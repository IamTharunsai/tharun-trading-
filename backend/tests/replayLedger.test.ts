jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
import axios from 'axios';
import { replayLedger, ReplaySettings } from '../src/trading/replayLedger';
import { HistoricalBar } from '../src/trading/historicalBars';
import { runBacktest } from '../src/trading/backtestingEngine';
const start = Date.parse('2025-01-01T00:00:00Z'), hour = 3600000;
const settings: ReplaySettings = { initialCapital: 1000, feePct: 0, slippageBps: 0, riskPct: 100,
  maxPositionPct: 100, stopLossPct: 50, maxHoldBars: 20 };
const bars = (prices: number[]): HistoricalBar[] => prices.map((price, i) => ({
  openTime: start + i * hour, timestamp: start + (i + 1) * hour,
  open: price, high: price + 1, low: price - 1, close: price, volume: 1000,
}));
const once = (_symbol: string, history: readonly HistoricalBar[]) => history.length === 1;

test('entry waits a full bar and uses the later open rather than the signal close', () => {
  const result = replayLedger({ A: bars([100, 110, 120, 130]) }, settings, once);
  expect(result.trades).toHaveLength(1);
  expect(result.trades[0]).toMatchObject({ entryPrice: 120, enteredAt: start + 2 * hour, signalAt: start + hour, exitPrice: 130 });
  expect(result.finalEquity).toBeCloseTo(1083.33333);
  expect(result.trades[0].pnl).toBeCloseTo(result.finalEquity - 1000);
});

test('constant prices lose exactly both fees and cannot manufacture return', () => {
  const result = replayLedger({ A: bars([100, 100, 100, 100]) }, { ...settings, feePct: 1 }, once);
  const expectedQuantity = 9.90099;
  expect(result.trades[0].quantity).toBe(expectedQuantity);
  expect(result.totalFees).toBeCloseTo(expectedQuantity * 100 * 0.02);
  expect(result.finalEquity).toBeCloseTo(1000 - result.totalFees);
  expect(result.trades[0].pnl).toBeCloseTo(-result.totalFees);
  expect(result.equity.every(p => p.cash >= -1e-7 && Math.abs(p.equity - p.cash - p.holdings) < 1e-7)).toBe(true);
});

test('simultaneous symbols share cash rather than each receiving a full account', () => {
  const result = replayLedger({ B: bars([100, 100, 100, 100]), A: bars([100, 100, 100, 100]) }, settings, once);
  expect(result.trades).toHaveLength(1);
  expect(result.trades[0].symbol).toBe('A');
  expect(result.finalEquity).toBe(1000);
  expect(Math.max(...result.equity.map(p => p.holdings))).toBe(1000);
});

test('simultaneous marks are refreshed before another symbol reserves cash', () => {
  const c = bars([100, 100, 100, 100]).map(b => ({ ...b, openTime: b.openTime + hour, timestamp: b.timestamp + hour }));
  const result = replayLedger({ A: bars([100, 100, 100, 200, 200]),
    B: bars([100, 100, 100, 50, 50]), C: c }, { ...settings, maxPositionPct: 20, stopLossPct: 90 }, once);
  expect(result.trades.find(t => t.symbol === 'C')?.quantity).toBeCloseTo(2.2);
  expect(result.equity.filter(p => p.timestamp === start + 3 * hour)).toHaveLength(1);
  expect(result.equity.find(p => p.timestamp === start + 3 * hour)?.equity).toBeCloseTo(1100);
});

test('opening entry does not use that hour’s future volume as eligibility', () => {
  const series = bars([100, 100, 100, 100]); series[2].volume = 0;
  const result = replayLedger({ A: series }, settings, once);
  expect(result.trades[0].enteredAt).toBe(start + 2 * hour);
});

test('due exits release shared cash before earlier-ticker new entries reserve it', () => {
  const a = bars([100, 100, 100, 100]).map(b => ({ ...b, openTime: b.openTime + hour, timestamp: b.timestamp + hour }));
  const result = replayLedger({ A: a, B: bars([100, 100, 100, 100, 100]) }, { ...settings, maxHoldBars: 1 }, once);
  expect(result.trades.find(t => t.symbol === 'B')?.exitedAt).toBe(start + 3 * hour);
  expect(result.trades.find(t => t.symbol === 'A')?.enteredAt).toBe(start + 3 * hour);
  expect(result.finalEquity).toBe(1000);
});

test('a stop gap exits at the worse opening price, not the unavailable stop', () => {
  const result = replayLedger({ A: bars([100, 100, 100, 80]) }, { ...settings, stopLossPct: 5 }, once);
  expect(result.trades[0]).toMatchObject({ exitReason: 'STOP', exitPrice: 80, pnl: -200 });
  expect(result.finalEquity).toBe(800);
  expect(result.maxDrawdown).toBe(20);
});

test('missing exit liquidity retains an open holding rather than inventing closure', () => {
  const series = bars([100, 100, 100, 101]); series[3].volume = 0;
  const result = replayLedger({ A: series }, settings, once);
  expect(result.openPositions).toBe(1);
  expect(result.trades).toHaveLength(0);
  expect(result.cash).toBe(0);
  expect(result.finalEquity).toBe(1010);
});

test('future prices cannot change earlier decisions or valuations', () => {
  const original = bars([100, 100, 100, 105, 110]);
  const changed = bars([100, 100, 100, 105, 10]);
  const a = replayLedger({ A: original }, settings, once), b = replayLedger({ A: changed }, settings, once);
  expect(a.equity.filter(p => p.timestamp < start + 4 * hour)).toEqual(b.equity.filter(p => p.timestamp < start + 4 * hour));
  expect(a.trades[0].entryPrice).toBe(b.trades[0].entryPrice);
});

test('actual backend uses registered technical signals without invented specialist metrics', async () => {
  jest.clearAllMocks();
  (axios.get as jest.Mock).mockResolvedValue({ data: bars([100, 110, 120, 130, 140, 150]).map(b => [
    b.openTime, String(b.open), String(b.high), String(b.low), String(b.close), '1000', b.timestamp - 1,
  ]) });
  const result = await runBacktest({ startDate: '2025-01-01', endDate: '2025-01-01', symbols: ['BTC/USDT'],
    initialCapital: 1000, lookbackBars: 2, momentumThresholdPct: 1, riskPerTrade: 100,
    maxPositionSize: 100, brokerFeesPct: 0, slippageBps: 0, stopLossPct: 50, maxHoldBars: 20 });
  expect(result.totalTrades).toBe(1);
  expect(result.sampleTrades[0].entryPrice).toBe(140);
  expect(result.totalReturn).toBeCloseTo(71.42857);
  expect(result.agentAccuracy).toEqual({});
  expect(result.sampleTrades[0].agents).toEqual([]);
  expect(result.sampleTrades[0].confidence).toBeNull();
  expect(result.sharpeRatio).toBeNull();
  expect(result.strategy.councilReplay).toBe(false);
});

test('invalid costs and unsupported strategy cannot silently run a different strategy', async () => {
  expect(() => replayLedger({ A: bars([100, 100, 100]) }, { ...settings, feePct: -1 }, once)).toThrow('Invalid');
  await expect(runBacktest({ startDate: '2025-01-01', endDate: '2025-01-01', symbols: ['BTC/USDT'],
    initialCapital: 1000, strategy: 'kronos_transformer' } as any)).rejects.toThrow();
});
