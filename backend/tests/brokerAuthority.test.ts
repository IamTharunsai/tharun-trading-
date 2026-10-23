const mockBroker = {
  getPortfolioSummary: jest.fn(), getPosition: jest.fn(), createOrder: jest.fn(), getOrder: jest.fn(),
};
const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { get: (...args: any[]) => mockAxiosGet(...args) } }));
jest.mock('../src/trading/brokerRouter', () => ({
  getActiveMode: jest.fn(() => 'paper'), getTradingBroker: jest.fn(() => mockBroker),
  getTradingCredentials: jest.fn(() => ({ mode: 'paper', apiKey: 'fixture-key', secret: 'fixture-secret' })),
}));
jest.mock('../src/trading/riskManager', () => ({ validateTradeSignal: jest.fn() }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: jest.fn(() => false) }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrice: jest.fn(), buildMarketSnapshot: jest.fn() }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/utils/prisma', () => ({ prisma: {
  trade: { create: jest.fn(), findMany: jest.fn() },
  position: { upsert: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  agentDecision: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  executionIntent: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn(), $executeRaw: jest.fn(),
} }));

import { withRiskEvidence } from './helpers/riskEvidence';

describe('execution uses central broker authority and verified account values', () => {
  let executeTradeSignal: any;
  let prisma: any;
  let validateTradeSignal: any;
  const signal = {
    asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 80,
    entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 104, positionSizePct: 10,
    reasoning: 'dummy fixture', agentDecisionId: 'dummy-decision',
    voteCounts: { supporting: 8, opposing: 2, abstaining: 0 },
  };
  // The engine's final pre-submit guard re-verifies the same capital-evidence
  // contract as the risk gate, so the fixture portfolio carries it too.
  const portfolio = withRiskEvidence({ accountId: 'paper-account-1', brokerMode: 'paper', totalValue: 1000, cashBalance: 1000, positions: [] });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.DRY_RUN = 'false';
    // Raw mode variables disagree deliberately: the central router remains authoritative.
    process.env.TRADING_MODE = 'live';
    process.env.VITE_TRADING_MODE = 'LIVE';
    ({ executeTradeSignal } = require('../src/trading/executionEngine'));
    ({ prisma } = require('../src/utils/prisma'));
    ({ validateTradeSignal } = require('../src/trading/riskManager'));
    require('../src/services/portfolio').getPortfolioState.mockResolvedValue(portfolio);
    validateTradeSignal.mockResolvedValue({ approved: true, reason: 'fixture', adjustedSize: 2 });
    mockBroker.getPortfolioSummary.mockResolvedValue({ account_id: 'paper-account-1', cash: 1000 });
    mockBroker.getPosition.mockResolvedValue(null);
    prisma.position.findFirst.mockResolvedValue(null);
    prisma.position.findUnique.mockResolvedValue(null);
    // Stock entries bind to a live Alpaca IEX quote; serve a fresh one at the
    // approved plan price (ask 100 = entry 100, inside the 2:1 reward:risk law).
    mockAxiosGet.mockImplementation(async () => ({ data: { symbol: 'AAPL', quote: { t: new Date().toISOString(), bp: 100, ap: 100, bs: 10, as: 10 } } }));
    mockBroker.createOrder.mockResolvedValue({ id: 'dummy-order' });
    mockBroker.getOrder.mockResolvedValue({ status: 'filled', filled_avg_price: '100', filled_qty: '0.15' });
    prisma.trade.create.mockResolvedValue({ id: 'dummy-trade' });
    prisma.position.upsert.mockResolvedValue({ id: 'dummy-position' });
    prisma.agentDecision.update.mockResolvedValue({});
    prisma.agentDecision.updateMany.mockResolvedValue({ count: 1 });
    prisma.agentDecision.findUnique.mockResolvedValue({
      id: signal.agentDecisionId, asset: signal.asset, executed: false, executionReason: null, timestamp: new Date(),
      signal: 'BUY', finalVote: 'BUY', totalVotes: 14, goVotes: 14, noGoVotes: 0, avgConfidence: 80,
      agentVotes: Array.from({ length: 14 }, (_, i) => ({ agentId: i + 1, finalVote: 'BUY', confidence: 80, executionEligible: true })),
      marketSnapshot: { asset: signal.asset, market: 'stocks', timestamp: Date.now(), inputFingerprint: 'a'.repeat(64),
        dataEvidence: { source: 'Alpaca IEX', timeframe: '1Day', completedBars: 250, receivedAt: Date.now(), priceObservedAt: Date.now(), quoteObservedAt: Date.now() },
        executionPlan: { ...signal, version: 1, approved: true, mode: 'paper' } },
    });
    prisma.executionIntent.create.mockResolvedValue({ id: 'intent-1' });
    prisma.executionIntent.findFirst.mockResolvedValue(null);
    prisma.executionIntent.findUnique.mockResolvedValue({ id: 'intent-1', accountId: 'paper-account-1', mode: 'paper', status: 'SUBMITTED' });
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.executionIntent.update.mockResolvedValue({});
    prisma.executionIntent.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (work: any) => work(prisma));
  });

  afterEach(() => {
    process.env.DRY_RUN = 'true';
    process.env.TRADING_MODE = 'paper';
    delete process.env.VITE_TRADING_MODE;
  });

  it('rechecks risk before submission and applies the approved equity allocation', async () => {
    expect(await executeTradeSignal(signal, portfolio)).toBe(true);
    expect(validateTradeSignal).toHaveBeenCalledWith({ ...signal, voteCounts: { supporting: 14, opposing: 0, abstaining: 0 } }, portfolio);
    expect(mockBroker.createOrder.mock.calls[0][0].qty).toBe(0.2);
    expect(prisma.trade.create.mock.calls[0][0].data.quantity).toBe(0.15);
    expect(prisma.agentDecision.update.mock.calls[0][0].data.executionReason).toContain('PAPER');
  });

  it('never submits after a risk rejection', async () => {
    validateTradeSignal.mockResolvedValue({ approved: false, reason: 'fixture rejection' });
    expect(await executeTradeSignal(signal, portfolio)).toBe(false);
    expect(mockBroker.createOrder).not.toHaveBeenCalled();
  });

  it.each([0, null])('does not manufacture spendable cash when the broker reports %s', async cash => {
    mockBroker.getPortfolioSummary.mockResolvedValue(cash === null ? null : { account_id: 'paper-account-1', cash });
    expect(await executeTradeSignal(signal, portfolio)).toBe(false);
    expect(mockBroker.createOrder).not.toHaveBeenCalled();
    expect(prisma.trade.findMany).not.toHaveBeenCalled();
  });
});
