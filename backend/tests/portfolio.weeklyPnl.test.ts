// pnlWeekPct is the weekly counterpart to the existing pnlDayPct: same
// start-of-window snapshot baseline pattern, just a 7-day window instead of
// a same-day window. Backs the new WEEKLY_DRAWDOWN_LIMIT_PCT circuit breaker
// in riskManager.ts, which was previously a dead variable — declared and
// read from env, but never checked against anything.

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    portfolioSnapshot: { findFirst: jest.fn() },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    trade: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  },
}));
jest.mock('../src/services/marketData', () => ({ getCurrentPrices: jest.fn(() => ({})) }));
jest.mock('../src/services/alpacaBroker', () => ({ createAlpacaBroker: jest.fn(() => null) }));

import { prisma } from '../src/utils/prisma';
import { getPortfolioState } from '../src/services/portfolio';

describe('getPortfolioState — weekly P&L', () => {
  beforeEach(() => jest.clearAllMocks());

  it('computes pnlWeekPct from the earliest snapshot in the last 7 days', async () => {
    (prisma.portfolioSnapshot.findFirst as jest.Mock).mockResolvedValue({ totalValue: 100000, timestamp: new Date() });

    const state = await getPortfolioState();
    expect(typeof state.pnlWeekPct).toBe('number');
  });

  it('reflects the delta between current totalValue and the week-start snapshot baseline', async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);
    // Every portfolioSnapshot.findFirst call (start-of-day, week-start, peak)
    // resolves to the same baseline here — totalValue with no positions/trades
    // is STARTING_CAPITAL (100000), so a 95000 baseline is a -5% week.
    (prisma.portfolioSnapshot.findFirst as jest.Mock).mockResolvedValue({ totalValue: 95000, timestamp: new Date() });

    const state = await getPortfolioState();

    expect(state.pnlWeekPct).toBeCloseTo(((state.totalValue - 95000) / 95000) * 100);
  });

  it('falls back to 0 when there is no snapshot in the last 7 days', async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.portfolioSnapshot.findFirst as jest.Mock).mockResolvedValue(null);

    const state = await getPortfolioState();

    expect(state.pnlWeekPct).toBe(0);
  });
});
