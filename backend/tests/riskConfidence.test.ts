jest.mock('../src/utils/prisma', () => ({ prisma: { portfolioSnapshot: { findMany: jest.fn().mockResolvedValue([]) } } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { evaluateRisk, validateTradeSignal } from '../src/trading/riskManager';
import type { PortfolioState, TradeSignal } from '../src/agents/types';

const portfolio = {
  totalValue: 100000, cashBalance: 100000, invested: 0, pnlDay: 0,
  pnlDayPct: 0, pnlWeekPct: 0, pnlTotal: 0, positions: [],
  dailyLossToday: 0, tradesExecutedToday: 0, drawdownFromPeak: 0,
} satisfies PortfolioState;

const signal = (confidence: number): TradeSignal => ({
  asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence,
  entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 104,
  positionSizePct: 1, reasoning: 'fixture only', agentDecisionId: 'fixture',
});

describe('confidence percentages and genuine vote bounds', () => {
  beforeEach(() => {
    for (const name of ['DAILY_LOSS_LIMIT_PCT', 'MAX_RISK_PER_TRADE_PCT', 'CASH_RESERVE_PCT', 'MIN_VOTES_TO_EXECUTE', 'MAX_POSITION_SIZE_PCT', 'WEEKLY_DRAWDOWN_LIMIT_PCT']) delete process.env[name];
  });
  it('preserves a 60% confidence value rather than turning it into 6000%', async () => {
    const result = await validateTradeSignal(signal(60), portfolio);
    expect(result.reason).toContain('60% confidence');
    expect(result.reason).not.toContain('6000%');
  });

  it.each([NaN, Infinity, -1, 101])('rejects invalid confidence %s before risk approval', async confidence => {
    expect((await validateTradeSignal(signal(confidence), portfolio)).approved).toBe(false);
  });

  it('does not derive a committee vote count from confidence', async () => {
    const result = await validateTradeSignal(signal(90), portfolio);
    expect(result.reason).not.toMatch(/HIGH_CONVICTION|votes/);
  });

  it('rejects impossible vote totals rather than granting a conviction override', () => {
    const result = evaluateRisk({
      goVotes: 600, noGoVotes: -590, totalVotes: 10, avgConfidence: 6000,
      asset: 'AAPL', signal: 'BUY', proposedPositionSizePct: 1,
      currentDrawdownPct: 0, weeklyDrawdownPct: 0, existingPositionCount: 0, maxPositions: 10,
    });
    expect(result.approved).toBe(false);
  });

  it('approves only real supporting counts and preserves the confidence unit', async () => {
    const result = await validateTradeSignal({ ...signal(60), voteCounts: { supporting: 7, opposing: 1, abstaining: 2 } }, portfolio);
    expect(result.approved).toBe(true);
    expect(result.reason).toContain('60% confidence');
    expect(result.adjustedSize).toBe(1);
  });

  it('caps size by stop-loss risk, even with unanimous high-confidence votes', async () => {
    process.env.MAX_RISK_PER_TRADE_PCT = '0.1';
    const result = await validateTradeSignal({ ...signal(100), positionSizePct: 10, voteCounts: { supporting: 10, opposing: 0, abstaining: 0 } }, portfolio);
    expect(result.approved).toBe(true);
    expect(result.adjustedSize).toBe(5);
  });

  it('reserves cash before approving a position', async () => {
    const result = await validateTradeSignal({ ...signal(80), voteCounts: { supporting: 8, opposing: 2, abstaining: 0 } }, { ...portfolio, cashBalance: 20000 });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('CASH_RESERVE');
  });

  it('blocks daily losses before considering confidence', async () => {
    const result = await validateTradeSignal({ ...signal(100), voteCounts: { supporting: 10, opposing: 0, abstaining: 0 } }, { ...portfolio, pnlDayPct: -3 });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('DAILY_LOSS_LIMIT');
  });

  it('honors configured weekly limits and observed weekly losses', async () => {
    process.env.WEEKLY_DRAWDOWN_LIMIT_PCT = '10';
    const result = await validateTradeSignal({ ...signal(100), voteCounts: { supporting: 10, opposing: 0, abstaining: 0 } }, { ...portfolio, pnlWeekPct: -12 });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/weekly drawdown/i);
  });

  it('rejects missing or failed risk-data reads instead of treating failure as zero drawdown', async () => {
    const { prisma } = require('../src/utils/prisma');
    prisma.portfolioSnapshot.findMany.mockRejectedValueOnce(new Error('fixture database offline'));
    const result = await validateTradeSignal({ ...signal(100), voteCounts: { supporting: 10, opposing: 0, abstaining: 0 } }, portfolio);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('RISK_DATA_UNAVAILABLE');
  });
});
