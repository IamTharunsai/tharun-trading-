import { admissionPolicy, LlmAdmission, retryAfterMs } from '../src/utils/llmAdmission';
import { retryLlmRateLimit } from '../src/utils/llmRetry';
const originalEnv = { ...process.env };
const policy = (extra = {}) => ({ maxActive: 2, maxQueued: 2, maxWaitMs: 1000, intervalMs: 20, ...extra });
const deferred = <T = string>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const signal = () => new AbortController().signal;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); process.env = { ...originalEnv };
  for (const key of Object.keys(process.env)) if (key.startsWith('LLM_ADMISSION_')) delete process.env[key]; });
afterEach(() => { jest.useRealTimers(); process.env = { ...originalEnv }; });

test('conservative defaults are local bounded policy, not a provider quota', () => {
  expect(admissionPolicy('nvidia')).toEqual({ maxActive: 2, maxQueued: 32, maxWaitMs: 30000, intervalMs: 2000 });
  expect(admissionPolicy('anthropic').intervalMs).toBe(0);
  process.env.LLM_ADMISSION_MAX_ACTIVE = '9'; expect(() => admissionPolicy('nvidia')).toThrow('admission_config');
  delete process.env.LLM_ADMISSION_MAX_ACTIVE; process.env.LLM_ADMISSION_NVIDIA_INTERVAL_MS = ''; expect(() => admissionPolicy('nvidia')).toThrow('admission_config');
});
test.each([['120', 120000], ['0', 0], ['-1', undefined], ['1.5', undefined], ['nonsense', undefined],
  ['Wed, 21 Oct 2015 07:28:00 GMT', 60000], ['99999999999999999999999', Number.MAX_SAFE_INTEGER]])('Retry-After %s is normalized without shortening', (value, expected) => {
  expect(retryAfterMs({ 'retry-after': value }, Date.parse('2015-10-21T07:27:00Z'))).toBe(expected);
});
test('Headers-style access and HTTP-date past/obsolete forms are supported', () => {
  expect(retryAfterMs({ get: () => '5' })).toBe(5000);
  expect(retryAfterMs({ 'Retry-After': 'Sunday, 06-Nov-94 08:49:37 GMT' }, Date.parse('1994-11-06T08:49:30Z'))).toBe(7000);
  expect(retryAfterMs({ 'retry-after': 'Sun Nov  6 08:49:37 1994' }, Date.parse('1994-11-06T08:49:40Z'))).toBe(0);
  expect(retryAfterMs({ 'retry-after': '9'.repeat(512) })).toBe(Number.MAX_SAFE_INTEGER);
});
test('shared physical cap, start spacing, FIFO queue and full refusal', async () => {
  const gate = new LlmAdmission(() => policy(), Date.now), pending = [deferred(), deferred(), deferred(), deferred()];
  const starts: Array<{ id: number; at: number }> = [];
  const tasks = pending.map((item, id) => gate.run('nvidia', signal(), () => { starts.push({ id, at: Date.now() }); return item.promise; }));
  const full = gate.run('nvidia', signal(), async () => 'must not run').catch(error => error);
  expect(await full).toMatchObject({ code: 'queue_full' });
  await jest.advanceTimersByTimeAsync(20); expect(starts).toEqual([{ id: 0, at: 0 }, { id: 1, at: 20 }]);
  expect(gate.snapshot()[0]).toMatchObject({ active: 2, queued: 2 });
  pending[0].resolve('one'); await jest.advanceTimersByTimeAsync(20);
  expect(starts[2]).toEqual({ id: 2, at: 40 });
  pending[1].resolve('two'); await jest.advanceTimersByTimeAsync(20); expect(starts[3]).toEqual({ id: 3, at: 60 });
  pending[2].resolve('three'); pending[3].resolve('four'); await Promise.all(tasks);
  expect(gate.snapshot()[0]).toMatchObject({ active: 0, queued: 0, dispatched: 4 }); expect(jest.getTimerCount()).toBe(0);
});
test('canceled queued waiter is removed immediately and never starts', async () => {
  const gate = new LlmAdmission(() => policy({ maxActive: 1, intervalMs: 0 }), Date.now), pending = deferred(), controller = new AbortController();
  const first = gate.run('nvidia', signal(), () => pending.promise), operation = jest.fn();
  const second = gate.run('nvidia', controller.signal, operation).catch(error => error);
  controller.abort(new Error('fixture canceled')); expect((await second).message).toBe('fixture canceled');
  expect(gate.snapshot()[0].queued).toBe(0); pending.resolve('done'); await first; expect(operation).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
test('caller cancellation returns promptly but retains abort-ignoring physical permit', async () => {
  const gate = new LlmAdmission(() => policy({ maxActive: 1, intervalMs: 0 }), Date.now), pending = deferred(), controller = new AbortController();
  const first = gate.run('nvidia', controller.signal, () => pending.promise).catch(error => error);
  await jest.advanceTimersByTimeAsync(0); controller.abort(new Error('fixture canceled')); await first;
  const next = jest.fn(async () => 'next'), second = gate.run('nvidia', signal(), next);
  await jest.advanceTimersByTimeAsync(100); expect(next).not.toHaveBeenCalled(); expect(gate.snapshot()[0]).toMatchObject({ active: 1, queued: 1 });
  pending.resolve('late'); expect(await second).toBe('next'); expect(gate.snapshot()[0].active).toBe(0);
});
test('queue expiry and an abort-ignoring guard cannot release hidden underlying work', async () => {
  const gate = new LlmAdmission(() => policy({ maxActive: 1, maxWaitMs: 50, intervalMs: 0 }), Date.now), guard = deferred<void>(), operation = jest.fn();
  const first = gate.run('nvidia', signal(), operation, { beforeDispatch: () => guard.promise }).catch(error => error);
  await jest.advanceTimersByTimeAsync(50); expect(await first).toMatchObject({ code: 'queue_timeout' });
  expect(gate.snapshot()[0].active).toBe(1); expect(operation).not.toHaveBeenCalled();
  guard.resolve(); await jest.advanceTimersByTimeAsync(0); expect(gate.snapshot()[0].active).toBe(0); expect(jest.getTimerCount()).toBe(0);
});
test('asynchronous authoritative guard is after wait and cannot collapse actual start spacing', async () => {
  const gate = new LlmAdmission(() => policy(), Date.now), guard = deferred<void>(), starts: number[] = [];
  const first = gate.run('nvidia', signal(), async () => { starts.push(Date.now()); }, { beforeDispatch: () => guard.promise });
  const second = gate.run('nvidia', signal(), async () => { starts.push(Date.now()); });
  await jest.advanceTimersByTimeAsync(25); expect(starts).toEqual([]); guard.resolve();
  await jest.advanceTimersByTimeAsync(20); await Promise.all([first, second]); expect(starts).toEqual([25, 45]);
});
test('guard rejection prevents any physical dispatch and does not retain its raw error', async () => {
  const gate = new LlmAdmission(() => policy(), Date.now), operation = jest.fn();
  const error = await gate.run('nvidia', signal(), operation, { beforeDispatch: () => { throw new Error('PRIVATE_GUARD'); } }).catch(error => error);
  expect(error).toMatchObject({ code: 'admission_guard' }); expect(JSON.stringify(error)).not.toContain('PRIVATE'); expect(operation).not.toHaveBeenCalled();
});
test('429 cooldown applies before releasing the slot and future starts honor it', async () => {
  const gate = new LlmAdmission(() => policy({ intervalMs: 0, maxWaitMs: 10000 }), Date.now), next = jest.fn(async () => 'ok');
  const limited = gate.run('nvidia', signal(), async () => { throw { response: { status: 429, headers: { 'retry-after': '5' } } }; }).catch(error => error);
  expect(await limited).toMatchObject({ code: 'rate_limited', status: 429, retryAfterMs: 5000 });
  const second = gate.run('nvidia', signal(), next);
  await jest.advanceTimersByTimeAsync(4999); expect(next).not.toHaveBeenCalled(); await jest.advanceTimersByTimeAsync(1); expect(await second).toBe('ok');
  expect(jest.getTimerCount()).toBe(0);
});
test('a long valid Retry-After expires the waiter rather than retrying early', async () => {
  const gate = new LlmAdmission(() => policy({ intervalMs: 0, maxWaitMs: 50 }), Date.now), operation = jest.fn();
  await gate.run('nvidia', signal(), async () => { throw { status: 429, headers: { 'retry-after': '120' } }; }).catch(() => undefined);
  const second = gate.run('nvidia', signal(), operation).catch(error => error);
  await jest.advanceTimersByTimeAsync(50); expect(await second).toMatchObject({ code: 'queue_timeout' });
  expect(operation).not.toHaveBeenCalled(); expect(gate.snapshot()[0].cooldownRemainingMs).toBe(119950); expect(jest.getTimerCount()).toBe(0);
});
test.each([[1, 10], [10, 1]])('overlapping429 hints %s/%s extend but never reduce cooldown', async (a, b) => {
  const gate = new LlmAdmission(() => policy({ intervalMs: 0 }), Date.now), first = deferred(), second = deferred();
  const one = gate.run('nvidia', signal(), () => first.promise).catch(error => error);
  const two = gate.run('nvidia', signal(), () => second.promise).catch(error => error);
  await jest.advanceTimersByTimeAsync(0);
  first.reject({ status: 429, headers: { 'retry-after': String(a) } }); await one;
  second.reject({ status: 429, headers: { 'retry-after': String(b) } }); await two;
  expect(gate.snapshot()[0]).toMatchObject({ active: 0, cooldownRemainingMs: 10000, rateLimited: 2 });
});
test('a cooldown extended during an async guard requires the guard again after waiting', async () => {
  const gate = new LlmAdmission(() => policy({ intervalMs: 0, maxWaitMs: 2000 }), Date.now), pending = deferred(), guard = deferred<void>();
  const one = gate.run('nvidia', signal(), () => pending.promise).catch(error => error);
  const check = jest.fn(() => guard.promise), operation = jest.fn(async () => Date.now());
  const two = gate.run('nvidia', signal(), operation, { beforeDispatch: check });
  await jest.advanceTimersByTimeAsync(0); pending.reject({ status: 429, headers: { 'retry-after': '1' } }); await one; guard.resolve();
  await jest.advanceTimersByTimeAsync(999); expect(operation).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1); expect(await two).toBe(1000); expect(check).toHaveBeenCalledTimes(2);
});
test('missing429 hint uses15s and a different provider remains independently available', async () => {
  const gate = new LlmAdmission(() => policy({ intervalMs: 0 }), Date.now);
  expect(await gate.run('nvidia', signal(), async () => { throw { status: 429 }; }).catch(error => error)).toMatchObject({ retryAfterMs: 15000 });
  expect(await gate.run('anthropic', signal(), async () => 'other')).toBe('other');
});
test('retry waits use the original deadline and do not retry contract failures', async () => {
  const operation = jest.fn().mockRejectedValue({ status: 429, retryAfterMs: 0 });
  const result = retryLlmRateLimit(operation, { deadlineAt: 2500, maxRetries: 3 }).catch(error => error);
  await jest.advanceTimersByTimeAsync(2500); expect(await result).toMatchObject({ code: 'timeout' }); expect(operation).toHaveBeenCalledTimes(3);
  const invalid = jest.fn().mockRejectedValue({ code: 'schema_invalid' });
  await expect(retryLlmRateLimit(invalid, { deadlineAt: 5000, maxRetries: 3 })).rejects.toMatchObject({ code: 'schema_invalid' }); expect(invalid).toHaveBeenCalledTimes(1);
});
test('retry respects long hints and cancellation without any later attempt', async () => {
  const operation = jest.fn().mockRejectedValue({ status: 429, retryAfterMs: 120000 });
  await expect(retryLlmRateLimit(operation, { deadlineAt: 60000, maxRetries: 3 })).rejects.toMatchObject({ code: 'timeout' }); expect(operation).toHaveBeenCalledTimes(1);
  const controller = new AbortController(), short = jest.fn().mockRejectedValue({ status: 429, retryAfterMs: 0 });
  const result = retryLlmRateLimit(short, { deadlineAt: 60000, maxRetries: 3, signal: controller.signal }).catch(error => error);
  await jest.advanceTimersByTimeAsync(0); controller.abort(new Error('fixture canceled')); expect((await result).message).toBe('fixture canceled');
  await jest.advanceTimersByTimeAsync(60000); expect(short).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
