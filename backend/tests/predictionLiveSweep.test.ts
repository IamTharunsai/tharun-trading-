// Scheduler wiring for the Polymarket live lane: runLivePredictionSweep must
// (1) do nothing at all in paper mode, (2) still refuse when the live env is
// set but NO strategy-qualification evidence exists — the fail-closed proof
// that wiring reachability did not fabricate or bypass qualification — and
// (3) actually place through the existing gated path when, and only when,
// real qualification evidence bound to the revision + credential scope is
// present. Fixture shape follows tests/predictionExecution.authority.test.ts;
// the qualification row below is a test fixture, never production evidence.
const scope = { scopeKey: 'fixture-grant', identity: 'fixture-identity' };
const records: any[] = [];
let generation = 0;
let recoveryState: any = null;
let lock = Promise.resolve();
const qualification = { id: 'q1', strategyKey: 'BHISHMA_POLYMARKET_US', revision: 'a'.repeat(40),
  dataHash: 'b'.repeat(64), reportHash: 'c'.repeat(64), trialCount: 20, noLeakage: true, dsrProbability: .99,
  walkForwardPassed: true, costsValidated: true, executionValidated: true, ledgerReconciled: true,
  healthPassed: true, expiresAt: new Date(Date.now() + 600000), evidence: { credentialScopeKey: scope.scopeKey } };
const snapshot = () => ({ ...scope, observedAt: Date.now(), cash: 100, buyingPower: 100, positions: {}, openOrders: [] });
const getSnapshot = jest.fn();
const submit = jest.fn();
const getOrder = jest.fn();
const risk = { maxPositionSizePct: 5, maxRiskPerTradePct: 5, dailyLossLimitPct: 3 };
const market = (id: string) => ({ venue: 'polymarket_us', id, question: id, category: 'general', open: true,
  executionMetadataVerified: true, feeCoefficient: .0695, tickSize: .001, minQty: 1 });
const prediction = (id: string) => ({ id, marketSlug: id, venue: 'polymarket_us', decision: 'YES', side: 'YES',
  fairProb: .8, llmProb: .8, evidenceWeight: 1, createdAt: new Date() });
const matches = (row: any, where: any) => Object.entries(where).every(([k, v]: any) =>
  v && typeof v === 'object' && 'in' in v ? v.in.includes(row[k]) : v && typeof v === 'object' && 'not' in v ? row[k] !== v.not : row[k] === v);
const db: any = {
  predictionReduction: { findFirst: jest.fn(async () => null) },
  predictionHolding: { findUnique: jest.fn(async () => null) },
  user: { findUnique: jest.fn(async () => ({ id: 'owner', role: 'OWNER', email: 'owner@fixture.invalid' })) },
  settings: { findUnique: jest.fn(async () => risk) },
  strategyQualification: { findFirst: jest.fn(async () => qualification) },
  polymarketPrediction: {
    findUnique: jest.fn(async ({ where }: any) => prediction(where.id)),
    findMany: jest.fn(async () => [prediction('A')]),
  },
  predictionAccountAuthority: {
    findUnique: jest.fn(async () => ({ generation })),
    upsert: jest.fn(async () => ({ generation })),
    update: jest.fn(async () => ({ generation: ++generation })),
  },
  predictionRecoveryState: {
    findUnique: jest.fn(async () => recoveryState),
    create: jest.fn(async ({ data }: any) => recoveryState = { ...data }),
  },
  predictionExecution: {
    findUnique: jest.fn(async ({ where }: any) => records.find(r => r.id === where.id) ?? null),
    findFirst: jest.fn(async ({ where }: any) => records.find(r => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: any) => records.filter(r => matches(r, where))),
    create: jest.fn(async ({ data }: any) => { const r = { id: 'claim-' + records.length, ...data, appliedQuantity: 0, appliedNotional: 0, appliedFees: 0 }; records.push(r); return r; }),
    update: jest.fn(async ({ where, data }: any) => Object.assign(records.find(r => r.id === where.id), data)),
    updateMany: jest.fn(async ({ where, data }: any) => { const rs = records.filter(r => matches(r, where)); rs.forEach(r => Object.assign(r, data)); return { count: rs.length }; }),
  },
  trade: { findMany: jest.fn(async () => []), create: jest.fn(async () => ({ id: 'trade-' + records.length })), findUnique: jest.fn(), update: jest.fn() },
  $executeRaw: jest.fn(async () => 1),
  $transaction: jest.fn(async (fn: any) => {
    const prior = lock; let release!: () => void; lock = new Promise<void>(r => { release = r; });
    await prior; try { return await fn(db); } finally { release(); }
  }),
};
jest.mock('../src/utils/prisma', () => ({ prisma: db }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false }));
jest.mock('../src/services/polymarketUS', () => ({
  PredictionSubmissionRefused: class extends Error {},
  POLYMARKET_LIVE_STRATEGY: 'BHISHMA_POLYMARKET_US', getPolymarketUSCredentialScope: () => scope,
  getPolymarketUSExecutionSnapshot: (...args: any[]) => getSnapshot(...args),
  getPolymarketUSOrder: (...args: any[]) => getOrder(...args), submitPolymarketUSExecution: (...args: any[]) => submit(...args),
  polymarketUSVenue: { listMarkets: async () => [market('A'), market('B')], getBook: async () => ({
    bids: [{ price: .49, size: 100 }], asks: [{ price: .5, size: 100 }], state: 'MARKET_STATE_OPEN', fetchedAt: Date.now() }) },
}));
import { runLivePredictionSweep } from '../src/trading/predictionExecution';

const LIVE_ENV = { OWNER_EMAIL: 'owner@fixture.invalid', RELEASE_COMMIT_SHA: 'a'.repeat(40), TRADING_MODE: 'live',
  LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK', POLYMARKET_US_LIVE: 'true', POLYMARKET_US_MAX_ORDER_USD: '5' };
const ENV_KEYS = Object.keys(LIVE_ENV);
let savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  jest.clearAllMocks(); records.length = 0; generation = 0; lock = Promise.resolve(); recoveryState = null;
  savedEnv = {}; for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  db.trade.findUnique.mockResolvedValue({ status: 'OPEN', accountId: scope.scopeKey });
  db.strategyQualification.findFirst.mockResolvedValue(qualification);
  db.polymarketPrediction.findMany.mockResolvedValue([prediction('A')]);
  getSnapshot.mockImplementation(async () => snapshot());
  submit.mockImplementation(async (id: string) => ({ id: 'broker-' + id }));
  getOrder.mockImplementation(async (id: string) => {
    const r = records.find(r => r.brokerOrderId === id);
    return { order: { id, marketSlug: r.marketSlug, intent: 'ORDER_INTENT_BUY_LONG', type: 'ORDER_TYPE_LIMIT',
      price: { value: '0.5', currency: 'USD' }, quantity: r.quantity, cumQuantity: r.quantity,
      leavesQuantity: 0, state: 'ORDER_STATE_FILLED', avgPx: { value: '0.5', currency: 'USD' },
      commissionNotionalTotalCollected: { value: String(r.quantity * .017375), currency: 'USD' } } };
  });
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

test('paper mode: the sweep is a pure no-op — no candidate query, no claim, no submission', async () => {
  for (const k of ENV_KEYS) delete process.env[k]; // nothing live configured at all
  const result = await runLivePredictionSweep();
  expect(result.attempted).toBe(0);
  expect(result.placed).toBe(0);
  expect(result.reason).toMatch(/TRADING_MODE|live/i);
  expect(db.polymarketPrediction.findMany).not.toHaveBeenCalled();
  expect(db.predictionExecution.create).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

test('live env set but qualification evidence ABSENT: sweep still refuses (fail-closed)', async () => {
  Object.assign(process.env, LIVE_ENV);
  db.strategyQualification.findFirst.mockResolvedValue(null); // no DSR / walk-forward evidence exists
  const result = await runLivePredictionSweep();
  expect(result).toMatchObject({ attempted: 0, placed: 0 });
  expect(result.reason).toContain('LIVE_UNQUALIFIED');
  expect(db.polymarketPrediction.findMany).not.toHaveBeenCalled(); // refused before candidate selection
  expect(db.predictionExecution.create).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

test('live env + qualification bound to another credential scope: sweep still refuses', async () => {
  Object.assign(process.env, LIVE_ENV);
  db.strategyQualification.findFirst.mockResolvedValue({ ...qualification, evidence: { credentialScopeKey: 'some-other-grant' } });
  const result = await runLivePredictionSweep();
  expect(result).toMatchObject({ attempted: 0, placed: 0 });
  expect(result.reason).toMatch(/not bound to this API grant/);
  expect(submit).not.toHaveBeenCalled();
});

test('live env + valid bound qualification: the previously dead path is reachable and places', async () => {
  Object.assign(process.env, LIVE_ENV);
  const result = await runLivePredictionSweep();
  expect(result).toMatchObject({ attempted: 1, placed: 1 });
  expect(db.predictionExecution.create).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(records[0]).toMatchObject({ marketSlug: 'A', qualificationId: 'q1' });
});
