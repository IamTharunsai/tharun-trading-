jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
import axios from 'axios';
import { logger } from '../src/utils/logger';
import { getLlmHealth, routedMessagesCreate } from '../src/utils/llmRouter';

const originalEnv = { ...process.env };
const post = axios.post as jest.Mock;
const params = { model: 'fast', max_tokens: 700, temperature: 0.3, messages: [{ role: 'user', content: 'PRIVATE_PROMPT_FIXTURE' }] };
const response = (content: any = '{"vote":"HOLD"}', reason: any = 'stop', extra: any = {}) => ({ data: { choices: [{ finish_reason: reason, message: { role: 'assistant', content, ...extra } }], usage: { prompt_tokens: 3, completion_tokens: 4 } } });
beforeEach(() => {
  jest.clearAllMocks(); process.env = { ...originalEnv };
  // Completion contracts isolate transport timing; pacing is exercised separately.
  process.env.LLM_ADMISSION_NVIDIA_INTERVAL_MS = '0';
  process.env.LLM_PROVIDER_FAST = 'openai_compat';
  process.env.LLM_MODEL_FAST = `fixture-${expect.getState().currentTestName}`;
  process.env.OPENAI_COMPAT_BASE_URL = 'http://127.0.0.1:9999/fixture';
  delete process.env.NVIDIA_API_KEY; delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => { process.env = originalEnv; });

test('an unobserved configured model is not healthy', () => {
  expect(getLlmHealth().fast).toMatchObject({ healthy: false, observed: false });
});
const invalidResponses: Array<[string, ReturnType<typeof response>, string]> = [
  ['length', response('{"vote":"HOLD"}', 'length'), 'truncated'],
  ['missing reason', response('ok', undefined), 'malformed_envelope'],
  ['unknown reason', response('ok', 'future_stop'), 'malformed_envelope'],
  ['refusal', response('ok', 'stop', { refusal: 'PRIVATE_REFUSAL' }), 'refused'],
  ['tools', response('ok', 'stop', { tool_calls: [{ id: 'private-tool' }] }), 'unexpected_tools'],
  ['tool reason', response('ok', 'tool_calls'), 'unexpected_tools'],
  ['nontext', response({ private: 'PRIVATE_TEXT' }), 'malformed_envelope'],
  ['empty', response(' '), 'empty'],
  ['reasoning only', response('<think>PRIVATE_REASONING</think>'), 'empty'],
  ['unclosed reasoning', response('<think>PRIVATE_REASONING'), 'incomplete_reasoning'],
];
test.each(invalidResponses)('%s cannot be published as a completed answer', async (_label, fixture, code) => {
  if (_label === 'missing reason') delete fixture.data.choices[0].finish_reason;
  post.mockResolvedValue(fixture);
  await expect(routedMessagesCreate(params)).rejects.toMatchObject({ code, reportedUsage: { provider: 'openai_compat', usage: { input_tokens: 3, output_tokens: 4 } } });
  expect(post).toHaveBeenCalledTimes(1);
  expect(getLlmHealth().fast).toMatchObject({ healthy: false, lastError: code, transportHealthy: true });
  expect((logger.warn as jest.Mock).mock.calls[0][1]).toMatchObject({ validationCode: code, inputTokens: 3, outputTokens: 4 });
});
test('a valid stopped response has normalized completion metadata', async () => {
  post.mockResolvedValue(response());
  const result = await routedMessagesCreate(params);
  expect(result.completion).toEqual({ finishReason: 'stop', validation: 'text' });
  expect(result.usage).toEqual({ input_tokens: 3, output_tokens: 4 });
  expect(getLlmHealth().fast).toMatchObject({ healthy: true, completionHealthy: true, structuredHealthy: null });
});
test('structured malformed JSON and domain schema rejection are distinct and nonretryable', async () => {
  const options = { structured: true, validateText: (text: string) => {
    const parsed = JSON.parse(text); if (parsed.vote !== 'HOLD') throw new Error('PRIVATE_SCHEMA_ERROR');
  } };
  post.mockResolvedValue(response('{"vote":'));
  await expect(routedMessagesCreate(params, undefined, options)).rejects.toMatchObject({ code: 'invalid_json' });
  post.mockResolvedValue(response('{"vote":"OTHER"}'));
  await expect(routedMessagesCreate(params, undefined, options)).rejects.toMatchObject({ code: 'schema_invalid' });
  expect(getLlmHealth().fast).toMatchObject({ transportHealthy: true, completionHealthy: true, structuredHealthy: false, healthy: false });
  post.mockResolvedValue(response('ordinary chat'));
  await routedMessagesCreate(params);
  expect(getLlmHealth().fast.healthy).toBe(false);
  post.mockResolvedValue(response());
  await routedMessagesCreate(params, undefined, options);
  expect(getLlmHealth().fast).toMatchObject({ structuredHealthy: true, healthy: true });
  expect(post).toHaveBeenCalledTimes(4);
});
test.each(['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-ultra-550b-a55b'])('documented structured controls apply only to NVIDIA %s and preserve cap', async (model) => {
  process.env.LLM_PROVIDER_FAST = 'nvidia'; process.env.LLM_MODEL_FAST = model; process.env.NVIDIA_API_KEY = 'fixture-private-key';
  post.mockResolvedValue(response());
  await routedMessagesCreate(params, undefined, { structured: true });
  expect(post.mock.calls[0][1]).toMatchObject({ max_tokens: 700, temperature: 1, top_p: 0.95, chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true } });
});
test('unrelated models and ordinary chat do not receive Nemotron-specific controls', async () => {
  post.mockResolvedValue(response());
  await routedMessagesCreate(params, undefined, { structured: true });
  expect(post.mock.calls[0][1]).not.toHaveProperty('chat_template_kwargs');
  process.env.LLM_PROVIDER_FAST = 'nvidia'; process.env.NVIDIA_API_KEY = 'fixture-private-key'; process.env.LLM_MODEL_FAST = 'nvidia/nemotron-3-super-120b-a12b';
  await routedMessagesCreate(params);
  expect(post.mock.calls[1][1]).toMatchObject({ temperature: 0.3, max_tokens: 700 });
  expect(post.mock.calls[1][1]).not.toHaveProperty('chat_template_kwargs');
});
test('same-provider fallback success cannot hide a failed primary model', async () => {
  process.env.LLM_PROVIDER_FAST = 'nvidia'; process.env.NVIDIA_API_KEY = 'fixture-private-key';
  post.mockRejectedValueOnce({ response: { status: 503, data: { error: 'PRIVATE_PROVIDER_ECHO' } } }).mockResolvedValueOnce(response());
  const result = await routedMessagesCreate(params);
  expect(result.model).toBe('openai/gpt-oss-20b');
  expect(getLlmHealth().fast).toMatchObject({ healthy: false, lastError: 'transport_error' });
  const emitted = JSON.stringify([getLlmHealth(), (logger.info as jest.Mock).mock.calls, (logger.warn as jest.Mock).mock.calls]);
  expect(emitted).not.toMatch(/PRIVATE_|fixture-private-key/);
});
test('a quota hint only in a 400 provider body preserves transport fallback without exposing the body', async () => {
  process.env.NVIDIA_API_KEY = 'fixture-private-key';
  post.mockRejectedValueOnce({ message: 'HTTP 400', response: { status: 400, data: { error: { message: 'PRIVATE_ECHO quota exceeded' } } } })
    .mockResolvedValueOnce(response());
  const result = await routedMessagesCreate(params);
  expect(result.provider).toBe('nvidia'); expect(post).toHaveBeenCalledTimes(2);
  expect(getLlmHealth().fast).toMatchObject({ healthy: false, lastError: 'transport_error' });
  expect(JSON.stringify([getLlmHealth(), (logger.warn as jest.Mock).mock.calls])).not.toContain('PRIVATE_ECHO');
});
test('an invalid answer never starts an available paid fallback', async () => {
  process.env.NVIDIA_API_KEY = 'fixture-private-key'; process.env.ANTHROPIC_API_KEY = 'fixture-anthropic-key';
  post.mockResolvedValue(response('partial', 'length'));
  const create = jest.fn();
  await expect(routedMessagesCreate(params, create)).rejects.toMatchObject({ code: 'truncated' });
  expect(post).toHaveBeenCalledTimes(1); expect(create).not.toHaveBeenCalled();
});
test('raw provider bodies and errors cannot escape through thrown errors or telemetry', async () => {
  post.mockRejectedValue({ message: 'PRIVATE_MESSAGE', response: { status: 400, data: { error: 'PRIVATE_BODY' } }, config: { headers: { Authorization: 'PRIVATE_TOKEN' } } });
  const error = await routedMessagesCreate(params).catch(err => err);
  expect(error.message).toBe('All LLM providers failed: transport_error');
  expect(error.cause).toBeUndefined();
  expect(JSON.stringify([error, getLlmHealth(), (logger.warn as jest.Mock).mock.calls])).not.toMatch(/PRIVATE_/);
});
test('invalid or absent reported usage remains unknown instead of invented zero', async () => {
  post.mockResolvedValue({ ...response(), data: { ...response().data, usage: { prompt_tokens: -1, completion_tokens: '4' } } });
  const result = await routedMessagesCreate(params);
  expect(result.usage.input_tokens).toBeUndefined(); expect(result.usage.output_tokens).toBeUndefined();
});
test('a shared deadline aborts a pending provider and never starts fallback', async () => {
  process.env.NVIDIA_API_KEY = 'fixture-private-key'; process.env.LLM_TIMEOUT_MS = '20';
  post.mockImplementation((_url, _body, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('PRIVATE_TRANSPORT_ABORT')), { once: true });
  }));
  await expect(routedMessagesCreate(params)).rejects.toMatchObject({ code: 'timeout' });
  expect(post).toHaveBeenCalledTimes(1);
});
test('transport fallback reuses the original deadline signal', async () => {
  process.env.NVIDIA_API_KEY = 'fixture-private-key'; process.env.LLM_TIMEOUT_MS = '40';
  post.mockImplementationOnce(() => new Promise((_resolve, reject) => setTimeout(() => reject({ response: { status: 503 } }), 5)))
    .mockImplementation((_url, _body, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('PRIVATE_ABORT')), { once: true });
    }));
  await expect(routedMessagesCreate(params)).rejects.toMatchObject({ code: 'timeout' });
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[1][2].signal).toBe(post.mock.calls[0][2].signal);
});
test.each(['max_tokens', 'tool_use', 'refusal', null])('Anthropic stop reason %s is refused for text-only calls', async (stop_reason) => {
  process.env.LLM_PROVIDER_FAST = 'anthropic';
  const create = jest.fn().mockResolvedValue({ stop_reason, content: [{ type: 'text', text: 'private' }] });
  await expect(routedMessagesCreate(params, create)).rejects.toMatchObject({ code: expect.any(String) });
  expect(create).toHaveBeenCalledTimes(1);
});
test('Anthropic end_turn text succeeds and structured-only fields stay out of SDK request options', async () => {
  process.env.LLM_PROVIDER_FAST = 'anthropic';
  const create = jest.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"vote":"HOLD"}' }] });
  await routedMessagesCreate(params, create, { structured: true, validateText: text => { JSON.parse(text); } });
  expect(create.mock.calls[0][1]).not.toHaveProperty('structured');
});
