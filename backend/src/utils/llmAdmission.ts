/** Process-local pacing, not an account quota or a spending ledger. */
export type AdmissionProvider = 'anthropic' | 'ollama' | 'nvidia' | 'openai_compat';
export interface AdmissionPolicy { maxActive: number; maxQueued: number; maxWaitMs: number; intervalMs: number }
export class LlmAdmissionError extends Error {
  constructor(readonly code: 'admission_config' | 'admission_guard' | 'queue_full' | 'queue_timeout' | 'rate_limited', readonly status = 503,
    readonly retryAfterMs?: number, readonly retryAfterSource?: 'server' | 'default') { super(code); }
}
function limit(name: string, fallback: number, min: number, max: number): number {
  if (process.env[name] !== undefined && !process.env[name]!.trim()) throw new LlmAdmissionError('admission_config');
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new LlmAdmissionError('admission_config');
  return value;
}
export function admissionPolicy(provider: AdmissionProvider): AdmissionPolicy {
  return { maxActive: limit('LLM_ADMISSION_MAX_ACTIVE', 2, 1, 8), maxQueued: limit('LLM_ADMISSION_MAX_QUEUED', 32, 0, 64),
    maxWaitMs: limit('LLM_ADMISSION_MAX_WAIT_MS', 30_000, 1, 60_000),
    intervalMs: provider === 'nvidia' ? limit('LLM_ADMISSION_NVIDIA_INTERVAL_MS', 2000, 0, 60_000) : 0 };
}

/** RFC9110: delay-seconds or HTTP-date; never clamp a valid server delay down. */
export function retryAfterMs(headers: unknown, receivedAt = Date.now()): number | undefined {
  const input = headers as { get?: (name: string) => unknown; [key: string]: unknown } | undefined;
  const value = typeof input?.get === 'function' ? input.get('retry-after') : input?.['retry-after'] ?? input?.['Retry-After'];
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const text = String(value).trim(); if (!text) return;
  // A very long digit delay is beyond any call deadline; never turn it into
  // an early15s retry just because parsing work is bounded.
  if (text.length > 128) return /^\d{129}$/.test(text.slice(0, 129)) ? Number.MAX_SAFE_INTEGER : undefined;
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? Math.min(Number.MAX_SAFE_INTEGER, seconds * 1000) : Number.MAX_SAFE_INTEGER;
  }
  // Accept the three HTTP-date forms, not arbitrary Date.parse numeric strings.
  const dateForm = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
  if (!dateForm.test(text)) return;
  const until = Date.parse(text.endsWith('GMT') ? text : `${text} GMT`);
  return Number.isFinite(until) ? Math.max(0, until - receivedAt) : undefined;
}
interface Waiter { signal: AbortSignal; grant: () => void; reject: (error: unknown) => void; cancel: () => void }
interface Bucket {
  active: number; queue: Waiter[]; nextStart: number; cooldownUntil: number; timer?: ReturnType<typeof setTimeout>;
  startTail: Promise<void>;
  dispatched: number; refused: number; rateLimited: number;
}
export interface AdmissionReceipt { queueWaitMs: number; active: number; queued: number }
export class LlmAdmission {
  private readonly buckets = new Map<AdmissionProvider, Bucket>();
  constructor(private readonly policy = admissionPolicy, private readonly now = () => performance.now()) {}
  private bucket(provider: AdmissionProvider) {
    let value = this.buckets.get(provider);
    if (!value) { value = { active: 0, queue: [], nextStart: 0, cooldownUntil: 0, startTail: Promise.resolve(), dispatched: 0, refused: 0, rateLimited: 0 }; this.buckets.set(provider, value); }
    return value;
  }
  snapshot() {
    return [...this.buckets].map(([provider, bucket]) => ({ provider, active: bucket.active, queued: bucket.queue.length,
      cooldownRemainingMs: Math.max(0, Math.ceil(bucket.cooldownUntil - this.now())), dispatched: bucket.dispatched,
      refused: bucket.refused, rateLimited: bucket.rateLimited }));
  }
  private pump(provider: AdmissionProvider, bucket: Bucket) {
    if (bucket.timer) { clearTimeout(bucket.timer); bucket.timer = undefined; }
    if (!bucket.queue.length) return;
    const wait = bucket.cooldownUntil - this.now();
    if (wait > 0) {
      bucket.timer = setTimeout(() => { bucket.timer = undefined; this.pump(provider, bucket); }, Math.min(wait, 30_000));
      bucket.timer.unref?.(); return;
    }
    while (bucket.queue.length && bucket.active < this.policy(provider).maxActive) {
      const waiter = bucket.queue.shift()!; waiter.signal.removeEventListener('abort', waiter.cancel);
      if (waiter.signal.aborted) { waiter.reject(waiter.signal.reason); continue; }
      bucket.active++; waiter.grant();
    }
  }
  private acquire(provider: AdmissionProvider, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted(); const policy = this.policy(provider), bucket = this.bucket(provider);
    const release = () => { bucket.active--; this.pump(provider, bucket); };
    if (!bucket.queue.length && bucket.active < policy.maxActive && bucket.cooldownUntil <= this.now()) {
      bucket.active++; return Promise.resolve(release);
    }
    if (bucket.queue.length >= policy.maxQueued) { bucket.refused++; return Promise.reject(new LlmAdmissionError('queue_full')); }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { signal, reject, grant: () => resolve(release), cancel: () => {
        const index = bucket.queue.indexOf(waiter); if (index < 0) return;
        bucket.queue.splice(index, 1); signal.removeEventListener('abort', waiter.cancel); bucket.refused++;
        reject(signal.reason); this.pump(provider, bucket);
      } };
      bucket.queue.push(waiter); signal.addEventListener('abort', waiter.cancel, { once: true });
      if (signal.aborted) waiter.cancel(); else this.pump(provider, bucket);
    });
  }
  private async start<T>(provider: AdmissionProvider, signal: AbortSignal, beforeDispatch: (() => Promise<void> | void), operation: () => Promise<T>) {
    const bucket = this.bucket(provider);
    const previous = bucket.startTail; let unlock!: () => void;
    bucket.startTail = new Promise<void>(resolve => { unlock = resolve; });
    // At most maxActive tasks can own this chain. An abort-ignoring guard
    // cannot accumulate unlimited continuations by releasing its slot early.
    await previous;
    try { while (true) {
      signal.throwIfAborted(); const now = this.now(), delay = Math.max(bucket.nextStart, bucket.cooldownUntil) - now;
      if (delay <= 0) {
        await beforeDispatch(); signal.throwIfAborted();
        // Another active request can extend cooldown during an async guard.
        if (Math.max(bucket.nextStart, bucket.cooldownUntil) > this.now()) continue;
        bucket.nextStart = this.now() + this.policy(provider).intervalMs; bucket.dispatched++;
        return { pending: operation() };
      }
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, Math.min(delay, 30_000));
        signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
      });
    } } finally { unlock(); }
  }
  async run<T>(provider: AdmissionProvider, signal: AbortSignal, operation: () => Promise<T>, options: {
    beforeDispatch?: (signal: AbortSignal) => Promise<void> | void; onDispatch?: (receipt: AdmissionReceipt) => void;
  } = {}): Promise<T> {
    signal.throwIfAborted(); const policy = this.policy(provider), queuedAt = this.now();
    const waiting = new AbortController(); const timeout = setTimeout(() => waiting.abort(new LlmAdmissionError('queue_timeout')), policy.maxWaitMs);
    const effective = AbortSignal.any([signal, waiting.signal]);
    let release: (() => void) | undefined;
    try { release = await this.acquire(provider, effective); }
    catch (error) { clearTimeout(timeout); throw error; }
    const bucket = this.bucket(provider);
    // The underlying task owns its permit. A caller deadline must not free it
    // while an abort-ignoring callback/transport is still physically pending.
    const task = (async () => {
      let dispatched = false;
      try {
        const { pending } = await this.start(provider, effective, async () => {
          effective.throwIfAborted();
          try { await options.beforeDispatch?.(effective); }
          catch { effective.throwIfAborted(); throw new LlmAdmissionError('admission_guard'); }
        }, () => {
          clearTimeout(timeout); dispatched = true;
          options.onDispatch?.({ queueWaitMs: Math.max(0, this.now() - queuedAt), active: bucket.active, queued: bucket.queue.length });
          return operation();
        });
        return await pending;
      } catch (error: any) {
        if (dispatched && (error?.status ?? error?.response?.status) === 429) {
          const hint = retryAfterMs(error?.headers ?? error?.response?.headers), delay = hint ?? 15_000;
          bucket.cooldownUntil = Math.max(bucket.cooldownUntil, this.now() + delay); bucket.rateLimited++;
          throw new LlmAdmissionError('rate_limited', 429, delay, hint === undefined ? 'default' : 'server');
        }
        throw error;
      } finally { clearTimeout(timeout); release!(); }
    })();
    return new Promise<T>((resolve, reject) => {
      const cancel = () => { effective.removeEventListener('abort', cancel); reject(signal.aborted ? signal.reason : effective.reason); };
      effective.addEventListener('abort', cancel, { once: true });
      task.then(value => { effective.removeEventListener('abort', cancel); resolve(value); }, error => { effective.removeEventListener('abort', cancel); reject(error); });
      if (effective.aborted) cancel();
    });
  }
}
export const llmAdmission = new LlmAdmission();
