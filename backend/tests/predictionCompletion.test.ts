jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('../src/services/sentimentService', () => ({ getHeadlinesForQuery: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/utils/prisma', () => ({ prisma: {} }));
jest.mock('../src/websocket/server', () => ({ getIO: () => null }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import axios from 'axios';
import { estimateProbabilityWithLLM } from '../src/services/polymarket';
import { logger } from '../src/utils/logger';
const originalEnv = { ...process.env };
const post = axios.post as jest.Mock;
const input = { question: 'PRIVATE_QUESTION', yesPrice: 0.4, headlines: [] };
const valid = { ourProbabilityYes: 0.7, confidence: 70, recommendedSide: 'YES', reasoning: 'PRIVATE_REASONING', riskFactors: [] };
function response(content: string, finishReason = 'stop') {
  return { data: { choices: [{ finish_reason: finishReason, message: { role: 'assistant', content } }] } };
}
beforeEach(() => {
  jest.clearAllMocks(); post.mockReset();
  process.env = { ...originalEnv, LLM_PROVIDER_SMART: 'nvidia', NVIDIA_API_KEY: 'fixture-key',
    LLM_MODEL_SMART: 'nvidia/nemotron-3-ultra-550b-a55b', LLM_ADMISSION_NVIDIA_INTERVAL_MS: '0' };
  delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => { process.env = originalEnv; });

test('actual estimation path requests bounded structured Nemotron output and accepts its domain schema', async () => {
  post.mockResolvedValue(response(JSON.stringify(valid)));
  expect(await estimateProbabilityWithLLM(input)).toMatchObject({ pYes: 0.7, confidence: 70, recommendedSide: 'YES' });
  const request = post.mock.calls[0][1];
  expect(request).toMatchObject({ max_tokens: 700, temperature: 1, top_p: 0.95,
    chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true } });
  expect(request.messages[0].content).not.toMatch(/kellyFraction|"edge"/);
  expect(post).toHaveBeenCalledTimes(1);
});
test.each([
  ['truncated', JSON.stringify(valid), 'length'],
  ['invalid_json', '{incomplete', 'stop'],
  ['schema_invalid', JSON.stringify({ ...valid, confidence: 700 }), 'stop'],
  ['schema_invalid', JSON.stringify({ ...valid, ourProbabilityYes: '0.7' }), 'stop'],
])('%s remains unknown and logs only a fixed refusal code', async (code, content, finishReason) => {
  post.mockResolvedValue(response(content, finishReason));
  expect(await estimateProbabilityWithLLM(input)).toBeNull();
  expect(post).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith('prediction_estimate_refused',
    { event: 'prediction_estimate_refused', source: 'routed', validationCode: code });
  expect(JSON.stringify([(logger.warn as jest.Mock).mock.calls, (logger.info as jest.Mock).mock.calls]))
    .not.toMatch(/PRIVATE_|fixture-key/);
});
