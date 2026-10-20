jest.mock('../src/services/cashFlowRisk', () => ({ getCashFlowRisk: jest.fn() }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn() } }));
import { logger } from '../src/utils/logger';
import { getCashFlowRisk } from '../src/services/cashFlowRisk';
// Regression coverage for the P&L bug a user caught by comparing the live
// dashboard against the real Alpaca account: Today's P&L and Total P&L only
// ever summed CLOSED trades, so both read exactly $0.00 forever regardless
// of real, visible gains/losses on open positions. See portfolio.ts's
// comments on pnlTotal/pnlDay for the fix this guards against regressing.

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    position: { findMany: jest.fn(), update: jest.fn(() => Promise.resolve()), count: jest.fn().mockResolvedValue(0) },
    trade: { findMany: jest.fn(), count: jest.fn(() => Promise.resolve(0)) },
    portfolioSnapshot: { findFirst: jest.fn(() => Promise.resolve(null)) },
  },
}));
jest.mock('../src/services/marketData', () => ({ getCurrentPrices: jest.fn(() => ({})) }));
jest.mock('../src/services/alpacaBroker', () => ({ createAlpacaBroker: jest.fn(() => null) }));
jest.mock('../src/trading/accountScope', () => ({ getVerifiedAccountScope: jest.fn(() => Promise.resolve({
  accountId: 'fixture-account', mode: 'paper', broker: { getPortfolioSummary: async () => mockSummary },
})) }));
let mockSummary: any;

import { prisma } from '../src/utils/prisma';
import { getCurrentPrices } from '../src/services/marketData';
import { getPortfolioState } from '../src/services/portfolio';

const mockPosition = (overrides: any) => ({
  id: 'p1', asset: 'NVDA', market: 'stocks', side: 'BUY',
  accountId: 'fixture-account', brokerMode: 'paper',
  quantity: 10, entryPrice: 100, currentPrice: 100,
  stopLossPrice: 90, takeProfitPrice: 120,
  ...overrides,
});

describe('getPortfolioState — P&L math', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCashFlowRisk as jest.Mock).mockResolvedValue({ complete: false, dailyPnl: null, dailyPnlPct: null, weeklyPnlPct: null, drawdownPct: null });
    mockSummary = { account_id: 'fixture-account', portfolio_value: 100000, cash: 100000, buying_power: 100000, last_equity: 100000 };
  });

  it('includes unrealized P&L in Total P&L, not just realized (closed) trades', async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([mockPosition({ entryPrice: 100 })]);
    (getCurrentPrices as jest.Mock).mockReturnValue({ NVDA: 120 }); // +$20/share unrealized
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]); // no closed trades, no realized P&L

    const state = await getPortfolioState();

    // Was previously locked to exactly 0 whenever no trade had closed yet,
    // no matter how much an open position had moved.
    expect(state.pnlTotal).toBeCloseTo(200); // 10 shares * $20
  });

  it.each(['RISK_HISTORY_COVERAGE_GAP', 'PRIVATE_ACCOUNT_AND_TOKEN'])('logs only a safe readiness reason for %s without changing risk state', async reason => {
    (getCashFlowRisk as jest.Mock).mockResolvedValue({ complete: false, reason, dailyPnl: null, dailyPnlPct: null });
    (prisma.position.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);
    const result = await getPortfolioState();
    expect(result.riskDataComplete).toBe(false);
    expect(result.pnlDay).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('portfolio_risk_evidence_incomplete', {
      reason: reason === 'RISK_HISTORY_COVERAGE_GAP' ? reason : 'OTHER_EVIDENCE_FAILURE',
    });
    expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toMatch(/PRIVATE_|fixture-account/);
  });

  it('adds realized P&L from closed trades on top of unrealized', async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([mockPosition({ entryPrice: 100 })]);
    (getCurrentPrices as jest.Mock).mockReturnValue({ NVDA: 110 }); // +$10/share unrealized = $100
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([{ status: 'CLOSED', pnl: 50 }, { status: 'CLOSED', pnl: -20 }]); // +$30 realized

    const state = await getPortfolioState();

    expect(state.pnlTotal).toBeCloseTo(130); // 100 unrealized + 30 realized
  });
  it('keeps broker quantity observations separate from the remaining execution P&L basis', async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([mockPosition({ quantity: 6, brokerObservedQuantity: 10, accountingStatus: 'RECONCILING' })]);
    (getCurrentPrices as jest.Mock).mockReturnValue({ NVDA: 90 });
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([{ status: 'OPEN', realizedPnl: -40 }]);
    const state = await getPortfolioState();
    expect(state.pnlTotal).toBe(-100); // $40 realized + $60 remaining execution loss
    expect(state.accountingComplete).toBe(false);
    expect(state.positions[0]).toMatchObject({ quantity: 6, brokerObservedQuantity: 10, unrealizedPnl: null });
    expect(state.invested).toBe(900); // conservative exposure until the observation reconciles
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

  it('never treats last_equity or a raw NAV snapshot as verified period profit', async () => {
    mockSummary.portfolio_value = 90000;
    (prisma.position.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.portfolioSnapshot.findFirst as jest.Mock).mockResolvedValue({ totalValue: 100000 });
    const state = await getPortfolioState();
    expect(state).toMatchObject({ totalValue: 90000, pnlDay: null, pnlDayPct: null, drawdownFromPeak: null, riskDataComplete: false });
    expect(prisma.portfolioSnapshot.findFirst).not.toHaveBeenCalled();
  });
  it('uses the broker-evidenced adjusted result independently from wall-clock NAV', async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);
    (getCashFlowRisk as jest.Mock).mockResolvedValue({ complete: true, dailyPnl: -4000, dailyPnlPct: -4, weeklyPnlPct: -4, drawdownPct: 4,
      equity: 106000, asOf: '2026-10-16T12:00:00Z', referenceAt: '2026-10-08T00:00:00Z' });
    const state = await getPortfolioState();
    expect(state).toMatchObject({ totalValue: 100000, pnlDay: -4000, pnlDayPct: -4, drawdownFromPeak: 4, riskDataComplete: true,
      capitalRisk: { equity: 106000, asOf: '2026-10-16T12:00:00Z' } });
  });
  it('retains known recorded losses and exposure when cashflow evidence is unavailable', async () => {
    (prisma.position.findMany as jest.Mock).mockResolvedValue([mockPosition({ quantity: 6, currentPrice: 90 })]);
    (getCurrentPrices as jest.Mock).mockReturnValue({ NVDA: 90 });
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([{ status: 'OPEN', realizedPnl: -40 }]);
    expect(await getPortfolioState()).toMatchObject({ pnlTotal: -100, invested: 540, pnlDay: null, riskDataComplete: false });
  });
});
