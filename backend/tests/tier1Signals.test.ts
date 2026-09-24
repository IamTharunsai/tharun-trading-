import { runTier1Agents } from '../src/agents/tier1Agents';
import { resolveSurvivalPolicy } from '../src/services/survivalEngine';
import { MarketSnapshot, PortfolioState } from '../src/agents/types';

const portfolio: PortfolioState = { totalValue: 1000, cashBalance: 1000, invested: 0, positions: [], pnlDay: 0,
  pnlDayPct: 0, pnlWeekPct: 0, pnlTotal: 0, dailyLossToday: 0, tradesExecutedToday: 0, drawdownFromPeak: 0 };
const policy = resolveSurvivalPolicy({ bankroll: 1000, drawdownFromPeakPct: 0, dailyLossPct: 0 });
const neutral = { asset: 'AAPL', market: 'stocks', price: 100, priceChangePct24h: 0, indicators: {} } as MarketSnapshot;
const bearish = { ...neutral, priceChangePct24h: -3, indicators: {
  rsi14: 40, macd: { value: -1, signal: 0, histogram: -1 },
  bollingerBands: { upper: 115, middle: 110, lower: 105 }, ema9: 105, ema21: 110,
  sma50: 110, vwap: 105, stochasticK: 40, volumeRatio: 2, atr14: 2,
} } as MarketSnapshot;

it('does not reinterpret neutral or missing indicators as bearish evidence', () => {
  const result = runTier1Agents(neutral, portfolio, policy, new Date('2026-09-23T14:00:00Z'));
  expect(result.votes[0].vote).toBe('HOLD');
  expect(result.dominant).toBe('HOLD');
});
it('sets a short stop above entry and a short target below entry', () => {
  const result = runTier1Agents(bearish, portfolio, policy, new Date('2026-09-23T14:00:00Z'));
  expect(result.dominant).toBe('SELL');
  expect(result.stopLoss).toBe(104);
  expect(result.takeProfit).toBe(92);
});
it.each([
  ['2026-09-23T13:44:00Z', true],
  ['2026-09-23T13:45:00Z', false],
  ['2026-09-23T19:44:00Z', false],
  ['2026-09-23T19:45:00Z', true],
  ['2026-09-26T14:00:00Z', true],
  ['2026-12-23T14:45:00Z', false],
])('enforces the entry window at %s (blocked=%s)', (at, blocked) => {
  const result = runTier1Agents(bearish, portfolio, policy, new Date(at));
  expect(result.votes.find(v => v.agentName === 'Market Hours')?.rejected).toBe(blocked);
});
