// GET /forecasts/scorecard must serve the measured scorecard (and nothing
// else): owner-only, read-only, and honestly zero when no forecasts exist.
// Harness follows tests/tradesStatsScope.test.ts.
const mockForecastFindMany = jest.fn();
jest.mock('../src/utils/prisma', () => ({ prisma: {
  forecastRecord: { findMany: mockForecastFindMany },
  trade: { findMany: jest.fn() },
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
jest.mock('../src/trading/accountScope', () => ({ getVerifiedAccountScope: jest.fn() }));
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
import { forecastsRouter } from '../src/routes/index';

async function request(path: string, query: any = {}, user: any = { id: 'fixture-owner', role: 'OWNER' }) {
  const req: any = { query, user };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
  const layers = (forecastsRouter as any).stack;
  const route = layers.find((layer: any) => layer.route?.path === path && layer.route.methods.get).route;
  const handlers = [...layers.filter((layer: any) => !layer.route), ...route.stack];
  for (const layer of handlers) {
    let advanced = false;
    await layer.handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

beforeEach(() => { jest.clearAllMocks(); mockForecastFindMany.mockResolvedValue([]); });

test('scorecard endpoint returns the measured aggregation over recorded forecasts', async () => {
  mockForecastFindMany.mockResolvedValue([
    { source: 'KRONOS', direction: 'UP', probabilityUp: null, realizedReturn: 0.02, directionHit: true, brier: null, scoredAt: new Date(), createdAt: new Date() },
    { source: 'KRONOS', direction: 'DOWN', probabilityUp: null, realizedReturn: 0.01, directionHit: false, brier: null, scoredAt: new Date(), createdAt: new Date() },
    { source: 'COUNCIL', direction: 'UP', probabilityUp: 0.8, realizedReturn: 0.03, directionHit: true, brier: 0.04, scoredAt: new Date(), createdAt: new Date() },
  ]);
  const res = await request('/scorecard');
  expect(res.status).not.toHaveBeenCalled();
  const body = res.json.mock.calls[0][0];
  expect(body.overall).toMatchObject({ recorded: 3, scored: 3, hits: 2, hitRate: 2 / 3 });
  expect(body.bySource.KRONOS.hitRate).toBe(0.5);
  expect(body.bySource.COUNCIL.brier).toMatchObject({ n: 1 });
  expect(body.bySource.COUNCIL.brier.mean).toBeCloseTo(0.04, 10);
});

test('scorecard endpoint is honestly empty before any forecast is recorded', async () => {
  const res = await request('/scorecard');
  const body = res.json.mock.calls[0][0];
  expect(body.overall).toMatchObject({ recorded: 0, scored: 0, hitRate: null });
});

test('scorecard endpoint rejects non-owners', async () => {
  const res = await request('/scorecard', {}, { id: 'someone', role: 'VIEWER' });
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mockForecastFindMany).not.toHaveBeenCalled();
});

test('recent endpoint lists recorded forecasts newest first', async () => {
  mockForecastFindMany.mockResolvedValue([{ id: 'f-2' }, { id: 'f-1' }]);
  const res = await request('/recent', { limit: '2' });
  const body = res.json.mock.calls[0][0];
  expect(body.total).toBe(2);
  expect(mockForecastFindMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 2 }));
});
