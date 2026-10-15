jest.mock('../src/middleware/auth', () => ({ requireOwner: jest.fn((req: any, res: any, next: () => void) => req.userId?.startsWith('owner-') ? next() : res.status(403).json({ error: 'owner_required' })) }));
jest.mock('../src/services/groundedDeepDive', () => ({ ...jest.requireActual('../src/services/groundedDeepDive'), runGroundedDeepDive: jest.fn() }));
jest.mock('../src/services/dashboardMarketEvidence', () => ({ getResearchStockQuote: jest.fn(), getDashboardCryptoAssets: jest.fn() }));
jest.mock('../src/utils/llmRouter', () => ({ routedMessagesCreate: jest.fn() }));
import { EventEmitter } from 'events';
import { deepDiveRouter } from '../src/routes/deepDive';
import { DeepDiveUnavailable, runGroundedDeepDive } from '../src/services/groundedDeepDive';
const run = runGroundedDeepDive as jest.Mock;
let identity = 0;
function request(body: unknown, userId = `owner-${++identity}`) {
  const req: any = { method: 'POST', url: '/', originalUrl: '/api/market/ai-deep-dive', body, userId, ip: '127.0.0.1', headers: {}, app: { get: () => false } };
  const res: any = new EventEmitter();
  res.statusCode = 200; res.headers = {}; res.writableEnded = false; res.destroyed = false;
  res.setHeader = (key: string, value: unknown) => { res.headers[key.toLowerCase()] = value; return res; };
  res.getHeader = (key: string) => res.headers[key.toLowerCase()];
  res.status = (code: number) => { res.statusCode = code; return res; };
  const done = new Promise<any>((resolve, reject) => {
    res.json = res.send = (payload: unknown) => { res.payload = payload; res.writableEnded = true; resolve(res); return res; };
    (deepDiveRouter as any).handle(req, res, (error: unknown) => error ? reject(error) : resolve({ statusCode: 404 }));
  });
  return { done, res };
}
beforeEach(() => { jest.clearAllMocks(); run.mockResolvedValue({ analysis: 'fixture source-backed note', tradingAuthority: false }); });
test('a non-owner never reaches research and responses are not cached', async () => {
  const { done } = request({ symbol: 'FIX' }, 'member'); const response = await done;
  expect(response.statusCode).toBe(403); expect(response.headers['cache-control']).toBe('no-store'); expect(run).not.toHaveBeenCalled();
});
test('invalid input is rejected before provider work', async () => {
  const response = await request({ symbol: 'FIX', arbitrary: 'prompt' }).done;
  expect(response.statusCode).toBe(400); expect(run).not.toHaveBeenCalled();
});
test('valid requests return the service result and no-store', async () => {
  const response = await request({ symbol: 'fix' }).done;
  expect(response.statusCode).toBe(200); expect(response.payload.tradingAuthority).toBe(false);
  expect(run).toHaveBeenCalledWith({ symbol: 'FIX', assetClass: 'stock' }, expect.any(AbortSignal));
  expect(response.headers['cache-control']).toBe('no-store');
});
test('source/provider failure yields only a bounded error, not a bullish fallback or raw message', async () => {
  run.mockRejectedValue(new DeepDiveUnavailable('evidence_unavailable'));
  expect((await request({ symbol: 'FIX' }).done).payload).toEqual({ error: 'evidence_unavailable' });
  run.mockRejectedValue(new Error('PRIVATE_KEY and raw provider response'));
  const response = await request({ symbol: 'FIX' }).done;
  expect(response.statusCode).toBe(503); expect(response.payload).toEqual({ error: 'research_unavailable' });
});
test('a concurrent note is refused and disconnect aborts the accepted one', async () => {
  let release!: (value: unknown) => void;
  run.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const first = request({ symbol: 'FIX' });
  // The actual rate limiter is async; settle its middleware microtasks first.
  await new Promise(resolve => setImmediate(resolve));
  expect((await request({ symbol: 'OTHER' }).done).statusCode).toBe(429);
  const signal = run.mock.calls[0][1] as AbortSignal;
  first.res.emit('close'); expect(signal.aborted).toBe(true);
  release({ analysis: 'must not publish' });
  const response = await first.done;
  expect(response.statusCode).toBe(503); expect(response.payload.analysis).toBeUndefined();
});
test('the owner request limit is enforced across repeated requests', async () => {
  const user = `owner-${++identity}`;
  for (let count = 0; count < 5; count++) expect((await request({ symbol: 'FIX' }, user).done).statusCode).toBe(200);
  const response = await request({ symbol: 'FIX' }, user).done;
  expect(response.statusCode).toBe(429); expect(response.payload).toEqual({ error: 'research_rate_limited' });
});
