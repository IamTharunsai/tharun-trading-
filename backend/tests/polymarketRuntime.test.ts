// Assert the actual status response, not just the helper's constant result.
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireOwner: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../src/utils/config', () => ({ appConfig: {
  get TRADING_MODE() { return process.env.TRADING_MODE; },
  ALPACA: { isPaperConfigured: false, isLiveConfigured: false },
} }));
jest.mock('../src/utils/llmRouter', () => ({ getLlmHealth: () => ({
  fast: { provider: 'fixture', model: 'fixture', healthy: false },
  smart: { provider: 'fixture', model: 'fixture', healthy: false },
}) }));
jest.mock('../src/utils/apiKeys', () => ({ isPlaceholderKey: () => true }));
jest.mock('../src/services/researchServices', () => ({
  getResearchServicesStatus: jest.fn(), isResearchService: jest.fn(),
  ResearchServiceError: class extends Error {}, runResearchService: jest.fn(),
}), { virtual: true }); // Also works before the independent research PR lands.
jest.mock('../src/agents/debateEngine', () => ({ getLlmSpendToday: () => ({ usd: 0, budget: 0 }) }));
jest.mock('../src/services/universeService', () => ({ universe: { status: () => ({ source: 'fixture' }) } }));
jest.mock('../src/trading/intradayEngine', () => ({ getIntradayStatus: async () => null }));
jest.mock('../src/services/brokerSync', () => ({ getLastBrokerSync: () => null }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false }));
jest.mock('../src/services/polymarketUS', () => ({
  getPolymarketUSHealth: () => ({ connected: true, status: 'verified' }), isPolymarketUSConfigured: () => true,
}));
jest.mock('../src/services/accountManager', () => ({ accountManager: {
  getLiveAccountsSummary: () => ({ alpaca: { connected: false, paperMode: true } }),
} }));
// The legacy route read this permission gate as its actual mode.
jest.mock('../src/trading/liveGate', () => ({ polymarketLiveAllowed: () => ({ allowed: process.env.TRADING_MODE === 'live' }) }));
import router from '../src/routes/system';

const names = ['TRADING_MODE', 'LIVE_TRADING_CONFIRMED', 'POLYMARKET_US_LIVE'];
const savedVariables = Object.fromEntries(names.map(name => [name, process.env[name]]));
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  for (const name of names) {
    if (savedVariables[name] === undefined) delete process.env[name]; else process.env[name] = savedVariables[name];
  }
});

test.each(['paper', 'live'])('status reports the connected paper runtime under global mode %s', async mode => {
  Object.assign(process.env, {
    TRADING_MODE: mode, LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK', POLYMARKET_US_LIVE: 'true',
  });
  const route = (router as any).stack.find((layer: any) => layer.route?.path === '/status').route;
  const response: any = { json: jest.fn().mockReturnThis() };
  await route.stack[0].handle({}, response);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
    polymarket: expect.objectContaining({
      mode: 'paper', usConnected: true,
      liveReadiness: expect.objectContaining({ ready: false, code: 'runtime-not-connected' }),
    }),
  }));
});
