jest.mock('../src/utils/prisma', () => ({ prisma: {
  position: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
  trade: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
} }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrices: () => ({}) }));
jest.mock('../src/services/cashFlowRisk', () => ({ getCashFlowRisk: jest.fn() }));
jest.mock('../src/trading/accountScope', () => ({ getVerifiedAccountScope: async () => ({ accountId: 'fixture', mode: 'paper',
  broker: { getPortfolioSummary: async () => ({ account_id: 'fixture', portfolio_value: 106000, cash: 106000 }) } }) }));
import { getCashFlowRisk } from '../src/services/cashFlowRisk';
import { getPortfolioState } from '../src/services/portfolio';
test('weekly result is the shared verified capital-adjusted opening-NAV result', async () => {
  (getCashFlowRisk as jest.Mock).mockResolvedValue({ complete: true, dailyPnl: -4000, dailyPnlPct: -4, weeklyPnlPct: -4, drawdownPct: 4 });
  expect(await getPortfolioState()).toMatchObject({ pnlWeekPct: -4, riskDataComplete: true });
});
test('unknown weekly coverage remains null while NAV is still available', async () => {
  (getCashFlowRisk as jest.Mock).mockResolvedValue({ complete: false, dailyPnl: null, dailyPnlPct: null, weeklyPnlPct: null, drawdownPct: null });
  expect(await getPortfolioState()).toMatchObject({ totalValue: 106000, pnlWeekPct: null, riskDataComplete: false });
});
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn() } }));
