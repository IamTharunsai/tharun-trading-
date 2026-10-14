// Execute only in the isolated test sandbox; all former account dependencies are mocked.
const mockCalls = {
  portfolio: jest.fn().mockResolvedValue({ totalValue: 100 }),
  trades: jest.fn().mockResolvedValue([]),
  create: jest.fn(), close: jest.fn(),
  wallet: jest.fn(() => false), events: jest.fn(async () => []),
  post: jest.fn(), get: jest.fn(), emit: jest.fn(),
};
jest.mock('axios', () => ({ post: (...args: any[]) => mockCalls.post(...args), get: (...args: any[]) => mockCalls.get(...args) }));
jest.mock('../src/utils/prisma', () => ({ prisma: {
  portfolioSnapshot: { findFirst: (...args: any[]) => mockCalls.portfolio(...args) },
  trade: { findMany: (...args: any[]) => mockCalls.trades(...args), create: mockCalls.create, updateMany: mockCalls.close },
} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: mockCalls.emit }) }));
jest.mock('../src/services/polymarket', () => ({ initPolymarketWallet: mockCalls.wallet, fetchActiveEvents: mockCalls.events }));
jest.mock('../src/trading/liveGate', () => ({ polymarketLiveAllowed: () => ({ allowed: true }) }));
import { activateGreedAgent, deactivateGreedAgent, getGreedAgentSnapshot, getComplianceAuditLog } from '../src/services/polymarketMoneyGreed';

const fixtureEnv: Record<string, string> = {
  TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK',
  POLYMARKET_US_LIVE: 'true', POLYMARKET_API_KEY_ID: 'fixture-only-key',
  POLYMARKET_API_SECRET: 'fixture-only-secret',
};
const savedVariables = Object.fromEntries(Object.keys(fixtureEnv).map(name => [name, process.env[name]]));
const originalFetch = global.fetch;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  Object.assign(process.env, fixtureEnv);
  global.fetch = jest.fn();
});
afterEach(() => {
  jest.clearAllTimers(); jest.useRealTimers(); global.fetch = originalFetch;
  for (const name of Object.keys(fixtureEnv)) {
    if (savedVariables[name] === undefined) delete process.env[name];
    else process.env[name] = savedVariables[name];
  }
});

describe('retired Greed execution boundary', () => {
  test.each([false, true])('refuses activation with a permitted live gate and greedMode=%s', async greedMode => {
    const result = await activateGreedAgent(greedMode);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/retired.*not connected/i);
    expect(result.state).toMatchObject({ active: false, executionAvailable: false, executionMode: 'retired' });
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(120000);
    for (const operation of Object.values(mockCalls)) expect(operation).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('stop and status never read or mutate financial rows or contact a broker', async () => {
    expect(await deactivateGreedAgent()).toMatchObject({ ok: true, state: { active: false, executionAvailable: false } });
    const snapshot = getGreedAgentSnapshot();
    expect(snapshot).toMatchObject({ active: false, metricsAvailable: false });
    expect(Object.values(snapshot).some(value => typeof value === 'number')).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    for (const operation of Object.values(mockCalls)) expect(operation).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('unavailable audit evidence never implies zero historical trades', () => {
    const audit = getComplianceAuditLog();
    expect(audit).toMatchObject({ available: false, executionAvailable: false });
    expect(Object.values(audit).some(value => typeof value === 'number')).toBe(false);
    expect(audit).not.toHaveProperty('recentTrades');
  });
});
