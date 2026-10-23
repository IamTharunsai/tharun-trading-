// Every business dependency is replaced before importing the registered routers.
// This suite never starts the application, a listener, a scheduler or a provider.
jest.mock('../src/utils/prisma', () => {
  const model = () => ({ findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) });
  return { prisma: { user: model(), revokedToken: model(), trade: model(), position: model(), agentDecision: model(),
    tradeLifecycleAudit: model(), portfolioSnapshot: model(), dailyJournal: model(), prediction: model(),
    polymarketPrediction: model(), companyFundamentals: model(), stockMemory: model(), systemLog: model() },
  checkDatabaseHealth: jest.fn().mockResolvedValue({ healthy: true }) };
});
jest.mock('jsonwebtoken', () => ({ __esModule: true, default: { verify: jest.fn(), sign: jest.fn() } }));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(() => { throw new Error('Unexpected external request'); }) } }));
jest.mock('../src/utils/config', () => ({ appConfig: { JWT_SECRET: 'fixture-secret', OWNER_EMAIL: 'configured@example.test',
  TRADING_MODE: 'paper', ALPACA: { isPaperConfigured: false, isLiveConfigured: false } },
  readRiskSettings: jest.fn().mockReturnValue({ maxPositionSizePct: 1 }) }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/utils/redis', () => ({ redis: { status: 'ready', mget: jest.fn().mockResolvedValue([]) } }));
jest.mock('../src/routes/backtest', () => ({ __esModule: true, default: require('express').Router() }));
jest.mock('../src/routes/chat', () => ({ chatRouter: require('express').Router() }));
jest.mock('../src/services/groundedDeepDive', () => ({ parseDeepDiveInput: jest.fn(), runGroundedDeepDive: jest.fn(), DeepDiveUnavailable: class extends Error {} }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn().mockResolvedValue({ positions: [{ id: 'PRIVATE_POSITION' }] }) }));
jest.mock('../src/services/teamSessions', () => ({ teamSessionRegistry: { snapshot: jest.fn().mockReturnValue({ sessions: [{ id: 'PRIVATE_SESSION' }] }) } }));
jest.mock('../src/services/portfolioAccounting', () => ({ calculateAuthenticatedPortfolio: jest.fn().mockResolvedValue({ totalValue: 123, dataSource: 'PRIVATE_ACCOUNT', timestamp: 'fixture' }) }));
jest.mock('../src/services/positionResearch', () => ({ getPositionResearchStatus: jest.fn().mockResolvedValue([]), getPositionResearchDecision: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/agents/orchestrator', () => ({ activateKillSwitch: jest.fn(), deactivateKillSwitch: jest.fn(), isKillSwitchActive: jest.fn().mockReturnValue(false) }));
jest.mock('../src/trading/riskManager', () => ({ closePosition: jest.fn() }));
jest.mock('../src/trading/killLiquidation', () => ({ liquidateCurrentAccount: jest.fn() }));
jest.mock('../src/jobs/scheduler', () => ({ runDebateForAsset: jest.fn() }));
jest.mock('../src/services/journalGenerator', () => ({ generateDailyJournal: jest.fn() }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrices: jest.fn().mockReturnValue({ AAPL: 100 }), buildMarketSnapshot: jest.fn().mockResolvedValue({ candles: [], indicators: {}, price: 100 }) }));
jest.mock('../src/services/accountManager', () => ({ accountManager: { getLiveAccountsSummary: jest.fn().mockReturnValue({ alpaca: { connected: false, accountNumber: 'PRIVATE_ACCOUNT' } }), testAndSaveAlpaca: jest.fn(), testAndSavePolymarket: jest.fn(), disconnectAlpaca: jest.fn(), disconnectPolymarket: jest.fn() } }));
jest.mock('../src/trading/brokerRouter', () => ({ getActiveMode: jest.fn().mockReturnValue('paper') }));
jest.mock('../src/trading/accountScope', () => ({ getVerifiedAccountScope: jest.fn().mockResolvedValue({ accountId: 'fixture-account', mode: 'paper', broker: {} }) }));
jest.mock('../src/services/sentimentService', () => ({ isSentimentEnabled: jest.fn().mockReturnValue(false) }));
jest.mock('../src/services/agentActivityMonitor', () => ({ agentActivityMonitor: {
  getActivities: jest.fn().mockReturnValue([{ content: 'PRIVATE_ACTIVITY' }]), getRecentActivities: jest.fn().mockReturnValue([]),
  getActivitySummaryByAgent: jest.fn().mockReturnValue({ marker: 'PRIVATE_SUMMARY' }), getLearningStats: jest.fn().mockReturnValue({ marker: 'PRIVATE_LEARNING' }),
} }));
jest.mock('../src/services/geopoliticalDataService', () => ({ geopoliticalDataService: {
  getRecentNews: jest.fn().mockReturnValue([{ title: 'MARKET_NEWS' }]), getHighImpactNews: jest.fn().mockReturnValue([]),
  getActiveGeopoliticalEvents: jest.fn().mockReturnValue([]), generateMarketSentimentSummary: jest.fn().mockReturnValue({ marker: 'MARKET_SENTIMENT' }),
  getLearningContext: jest.fn().mockReturnValue({ marker: 'MARKET_CONTEXT' }),
} }));
jest.mock('../src/services/agentActivityLogger', () => ({ __esModule: true, default: {
  getActivityFeed: jest.fn().mockResolvedValue({ totalActivities: 0, lastHourActivities: [], recentVotes: [], agentStatus: {} }),
  getAgentActivityTrace: jest.fn().mockResolvedValue([{ reasoning: 'PRIVATE_TRACE' }]), generateAgentActivitySummary: jest.fn().mockResolvedValue('PRIVATE_SUMMARY'),
  exportAgentActivityReport: jest.fn().mockResolvedValue('PRIVATE_EXPORT'), logAgentActivity: jest.fn(),
} }));
jest.mock('../src/services/agentResourceLearning', () => ({ __esModule: true, default: { buildAgentLearningState: jest.fn().mockResolvedValue({ overallScore: 50, recentLearnings: [] }) } }));
jest.mock('../src/services/geopoliticalIntelligence', () => ({ __esModule: true, default: {
  buildGeoRiskAssessment: jest.fn().mockResolvedValue({ overallRisk: 50 }), monitorGeopoliticalEvents: jest.fn().mockResolvedValue([]),
} }));
jest.mock('../src/services/intermarketService', () => ({ intermarketService: { getIntermarketAnalysis: jest.fn().mockResolvedValue({ assets: { vix: 20 } }) } }));
jest.mock('../src/services/fredService', () => ({ getMacroSnapshot: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/services/copyTradingEngine', () => ({ copyTradingEngine: {
  getStrategies: jest.fn().mockReturnValue([{ name: 'MARKET_STRATEGY' }]), getFollowers: jest.fn().mockReturnValue([{ name: 'PRIVATE_FOLLOWER' }]),
  getAuditLogs: jest.fn().mockReturnValue([{ id: 'PRIVATE_MIRROR' }]), createFollower: jest.fn(), updateFollower: jest.fn(), toggleFollowerStatus: jest.fn(), deleteFollower: jest.fn(),
} }));
jest.mock('../src/utils/llmRouter', () => ({ getLlmHealth: jest.fn().mockReturnValue({ fast: 'fixture', smart: 'fixture' }) }));
jest.mock('../src/services/polymarketRuntime', () => ({ getPolymarketRuntimeStatus: jest.fn().mockReturnValue({}) }));
jest.mock('../src/services/researchServices', () => ({ getResearchServicesStatus: jest.fn(), isResearchService: jest.fn(), ResearchServiceError: class extends Error {}, runResearchService: jest.fn() }));
jest.mock('../src/agents/debateEngine', () => ({ getLlmSpendToday: jest.fn().mockReturnValue({ usd: 0, budget: 0 }) }));
jest.mock('../src/services/universeService', () => ({ universe: { status: jest.fn().mockReturnValue({ source: 'fixture' }) } }));
jest.mock('../src/trading/intradayEngine', () => ({ getIntradayStatus: jest.fn().mockResolvedValue({ marker: 'PRIVATE_INTRADAY' }), runIntradayScan: jest.fn() }));
jest.mock('../src/services/brokerSync', () => ({ getLastBrokerSync: jest.fn().mockReturnValue({ imported: ['PRIVATE_BROKER'] }), syncBrokerPositions: jest.fn() }));
jest.mock('../src/services/polymarketUS', () => ({ getPolymarketUSHealth: jest.fn().mockReturnValue({ connected: false }), isPolymarketUSConfigured: jest.fn().mockReturnValue(false), getPolymarketUSAccount: jest.fn(), listPolymarketUSEvents: jest.fn().mockResolvedValue([{ title: 'MARKET_EVENT' }]) }));
jest.mock('../src/services/polymarketEdge', () => ({ computeScorecard: jest.fn().mockResolvedValue({ marker: 'PRIVATE_SCORECARD' }) }));
jest.mock('../src/services/securityMaster', () => ({ securityMaster: { getEligibleUniverse: jest.fn().mockReturnValue([]), getAsset: jest.fn(), getAllAssets: jest.fn().mockReturnValue({ assets: [], total: 0 }) } }));

import express, { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/utils/prisma';
// Import the same re-export entrypoints used by the real application mounts.
import trades from '../src/routes/trades';
import portfolio from '../src/routes/portfolio';
import agents from '../src/routes/agents';
import market from '../src/routes/market';
import journal from '../src/routes/journal';
import settings from '../src/routes/settings';
import killSwitch from '../src/routes/killSwitch';
import monitor from '../src/routes/agentMonitor';
import intelligence from '../src/routes/intelligence';
import copyTrading from '../src/routes/copyTrading';
import system from '../src/routes/system';
import { greedRouter } from '../src/routes/index';

const mounts: Array<[string, Router]> = [
  ['/api/trades', trades], ['/api/portfolio', portfolio], ['/api/agents', agents], ['/api/market', market],
  ['/api/journal', journal], ['/api/settings', settings], ['/api/kill-switch', killSwitch], ['/api/monitor', monitor],
  ['/api/intelligence', intelligence], ['/api/copy-trading', copyTrading], ['/api/system', system], ['/api/polymarket/greed', greedRouter],
];
const routes = express.Router();
mounts.forEach(([prefix, router]) => routes.use(prefix, router));

type Endpoint = [string, string];
const privateReads: Endpoint[] = [
  ...['', '/lifecycle', '/lifecycle/fixture', '/stats?market=stocks'].map(path => ['GET', `/api/trades${path}`] as Endpoint),
  ...['', '/breakdown', '/db-health', '/snapshots?days=1', '/positions', '/live-accounts', '/position-research', '/position-research/fixture'].map(path => ['GET', `/api/portfolio${path}`] as Endpoint),
  ['GET', '/api/journal'], ['GET', '/api/journal/2026-01-01'], ['GET', '/api/settings'],
  ['GET', '/api/agents/decisions?page=2'], ['GET', '/api/agents/decisions/fixture'],
  ['GET', '/api/agents/sessions'],
  ...['/activities?recent=10', '/activities/summary', '/learning', '/recent-decisions', '/status'].map(path => ['GET', `/api/monitor${path}`] as Endpoint),
  ...['/stocks-universe', '/stock/AAPL', '/polymarket/scorecard', '/polymarket/edge/predictions', '/predictions'].map(path => ['GET', `/api/market${path}`] as Endpoint),
  ['POST', '/api/market/predictions/scan'],
  ...['/activity/feed', '/activity/agent/1', '/activity/agent/1/summary', '/activity/agent/1/export?format=csv', '/dashboard'].map(path => ['GET', `/api/intelligence${path}`] as Endpoint),
  ['GET', '/api/copy-trading/followers'], ['GET', '/api/copy-trading/audit-log'], ['GET', '/api/system/status'],
  // Existing private paths remain protected as the surrounding routers change.
  ['GET', '/api/market/polymarket-us/account'], ['GET', '/api/market/predictions/simulations'],
];
const ownerMutations: Endpoint[] = [
  ['POST', '/api/market/ai-deep-dive'],
  ['POST', '/api/agents/trigger-debate'], ['POST', '/api/journal/generate'],
  ['POST', '/api/intelligence/learning/log-activity'], ['POST', '/api/copy-trading/followers'],
  ['PATCH', '/api/copy-trading/followers/fixture'], ['POST', '/api/copy-trading/followers/fixture/toggle'],
  ['DELETE', '/api/copy-trading/followers/fixture'], ['POST', '/api/kill-switch/activate'],
  ['POST', '/api/trades/fixture/close'], ['POST', '/api/settings/connect-alpaca'],
  ['POST', '/api/settings/connect-polymarket'], ['POST', '/api/settings/disconnect'],
];

// Prewarm every mock at module scope; cold compilation/initialization is outside
// individual five-second tests, and cannot lazily import a real financial module.
const businessModules = [
  '../src/services/teamSessions',
  '../src/services/portfolio', '../src/services/portfolioAccounting', '../src/services/positionResearch', '../src/services/groundedDeepDive', '../src/agents/orchestrator',
  '../src/trading/riskManager', '../src/trading/killLiquidation', '../src/jobs/scheduler', '../src/services/journalGenerator',
  '../src/services/marketData', '../src/services/accountManager', '../src/trading/brokerRouter', '../src/trading/accountScope', '../src/services/sentimentService',
  '../src/services/agentActivityMonitor', '../src/services/geopoliticalDataService', '../src/services/agentActivityLogger',
  '../src/services/agentResourceLearning', '../src/services/geopoliticalIntelligence', '../src/services/intermarketService', '../src/services/fredService',
  '../src/services/copyTradingEngine', '../src/utils/llmRouter', '../src/services/polymarketRuntime', '../src/services/researchServices',
  '../src/agents/debateEngine', '../src/services/universeService', '../src/trading/intradayEngine', '../src/services/brokerSync',
  '../src/services/polymarketUS', '../src/services/polymarketEdge', '../src/services/securityMaster',
].map(path => jest.requireMock(path));
function mocks(value: any): jest.Mock[] {
  if (jest.isMockFunction(value)) return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(mocks) : [];
}
const dbWork = Object.entries(prisma).filter(([name]) => name !== 'user' && name !== 'revokedToken').flatMap(([, value]) => mocks(value));
const protectedWork = [...dbWork, ...businessModules.flatMap(mocks), ...mocks(jest.requireMock('../src/utils/redis')),
  ...mocks(jest.requireMock('axios')), jest.requireMock('../src/utils/prisma').checkDatabaseHealth, jest.requireMock('../src/utils/config').readRiskSettings];
let ownerRole = 'OWNER';
beforeEach(() => {
  jest.clearAllMocks(); ownerRole = 'OWNER';
  (jwt.verify as jest.Mock).mockImplementation((token: string) => {
    if (token === 'invalid' || token === 'expired') throw new Error('fixture invalid or expired');
    return { userId: token, role: token === 'owner' ? 'MEMBER' : 'OWNER', exp: Math.floor(Date.now() / 1000) + 7200 };
  });
  (prisma.revokedToken.findUnique as jest.Mock).mockImplementation(({ where }) => Promise.resolve(where.token === 'revoked' ? { token: 'revoked' } : null));
  (prisma.user.findUnique as jest.Mock).mockImplementation(({ where }) => Promise.resolve(where.id === 'deleted' ? null : {
    id: where.id, email: where.id === 'configured' ? 'configured@example.test' : `${where.id}@example.test`,
    role: where.id === 'owner' ? ownerRole : 'MEMBER',
  }));
});

// Use Express' actual path/method/parameter matching and registered middleware.
// No HTTP server or socket is created; responses are captured in memory.
function request([method, url]: Endpoint, token?: string) {
  return new Promise<any>((resolve, reject) => {
    const req: any = { method, url, originalUrl: url, headers: token ? { authorization: `Bearer ${token}` } : {},
      query: Object.fromEntries(new URL(url, 'http://fixture.invalid').searchParams), body: {}, params: {} };
    const headers: Record<string, unknown> = {};
    const res: any = { statusCode: 200, headers };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.setHeader = (name: string, value: unknown) => { headers[name.toLowerCase()] = value; return res; };
    res.json = res.send = (payload: unknown) => { res.payload = payload; resolve(res); return res; };
    (routes as any).handle(req, res, (error: unknown) => error ? reject(error) : resolve({ ...res, statusCode: 404 }));
  });
}

test('owner system status reports the actual uninitialized scheduler, never a hardcoded online label', async () => {
  const runtime = require('../src/jobs/schedulerRuntime').schedulerRuntime;
  const snapshot = jest.spyOn(runtime, 'snapshot');
  const denied = await request(['GET', '/api/system/status'], 'member');
  expect(denied.statusCode).toBe(403);
  expect(snapshot).not.toHaveBeenCalled();
  const response = await request(['GET', '/api/system/status'], 'owner');
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toContain('no-store');
  expect(response.payload).toMatchObject({ scheduler: 'offline', schedulerRuntime: {
    lifecycle: 'not_started', evidenceScope: 'CURRENT_PROCESS', observer: { status: 'not_observed' }, jobs: [],
  } });
  expect(snapshot).toHaveBeenCalledTimes(1);
  snapshot.mockRestore();
});

describe.each([undefined, 'invalid', 'expired', 'revoked', 'deleted', 'member', 'demoted'])('private boundary for %s', token => {
  test.each([...privateReads, ...ownerMutations])('%s %s denies before protected work', async (method, url) => {
    const response = await request([method, url], token);
    expect(response.statusCode).toBe(token === 'member' || token === 'demoted' ? 403 : 401);
    expect(JSON.stringify(response.payload)).not.toContain('PRIVATE_');
    protectedWork.forEach(work => expect(work).not.toHaveBeenCalled());
  });
});

const ownerPayloads: Array<[Endpoint, string]> = [
  [['GET', '/api/agents/sessions'], 'PRIVATE_SESSION'],
  [['GET', '/api/portfolio'], 'PRIVATE_ACCOUNT'], [['GET', '/api/portfolio/positions'], 'PRIVATE_POSITION'],
  [['GET', '/api/settings'], 'PRIVATE_ACCOUNT'], [['GET', '/api/monitor/activities'], 'PRIVATE_ACTIVITY'],
  [['GET', '/api/monitor/learning'], 'PRIVATE_LEARNING'], [['GET', '/api/market/polymarket/scorecard'], 'PRIVATE_SCORECARD'],
  [['GET', '/api/intelligence/activity/agent/1'], 'PRIVATE_TRACE'],
  [['GET', '/api/intelligence/activity/agent/1/export?format=csv'], 'PRIVATE_EXPORT'],
  [['GET', '/api/intelligence/activity/agent/1/export?format=json'], 'PRIVATE_EXPORT'],
  [['GET', '/api/copy-trading/followers'], 'PRIVATE_FOLLOWER'], [['GET', '/api/copy-trading/audit-log'], 'PRIVATE_MIRROR'],
  [['GET', '/api/system/status'], 'PRIVATE_BROKER'],
];
test.each(ownerPayloads)('current DB owner receives %j with no-store', async (endpoint, marker) => {
  const response = await request(endpoint, 'owner'); // JWT deliberately claims MEMBER.
  expect(response.statusCode).toBe(200); expect(JSON.stringify(response.payload)).toContain(marker);
  expect(response.headers['cache-control']).toBe('no-store');
});
test('current owner demotion and deletion revoke reads despite an earlier successful request', async () => {
  expect((await request(['GET', '/api/portfolio'], 'owner')).statusCode).toBe(200);
  ownerRole = 'MEMBER';
  protectedWork.forEach(work => work.mockClear());
  expect((await request(['GET', '/api/portfolio'], 'owner')).statusCode).toBe(403);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
  expect((await request(['GET', '/api/portfolio'], 'owner')).statusCode).toBe(401);
  protectedWork.forEach(work => expect(work).not.toHaveBeenCalled());
});
test('configured current owner email retains the existing owner policy', async () => {
  const response = await request(['GET', '/api/portfolio'], 'configured');
  expect(response.statusCode).toBe(200); expect(JSON.stringify(response.payload)).toContain('PRIVATE_ACCOUNT');
});
test('database authentication outage never reaches a private handler', async () => {
  (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('fixture offline'));
  expect((await request(['GET', '/api/portfolio'], 'owner')).statusCode).toBe(503);
  protectedWork.forEach(work => expect(work).not.toHaveBeenCalled());
});
test.each(privateReads)('private %s %s accepts current owner without rewriting the payload', async (method, url) => {
  // Some valid owner lookups intentionally return fixture 404; authorization
  // still runs before the handler and never substitutes a fake success body.
  const response = await request([method, url], 'owner');
  expect([200, 404]).toContain(response.statusCode);
  expect(response.headers['cache-control']).toBe('no-store');
});

const marketReads: Endpoint[] = [
  ['GET', '/api/market/prices'], ['GET', '/api/market/all-stocks'], ['GET', '/api/market/stock/AAPL/candles'],
  ['GET', '/api/market/polymarket-us/events'], ['GET', '/api/market/regimes?assets=AAPL'],
  ...['/news', '/news/high-impact', '/geopolitics', '/sentiment', '/context'].map(path => ['GET', `/api/monitor${path}`] as Endpoint),
  ...['/risk/assessment', '/risk/events', '/risk/macro', '/learning/AAPL'].map(path => ['GET', `/api/intelligence${path}`] as Endpoint),
  ['GET', '/api/copy-trading/strategies'], ['GET', '/api/polymarket/greed/status'],
];
test.each(marketReads)('member retains market-only %s %s', async (method, url) => {
  const response = await request([method, url], 'member');
  expect(response.statusCode).toBe(200); expect(JSON.stringify(response.payload)).not.toContain('PRIVATE_');
  expect((await request([method, url])).statusCode).toBe(401);
});
