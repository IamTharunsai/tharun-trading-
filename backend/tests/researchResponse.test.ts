jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
import axios from 'axios';
import { runBacktest } from '../src/trading/backtestingEngine';
import { parseResearchResponse, researchSymbols } from '../../frontend/src/services/researchReplay';

async function response() {
  const start = Date.parse('2025-01-01T00:00:00Z');
  (axios.get as jest.Mock).mockResolvedValue({ data: [100, 110, 120, 130, 140, 150].map((p, i) => [
    start + i * 3600000, String(p), String(p + 1), String(p - 1), String(p), '100', start + (i + 1) * 3600000 - 1,
  ]) });
  const results = await runBacktest({ startDate: '2025-01-01', endDate: '2025-01-01', symbols: ['BTC/USDT'],
    initialCapital: 1000, lookbackBars: 2, brokerFeesPct: 0, slippageBps: 0 });
  return { success: true, results, evaluation: { canGoLive: false } };
}
test('frontend contract accepts the actual backend replay without fabricating metrics', async () => {
  const payload = await response();
  expect(parseResearchResponse(payload, payload.results.configuration)).toBe(payload.results);
  expect(parseResearchResponse(payload, payload.results.configuration).sharpeRatio).toBeNull();
});
test('legacy simulated, wrong-capital and inconsistent cash responses are refused', async () => {
  expect(() => parseResearchResponse({ totalReturn: 20, sharpeRatio: 4 }, { initialCapital: 1000, symbols: [] } as any)).toThrow('incompatible');
  const payload = await response();
  expect(() => parseResearchResponse(payload, { ...payload.results.configuration, initialCapital: 2000 })).toThrow('incompatible');
  payload.results.equity[0].cash += 100;
  expect(() => parseResearchResponse(payload, payload.results.configuration)).toThrow('incompatible');
});
test('unqualified baseline cannot be presented as live approved or calibrated', async () => {
  const payload: any = await response();
  payload.evaluation.canGoLive = true;
  expect(() => parseResearchResponse(payload, payload.results.configuration)).toThrow('incompatible');
  payload.evaluation.canGoLive = false; payload.results.sharpeRatio = 10;
  expect(() => parseResearchResponse(payload, payload.results.configuration)).toThrow('incompatible');
});
test('instrument input normalizes case but never silently swaps currencies', () => {
  expect(researchSymbols('aapl, btc/usdt')).toEqual(['AAPL', 'BTC/USDT']);
  expect(() => researchSymbols('BTC/USD')).toThrow('quote conversions');
  expect(() => researchSymbols('ETH/BTC')).toThrow('quote conversions');
  expect(() => researchSymbols('AAPL, aapl')).toThrow('unique');
  expect(() => researchSymbols('')).toThrow('unique');
});
test('backend refuses cross-quote accounting without a conversion model', async () => {
  await expect(runBacktest({ startDate: '2025-01-01', endDate: '2025-01-01', symbols: ['ETH/BTC'], initialCapital: 1000 }))
    .rejects.toThrow();
});
test('a response is bound to the submitted instruments, dates and strategy parameters', async () => {
  const payload = await response(), requested = { ...payload.results.configuration };
  expect(() => parseResearchResponse(payload, { ...requested, symbols: ['AAPL'] })).toThrow('incompatible');
  expect(() => parseResearchResponse(payload, { ...requested, endDate: '2025-01-02' })).toThrow('incompatible');
  expect(() => parseResearchResponse(payload, { ...requested, lookbackBars: 10 })).toThrow('incompatible');
  payload.results.dataCoverage.AAPL = payload.results.dataCoverage['BTC/USDT'];
  expect(() => parseResearchResponse(payload, requested)).toThrow('incompatible');
});
test('inconsistent final cash and sample-trade P&L cannot be displayed', async () => {
  const a = await response(), b = await response();
  a.results.cash += 5;
  expect(() => parseResearchResponse(a, a.results.configuration)).toThrow('incompatible');
  b.results.sampleTrades[0].pnl += 5;
  expect(() => parseResearchResponse(b, b.results.configuration)).toThrow('incompatible');
});
