jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
import axios from 'axios';
import { routedMessagesCreate } from '../src/utils/llmRouter';
beforeEach(() => {
  jest.clearAllMocks(); process.env.LLM_PROVIDER_FAST = 'openai_compat';
  process.env.OPENAI_COMPAT_BASE_URL = 'http://127.0.0.1:9999/fixture';
});
test('an already canceled request never calls a provider', async () => {
  const controller = new AbortController(); controller.abort(new Error('fixture canceled'));
  await expect(routedMessagesCreate({ model: 'fast', messages: [] }, undefined, { signal: controller.signal })).rejects.toThrow('fixture canceled');
  expect(axios.post).not.toHaveBeenCalled();
});
test('in-flight cancellation reaches HTTP and never starts a fallback provider', async () => {
  const controller = new AbortController();
  (axios.post as jest.Mock).mockImplementation((_url, _body, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('transport canceled')), { once: true });
  }));
  const result = routedMessagesCreate({ model: 'fast', messages: [] }, undefined, { signal: controller.signal });
  controller.abort(new Error('fixture canceled'));
  await expect(result).rejects.toThrow('fixture canceled');
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.objectContaining({ signal: controller.signal }));
});
