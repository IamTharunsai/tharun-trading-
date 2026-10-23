// GET /trades/stats must aggregate ONLY the verified account scope and its
// active broker mode (the whereScope the capital-risk path uses). Before the
// fix the handler pooled every account and both paper and live modes, so the
// reported win rate and P&L mixed unrelated books. Harness follows the
// existing route-test pattern (polymarketGreed.route.test.ts): invoke the
// registered Express handlers with dummy requests and response spies.
const mockFindMany = jest.fn();
const mockGetVerifiedAccountScope = jest.fn();
jest.mock('../src/utils/prisma', () => ({ prisma: {
  trade: { findMany: mockFindMany },
  portfolioSnapshot: { findFirst: jest.fn() },
} }));
jest.mock('../src/utils/redis', () => ({ redis: {} }));
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }),
  requireOwner: (req: any, res: any, next: any) => req.user?.role === 'OWNER' ? next() : res.status(403).json({ error: 'Owner required' }),
  revokeToken: jest.fn(),
  boundedAuthStore: async (work: any) => work(),
}));
jest.mock('../src/utils/config', () => ({ appConfig: {} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../src/services/polymarket', () => ({ initPolymarketWallet: jest.fn(), fetchActiveEvents: jest.fn() }));
jest.mock('../src/trading/liveGate', () => ({ polymarketLiveAllowed: () => ({ allowed: true }) }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
jest.mock('../src/agents/orchestrator', () => ({ activateKillSwitch: jest.fn(), deactivateKillSwitch: jest.fn(), isKillSwitchActive: () => false }));
jest.mock('../src/trading/riskManager', () => ({ closePosition: jest.fn() }));
jest.mock('../src/trading/accountScope', () => ({ getVerifiedAccountScope: mockGetVerifiedAccountScope }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrices: () => ({}) }));
jest.mock('../src/routes/predictionSimulation', () => ({ recordPredictionSimulation: jest.fn(), listPredictionSimulations: jest.fn() }));
jest.mock('../src/trading/decisionVisibility', () => ({ entryDecisionWhere: jest.fn() }));
jest.mock('../src/routes/backtest', () => ({ __esModule: true, default: require('express').Router() }));
jest.mock('../src/routes/chat', () => ({ chatRouter: require('express').Router() }));
jest.mock('../src/routes/intelligence', () => ({ __esModule: true, default: require('express').Router() }));
jest.mock('../src/routes/agentMonitor', () => ({ __esModule: true, default: require('express').Router() }));
jest.mock('jsonwebtoken', () => ({}));
jest.mock('bcryptjs', () => ({}));
jest.mock('speakeasy', () => ({}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
import { tradesRouter } from '../src/routes/index';

// One book per scope corner, plus an unscoped legacy row and an open trade.
// The findMany stub applies the received `where` honestly, like Prisma would,
// so the aggregation is genuinely exercised against the scoped row set.
const mockTrades = [
  { id: 'a-paper-win1', status: 'CLOSED', accountId: 'acct-A', brokerMode: 'paper', market: 'stock', pnl: 30 },
  { id: 'a-paper-win2', status: 'CLOSED', accountId: 'acct-A', brokerMode: 'paper', market: 'stock', pnl: 10 },
  { id: 'a-paper-loss', status: 'CLOSED', accountId: 'acct-A', brokerMode: 'paper', market: 'stock', pnl: -5 },
  { id: 'a-live-win', status: 'CLOSED', accountId: 'acct-A', brokerMode: 'live', market: 'stock', pnl: 999 },
  { id: 'b-paper-loss', status: 'CLOSED', accountId: 'acct-B', brokerMode: 'paper', market: 'stock', pnl: -777 },
  { id: 'legacy-win', status: 'CLOSED', accountId: null, brokerMode: null, market: 'stock', pnl: 555 },
  { id: 'a-paper-open', status: 'OPEN', accountId: 'acct-A', brokerMode: 'paper', market: 'stock', pnl: 100 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockImplementation(async ({ where }: any) => mockTrades
    .filter((t) => (where.status === undefined || t.status === where.status)
      && (where.accountId === undefined || t.accountId === where.accountId)
      && (where.brokerMode === undefined || t.brokerMode === where.brokerMode)
      && (where.market === undefined || t.market === where.market))
    .map((t) => ({ ...t })));
});

async function statsRequest() {
  const request: any = { query: {}, user: { id: 'fixture-owner', role: 'OWNER' } };
  const response: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
  const layers = (tradesRouter as any).stack;
  const route = layers.find((layer: any) => layer.route?.path === '/stats' && layer.route.methods.get).route;
  const handlers = [...layers.filter((layer: any) => !layer.route), ...route.stack];
  for (const layer of handlers) {
    let advanced = false;
    await layer.handle(request, response, () => { advanced = true; });
    if (!advanced) break;
  }
  return response;
}

test('stats aggregate only the requesting account in its active (paper) mode', async () => {
  mockGetVerifiedAccountScope.mockResolvedValue({ accountId: 'acct-A', mode: 'paper', broker: {} });
  const response = await statsRequest();
  expect(mockFindMany).toHaveBeenCalledWith({ where: expect.objectContaining({
    status: 'CLOSED', accountId: 'acct-A', brokerMode: 'paper',
  }) });
  expect(response.status).not.toHaveBeenCalled();
  const body = response.json.mock.calls[0][0];
  expect(body.totalTrades).toBe(3);
  expect(body.winRate).toBe('66.7');
  expect(body.totalPnl).toBe('35.00');
  expect(body.avgWin).toBe('20.00');
  expect(body.avgLoss).toBe('-5.00');
  expect(body.bestTrade.id).toBe('a-paper-win1');
  expect(body.worstTrade.id).toBe('a-paper-loss');
  expect(body.profitFactor).toBe('8.00');
  expect(body.payoffRatio).toBe('4.00');
});

test('the same account in live mode sees only its live book', async () => {
  mockGetVerifiedAccountScope.mockResolvedValue({ accountId: 'acct-A', mode: 'live', broker: {} });
  const response = await statsRequest();
  const body = response.json.mock.calls[0][0];
  expect(body.totalTrades).toBe(1);
  expect(body.winRate).toBe('100.0');
  expect(body.totalPnl).toBe('999.00');
});

test('when no verified account scope exists the endpoint errors instead of pooling', async () => {
  mockGetVerifiedAccountScope.mockRejectedValue(new Error('BROKER_UNAVAILABLE'));
  const response = await statsRequest();
  expect(response.status).toHaveBeenCalledWith(500);
  expect(response.json).toHaveBeenCalledWith({ error: 'BROKER_UNAVAILABLE' });
  expect(mockFindMany).not.toHaveBeenCalled();
});
