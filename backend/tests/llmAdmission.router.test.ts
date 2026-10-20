jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
import axios from 'axios';
import { logger } from '../src/utils/logger';
import { getLlmHealth, routedMessagesCreate, llmText } from '../src/utils/llmRouter';
const post = axios.post as jest.Mock, originalEnv = { ...process.env };
const params = { model: 'fast', max_tokens: 700, messages: [{ role: 'user', content: 'PRIVATE_PROMPT' }] };
const complete = () => ({ data: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }] } });
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise(resolveValue => { resolve = resolveValue; }); return { promise, resolve }; };
async function dispatched(count: number) { for (let i = 0; i < 100; i++) { if (post.mock.calls.length >= count) return; await new Promise(resolve => setImmediate(resolve)); } throw new Error('fixture did not dispatch'); }
beforeEach(() => {
  jest.clearAllMocks(); post.mockReset(); process.env = { ...originalEnv, LLM_PROVIDER_FAST: 'openai_compat', LLM_PROVIDER_SMART: 'openai_compat',
    OPENAI_COMPAT_BASE_URL: 'http://127.0.0.1:9999/fixture', LLM_ADMISSION_MAX_ACTIVE: '1', LLM_ADMISSION_MAX_QUEUED: '32', LLM_ADMISSION_NVIDIA_INTERVAL_MS: '0' };
  delete process.env.NVIDIA_API_KEY; delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => { process.env = originalEnv; });

test('fast and smart share physical capacity; a local refusal never becomes provider health failure', async () => {
  process.env.LLM_ADMISSION_MAX_QUEUED = '0'; const pending = deferred(); post.mockReturnValue(pending.promise);
  const first = routedMessagesCreate(params); await dispatched(1);
  await expect(routedMessagesCreate({ ...params, model: 'smart' })).rejects.toMatchObject({ code: 'queue_full' });
  expect(post).toHaveBeenCalledTimes(1); expect(getLlmHealth().fast.observed).toBe(false);
  expect((logger.warn as jest.Mock).mock.calls[0]).toEqual(['llm_admission_refused', expect.objectContaining({ dispatched: false, validationCode: 'queue_full' })]);
  pending.resolve(complete()); await first;
});
test('a queued current budget/lease guard can refuse before physical dispatch', async () => {
  const pending = deferred(); post.mockReturnValueOnce(pending.promise).mockResolvedValue(complete()); let permitted = true;
  const first = routedMessagesCreate(params); await dispatched(1);
  const second = routedMessagesCreate(params, undefined, { beforeDispatch: () => { if (!permitted) throw new Error('PRIVATE_BUDGET_OR_LEASE'); } }).catch(error => error);
  permitted = false; pending.resolve(complete()); await first;
  expect(await second).toMatchObject({ code: 'admission_guard' }); expect(post).toHaveBeenCalledTimes(1);
  expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('PRIVATE_BUDGET');
});
test('a canceled abort-ignoring transport retains capacity until its real settlement', async () => {
  const pending = deferred(), controller = new AbortController(); post.mockReturnValueOnce(pending.promise).mockResolvedValue(complete());
  const first = routedMessagesCreate(params, undefined, { signal: controller.signal }).catch(error => error); await dispatched(1);
  controller.abort(new Error('fixture canceled')); await first;
  const second = routedMessagesCreate({ ...params, model: 'smart' }); await new Promise(resolve => setImmediate(resolve)); expect(post).toHaveBeenCalledTimes(1);
  pending.resolve(complete()); await second; expect(post).toHaveBeenCalledTimes(2); expect(getLlmHealth().admission.providers[0].active).toBe(0);
});
test('llmText forwards caller cancellation instead of leaving a raced request running', async () => {
  const controller = new AbortController(); post.mockImplementation((_url, _body, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('fixture HTTP canceled')), { once: true });
  }));
  const result = llmText({ prompt: 'PRIVATE_PROMPT', signal: controller.signal }).catch(error => error); await dispatched(1);
  controller.abort(new Error('fixture canceled')); expect((await result).message).toBe('fixture canceled'); expect(post.mock.calls[0][2].signal.aborted).toBe(true);
});
test('SDK retries are disabled in both ordinary and injected Anthropic paths', async () => {
  process.env.LLM_PROVIDER_FAST = 'anthropic'; const create = jest.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
  await routedMessagesCreate(params, create); expect(create.mock.calls[0][1]).toMatchObject({ maxRetries: 0, timeout: expect.any(Number), signal: expect.any(AbortSignal) });
});
test('429 skips another NVIDIA model, preserves configured distinct fallback, and sanitizes its hint', async () => {
  process.env.LLM_PROVIDER_FAST = 'nvidia'; process.env.NVIDIA_API_KEY = 'fixture-key'; process.env.ANTHROPIC_API_KEY = 'fixture-anthropic';
  post.mockRejectedValue({ response: { status: 429, headers: { 'retry-after': '120', authorization: 'PRIVATE_KEY' }, data: 'PRIVATE_BODY' } });
  const create = jest.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
  const result = await routedMessagesCreate(params, create); expect(result.provider).toBe('anthropic'); expect(post).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  expect(getLlmHealth().fast).toMatchObject({ healthy: false, lastError: 'rate_limited' });
  expect(getLlmHealth().admission.providers.find(row => row.provider === 'nvidia')!.cooldownRemainingMs).toBeGreaterThan(119000);
  expect(JSON.stringify([getLlmHealth(), (logger.info as jest.Mock).mock.calls, (logger.warn as jest.Mock).mock.calls])).not.toMatch(/PRIVATE_|fixture-key/);
});
