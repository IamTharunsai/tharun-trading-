// Providers and database are in-memory fixtures. No broker request is made.
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
  polymarketPrediction: { findUnique: jest.fn(async ({ where }: any) => prediction(where.id)) },
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
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false }));
jest.mock('../src/services/polymarketUS', () => ({
  PredictionSubmissionRefused: class extends Error {},
  POLYMARKET_LIVE_STRATEGY: 'BHISHMA_POLYMARKET_US', getPolymarketUSCredentialScope: () => scope,
  getPolymarketUSExecutionSnapshot: (...args: any[]) => getSnapshot(...args),
  getPolymarketUSOrder: (...args: any[]) => getOrder(...args), submitPolymarketUSExecution: (...args: any[]) => submit(...args),
  polymarketUSVenue: { listMarkets: async () => [market('A'), market('B')], getBook: async () => ({
    bids: [{ price: .49, size: 100 }], asks: [{ price: .5, size: 100 }], state: 'MARKET_STATE_OPEN', fetchedAt: Date.now() }) },
}));
import { executeLivePrediction, reconcilePredictionExecution } from '../src/trading/predictionExecution';
import { PredictionSubmissionRefused } from '../src/services/polymarketUS';
beforeEach(() => {
  jest.clearAllMocks(); records.length = 0; generation = 0; lock = Promise.resolve();
  recoveryState = null;
  Object.assign(process.env, { OWNER_EMAIL: 'owner@fixture.invalid', RELEASE_COMMIT_SHA: 'a'.repeat(40), TRADING_MODE: 'live',
    LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK', POLYMARKET_US_LIVE: 'true', POLYMARKET_US_MAX_ORDER_USD: '5' });
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  db.trade.findUnique.mockResolvedValue({ status: 'OPEN', accountId: scope.scopeKey });
  getSnapshot.mockImplementation(async () => snapshot());
  submit.mockImplementation(async (id: string) => ({ id: 'broker-' + id }));
  getOrder.mockImplementation(async (id: string) => {
    const r = records.find(r => r.brokerOrderId === id);
    return { order: { id, marketSlug: r.marketSlug, intent: 'ORDER_INTENT_BUY_LONG', type: 'ORDER_TYPE_LIMIT',
      price: { value: '.5'.replace(/^\./, '0.'), currency: 'USD' }, quantity: r.quantity, cumQuantity: r.quantity,
      leavesQuantity: 0, state: 'ORDER_STATE_FILLED', avgPx: { value: '0.5', currency: 'USD' },
      commissionNotionalTotalCollected: { value: String(r.quantity * .017375), currency: 'USD' } } };
  });
});
test('a completed fill invalidates another market snapshot collected before the fill', async () => {
  let finishB!: (value: any) => void; let startedB!: () => void;
  const bStarted = new Promise<void>(r => { startedB = r; });
  getSnapshot.mockImplementationOnce(async () => snapshot()).mockImplementationOnce(() => {
    const old = snapshot(); startedB(); return new Promise(resolve => { finishB = () => resolve(old); });
  });
  const a = executeLivePrediction('A'); const b = executeLivePrediction('B');
  await bStarted;
  expect(await a).toMatchObject({ placed: true, status: 'FILLED' });
  finishB(null);
  expect(await b).toMatchObject({ placed: false });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(records).toHaveLength(1);
});
test('repeated cumulative fill evidence does not create or apply a second trade', async () => {
  const result = await executeLivePrediction('A');
  expect(result.placed).toBe(true);
  await reconcilePredictionExecution((result as any).id);
  expect(db.trade.create).toHaveBeenCalledTimes(1);
  expect(db.trade.update).not.toHaveBeenCalled();
});
test('uncertain submissions retain the claim and prevent a new market order', async () => {
  submit.mockRejectedValueOnce(new Error('fixture acknowledgement lost'));
  expect(await executeLivePrediction('A')).toMatchObject({ placed: false, reason: expect.stringContaining('uncertain') });
  expect(records[0].status).toBe('RECONCILIATION_REQUIRED');
  expect(await executeLivePrediction('B')).toMatchObject({ placed: false });
  expect(submit).toHaveBeenCalledTimes(1);
});
test('an additional positive fill cannot reduce cumulative purchase cost', async () => {
  const observation = (quantity: number, avg: string) => ({ order: {
    id: 'broker-claim-0', marketSlug: 'A', intent: 'ORDER_INTENT_BUY_LONG', type: 'ORDER_TYPE_LIMIT',
    price: { value: '0.5', currency: 'USD' }, quantity: 5, cumQuantity: quantity, leavesQuantity: 5 - quantity,
    state: 'ORDER_STATE_PARTIALLY_FILLED', avgPx: { value: avg, currency: 'USD' },
    commissionNotionalTotalCollected: { value: '0.04', currency: 'USD' },
  } });
  getOrder.mockResolvedValueOnce(observation(2, '0.49'));
  const result = await executeLivePrediction('A');
  expect(result).toMatchObject({ placed: true, status: 'PARTIALLY_FILLED' });
  getOrder.mockResolvedValueOnce(observation(3, '0.01'));
  expect(await reconcilePredictionExecution((result as any).id)).toMatchObject({ reconciled: false });
  expect(db.trade.update).not.toHaveBeenCalled();
  expect(records[0].appliedNotional).toBe(.98);
});
test('a valid later partial fill applies cumulative quantities once', async () => {
  const observation = (quantity: number, state: string) => ({ order: {
    id: 'broker-claim-0', marketSlug: 'A', intent: 'ORDER_INTENT_BUY_LONG', type: 'ORDER_TYPE_LIMIT',
    price: { value: '0.5', currency: 'USD' }, quantity: 5, cumQuantity: quantity, leavesQuantity: state === 'ORDER_STATE_CANCELED' ? 0 : 5 - quantity,
    state, avgPx: { value: '0.49', currency: 'USD' }, commissionNotionalTotalCollected: { value: String(quantity * .02), currency: 'USD' },
  } });
  getOrder.mockResolvedValueOnce(observation(2, 'ORDER_STATE_PARTIALLY_FILLED'));
  const result = await executeLivePrediction('A');
  getOrder.mockResolvedValueOnce(observation(3, 'ORDER_STATE_CANCELED'));
  expect(await reconcilePredictionExecution((result as any).id)).toMatchObject({ reconciled: true, status: 'TERMINAL_PARTIAL', filledQuantity: 3 });
  expect(db.trade.create).toHaveBeenCalledTimes(1);
  expect(db.trade.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: 3, entryPrice: .49, fees: .06 }) }));
  expect(records[0].reservedUsd).toBe(0);
});
test('a pre-POST refusal releases only an unconsumed claim', async () => {
  submit.mockRejectedValueOnce(new PredictionSubmissionRefused());
  expect(await executeLivePrediction('A')).toMatchObject({ placed: false, reason: 'Authorization refused before POST' });
  expect(records[0]).toMatchObject({ status: 'ABORTED', reservedUsd: 0 });
});
test('another writer consuming a claim prevents a refused invocation from releasing its funds', async () => {
  submit.mockImplementationOnce(async (id: string) => {
    records.find(r => r.id === id).status = 'SUBMITTING'; throw new PredictionSubmissionRefused();
  });
  expect(await executeLivePrediction('A')).toMatchObject({ placed: false, reason: expect.stringContaining('uncertain') });
  expect(records[0].status).toBe('RECONCILIATION_REQUIRED');
  expect(records[0].reservedUsd).toBeGreaterThan(0);
});
