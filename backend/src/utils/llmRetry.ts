/** Retry only an observed429, within the original logical call deadline. */
export async function retryLlmRateLimit<T>(operation: () => Promise<T>, options: {
  deadlineAt: number; signal?: AbortSignal; maxRetries: number;
  onRetry?: (attempt: number, waitMs: number) => void;
}): Promise<T> {
  if (!Number.isFinite(options.deadlineAt) || !Number.isInteger(options.maxRetries) || options.maxRetries < 0 || options.maxRetries > 3) throw new Error('Invalid LLM retry policy');
  const expired = () => Object.assign(new Error('LLM logical call deadline exceeded'), { code: 'timeout', status: 504 });
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted(); if (performance.now() >= options.deadlineAt) throw expired();
    try { return await operation(); }
    catch (error: any) {
      options.signal?.throwIfAborted();
      if (error?.status !== 429 || attempt >= options.maxRetries) throw error;
      const hint = error?.retryAfterMs;
      const delay = (Number.isFinite(hint) && hint >= 0 ? hint : 15_000) + 1000;
      if (delay >= options.deadlineAt - performance.now()) throw expired();
      options.onRetry?.(attempt + 1, delay);
      await new Promise<void>((resolve, reject) => {
        const signal = options.signal;
        const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, delay);
        signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
      });
    }
  }
}
