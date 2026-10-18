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
import { polymarketScanEvidence } from '../src/services/polymarketScanEvidence';

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
  const response: any = { setHeader: jest.fn() };
  await new Promise<void>((resolve, reject) => {
    response.json = jest.fn(() => { resolve(); return response; });
    // Traverse the registered guards as well as the status handler. Middleware
    // additions must not turn this into a test of an assumed stack index.
    (router as any).handle({ method: 'GET', url: '/status', headers: {}, query: {} }, response,
      (error: unknown) => reject(error || new Error('Fixture status route did not respond')));
  });
  expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
    polymarket: expect.objectContaining({
      mode: 'paper', usConnected: true,
      liveReadiness: expect.objectContaining({ ready: false, code: 'runtime-not-connected' }),
      scanEvidence: expect.objectContaining({ scope: 'process-local', previousProcessHistoryAvailable: false, latestRun: null }),
    }),
  }));
});

test('owner status reads a new completed zero-entry scan without inferring live readiness', async () => {
  polymarketScanEvidence.finish(polymarketScanEvidence.start()!, 'completed', {
    listed: 200, candidates: 15, estimated: 0, reused: 5, entries: 0,
    skips: { 'LLM budget for this scan used': 10, 'reused SKIP decision': 5 },
  });
  const response: any = { setHeader: jest.fn() };
  await new Promise<void>((resolve, reject) => {
    response.json = jest.fn(() => { resolve(); return response; });
    (router as any).handle({ method: 'GET', url: '/status', headers: {}, query: {} }, response,
      (error: unknown) => reject(error || new Error('Fixture status route did not respond')));
  });
  expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ polymarket: expect.objectContaining({
    mode: 'paper', liveReadiness: expect.objectContaining({ ready: false }),
    scanEvidence: expect.objectContaining({ latestRun: expect.objectContaining({ status: 'completed',
      counts: { listed: 200, candidates: 15, estimated: 0, reused: 5, paperEntries: 0 },
      skipCounts: expect.objectContaining({ llm_budget_exhausted: 10, reused_skip: 5 }),
    }) }),
  }) }));
});
