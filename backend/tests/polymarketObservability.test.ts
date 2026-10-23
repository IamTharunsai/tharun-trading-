// Polymarket observability repairs. Three wiring bugs made the Polymarket
// screen lie: (a) /portfolio/breakdown derived polymarket.connected from a
// dataSource string that only ever names the Alpaca account, so it could
// never be true; (b) the page queried trades with market 'polymarket' while
// every prediction trade is stored as market 'prediction', so recorded
// wagers were empty by construction; (c) the scan's display writer persisted
// expectedValue/kellyFraction as literal 0. Harness follows the existing
// route-test pattern: invoke registered Express handlers with dummy
// requests and response spies.
const mockTradeFindMany = jest.fn();
const mockTradeCount = jest.fn();
const mockCalcPortfolio = jest.fn();
const mockIsConfigured = jest.fn();
const mockGetAccount = jest.fn();
jest.mock('../src/utils/prisma', () => ({ prisma: {
  trade: { findMany: mockTradeFindMany, count: mockTradeCount },
  portfolioSnapshot: { findFirst: jest.fn() },
  prediction: { create: jest.fn(), deleteMany: jest.fn() },
  polymarketPrediction: { findMany: jest.fn(async () => []) },
} }));
jest.mock('../src/utils/redis', () => ({ redis: {} }));
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }),
  requireOwner: (req: any, res: any, next: any) => req.user?.role === 'OWNER' ? next() : res.status(403).json({ error: 'Owner required' }),
  revokeToken: jest.fn(),
  boundedAuthStore: async (work: any) => work(),
}));
jest.mock('../src/utils/config', () => ({ appConfig: {} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../src/services/polymarket', () => ({
  initPolymarketWallet: jest.fn(), fetchActiveEvents: jest.fn(),
  estimateProbabilityWithLLM: jest.fn(), checkPolymarketExposure: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../src/services/sentimentService', () => ({ getQuerySentiment: jest.fn() }));
jest.mock('../src/trading/liveGate', () => ({ polymarketLiveAllowed: () => ({ allowed: true }), getPolymarketMaxOrderUsd: () => 0 }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
jest.mock('../src/services/portfolioAccounting', () => ({ calculateAuthenticatedPortfolio: mockCalcPortfolio }));
jest.mock('../src/services/polymarketUS', () => ({
  isPolymarketUSConfigured: mockIsConfigured,
  getPolymarketUSAccount: mockGetAccount,
  placePolymarketUSOrder: jest.fn(),
  polymarketUSVenue: null,
}));
jest.mock('../src/agents/orchestrator', () => ({ activateKillSwitch: jest.fn(), deactivateKillSwitch: jest.fn(), isKillSwitchActive: () => false }));
jest.mock('../src/trading/riskManager', () => ({ closePosition: jest.fn() }));
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
import { portfolioRouter, tradesRouter } from '../src/routes/index';
import { displayEvKelly } from '../src/services/polymarketEdge';

async function invoke(router: any, path: string, method: string, request: any) {
  const response: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
  const layers = router.stack;
  const route = layers.find((layer: any) => layer.route?.path === path && layer.route.methods[method]).route;
  const handlers = [...layers.filter((layer: any) => !layer.route), ...route.stack];
  for (const layer of handlers) {
    let advanced = false;
    await layer.handle(request, response, () => { advanced = true; });
    if (!advanced) break;
  }
  return response;
}

const ownerReq = (over: any = {}) => ({ query: {}, user: { id: 'fixture-owner', role: 'OWNER' }, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  mockCalcPortfolio.mockResolvedValue({
    alpacaEquity: 1000, polymarketEquity: 0, combinedTotal: 1000, cashBalance: 500,
    buyingPower: 500, investedCollateral: 100, dataSource: 'ALPACA_AUTHENTICATED_PAPER', timestamp: 'fixture',
  });
});

// ── (a) breakdown wallet status ─────────────────────────────────────────────

test('(a) breakdown reports polymarket connected from the actual account state', async () => {
  mockIsConfigured.mockReturnValue(true);
  mockGetAccount.mockResolvedValue({ connected: true });
  const res = await invoke(portfolioRouter, '/breakdown', 'get', ownerReq());
  const body = res.json.mock.calls[0][0];
  expect(body.polymarket.connected).toBe(true);
  expect(body.alpaca.connected).toBe(true);
});

test('(a) breakdown reports not connected when Polymarket US is not configured', async () => {
  mockIsConfigured.mockReturnValue(false);
  const res = await invoke(portfolioRouter, '/breakdown', 'get', ownerReq());
  const body = res.json.mock.calls[0][0];
  expect(body.polymarket.connected).toBe(false);
  expect(mockGetAccount).not.toHaveBeenCalled();
});

test('(a) a Polymarket US failure degrades to not-connected instead of failing the breakdown', async () => {
  mockIsConfigured.mockReturnValue(true);
  mockGetAccount.mockRejectedValue(new Error('venue down'));
  const res = await invoke(portfolioRouter, '/breakdown', 'get', ownerReq());
  expect(res.status).not.toHaveBeenCalled();
  const body = res.json.mock.calls[0][0];
  expect(body.polymarket.connected).toBe(false);
  expect(body.alpaca.equity).toBe(1000);
});

// ── (b) wagers read path uses the stored market value ───────────────────────

const mockWagerTrades = [
  { id: 'w1', market: 'prediction', status: 'CLOSED', pnl: 5 },
  { id: 'w2', market: 'prediction', status: 'OPEN', pnl: null },
  { id: 's1', market: 'stock', status: 'CLOSED', pnl: 9 },
];

test('(b) GET /trades with the stored market value returns the recorded wagers', async () => {
  const applyWhere = (where: any) => mockWagerTrades.filter((t: any) =>
    (where.market === undefined || t.market === where.market)
    && (where.status === undefined || t.status === where.status)
    && (where.asset === undefined || t.asset === where.asset));
  mockTradeFindMany.mockImplementation(async ({ where, skip = 0, take }: any) =>
    applyWhere(where).slice(skip, take == null ? undefined : skip + take).map((t) => ({ ...t })));
  mockTradeCount.mockImplementation(async ({ where }: any) => applyWhere(where).length);

  const res = await invoke(tradesRouter, '/', 'get', ownerReq({ query: { market: 'prediction' } }));
  const body = res.json.mock.calls[0][0];
  expect(body.total).toBe(2);
  expect(body.trades.map((t: any) => t.id).sort()).toEqual(['w1', 'w2']);

  const empty = await invoke(tradesRouter, '/', 'get', ownerReq({ query: { market: 'polymarket' } }));
  expect(empty.json.mock.calls[0][0].total).toBe(0);
});

// ── (c) display EV / Kelly are computed, not zeroed ─────────────────────────

const fairOf = (fair: number) => ({
  fair, rawFair: fair, evidenceWeight: 0.5, llmProb: null, llmConfidence: null,
  headlineCount: 0, freshestHours: null, sentimentScore: null, sentimentMentions: 0, momentum: null,
});

test('(c) YES row: EV and Kelly come from the model probability and the mid', () => {
  const out = displayEvKelly({ fair: fairOf(0.70) as any, mid: 0.55, decision: 'YES' });
  expect(out.expectedValue).toBeCloseTo(0.15, 10);
  expect(out.kellyFraction).toBeCloseTo((0.70 - 0.55) / (1 - 0.55), 10);
});

test('(c) NO row: the side is priced off 1 − fair against 1 − mid', () => {
  const out = displayEvKelly({ fair: fairOf(0.20) as any, mid: 0.55, decision: 'NO' });
  expect(out.expectedValue).toBeCloseTo(0.35, 10);
  expect(out.kellyFraction).toBeCloseTo((0.80 - 0.45) / (1 - 0.45), 10);
});

test('(c) a negative-edge side reports negative EV and zero Kelly', () => {
  const out = displayEvKelly({ fair: fairOf(0.70) as any, mid: 0.55, decision: 'NO' });
  expect(out.expectedValue).toBeCloseTo(-0.15, 10);
  expect(out.kellyFraction).toBe(0);
});

test('(c) a row with no recommendation keeps both at 0', () => {
  const out = displayEvKelly({ fair: fairOf(0.70) as any, mid: 0.55, decision: 'NEUTRAL' });
  expect(out).toEqual({ expectedValue: 0, kellyFraction: 0 });
});

test('(c) a SKIP row with a computed best-edge side is priced on that side, not zeroed', () => {
  const out = displayEvKelly({ fair: fairOf(0.70) as any, mid: 0.55, decision: 'SKIP', side: 'YES' });
  expect(out.expectedValue).toBeCloseTo(0.15, 10);
  expect(out.kellyFraction).toBeCloseTo((0.70 - 0.55) / (1 - 0.55), 10);
});

test('(c) a SKIP row with no computed side keeps both at 0', () => {
  const out = displayEvKelly({ fair: fairOf(0.70) as any, mid: 0.55, decision: 'SKIP' });
  expect(out).toEqual({ expectedValue: 0, kellyFraction: 0 });
});

test('(c) the bet decision takes precedence over the fallback side', () => {
  const out = displayEvKelly({ fair: fairOf(0.20) as any, mid: 0.55, decision: 'NO', side: 'YES' });
  expect(out.expectedValue).toBeCloseTo(0.35, 10);
  expect(out.kellyFraction).toBeCloseTo((0.80 - 0.45) / (1 - 0.45), 10);
});
