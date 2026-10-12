import { createPrivateKey, createPublicKey, verify } from 'crypto';
import { bindPolymarketUSRest } from '../src/services/polymarketUSRest';
const keyId = '00000000-0000-4000-8000-000000000001';
const seed = Buffer.alloc(32, 1); const secret = seed.toString('base64');
const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
test('signs timestamp, method and path only; sends once and rejects redirects', async () => {
  (fetch as jest.Mock).mockResolvedValue(new Response('{"id":"fixture"}'));
  const request = bindPolymarketUSRest(keyId, secret);
  expect(await request('POST', '/v1/orders', { quantity: 1 }, { limit: 1 })).toEqual({ id: 'fixture' });
  const [url, opts] = (fetch as jest.Mock).mock.calls[0];
  const key = createPublicKey(createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' }));
  expect(verify(null, Buffer.from(opts.headers['X-PM-Timestamp'] + 'POST/v1/orders'), key, Buffer.from(opts.headers['X-PM-Signature'], 'base64'))).toBe(true);
  expect(String(url)).toBe('https://api.polymarket.us/v1/orders?limit=1');
  expect(opts.redirect).toBe('error'); expect(fetch).toHaveBeenCalledTimes(1);
});
test('an error body cannot disclose credentials and is never retried', async () => {
  (fetch as jest.Mock).mockResolvedValue(new Response(secret, { status: 503 }));
  await expect(bindPolymarketUSRest(keyId, secret)('POST', '/v1/orders', {})).rejects.toThrow('transport failed');
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('a stalled response body reaches its deadline and cancels the stream', async () => {
  jest.useFakeTimers(); const cancel = jest.fn();
  (fetch as jest.Mock).mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const promise = bindPolymarketUSRest(keyId, secret)('GET', '/v1/orders/open');
  const result = expect(promise).rejects.toThrow('transport failed');
  await jest.advanceTimersByTimeAsync(10001); await result;
  expect(cancel).toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
});
test('a fetch that ignores abort still times out without a second request', async () => {
  jest.useFakeTimers(); (fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const result = expect(bindPolymarketUSRest(keyId, secret)('POST', '/v1/orders', {})).rejects.toThrow('transport failed');
  await jest.advanceTimersByTimeAsync(10001); await result; expect(fetch).toHaveBeenCalledTimes(1);
});
test('the response body is bounded', async () => {
  (fetch as jest.Mock).mockResolvedValue(new Response('x'.repeat(1048577)));
  await expect(bindPolymarketUSRest(keyId, secret)('GET', '/v1/orders/open')).rejects.toThrow('transport failed');
});
test('paths cannot change the exchange origin or traverse resources', async () => {
  await expect(bindPolymarketUSRest(keyId, secret)('GET', '/v1/../../private')).rejects.toThrow('resource path');
  expect(fetch).not.toHaveBeenCalled();
});
