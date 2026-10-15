jest.mock('../src/utils/prisma', () => ({ prisma: {
  trade: { findMany: jest.fn() }, brokerActivity: { count: jest.fn() }, positionExit: { count: jest.fn() },
  portfolioSnapshot: { findFirst: jest.fn() },
} }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrices: () => ({}) }));
import { prisma } from '../src/utils/prisma';
import { getPortfolioState } from '../src/services/portfolio';
import { calculateAuthenticatedPortfolio } from '../src/services/portfolioAccounting';
beforeEach(() => {
  jest.clearAllMocks();
  (getPortfolioState as jest.Mock).mockResolvedValue({ accountId: 'fixture', brokerMode: 'paper', totalValue: 900,
    cashBalance: 900, positions: [], pnlDay: -100, pnlDayPct: -10, accountingComplete: false });
  (prisma.trade.findMany as jest.Mock).mockImplementation(async ({ where }) => where.status === 'CLOSED'
    ? [{ pnl: -40, fees: 0, actualFeeCash: 0 }] : []);
  (prisma.brokerActivity.count as jest.Mock).mockResolvedValue(1);
  (prisma.positionExit.count as jest.Mock).mockResolvedValue(1);
  (prisma.portfolioSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
});
test('unresolved flat exit preserves the known loss while total unknown P&L is not reported as zero', async () => {
  const portfolio = await calculateAuthenticatedPortfolio();
  expect(portfolio).toMatchObject({ totalEquity: 900, knownRealizedPnl: -40, accountingComplete: false,
    realizedPnl: null, totalPnl: null, totalFeesPaid: null, isStale: true });
});
