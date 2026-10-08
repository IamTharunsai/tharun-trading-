jest.mock('../src/utils/prisma', () => ({ prisma: { portfolioSnapshot: { findMany: jest.fn().mockResolvedValue([]) } } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
import { validateTradeSignal } from '../src/trading/riskManager';
import type { PortfolioState, TradeSignal } from '../src/agents/types';

const portfolio: PortfolioState = {
  totalValue: 100000, cashBalance: 100000, invested: 0, pnlDay: 0,
  pnlDayPct: 0, pnlWeekPct: 0, pnlTotal: 0, positions: [], dailyLossToday: 0,
  tradesExecutedToday: 0, drawdownFromPeak: 0,
};
const signal: TradeSignal = {
  asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 80,
  entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 104,
  positionSizePct: 1, reasoning: 'test', agentDecisionId: 'fixture',
  voteCounts: { supporting: 14, opposing: 0, abstaining: 0 },
};
describe('default daily loss boundary', () => {
  beforeEach(() => { delete process.env.DAILY_LOSS_LIMIT_PCT; });
  it('refuses new risk at a three percent daily loss', async () => {
    expect((await validateTradeSignal(signal, { ...portfolio, pnlDayPct: -3 })).approved).toBe(false);
  });
  it('allows an otherwise valid signal below the default loss limit', async () => {
    expect((await validateTradeSignal(signal, { ...portfolio, pnlDayPct: -2.99 })).approved).toBe(true);
  });
});
