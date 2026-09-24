import { executionQuantity } from '../src/trading/orderSizing';
import { PortfolioState, TradeSignal } from '../src/agents/types';

const signal: TradeSignal = { asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 90,
  entryPrice: 200, stopLossPrice: 196, takeProfitPrice: 208, positionSizePct: 1, reasoning: '', agentDecisionId: '' };
const portfolio: PortfolioState = { totalValue: 1000, cashBalance: 1000, invested: 0, pnlDay: 0, pnlDayPct: 0,
  pnlWeekPct: 0, pnlTotal: 0, positions: [], dailyLossToday: 0, tradesExecutedToday: 0, drawdownFromPeak: 0 };

it('keeps a $10 allocation at 0.05 shares, without rounding up to $200', () => {
  expect(executionQuantity(signal, portfolio, 1)).toBe(0.05);
});
it('reserves cash after the proposed trade', () => {
  expect(executionQuantity(signal, { ...portfolio, cashBalance: 301 }, 1)).toBe(0.005);
  expect(executionQuantity(signal, { ...portfolio, cashBalance: 300 }, 1)).toBe(0);
});
it('limits risk to the stop even with an oversized proposal', () => {
  expect(executionQuantity({ ...signal, stopLossPrice: 100, takeProfitPrice: 400, positionSizePct: 10 }, portfolio, 100)).toBe(0.1);
});
it.each([NaN, Infinity, -1, 0])('rejects invalid entry %s', entryPrice => {
  expect(executionQuantity({ ...signal, entryPrice }, portfolio, 1)).toBe(0);
});
it('rejects inverted stops and targets', () => {
  expect(executionQuantity({ ...signal, stopLossPrice: 201 }, portfolio, 1)).toBe(0);
  expect(executionQuantity({ ...signal, takeProfitPrice: 199 }, portfolio, 1)).toBe(0);
});
it('does not increase a sub-share short to a whole share', () => {
  expect(executionQuantity({ ...signal, direction: 'SELL', stopLossPrice: 204, takeProfitPrice: 192 }, portfolio, 1)).toBe(0);
});
it('blocks sizing when drawdown protection is active', () => {
  expect(executionQuantity(signal, { ...portfolio, drawdownFromPeak: 25 }, 1)).toBe(0);
});
