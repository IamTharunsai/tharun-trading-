jest.mock('../src/middleware/auth', () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));
jest.mock('../src/trading/backtestingEngine', () => ({
  ...jest.requireActual('../src/trading/backtestingEngine'), runBacktest: jest.fn(),
}));
import router from '../src/routes/backtest';
import { runBacktest } from '../src/trading/backtestingEngine';
const config = { startDate: '2025-01-01', endDate: '2025-01-02', symbols: ['BTC/USDT'], initialCapital: 1000 };
async function request(path: string, body: any) {
  const handler = (router as any).stack.find((layer: any) => layer.route?.path === path).route.stack[0].handle;
  const response: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await handler({ body }, response);
  return response;
}
beforeEach(() => jest.clearAllMocks());
test('validation uses actual strategy schema and preserves explicitly zero costs', async () => {
  const valid = await request('/validate', { ...config, brokerFeesPct: 0, slippageBps: 0 });
  expect(valid.json).toHaveBeenCalledWith(expect.objectContaining({ valid: true,
    config: expect.objectContaining({ brokerFeesPct: 0, slippageBps: 0 }) }));
  const invalid = await request('/validate', { ...config, strategy: 'freqai_lgbm' });
  expect(invalid.status).toHaveBeenCalledWith(400);
});
test('run rejects missing dates and unsupported strategies before provider work', async () => {
  expect((await request('/run', { symbols: ['BTC/USDT'] })).status).toHaveBeenCalledWith(400);
  expect((await request('/run', { ...config, strategy: 'freqai_lgbm' })).status).toHaveBeenCalledWith(400);
  expect(runBacktest).not.toHaveBeenCalled();
});
test('run and validation reject identical missing-capital and unknown-field payloads', async () => {
  for (const body of [{ ...config, initialCapital: undefined }, { ...config, unexpectedStrategySetting: 12 }]) {
    expect((await request('/validate', body)).status).toHaveBeenCalledWith(400);
    expect((await request('/run', body)).status).toHaveBeenCalledWith(400);
  }
  expect(runBacktest).not.toHaveBeenCalled();
});
test('run forwards declared parameters and returns live refusal with actual results', async () => {
  (runBacktest as jest.Mock).mockResolvedValue({ finalEquity: 990, sharpeRatio: null });
  const res = await request('/run', { ...config, brokerFeesPct: 0, slippageBps: 0, lookbackBars: 7, maxHoldBars: 8 });
  expect(runBacktest).toHaveBeenCalledWith(expect.objectContaining({ brokerFeesPct: 0, slippageBps: 0, lookbackBars: 7, maxHoldBars: 8 }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true,
    results: { finalEquity: 990, sharpeRatio: null }, evaluation: expect.objectContaining({ canGoLive: false }) }));
});
