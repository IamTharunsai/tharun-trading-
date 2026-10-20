const request = jest.fn();
let claim: any, generation: number, qualification: any, risk: any, recoveryState: any;
const db: any = {
  predictionReduction: { findFirst: jest.fn(async () => null) },
  predictionHolding: { findUnique: jest.fn(async () => null) },
  predictionExecution: { findUnique: jest.fn(async () => claim), findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.status && claim.status !== where.status) return { count: 0 };
      if ('cancelAttemptedAt' in where && claim.cancelAttemptedAt !== where.cancelAttemptedAt) return { count: 0 };
      Object.assign(claim, data); return { count: 1 };
    }) },
  predictionAccountAuthority: { findUnique: jest.fn(async () => ({ generation })), upsert: jest.fn(async () => ({ generation })), update: jest.fn(async () => ({ generation: ++generation })) },
  predictionRecoveryState: { findUnique: jest.fn(async () => recoveryState), create: jest.fn(async ({ data }: any) => recoveryState = { ...data }) },
  trade: { findMany: jest.fn(async () => []) },
  strategyQualification: { findFirst: jest.fn(async () => qualification) },
  user: { findUnique: jest.fn(async () => ({ role: 'OWNER', email: 'owner@fixture.invalid' })) },
  settings: { findUnique: jest.fn(async () => risk) },
  $executeRaw: jest.fn(), $transaction: jest.fn(async (fn: any) => fn(db)),
};
jest.mock('../src/utils/prisma', () => ({ prisma: db }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false }));
jest.mock('polymarket-us', () => ({ PolymarketUS: jest.fn() }), { virtual: true });
jest.mock('../src/services/polymarketUSRest', () => ({ bindPolymarketUSRest: () => request }));
import { submitPolymarketUSExecution, getPolymarketUSCredentialScope, getPolymarketUSTradeActivities, cancelPolymarketUSOrder } from '../src/services/polymarketUS';
import { createHash } from 'crypto';
const hashRisk = (r: any) => createHash('sha256').update(JSON.stringify([
  r.maxPositionSizePct, r.maxRiskPerTradePct, r.dailyLossLimitPct,
])).digest('hex');
const saved = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks(); process.env = { ...saved, TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK',
    POLYMARKET_US_LIVE: 'true', POLYMARKET_KEY_ID: '00000000-0000-4000-8000-000000000001',
    POLYMARKET_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'), OWNER_EMAIL: 'owner@fixture.invalid', RELEASE_COMMIT_SHA: 'a'.repeat(40) };
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  const scope = getPolymarketUSCredentialScope(); generation = 1;
  recoveryState = null;
  risk = { maxPositionSizePct: 5, maxRiskPerTradePct: 5, dailyLossLimitPct: 3 };
  qualification = { id: 'q1', strategyKey: 'BHISHMA_POLYMARKET_US', revision: 'a'.repeat(40),
    dataHash: 'b'.repeat(64), reportHash: 'c'.repeat(64), trialCount: 20, noLeakage: true, dsrProbability: .99,
    walkForwardPassed: true, costsValidated: true, executionValidated: true, ledgerReconciled: true,
    healthPassed: true, expiresAt: new Date(Date.now() + 60000), evidence: { credentialScopeKey: scope.scopeKey } };
  claim = { id: 'claim', status: 'PREPARING', ownerId: 'owner', credentialScopeKey: scope.scopeKey,
    credentialIdentity: scope.identity, marketSlug: 'fixture-market', side: 'YES', quantity: 2, sideLimitPrice: .5,
    reservedUsd: 1.04, authorityGeneration: 1, planExpiresAt: new Date(Date.now() + 5000),
    riskPolicyHash: hashRisk(risk), qualificationId: qualification.id, planNetEdge: .2 };
  request.mockImplementation(async (method, path) => {
    if (method === 'POST') return { id: 'broker-order' };
    if (path === '/v1/account/balances') return { balances: [{ currency: 'USD', currentBalance: 100, buyingPower: 100 }] };
    if (path === '/v1/orders/open') return { orders: [] };
    if (path === '/v1/portfolio/positions') return { positions: {}, eof: true };
    throw new Error('Unexpected fixture request');
  });
});
afterEach(() => { jest.restoreAllMocks(); process.env = { ...saved }; });
test('a claim can issue one POST, then cannot be replayed', async () => {
  expect(await submitPolymarketUSExecution('claim')).toMatchObject({ id: 'broker-order' });
  await expect(submitPolymarketUSExecution('claim')).rejects.toThrow();
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(1);
});
test.each(['qualification', 'plan'])('%s expiry during broker reads prevents POST', async kind => {
  const now = Date.now(); const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  qualification.expiresAt = new Date(now + 2000); claim.planExpiresAt = new Date(now + (kind === 'plan' ? 2000 : 60000));
  if (kind === 'plan') qualification.expiresAt = new Date(now + 60000);
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (...args: any[]) => { const result = await original(...args); if (args[1] === '/v1/account/balances') clock.mockReturnValue(now + 3000); return result; });
  await expect(submitPolymarketUSExecution('claim')).rejects.toThrow();
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(0);
});
test('a tightened risk policy after planning prevents POST', async () => {
  risk.dailyLossLimitPct = .1;
  await expect(submitPolymarketUSExecution('claim')).rejects.toThrow();
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(0);
});
test('a changed account generation prevents POST', async () => {
  generation++;
  await expect(submitPolymarketUSExecution('claim')).rejects.toThrow();
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(0);
});
test('unresolved broker orders prevent POST', async () => {
  request.mockResolvedValueOnce({ balances: [{ currency: 'USD', currentBalance: 10, buyingPower: 10 }] })
    .mockResolvedValueOnce({ orders: [{ id: 'unresolved' }] });
  await expect(submitPolymarketUSExecution('claim')).rejects.toThrow();
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(0);
});

test('a rotated grant is refused by the last writer without resetting the stored owner binding', async () => {
  recoveryState = { ownerId: 'owner', boundCredentialScopeKey: 'older-grant' };
  await expect(submitPolymarketUSExecution('claim')).rejects.toThrow();
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(0);
  expect(recoveryState.boundCredentialScopeKey).toBe('older-grant');
});

const tradeActivity = (id: string) => ({ type: 'ACTIVITY_TYPE_TRADE', trade: { id, marketSlug: 'fixture-market', state: 'TRADE_STATE_NEW',
  qtyDecimal: '0.25', price: { value: '0.5', currency: 'USD' } } });
test('activity traversal follows cursors and requires explicit complete pagination without inferring historical coverage', async () => {
  request.mockResolvedValueOnce({ activities: [tradeActivity('t1')], nextCursor: 'next', eof: false })
    .mockResolvedValueOnce({ activities: [tradeActivity('t2')], eof: true });
  const result = await getPolymarketUSTradeActivities(getPolymarketUSCredentialScope().scopeKey);
  expect(result.map(row => row.id)).toEqual(['t1', 't2']);
  expect(request).toHaveBeenNthCalledWith(2, 'GET', '/v1/portfolio/activities', undefined, expect.objectContaining({ cursor: 'next' }));
  expect(request.mock.calls.some(call => call[0] === 'POST')).toBe(false);
});
test.each([
  [{ activities: [], eof: false }],
  [{ activities: [] }],
  [{ activities: [], nextCursor: 'same' }, { activities: [], nextCursor: 'same' }],
])('incomplete or repeating activity pagination remains unknown', async (...pages: any[]) => {
  for (const page of pages) request.mockResolvedValueOnce(page);
  await expect(getPolymarketUSTradeActivities(getPolymarketUSCredentialScope().scopeKey)).rejects.toThrow();
});

test('a matching owned claim can cancel once in paper mode with expired entry qualification', async () => {
  process.env.TRADING_MODE = 'paper'; process.env.POLYMARKET_US_LIVE = 'false';
  qualification.expiresAt = new Date(0);
  Object.assign(claim, { brokerOrderId: 'broker-order', status: 'PARTIALLY_FILLED', cancelAttemptedAt: null });
  const observation = { order: { id: 'broker-order', marketSlug: claim.marketSlug, intent: 'ORDER_INTENT_BUY_LONG', type: 'ORDER_TYPE_LIMIT',
    quantity: 2, cumQuantity: .25, leavesQuantity: 1.75, state: 'ORDER_STATE_PARTIALLY_FILLED',
    price: { value: '0.5', currency: 'USD' }, avgPx: { value: '0.5', currency: 'USD' } } };
  request.mockImplementation(async (method, path) => {
    if (method === 'GET' && path === '/v1/order/broker-order') return observation;
    if (method === 'POST' && path === '/v1/order/broker-order/cancel') return {};
    throw new Error('Unexpected financial request');
  });
  expect(await cancelPolymarketUSOrder('broker-order', claim.marketSlug, claim.id)).toBe('CANCEL_ACKNOWLEDGED');
  expect(await cancelPolymarketUSOrder('broker-order', claim.marketSlug, claim.id)).toBe('ALREADY_ATTEMPTED');
  expect(request.mock.calls.filter(call => call[0] === 'POST')).toHaveLength(1);
  expect(claim.status).toBe('PARTIALLY_FILLED'); // Empty cancel response is not zero fills or a terminal state.
});

test('unbound or wrong-market cancellation cannot call a provider', async () => {
  await expect(cancelPolymarketUSOrder('broker-order', claim.marketSlug)).rejects.toThrow('disabled');
  await expect(cancelPolymarketUSOrder('broker-order', 'other-market', claim.id)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
