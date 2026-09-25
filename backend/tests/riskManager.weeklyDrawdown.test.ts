// weeklyDrawdownLimit was declared (read from WEEKLY_DRAWDOWN_LIMIT_PCT) and
// never checked against anything — a dead safety variable sitting between
// the daily and all-time drawdown circuit breakers. This locks in the
// middle-tier gate: rejects when pnlWeekPct breaches -weeklyDrawdownLimit.

import { validateTradeSignal } from '../src/trading/riskManager';
import { TradeSignal, PortfolioState } from '../src/agents/types';

const baseSignal: TradeSignal = {
  asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 80,
  entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110,
  positionSizePct: 1, reasoning: 'test', agentDecisionId: 'x',
};

const basePortfolio: PortfolioState = {
  totalValue: 100000, cashBalance: 40000, invested: 60000,
  pnlDay: 0, pnlDayPct: 0, pnlTotal: 0,
  pnlWeekPct: 0,
} as PortfolioState;

describe('validateTradeSignal — weekly drawdown', () => {
  it('rejects when pnlWeekPct breaches WEEKLY_DRAWDOWN_LIMIT_PCT', async () => {
    process.env.WEEKLY_DRAWDOWN_LIMIT_PCT = '10';
    const portfolio = { ...basePortfolio, pnlWeekPct: -12 };
    const result = await validateTradeSignal(baseSignal, portfolio);
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/weekly drawdown/i);
  });

  it('approves when pnlWeekPct is within the limit', async () => {
    process.env.WEEKLY_DRAWDOWN_LIMIT_PCT = '10';
    const portfolio = { ...basePortfolio, pnlWeekPct: -3 };
    const result = await validateTradeSignal(baseSignal, portfolio);
    expect(result.approved).toBe(true);
  });
});
