const request = jest.fn();
let claim: any, generation: number, qualification: any, risk: any;
const db: any = {
  predictionExecution: { findUnique: jest.fn(async () => claim), findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (claim.status !== where.status) return { count: 0 }; Object.assign(claim, data); return { count: 1 };
    }) },
  predictionAccountAuthority: { findUnique: jest.fn(async () => ({ generation })), upsert: jest.fn(async () => ({ generation })), update: jest.fn(async () => ({ generation: ++generation })) },
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
import { submitPolymarketUSExecution, getPolymarketUSCredentialScope } from '../src/services/polymarketUS';
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
