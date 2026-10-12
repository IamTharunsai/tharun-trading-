// Disposable CI PostgreSQL only. Providers remain mocked; no financial requests.
const scope = { scopeKey: 'fixture-prediction-grant', identity: 'fixture-identity' };
const getSnapshot = jest.fn(); const submit = jest.fn(); const getOrder = jest.fn();
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('../src/services/polymarketUS', () => ({
  PredictionSubmissionRefused: class extends Error {}, POLYMARKET_LIVE_STRATEGY: 'BHISHMA_POLYMARKET_US',
  getPolymarketUSCredentialScope: () => scope, getPolymarketUSExecutionSnapshot: () => getSnapshot(),
  submitPolymarketUSExecution: (id: string) => submit(id), getPolymarketUSOrder: (id: string) => getOrder(id),
  polymarketUSVenue: { listMarkets: async () => ['A', 'B'].map(id => ({ venue: 'polymarket_us', id,
    question: id, category: 'general', open: true, executionMetadataVerified: true, feeCoefficient: .0695, tickSize: .001, minQty: 1 })),
    getBook: async () => ({ bids: [{ price: .49, size: 100 }], asks: [{ price: .5, size: 100 }], state: 'MARKET_STATE_OPEN', fetchedAt: Date.now() }) },
}));
import { prisma } from '../src/utils/prisma';
import { executeLivePrediction } from '../src/trading/predictionExecution';
const enabled = process.env.RUN_PREDICTION_POSTGRES_TESTS === 'true';
const suite = enabled ? describe : describe.skip;
suite('prediction execution with real PostgreSQL locks and unique claims', () => {
  const saved = { ...process.env };
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== 'postgresql://postgres:postgres@localhost:5432/deployment_fixture') throw new Error('Only the disposable CI database is allowed');
    Object.assign(process.env, { OWNER_EMAIL: 'prediction-fixture@fixture.invalid', RELEASE_COMMIT_SHA: 'a'.repeat(40),
      TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK', POLYMARKET_US_LIVE: 'true', POLYMARKET_US_MAX_ORDER_USD: '5' });
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    await prisma.user.create({ data: { id: 'prediction-fixture-owner', email: process.env.OWNER_EMAIL!, passwordHash: 'dummy-not-used', role: 'OWNER' } });
    await prisma.settings.upsert({ where: { id: 'settings-1' }, create: { id: 'settings-1', maxPositionSizePct: 5, maxRiskPerTradePct: 5, dailyLossLimitPct: 3 },
      update: { maxPositionSizePct: 5, maxRiskPerTradePct: 5, dailyLossLimitPct: 3 } });
    await prisma.strategyQualification.create({ data: { strategyKey: 'BHISHMA_POLYMARKET_US', revision: 'a'.repeat(40),
      dataHash: 'b'.repeat(64), reportHash: 'c'.repeat(64), trialCount: 20, noLeakage: true, dsrProbability: .99,
      walkForwardPassed: true, costsValidated: true, executionValidated: true, ledgerReconciled: true, healthPassed: true,
      expiresAt: new Date(Date.now() + 600000), evidence: { credentialScopeKey: scope.scopeKey, testFixture: true } } });
    for (const id of ['A', 'B']) await prisma.polymarketPrediction.create({ data: { id, marketSlug: id, venue: 'polymarket_us', question: id,
      side: 'YES', decision: 'YES', marketMid: .495, rawFair: .8, fairProb: .8, llmProb: .8, evidenceWeight: 1 } });
    submit.mockImplementation(async id => ({ id: 'broker-' + id }));
    getOrder.mockImplementation(async id => {
      const row = await prisma.predictionExecution.findUniqueOrThrow({ where: { brokerOrderId: id } });
      return { order: { id, marketSlug: row.marketSlug, intent: 'ORDER_INTENT_BUY_LONG', type: 'ORDER_TYPE_LIMIT',
        price: { value: '0.5', currency: 'USD' }, quantity: row.quantity, cumQuantity: row.quantity,
        leavesQuantity: 0, state: 'ORDER_STATE_FILLED', avgPx: { value: '0.5', currency: 'USD' },
        commissionNotionalTotalCollected: { value: String(row.quantity * .017375), currency: 'USD' } } };
    });
  });
  afterAll(async () => { process.env = saved; await prisma.$disconnect(); });
  test('a terminal fill invalidates the concurrent caller, and replay creates no second claim', async () => {
    let finishB!: () => void; let startedB!: () => void;
    let acceptA!: () => void; let submittedA!: () => void;
    const aSubmitted = new Promise<void>(r => { submittedA = r; });
    submit.mockImplementationOnce((id: string) => { submittedA(); return new Promise(resolve => { acceptA = () => resolve({ id: 'broker-' + id }); }); });
    const bStarted = new Promise<void>(r => { startedB = r; });
    const snapshot = () => ({ ...scope, observedAt: Date.now(), cash: 100, buyingPower: 100, positions: {}, openOrders: [] });
    getSnapshot.mockImplementationOnce(async () => snapshot()).mockImplementationOnce(() => {
      const old = snapshot(); startedB(); return new Promise(resolve => { finishB = () => resolve(old); });
    });
    const a = executeLivePrediction('A'); await aSubmitted;
    const b = executeLivePrediction('B'); await bStarted; acceptA();
    expect(await a).toMatchObject({ placed: true, status: 'FILLED' }); finishB();
    expect(await b).toMatchObject({ placed: false }); expect(submit).toHaveBeenCalledTimes(1);
    expect(await prisma.predictionExecution.count()).toBe(1);
    expect(await prisma.trade.count({ where: { accountId: scope.scopeKey, brokerConfirmed: true } })).toBe(1);
    getSnapshot.mockImplementation(async () => snapshot());
    expect(await executeLivePrediction('A')).toMatchObject({ placed: false });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await prisma.predictionExecution.count()).toBe(1);
  }, 15000);
});
