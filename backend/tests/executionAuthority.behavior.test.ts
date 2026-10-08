jest.mock('../src/utils/prisma', () => ({ prisma: {
  agentDecision: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  strategyQualification: { findFirst: jest.fn() },
  executionIntent: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
  trade: { create: jest.fn() }, position: { upsert: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() }, $transaction: jest.fn(), $executeRaw: jest.fn(),
} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrice: jest.fn(), buildMarketSnapshot: jest.fn() }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: jest.fn(() => false) }));
jest.mock('../src/trading/brokerRouter', () => ({ getActiveMode: jest.fn(() => 'paper'), getTradingBroker: jest.fn() }));
jest.mock('../src/trading/riskManager', () => ({ validateTradeSignal: jest.fn(async () => ({ approved: true, adjustedSize: 1 })) }));
import { prisma } from '../src/utils/prisma';
import { getTradingBroker, getActiveMode } from '../src/trading/brokerRouter';
import type { PortfolioState, TradeSignal } from '../src/agents/types';
import { getPortfolioState } from '../src/services/portfolio';

const signal: TradeSignal = { asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 80,
  entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 105, positionSizePct: 1,
  agentDecisionId: 'current', reasoning: 'fixture' };
const portfolio: PortfolioState = { accountId: 'paper-account-1', brokerMode: 'paper', totalValue: 100000, cashBalance: 100000, invested: 0, pnlDay: 0,
  pnlDayPct: 0, pnlWeekPct: 0, pnlTotal: 0, positions: [], dailyLossToday: 0,
  tradesExecutedToday: 0, drawdownFromPeak: 0 };
const broker = { getPortfolioSummary: jest.fn(), getPosition: jest.fn(), createOrder: jest.fn(), getOrder: jest.fn(), getOrderByClientOrderId: jest.fn() };
let executeTradeSignal: typeof import('../src/trading/executionEngine').executeTradeSignal;
let reconcileExecutionIntents: typeof import('../src/trading/executionEngine').reconcileExecutionIntents;
beforeAll(() => {
  process.env.DRY_RUN = 'false'; // All provider objects are mocks; network is disabled by the test sandbox.
  executeTradeSignal = require('../src/trading/executionEngine').executeTradeSignal;
  reconcileExecutionIntents = require('../src/trading/executionEngine').reconcileExecutionIntents;
});
afterAll(() => { process.env.DRY_RUN = 'true'; });
beforeEach(() => {
  jest.clearAllMocks();
  (getActiveMode as jest.Mock).mockReturnValue('paper');
  delete process.env.RELEASE_COMMIT_SHA;
  (getPortfolioState as jest.Mock).mockResolvedValue(portfolio);
  (prisma.strategyQualification.findFirst as jest.Mock).mockResolvedValue(null);
  const now = Date.now();
  (prisma.agentDecision.findUnique as jest.Mock).mockResolvedValue({
    id: 'current', asset: 'AAPL', executed: false, executionReason: null, timestamp: new Date(now),
    signal: 'BUY', finalVote: 'BUY', totalVotes: 14, goVotes: 14, noGoVotes: 0, avgConfidence: 80,
    agentVotes: Array.from({ length: 14 }, (_, i) => ({ agentId: i + 1, finalVote: 'BUY', confidence: 80, executionEligible: true })),
    marketSnapshot: { asset: 'AAPL', market: 'stocks', timestamp: now, inputFingerprint: 'a'.repeat(64),
      executionPlan: { version: 1, approved: true, mode: 'paper', market: 'stocks', direction: 'BUY', confidence: 80,
        entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 105, positionSizePct: 1 } },
  });
  (getTradingBroker as jest.Mock).mockReturnValue(broker);
  broker.getPortfolioSummary.mockResolvedValue({ account_id: 'paper-account-1', cash: 100000 });
  broker.getPosition.mockResolvedValue(null);
  broker.createOrder.mockResolvedValue({ id: 'broker-1' });
  broker.getOrder.mockResolvedValue({ status: 'filled', filled_avg_price: '100.2', filled_qty: '10' });
  (prisma.executionIntent.create as jest.Mock).mockResolvedValue({ id: 'intent-1' });
  (prisma.executionIntent.update as jest.Mock).mockResolvedValue({});
  (prisma.executionIntent.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.executionIntent.findUnique as jest.Mock).mockResolvedValue({ id: 'intent-1', accountId: 'paper-account-1', mode: 'paper', status: 'SUBMITTED' });
  (prisma.executionIntent.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.position.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.position.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);
  (prisma.executionIntent.findMany as jest.Mock).mockResolvedValue([{
    id: 'intent-1', decisionId: 'current', clientOrderId: 'stable-client-id', asset: 'AAPL',
    market: 'stocks', mode: 'paper', direction: 'BUY', quantity: 10, protection: 'BROKER_HOSTED', status: 'SUBMITTING',
    accountId: 'paper-account-1', executionPlan: { ...signal, version: 1, approved: true, mode: 'paper' },
  }]);
  broker.getOrderByClientOrderId.mockResolvedValue({ id: 'broker-1', client_order_id: 'stable-client-id',
    symbol: 'AAPL', side: 'buy', status: 'filled', filled_qty: '10', filled_avg_price: '100.2' });
  (prisma.agentDecision.update as jest.Mock).mockResolvedValue({});
  (prisma.agentDecision.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.trade.create as jest.Mock).mockResolvedValue({ id: 'trade-1' });
  (prisma.position.upsert as jest.Mock).mockResolvedValue({ id: 'position-1' });
  (prisma.$transaction as jest.Mock).mockImplementation(async work => work(prisma));
});

it('does not submit or mutate execution history for missing persisted authority', async () => {
  (prisma.agentDecision.findUnique as jest.Mock).mockResolvedValue(null);
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(broker.createOrder).not.toHaveBeenCalled();
  expect(prisma.agentDecision.updateMany).not.toHaveBeenCalled();
});
it('blocks a live submission without a current strategy qualification', async () => {
  (getActiveMode as jest.Mock).mockReturnValue('live');
  process.env.RELEASE_COMMIT_SHA = 'a'.repeat(40);
  const decision = await (prisma.agentDecision.findUnique as jest.Mock)();
  decision.marketSnapshot.executionPlan.mode = 'live';
  (prisma.agentDecision.findUnique as jest.Mock).mockResolvedValue(decision);
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(broker.createOrder).not.toHaveBeenCalled();
  expect(prisma.agentDecision.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ executionReason: expect.stringContaining('LIVE_UNQUALIFIED') }) }));
});
it('permits a live submission only after the registered gates and matching account mode pass', async () => {
  (getActiveMode as jest.Mock).mockReturnValue('live');
  process.env.RELEASE_COMMIT_SHA = 'a'.repeat(40);
  const decision = await (prisma.agentDecision.findUnique as jest.Mock)();
  decision.marketSnapshot.executionPlan.mode = 'live';
  (prisma.agentDecision.findUnique as jest.Mock).mockResolvedValue(decision);
  (getPortfolioState as jest.Mock).mockResolvedValue({ ...portfolio, brokerMode: 'live' });
  (prisma.strategyQualification.findFirst as jest.Mock).mockResolvedValue({ strategyKey: 'BHISHMA_COUNCIL',
    revision: process.env.RELEASE_COMMIT_SHA, dataHash: 'b'.repeat(64), reportHash: 'c'.repeat(64), trialCount: 80,
    noLeakage: true, dsrProbability: 0.97, walkForwardPassed: true, costsValidated: true, executionValidated: true,
    ledgerReconciled: true, healthPassed: true, expiresAt: new Date(Date.now() + 3600000) });
  expect(await executeTradeSignal(signal, portfolio)).toBe(true);
  expect(broker.createOrder).toHaveBeenCalledTimes(1);
});
it('uses fresh account evidence instead of a caller-supplied equity figure', async () => {
  expect(await executeTradeSignal(signal, { ...portfolio, totalValue: 100000000 })).toBe(true);
  expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({ qty: 10 }));
});
it('persists a claim before submitting and atomically records confirmed fill state', async () => {
  expect(await executeTradeSignal(signal, portfolio)).toBe(true);
  expect(prisma.executionIntent.create.mock.invocationCallOrder[0]).toBeLessThan(broker.createOrder.mock.invocationCallOrder[0]);
  expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({ client_order_id: expect.stringMatching(/^bh-[a-f0-9]{40}$/), qty: 10, order_class: 'bracket' }));
  expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  expect(prisma.trade.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entryPrice: 100.2, quantity: 10, brokerOrderId: 'broker-1' }) }));
  expect(prisma.executionIntent.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RECORDED' }) }));
});
it('allows at most one submission when two workers claim the same decision', async () => {
  let claimed = false;
  (prisma.executionIntent.create as jest.Mock).mockImplementation(async () => {
    if (claimed) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
    claimed = true; return { id: 'intent-1' };
  });
  const outcomes = await Promise.all([executeTradeSignal(signal, portfolio), executeTradeSignal(signal, portfolio)]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(broker.createOrder).toHaveBeenCalledTimes(1);
});
it('retains an ambiguous submission for reconciliation without inventing a trade', async () => {
  broker.createOrder.mockRejectedValue(new Error('response lost after submission'));
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(prisma.executionIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RECONCILIATION_REQUIRED' }) }));
  expect(prisma.trade.create).not.toHaveBeenCalled();
});
it('fails closed when a durable claim cannot be saved', async () => {
  (prisma.executionIntent.create as jest.Mock).mockRejectedValue(new Error('database unavailable'));
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(broker.createOrder).not.toHaveBeenCalled();
});
it('retains an oversized fill as a reconciliation fault rather than recording an approved allocation', async () => {
  broker.getOrder.mockResolvedValue({ status: 'filled', filled_avg_price: '100.2', filled_qty: '20' });
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(prisma.trade.create).not.toHaveBeenCalled();
});
it('cannot reopen or duplicate a fill recovered before the POST response arrives', async () => {
  let state = 'SUBMITTING';
  (prisma.executionIntent.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
    const allowed = where.status?.in ? where.status.in.includes(state) : where.status?.not ? state !== where.status.not : true;
    if (!allowed) return { count: 0 };
    state = data.status ?? state; return { count: 1 };
  });
  (prisma.executionIntent.findUnique as jest.Mock).mockImplementation(async () => ({ accountId: 'paper-account-1', mode: 'paper', status: state }));
  broker.createOrder.mockImplementationOnce(async request => {
    (prisma.executionIntent.findMany as jest.Mock).mockResolvedValue([{
      id: 'intent-1', decisionId: 'current', clientOrderId: request.client_order_id,
      asset: 'AAPL', market: 'stocks', mode: 'paper', accountId: 'paper-account-1', direction: 'BUY', quantity: 10,
      protection: 'BROKER_HOSTED', executionPlan: { ...signal, version: 1, approved: true, mode: 'paper' },
    }]);
    broker.getOrderByClientOrderId.mockResolvedValue({ id: 'broker-1', client_order_id: request.client_order_id,
      symbol: 'AAPL', side: 'buy', status: 'filled', filled_qty: '10', filled_avg_price: '100.2' });
    await reconcileExecutionIntents();
    return { id: 'broker-1' };
  });
  (prisma.executionIntent.update as jest.Mock).mockImplementation(async ({ data }) => { state = data.status ?? state; return {}; });
  expect(await executeTradeSignal(signal, portfolio)).toBe(true);
  await reconcileExecutionIntents();
  expect(state).toBe('RECORDED');
  expect(prisma.trade.create).toHaveBeenCalledTimes(1);
});
it('recovers a late fill using its client identity and never submits another order', async () => {
  await reconcileExecutionIntents();
  expect(broker.getOrderByClientOrderId).toHaveBeenCalledWith('stable-client-id');
  expect(broker.createOrder).not.toHaveBeenCalled();
  expect(prisma.trade.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: 10, entryPrice: 100.2 }) }));
});
it('keeps a pending partial fill visible without inventing a complete trade', async () => {
  broker.getOrderByClientOrderId.mockResolvedValue({ id: 'broker-1', client_order_id: 'stable-client-id',
    symbol: 'AAPL', side: 'buy', status: 'partially_filled', filled_qty: '2', filled_avg_price: '100.2' });
  await reconcileExecutionIntents();
  expect(prisma.trade.create).not.toHaveBeenCalled();
  expect(prisma.executionIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIALLY_FILLED' }) }));
});
it('records the actual terminal partial quantity after cancellation', async () => {
  broker.getOrderByClientOrderId.mockResolvedValue({ id: 'broker-1', client_order_id: 'stable-client-id',
    symbol: 'AAPL', side: 'buy', status: 'canceled', filled_qty: '2', filled_avg_price: '100.2' });
  await reconcileExecutionIntents();
  expect(prisma.trade.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: 2 }) }));
});
it('never resets a recorded intent when a second worker observes an old pending list', async () => {
  (prisma.executionIntent.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
  await reconcileExecutionIntents();
  expect(prisma.trade.create).not.toHaveBeenCalled();
});
it('retains an unresolved claim when lookup is unavailable or returns no order', async () => {
  broker.getOrderByClientOrderId.mockRejectedValueOnce(new Error('offline'));
  await reconcileExecutionIntents();
  broker.getOrderByClientOrderId.mockResolvedValueOnce(null);
  await reconcileExecutionIntents();
  expect(broker.createOrder).not.toHaveBeenCalled();
  expect(prisma.trade.create).not.toHaveBeenCalled();
});
