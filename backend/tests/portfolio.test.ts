// Regression coverage for the P&L bug a user caught by comparing the live
// dashboard against the real Alpaca account: Today's P&L and Total P&L only
// ever summed CLOSED trades, so both read exactly $0.00 forever regardless
// of real, visible gains/losses on open positions. See portfolio.ts's
// comments on pnlTotal/pnlDay for the fix this guards against regressing.

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    position: { findMany: jest.fn(), update: jest.fn(() => Promise.resolve()) },
    trade: { findMany: jest.fn(), count: jest.fn(() => Promise.resolve(0)) },
    portfolioSnapshot: { findFirst: jest.fn(() => Promise.resolve(null)) },
  },
}));
jest.mock('../src/services/marketData', () => ({ getCurrentPrices: jest.fn(() => ({})) }));
jest.mock('../src/services/alpacaBroker', () => ({ createAlpacaBroker: jest.fn(() => null) }));

import { prisma } from '../src/utils/prisma';
import { getCurrentPrices } from '../src/services/marketData';
import { getPortfolioState } from '../src/services/portfolio';

const mockPosition = (overrides: any) => ({
  id: 'p1', asset: 'NVDA', market: 'stocks', side: 'BUY',
  quantity: 10, entryPrice: 100, currentPrice: 100,
  stopLossPrice: 90, takeProfitPrice: 120,
  ...overrides,
});

describe('getPortfolioState — P&L math', () => {
  beforeEach(() => jest.clearAllMocks());

  it('includes unrealized P&L in Total P&L, not just realized (closed) trades', async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([mockPosition({ entryPrice: 100 })]);
    (getCurrentPrices as jest.Mock).mockReturnValue({ NVDA: 120 }); // +$20/share unrealized
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]); // no closed trades, no realized P&L

    const state = await getPortfolioState();

    // Was previously locked to exactly 0 whenever no trade had closed yet,
    // no matter how much an open position had moved.
    expect(state.pnlTotal).toBeCloseTo(200); // 10 shares * $20
  });

  it('adds realized P&L from closed trades on top of unrealized', async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([mockPosition({ entryPrice: 100 })]);
    (getCurrentPrices as jest.Mock).mockReturnValue({ NVDA: 110 }); // +$10/share unrealized = $100
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([{ pnl: 50 }, { pnl: -20 }]); // +$30 realized

    const state = await getPortfolioState();

    expect(state.pnlTotal).toBeCloseTo(130); // 100 unrealized + 30 realized
  });

  it('computes unrealized P&L correctly for a SHORT position (profit when price falls)', async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([
      mockPosition({ asset: 'SDOT', side: 'SELL', entryPrice: 100, quantity: 5 }),
    ]);
    (getCurrentPrices as jest.Mock).mockReturnValue({ SDOT: 80 }); // price fell $20
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);

    const state = await getPortfolioState();

    expect(state.pnlTotal).toBeCloseTo(100); // 5 shares * $20 profit (short)
  });

  it("falls back to realized+unrealized for Today's P&L when there's no prior snapshot yet", async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([mockPosition({ entryPrice: 100 })]);
    (getCurrentPrices as jest.Mock).mockReturnValue({ NVDA: 115 });
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([{ pnl: 10 }]);
    (prisma.portfolioSnapshot.findFirst as jest.Mock).mockResolvedValue(null);

    const state = await getPortfolioState();

    expect(state.pnlDay).toBeCloseTo(160); // (10 shares * $15) + $10 realized
  });

  it("uses a real start-of-day snapshot baseline for Today's P&L when one exists", async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([mockPosition({ entryPrice: 100 })]);
    (getCurrentPrices as jest.Mock).mockReturnValue({ NVDA: 100 }); // flat vs entry
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);
    // Prior snapshot at $99,000; local calc gives totalValue = 100000 (cash) + 0 (pnlTotal) - 1000 (invested) + 1000 (invested) = 100000
    (prisma.portfolioSnapshot.findFirst as jest.Mock).mockImplementation(({ where }: any) =>
      Promise.resolve(where ? { totalValue: 99000 } : { totalValue: 99000 })
    );

    const state = await getPortfolioState();

    // pnlDay should reflect the real delta from the snapshot baseline, not
    // just today's realized trades (there are none here).
    expect(state.pnlDay).toBeCloseTo(state.totalValue - 99000);
  });

  it("computes pnlDayPct against the start-of-day baseline value, not current totalValue", async () => {
    // 100k -> 50k drop (a $500,000 unrealized loss: 1000 shares, $1000 -> $500).
    // Baseline-denominator (correct, matches pnlWeekPct): -50000 / 100000 = -50%.
    // Current-value-denominator (the bug this test guards against): -50000 / 50000 = -100%.
    (prisma.position.findMany as jest.Mock).mockResolvedValue([
      mockPosition({ entryPrice: 1000, quantity: 100, currentPrice: 1000 }),
    ]);
    (getCurrentPrices as jest.Mock).mockReturnValue({ NVDA: 500 });
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.portfolioSnapshot.findFirst as jest.Mock).mockResolvedValue({ totalValue: 100000 });

    const state = await getPortfolioState();

    expect(state.totalValue).toBeCloseTo(50000);
    expect(state.pnlDayPct).toBeCloseTo(-50);
  });
});
