// Only the disposable offline CI database is permitted; exchange and gate calls
// are mocks. No financial transport or real account credentials are available.
const scope = { scopeKey: 'fixture-recovery-grant', identity: 'fixture-identity' };
const readOrder = jest.fn(); const readActivities = jest.fn(); const cancel = jest.fn();
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: jest.fn(() => true) }));
jest.mock('../src/services/polymarketUS', () => ({ getPolymarketUSCredentialScope: () => scope,
  getPolymarketUSOrder: (id: string) => readOrder(id), getPolymarketUSTradeActivities: () => readActivities(),
  cancelPolymarketUSOrder: (...args: any[]) => cancel(...args), PredictionSubmissionRefused: class extends Error {},
  POLYMARKET_LIVE_STRATEGY: 'BHISHMA_POLYMARKET_US', polymarketUSVenue: {},
}));
import { prisma } from '../src/utils/prisma';
import { recoverPredictionOrders } from '../src/trading/predictionRecovery';
import { reconcilePredictionExecution } from '../src/trading/predictionExecution';
import { assertPredictionRecoveryScope } from '../src/trading/predictionRecoveryScope';
import { isKillSwitchActive } from '../src/agents/orchestrator';
const ownerId = 'recovery-test-owner';
const enabled = process.env.RUN_PREDICTION_RECOVERY_POSTGRES === 'true';
const suite = enabled ? describe : describe.skip;
suite('durable prediction read recovery', () => {
  const saved = { ...process.env };
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== 'postgresql://fixture:fixture@127.0.0.1:5432/fixture') throw new Error('Disposable offline CI database required');
    Object.assign(process.env, { OWNER_EMAIL: 'recovery-test@fixture.invalid', TRADING_MODE: 'paper', POLYMARKET_US_LIVE: 'false' });
    delete process.env.LIVE_TRADING_CONFIRMED; delete process.env.RELEASE_COMMIT_SHA; delete process.env.RAILWAY_GIT_COMMIT_SHA;
    await prisma.user.upsert({ where: { id: ownerId }, create: { id: ownerId, email: process.env.OWNER_EMAIL!, passwordHash: 'not-used', role: 'OWNER' }, update: {} });
  });
  beforeEach(async () => {
    jest.clearAllMocks(); scope.scopeKey = 'fixture-recovery-grant';
    await prisma.predictionExecution.deleteMany({ where: { ownerId } });
    await prisma.trade.deleteMany({ where: { accountId: scope.scopeKey } });
    await prisma.predictionRecoveryState.deleteMany({ where: { ownerId } });
    readActivities.mockResolvedValue([]);
    readOrder.mockImplementation(async id => {
      const row = await prisma.predictionExecution.findUniqueOrThrow({ where: { brokerOrderId: id } });
      return observation(id, row.marketSlug, 5, 'ORDER_STATE_FILLED', '0.10');
    });
  });
  afterAll(async () => { process.env = saved; await prisma.$disconnect(); });
  async function seed(id: string, overrides: Record<string, unknown> = {}) {
    await prisma.polymarketPrediction.upsert({ where: { id: 'prediction-' + id }, create: { id: 'prediction-' + id,
      venue: 'polymarket_us', marketSlug: id, question: 'fixture only', marketMid: .5, rawFair: .7, fairProb: .7, evidenceWeight: 1, decision: 'YES', side: 'YES' }, update: {} });
    return prisma.predictionExecution.create({ data: { id, claimKey: 'claim-' + id, ownerId, credentialScopeKey: scope.scopeKey,
      credentialIdentity: scope.identity, predictionId: 'prediction-' + id, marketSlug: id, side: 'YES', quantity: 5,
      sideLimitPrice: .5, reservedUsd: 2.6, authorityGeneration: 0, planExpiresAt: new Date(0), riskPolicyHash: 'fixture',
      qualificationId: 'expired-fixture', planNetEdge: .2, status: 'SUBMITTED', brokerOrderId: 'broker-' + id, ...overrides } });
  }
  function observation(id: string, marketSlug: string, quantity: number, state: string, fee?: string) {
    return { order: { id, marketSlug, intent: 'ORDER_INTENT_BUY_LONG', type: 'ORDER_TYPE_LIMIT', quantity: 5,
      cumQuantity: quantity, leavesQuantity: state === 'ORDER_STATE_PARTIALLY_FILLED' ? 5 - quantity : 0, state,
      price: { value: '0.5', currency: 'USD' }, ...(quantity ? { avgPx: { value: '0.49', currency: 'USD' } } : {}),
      ...(fee === undefined ? {} : { commissionNotionalTotalCollected: { value: fee, currency: 'USD' } }) } };
  }

  test('expired plans, paper entry mode and kill state do not prevent actual-shaped cumulative read recovery', async () => {
    await seed('A');
    const result = await recoverPredictionOrders();
    expect(result).toMatchObject({ processed: 1, unresolved: 0, outcome: 'KNOWN_ORDERS_OBSERVED' });
    const row = await prisma.predictionExecution.findUniqueOrThrow({ where: { id: 'A' } });
    expect(row).toMatchObject({ status: 'FILLED', appliedQuantity: 5, appliedNotional: 2.45, appliedFees: .1, reservedUsd: 0 });
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: row.tradeId! } })).toMatchObject({ quantity: 5, entryPrice: .49, fees: .1, brokerConfirmed: true });
    await reconcilePredictionExecution('A');
    expect(await prisma.trade.count({ where: { accountId: scope.scopeKey } })).toBe(1);
    expect(cancel).not.toHaveBeenCalled(); expect(isKillSwitchActive).not.toHaveBeenCalled();
  });

  test('missing commission remains unknown; later terminal partial evidence books exactly once', async () => {
    await seed('B');
    readOrder.mockResolvedValueOnce(observation('broker-B', 'B', 2, 'ORDER_STATE_PARTIALLY_FILLED'));
    expect(await recoverPredictionOrders()).toMatchObject({ unresolved: 1 });
    expect(await prisma.trade.count({ where: { accountId: scope.scopeKey } })).toBe(0);
    readOrder.mockResolvedValueOnce(observation('broker-B', 'B', 2, 'ORDER_STATE_CANCELED', '0.04'));
    expect(await recoverPredictionOrders()).toMatchObject({ unresolved: 0 });
    const row = await prisma.predictionExecution.findUniqueOrThrow({ where: { id: 'B' } });
    expect(row).toMatchObject({ status: 'TERMINAL_PARTIAL', appliedQuantity: 2, appliedFees: .04, reservedUsd: 0 });
    expect(await prisma.trade.count({ where: { accountId: scope.scopeKey } })).toBe(1);
  });

  test('persisted unknown-ID rows cannot starve a later known order or trigger any resubmission', async () => {
    for (let i = 0; i < 40; i++) await seed('N-' + String(i).padStart(2, '0'), { brokerOrderId: null, status: 'SUBMITTING' });
    await seed('Z-known');
    await recoverPredictionOrders(); await recoverPredictionOrders(); await recoverPredictionOrders();
    expect(readOrder).toHaveBeenCalledTimes(1);
    expect((await prisma.predictionExecution.findUniqueOrThrow({ where: { id: 'Z-known' } })).status).toBe('FILLED');
    expect((await prisma.predictionExecution.findUniqueOrThrow({ where: { id: 'N-00' } })).reservedUsd).toBe(2.6);
    expect(cancel).not.toHaveBeenCalled();
  });

  test('a persisted lease prevents overlap; expired lease recovers after a simulated process loss', async () => {
    await seed('C');
    await prisma.predictionRecoveryState.create({ data: { ownerId, boundCredentialScopeKey: scope.scopeKey,
      leaseId: 'previous-process', leaseUntil: new Date(Date.now() + 60000) } });
    expect(await recoverPredictionOrders()).toMatchObject({ outcome: 'LEASE_ACTIVE' });
    expect(readOrder).not.toHaveBeenCalled();
    await prisma.predictionRecoveryState.update({ where: { ownerId }, data: { leaseUntil: new Date(0) } });
    expect(await recoverPredictionOrders()).toMatchObject({ processed: 1, unresolved: 0 });
    expect((await prisma.predictionRecoveryState.findUniqueOrThrow({ where: { ownerId } })).leaseId).toBeNull();
  });

  test('grant rotation preserves the old unknown reservation and refuses new entry authority', async () => {
    await seed('D', { brokerOrderId: null }); await recoverPredictionOrders();
    scope.scopeKey = 'different-grant';
    expect(await recoverPredictionOrders()).toMatchObject({ outcome: 'GRANT_REVIEW_REQUIRED', unresolved: 1 });
    await expect(prisma.$transaction(tx => assertPredictionRecoveryScope(tx, ownerId, scope.scopeKey))).rejects.toThrow('ROTATION_REQUIRES_REVIEW');
    expect((await prisma.predictionRecoveryState.findUniqueOrThrow({ where: { ownerId } })).boundCredentialScopeKey).toBe('fixture-recovery-grant');
    expect((await prisma.predictionExecution.findUniqueOrThrow({ where: { id: 'D' } })).reservedUsd).toBe(2.6);
  });
});
