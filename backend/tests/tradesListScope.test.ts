// GET /trades must list ONLY the verified account scope and its active
// broker mode — the same scoping PR #62 applied to GET /trades/stats.
// Before the fix the handler pooled every account and both paper and live
// modes (and counted them in the pagination total), so one book's list
// leaked unrelated books' rows. Harness follows tradesStatsScope.test.ts:
// invoke the registered Express handlers with dummy requests and response
// spies, with findMany/count stubs that apply the received `where` honestly.
const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockGetVerifiedAccountScope = jest.fn();
jest.mock('../src/utils/prisma', () => ({ prisma: {
  trade: { findMany: mockFindMany, count: mockCount },
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

// One book per scope corner, plus an unscoped legacy row. openedAt increases
// down the non-scope rows on purpose: if scoping regresses, the newest rows
// in the pooled list are exactly the ones that must NOT appear.
const mockTrades = [
  { id: 'a-paper-old', status: 'CLOSED', accountId: 'acct-A', brokerMode: 'paper', market: 'stock', asset: 'AAPL', openedAt: new Date('2026-01-01T00:00:00Z') },
  { id: 'a-paper-mid', status: 'OPEN', accountId: 'acct-A', brokerMode: 'paper', market: 'stock', asset: 'MSFT', openedAt: new Date('2026-01-02T00:00:00Z') },
  { id: 'a-paper-new', status: 'CLOSED', accountId: 'acct-A', brokerMode: 'paper', market: 'crypto', asset: 'BTC/USD', openedAt: new Date('2026-01-03T00:00:00Z') },
  { id: 'a-live', status: 'CLOSED', accountId: 'acct-A', brokerMode: 'live', market: 'stock', asset: 'AAPL', openedAt: new Date('2026-01-04T00:00:00Z') },
  { id: 'b-paper', status: 'CLOSED', accountId: 'acct-B', brokerMode: 'paper', market: 'stock', asset: 'AAPL', openedAt: new Date('2026-01-05T00:00:00Z') },
  { id: 'b-live', status: 'OPEN', accountId: 'acct-B', brokerMode: 'live', market: 'crypto', asset: 'ETH/USD', openedAt: new Date('2026-01-06T00:00:00Z') },
  { id: 'legacy', status: 'CLOSED', accountId: null, brokerMode: null, market: 'stock', asset: 'AAPL', openedAt: new Date('2026-01-07T00:00:00Z') },
];

function applyWhere(rows: any[], where: any) {
  return rows.filter((t) => (where.status === undefined || t.status === where.status)
    && (where.accountId === undefined || t.accountId === where.accountId)
    && (where.brokerMode === undefined || t.brokerMode === where.brokerMode)
    && (where.market === undefined || t.market === where.market)
    && (where.asset === undefined || t.asset === where.asset));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockImplementation(async ({ where, skip = 0, take, orderBy }: any) => {
    let rows = applyWhere(mockTrades, where);
    if (orderBy?.openedAt === 'desc') rows = [...rows].sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
    if (take !== undefined) rows = rows.slice(skip, skip + take);
    return rows.map((t) => ({ ...t }));
  });
  mockCount.mockImplementation(async ({ where }: any) => applyWhere(mockTrades, where).length);
});

async function listRequest(query: any = {}) {
  const request: any = { query, user: { id: 'fixture-owner', role: 'OWNER' } };
  const response: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
  const layers = (tradesRouter as any).stack;
  const route = layers.find((layer: any) => layer.route?.path === '/' && layer.route.methods.get).route;
  const handlers = [...layers.filter((layer: any) => !layer.route), ...route.stack];
  for (const layer of handlers) {
    let advanced = false;
    await layer.handle(request, response, () => { advanced = true; });
    if (!advanced) break;
  }
  return response;
}

test('list returns only the requesting account in its active (paper) mode', async () => {
  mockGetVerifiedAccountScope.mockResolvedValue({ accountId: 'acct-A', mode: 'paper', broker: {} });
  const response = await listRequest();
  expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ accountId: 'acct-A', brokerMode: 'paper' }),
    orderBy: { openedAt: 'desc' },
    include: { agentDecision: true },
  }));
  expect(mockCount).toHaveBeenCalledWith({
    where: expect.objectContaining({ accountId: 'acct-A', brokerMode: 'paper' }),
  });
  expect(response.status).not.toHaveBeenCalled();
  const body = response.json.mock.calls[0][0];
  expect(body.trades.map((t: any) => t.id)).toEqual(['a-paper-new', 'a-paper-mid', 'a-paper-old']);
  expect(body.total).toBe(3);
  expect(body.page).toBe(1);
  expect(body.pages).toBe(1);
});

test('the same account in live mode sees only its live book', async () => {
  mockGetVerifiedAccountScope.mockResolvedValue({ accountId: 'acct-A', mode: 'live', broker: {} });
  const response = await listRequest();
  const body = response.json.mock.calls[0][0];
  expect(body.trades.map((t: any) => t.id)).toEqual(['a-live']);
  expect(body.total).toBe(1);
});

test('a different verified account sees only its own book', async () => {
  mockGetVerifiedAccountScope.mockResolvedValue({ accountId: 'acct-B', mode: 'paper', broker: {} });
  const response = await listRequest();
  const body = response.json.mock.calls[0][0];
  expect(body.trades.map((t: any) => t.id)).toEqual(['b-paper']);
  expect(body.total).toBe(1);
});

test('status, market and asset filters compose with the scope instead of replacing it', async () => {
  mockGetVerifiedAccountScope.mockResolvedValue({ accountId: 'acct-A', mode: 'paper', broker: {} });
  const byStatusMarket = await listRequest({ status: 'CLOSED', market: 'stock' });
  expect(mockFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { accountId: 'acct-A', brokerMode: 'paper', status: 'CLOSED', market: 'stock' },
  }));
  expect(byStatusMarket.json.mock.calls[0][0].trades.map((t: any) => t.id)).toEqual(['a-paper-old']);
  expect(byStatusMarket.json.mock.calls[0][0].total).toBe(1);

  const byAsset = await listRequest({ asset: 'AAPL' });
  // b-paper, a-live and the legacy row are also AAPL — none may leak in.
  expect(byAsset.json.mock.calls[0][0].trades.map((t: any) => t.id)).toEqual(['a-paper-old']);
  expect(byAsset.json.mock.calls[0][0].total).toBe(1);
});

test('pagination is computed over the scoped total only', async () => {
  mockGetVerifiedAccountScope.mockResolvedValue({ accountId: 'acct-A', mode: 'paper', broker: {} });
  const page2 = await listRequest({ page: '2', limit: '2' });
  const body = page2.json.mock.calls[0][0];
  expect(body.trades.map((t: any) => t.id)).toEqual(['a-paper-old']);
  expect(body.total).toBe(3);
  expect(body.page).toBe(2);
  expect(body.pages).toBe(2);
});

test('when no verified account scope exists the endpoint errors instead of pooling', async () => {
  mockGetVerifiedAccountScope.mockRejectedValue(new Error('BROKER_UNAVAILABLE'));
  const response = await listRequest();
  expect(response.status).toHaveBeenCalledWith(500);
  expect(response.json).toHaveBeenCalledWith({ error: 'BROKER_UNAVAILABLE' });
  expect(mockFindMany).not.toHaveBeenCalled();
  expect(mockCount).not.toHaveBeenCalled();
});
