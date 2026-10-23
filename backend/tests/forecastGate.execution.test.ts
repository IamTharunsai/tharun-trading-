// Forecast gate at the execution handoff: an opposed recorded forecast must
// stop executeTradeSignal before any intent claim or broker order exists, an
// aligned forecast must let the identical trade through, and FORECAST_GATE_
// ENABLED=false must restore the pre-gate behaviour exactly.
// Fixture shape follows tests/executionAuthority.behavior.test.ts.
jest.mock('../src/utils/prisma', () => ({ prisma: {
  agentDecision: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  strategyQualification: { findFirst: jest.fn() },
  executionIntent: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
  forecastRecord: { findMany: jest.fn() },
  trade: { create: jest.fn() }, position: { upsert: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() }, $transaction: jest.fn(), $executeRaw: jest.fn(),
} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrice: jest.fn(), buildMarketSnapshot: jest.fn() }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: jest.fn(() => false) }));
jest.mock('../src/trading/brokerRouter', () => {
  const mode = jest.fn(() => 'paper');
  return { getActiveMode: mode, getTradingBroker: jest.fn(), getTradingCredentials: jest.fn(() => ({ mode: mode(), apiKey: 'fixture-paper', secret: 'fixture-secret' })) };
});
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { symbol: 'AAPL', quote: { bp: 99.99, ap: 100, t: new Date().toISOString() } } })) } }));
jest.mock('../src/trading/riskManager', () => ({ validateTradeSignal: jest.fn(async () => ({ approved: true, adjustedSize: 1 })) }));
import { prisma } from '../src/utils/prisma';
import { getTradingBroker, getActiveMode, getTradingCredentials } from '../src/trading/brokerRouter';
import type { PortfolioState, TradeSignal } from '../src/agents/types';
import { getPortfolioState } from '../src/services/portfolio';
import axios from 'axios';

const signal: TradeSignal = { asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 80,
  entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 105, positionSizePct: 1,
  agentDecisionId: 'current', reasoning: 'fixture' };
const portfolio: PortfolioState = { accountId: 'paper-account-1', brokerMode: 'paper', totalValue: 100000, cashBalance: 100000, invested: 0, pnlDay: 0,
  pnlDayPct: 0, pnlWeekPct: 0, pnlTotal: 0, positions: [], dailyLossToday: 0,
  tradesExecutedToday: 0, drawdownFromPeak: 0 } as any;
const broker = { getPortfolioSummary: jest.fn(), getPosition: jest.fn(), createOrder: jest.fn(), getOrder: jest.fn(), getOrderByClientOrderId: jest.fn() };
let executeTradeSignal: typeof import('../src/trading/executionEngine').executeTradeSignal;
const forecastFindMany = (prisma as any).forecastRecord.findMany as jest.Mock;
const forecastRow = (over: any = {}) => ({
  source: 'KRONOS', asset: 'AAPL', direction: 'DOWN', decisionId: null,
  createdAt: new Date(Date.now() - 60_000), maturesAt: new Date(Date.now() + 3_600_000), ...over,
});
const ORIGINAL_FLAG = process.env.FORECAST_GATE_ENABLED;
beforeAll(() => {
  process.env.DRY_RUN = 'false'; // All provider objects are mocks; network is disabled by the test sandbox.
  executeTradeSignal = require('../src/trading/executionEngine').executeTradeSignal;
});
afterAll(() => {
  process.env.DRY_RUN = 'true';
  if (ORIGINAL_FLAG === undefined) delete process.env.FORECAST_GATE_ENABLED; else process.env.FORECAST_GATE_ENABLED = ORIGINAL_FLAG;
});
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.FORECAST_GATE_ENABLED;
  (getActiveMode as jest.Mock).mockReturnValue('paper');
  (getTradingCredentials as jest.Mock).mockImplementation(() => ({ mode: getActiveMode(), apiKey: 'fixture-paper', secret: 'fixture-secret' }));
  (axios.get as jest.Mock).mockImplementation(async () => ({ data: { symbol: 'AAPL', quote: { bp: 99.99, ap: 100, t: new Date().toISOString() } } }));
  jest.requireMock('../src/trading/riskManager').validateTradeSignal.mockResolvedValue({ approved: true, adjustedSize: 1 });
  delete process.env.RELEASE_COMMIT_SHA;
  (getPortfolioState as jest.Mock).mockResolvedValue(portfolio);
  (prisma.strategyQualification.findFirst as jest.Mock).mockResolvedValue(null);
  forecastFindMany.mockResolvedValue([]);
  const now = Date.now();
  Object.assign(portfolio, { riskDataComplete: true, capitalRisk: { accountId: portfolio.accountId, brokerMode: 'paper', complete: true,
    asOf: new Date(now).toISOString(), dailyPnlPct: 0, weeklyPnlPct: 0, drawdownPct: 0 } });
  (prisma.agentDecision.findUnique as jest.Mock).mockResolvedValue({
    id: 'current', asset: 'AAPL', executed: false, executionReason: null, timestamp: new Date(now),
    signal: 'BUY', finalVote: 'BUY', totalVotes: 14, goVotes: 14, noGoVotes: 0, avgConfidence: 80,
    agentVotes: Array.from({ length: 14 }, (_, i) => ({ agentId: i + 1, finalVote: 'BUY', confidence: 80, executionEligible: true })),
    marketSnapshot: { asset: 'AAPL', market: 'stocks', timestamp: now, inputFingerprint: 'a'.repeat(64),
      dataEvidence: { source: 'Alpaca IEX', timeframe: '1Day', completedBars: 250, priceObservedAt: now, quoteObservedAt: now, receivedAt: now },
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
  (prisma.agentDecision.update as jest.Mock).mockResolvedValue({});
  (prisma.agentDecision.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.trade.create as jest.Mock).mockResolvedValue({ id: 'trade-1' });
  (prisma.position.upsert as jest.Mock).mockResolvedValue({ id: 'position-1' });
  (prisma.$transaction as jest.Mock).mockImplementation(async (work: any) => work(prisma));
});

test('an unexpired opposing Kronos forecast blocks the entry before any claim or order', async () => {
  forecastFindMany.mockResolvedValue([forecastRow()]);
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(broker.createOrder).not.toHaveBeenCalled();
  expect(prisma.executionIntent.create).not.toHaveBeenCalled();
  expect(prisma.agentDecision.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ executionReason: expect.stringContaining('FORECAST_GATE_OPPOSED') }),
  }));
});

test('an aligned forecast lets the identical trade execute', async () => {
  forecastFindMany.mockResolvedValue([forecastRow({ direction: 'UP' })]);
  expect(await executeTradeSignal(signal, portfolio)).toBe(true);
  expect(broker.createOrder).toHaveBeenCalledTimes(1);
});

test('no recorded forecast lets the identical trade execute', async () => {
  forecastFindMany.mockResolvedValue([]);
  expect(await executeTradeSignal(signal, portfolio)).toBe(true);
  expect(broker.createOrder).toHaveBeenCalledTimes(1);
});

test("the trade's own council call cannot block it, but another decision's call can", async () => {
  forecastFindMany.mockResolvedValue([forecastRow({ source: 'COUNCIL', decisionId: 'current' })]);
  expect(await executeTradeSignal(signal, portfolio)).toBe(true);
  expect(broker.createOrder).toHaveBeenCalledTimes(1);

  jest.clearAllMocks();
  forecastFindMany.mockResolvedValue([forecastRow({ source: 'COUNCIL', decisionId: 'someone-else' })]);
  // Re-arm the fixture mocks cleared above.
  (prisma.agentDecision.findUnique as jest.Mock).mockResolvedValue({
    id: 'current', asset: 'AAPL', executed: false, executionReason: null, timestamp: new Date(),
    signal: 'BUY', finalVote: 'BUY', totalVotes: 14, goVotes: 14, noGoVotes: 0, avgConfidence: 80,
    agentVotes: Array.from({ length: 14 }, (_, i) => ({ agentId: i + 1, finalVote: 'BUY', confidence: 80, executionEligible: true })),
    marketSnapshot: { asset: 'AAPL', market: 'stocks', timestamp: Date.now(), inputFingerprint: 'a'.repeat(64),
      dataEvidence: { source: 'Alpaca IEX', timeframe: '1Day', completedBars: 250, priceObservedAt: Date.now(), quoteObservedAt: Date.now(), receivedAt: Date.now() },
      executionPlan: { version: 1, approved: true, mode: 'paper', market: 'stocks', direction: 'BUY', confidence: 80,
        entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 105, positionSizePct: 1 } },
  });
  (getPortfolioState as jest.Mock).mockResolvedValue(portfolio);
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(broker.createOrder).not.toHaveBeenCalled();
});

test('FORECAST_GATE_ENABLED=false restores pre-gate behaviour: the opposed trade executes', async () => {
  process.env.FORECAST_GATE_ENABLED = 'false';
  forecastFindMany.mockResolvedValue([forecastRow()]);
  expect(await executeTradeSignal(signal, portfolio)).toBe(true);
  expect(broker.createOrder).toHaveBeenCalledTimes(1);
  expect(forecastFindMany).not.toHaveBeenCalled();
});
