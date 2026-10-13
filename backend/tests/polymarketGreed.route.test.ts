// Existing suite pattern: invoke registered Express handlers with dummy requests
// and response spies. No HTTP listener or provider is started.
const mockOperations = {
  findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), updateMany: jest.fn(),
  portfolio: jest.fn().mockResolvedValue({ totalValue: 100 }),
  post: jest.fn(), get: jest.fn(), wallet: jest.fn(() => false), events: jest.fn(),
};
jest.mock('../src/utils/prisma', () => ({ prisma: {
  trade: { findMany: mockOperations.findMany, create: mockOperations.create, updateMany: mockOperations.updateMany },
  portfolioSnapshot: { findFirst: mockOperations.portfolio },
} }));
jest.mock('../src/utils/redis', () => ({ redis: {} }));
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }),
  requireOwner: (req: any, res: any, next: any) => req.user?.role === 'OWNER' ? next() : res.status(403).json({ error: 'Owner required' }),
  revokeToken: jest.fn(),
}));
jest.mock('../src/utils/config', () => ({ appConfig: {} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../src/services/polymarket', () => ({ initPolymarketWallet: mockOperations.wallet, fetchActiveEvents: mockOperations.events }));
jest.mock('../src/trading/liveGate', () => ({ polymarketLiveAllowed: () => ({ allowed: true }) }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
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
jest.mock('axios', () => ({ post: mockOperations.post, get: mockOperations.get }));
import { greedRouter } from '../src/routes/index';

const fixtureEnv: Record<string, string> = {
  TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK',
  POLYMARKET_US_LIVE: 'true', POLYMARKET_API_KEY_ID: 'fixture-only-key', POLYMARKET_API_SECRET: 'fixture-only-secret',
};
const savedVariables = Object.fromEntries(Object.keys(fixtureEnv).map(name => [name, process.env[name]]));
const originalFetch = global.fetch;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  Object.assign(process.env, fixtureEnv); global.fetch = jest.fn();
});
afterEach(() => {
  jest.clearAllTimers(); jest.useRealTimers(); global.fetch = originalFetch;
  for (const name of Object.keys(fixtureEnv)) {
    if (savedVariables[name] === undefined) delete process.env[name]; else process.env[name] = savedVariables[name];
  }
});

async function activationRequest(role?: string) {
  const request = { body: { active: true, greedMode: true }, ...(role ? { user: { id: 'fixture-owner', role } } : {}) };
  const response: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const layers = (greedRouter as any).stack;
  const route = layers.find((layer: any) => layer.route?.path === '/' && layer.route.methods.post).route;
  const handlers = [...layers.filter((layer: any) => !layer.route), ...route.stack];
  for (const layer of handlers) {
    let advanced = false;
    await layer.handle(request, response, () => { advanced = true; });
    if (!advanced) break;
  }
  return response;
}

test('owner activation returns HTTP 409 and cannot start execution or touch financial rows', async () => {
  const response = await activationRequest('OWNER');
  expect(response.status).toHaveBeenCalledWith(409);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
    ok: false, message: expect.stringMatching(/retired.*not connected/i),
    state: expect.objectContaining({ active: false, executionAvailable: false, metricsAvailable: false }),
  }));
  expect(jest.getTimerCount()).toBe(0);
  for (const operation of Object.values(mockOperations)) expect(operation).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([[undefined, 401], ['MEMBER', 403]])('activation keeps registered authentication/owner guards for role %s', async (role, status) => {
  const response = await activationRequest(role as string | undefined);
  expect(response.status).toHaveBeenCalledWith(status);
  expect(jest.getTimerCount()).toBe(0);
  for (const operation of Object.values(mockOperations)) expect(operation).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});
