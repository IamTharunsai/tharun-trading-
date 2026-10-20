// Only the network-isolated disposable CI database is permitted. Actual entry
// and reduction writers run, but every exchange transport and public read is fake.
const request = jest.fn(); let killed = false;
jest.mock('../src/services/polymarketUSRest', () => ({ bindPolymarketUSRest: () => request }));
jest.mock('polymarket-us', () => ({ PolymarketUS: jest.fn() }), { virtual: true });
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => killed }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));
import { prisma } from '../src/utils/prisma';
import { executeLivePrediction, reconcilePredictionExecution } from '../src/trading/predictionExecution';
import { reducePredictionHolding, reconcilePredictionReduction } from '../src/trading/predictionReduction';
import { recoverPredictionOrders } from '../src/trading/predictionRecovery';
import { getPolymarketUSCredentialScope, polymarketUSVenue } from '../src/services/polymarketUS';
import { assertPredictionRecoveryScope } from '../src/trading/predictionRecoveryScope';

const ownerId = 'reduction-fixture-owner';
const suite = process.env.RUN_PREDICTION_RECOVERY_POSTGRES === 'true' ? describe : describe.skip;
jest.setTimeout(20000);
suite('linked reduction through actual entry/recovery/holding PostgreSQL transactions', () => {
  const saved = { ...process.env };
  let signedPosition = 0, orderSequence = 0;
  let scopeKey: string;
  const brokerOrders = new Map<string, any>();
  const posted: any[] = [];
  let loseReply = false, unknownFee = false, partial = false, zeroFill = false;

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== 'postgresql://fixture:fixture@127.0.0.1:5432/fixture') throw new Error('Disposable offline CI database required');
    Object.assign(process.env, { OWNER_EMAIL: 'reduction@fixture.invalid', RELEASE_COMMIT_SHA: 'a'.repeat(40),
      TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK', POLYMARKET_US_LIVE: 'true',
      POLYMARKET_KEY_ID: '00000000-0000-4000-8000-000000000091', POLYMARKET_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'),
      POLYMARKET_US_MAX_ORDER_USD: '5', POLYMARKET_KELLY_FRACTION: '.25', POLYMARKET_MIN_EDGE: '.05' });
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    scopeKey = getPolymarketUSCredentialScope().scopeKey;
    await prisma.user.upsert({ where: { id: ownerId }, create: { id: ownerId, email: process.env.OWNER_EMAIL!, passwordHash: 'unused', role: 'OWNER' }, update: {} });
    await prisma.settings.upsert({ where: { id: 'settings-1' }, create: { id: 'settings-1', maxPositionSizePct: 5, maxRiskPerTradePct: 5, dailyLossLimitPct: 3 },
      update: { maxPositionSizePct: 5, maxRiskPerTradePct: 5, dailyLossLimitPct: 3 } });
    jest.spyOn(polymarketUSVenue, 'listMarkets').mockImplementation(async () => [{ venue: 'polymarket_us', id: 'reduction-market',
      question: 'offline only', category: 'general', open: true, executionMetadataVerified: true, feeCoefficient: .0695, tickSize: .01, minQty: .01 }]);
    jest.spyOn(polymarketUSVenue, 'getBook').mockImplementation(async () => ({ bids: [{ price: .49, size: 100 }],
      asks: [{ price: .5, size: 100 }], state: 'MARKET_STATE_OPEN', fetchedAt: Date.now() }));
  });
  beforeEach(async () => {
    killed = false; signedPosition = 0; orderSequence = 0; loseReply = false; unknownFee = false; partial = false; zeroFill = false;
    brokerOrders.clear(); posted.length = 0; request.mockReset();
    Object.assign(process.env, { TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK', POLYMARKET_US_LIVE: 'true' });
    await prisma.predictionReductionObservation.deleteMany({ where: { reduction: { ownerId } } });
    await prisma.predictionReduction.deleteMany({ where: { ownerId } });
    await prisma.predictionHolding.deleteMany({ where: { ownerId } });
    await prisma.predictionExecution.deleteMany({ where: { ownerId } });
    await prisma.trade.deleteMany({ where: { accountId: scopeKey } });
    await prisma.predictionRecoveryState.deleteMany({ where: { ownerId } });
    await prisma.predictionAccountAuthority.deleteMany({ where: { scopeKey } });
    await prisma.strategyQualification.deleteMany({ where: { strategyKey: 'BHISHMA_POLYMARKET_US', revision: 'a'.repeat(40) } });
    await prisma.strategyQualification.create({ data: { strategyKey: 'BHISHMA_POLYMARKET_US', revision: 'a'.repeat(40),
      dataHash: 'b'.repeat(64), reportHash: 'c'.repeat(64), trialCount: 20, noLeakage: true, dsrProbability: .99,
      walkForwardPassed: true, costsValidated: true, executionValidated: true, ledgerReconciled: true, healthPassed: true,
      expiresAt: new Date(Date.now() + 600000), evidence: { credentialScopeKey: scopeKey, fixtureOnly: true } } });
    await prisma.polymarketPrediction.upsert({ where: { id: 'reduction-prediction' }, create: { id: 'reduction-prediction',
      venue: 'polymarket_us', marketSlug: 'reduction-market', question: 'offline only', marketMid: .495,
      rawFair: .8, fairProb: .8, llmProb: .8, evidenceWeight: 1, decision: 'YES', side: 'YES' },
      update: { createdAt: new Date(), decision: 'YES', side: 'YES', fairProb: .8, llmProb: .8 } });
    request.mockImplementation(async (method: string, path: string, body: any) => {
      if (method === 'GET' && path === '/v1/account/balances') return { balances: [{ currency: 'USD', currentBalance: 100, buyingPower: 100 }] };
      if (method === 'GET' && path === '/v1/orders/open') return { orders: [] };
      if (method === 'GET' && path === '/v1/portfolio/positions') return { positions: signedPosition === 0 ? {} : {
        'reduction-market': { netPositionDecimal: String(signedPosition), expired: false } }, eof: true };
      if (method === 'GET' && path === '/v1/portfolio/activities') return { activities: [], eof: true };
      if (method === 'GET' && path.startsWith('/v1/order/')) {
        const row = brokerOrders.get(path.slice('/v1/order/'.length)); if (!row) throw new Error('Unknown fixture order'); return { order: row };
      }
      if (method === 'POST' && path === '/v1/orders') {
        const id = 'fixture-order-' + (++orderSequence); posted.push({ id, ...body });
        const opening = body.intent.startsWith('ORDER_INTENT_BUY');
        const sign = body.intent.endsWith('LONG') ? 1 : -1;
        const quantity = opening ? body.quantity : zeroFill ? 0 : partial ? .5 : body.quantity;
        // Opening .50 YES/.50 NO. Reduction execution matches explicit YES
        // price: SELL_SHORT .20 YES is .80 economic NO proceeds.
        const avg = opening ? .5 : Number(body.price.value);
        brokerOrders.set(id, { ...body, id, quantity: body.quantity, cumQuantity: quantity,
          leavesQuantity: 0, state: quantity === body.quantity ? 'ORDER_STATE_FILLED' : 'ORDER_STATE_CANCELED',
          avgPx: { value: String(avg), currency: 'USD' },
          ...(!unknownFee || opening ? { commissionNotionalTotalCollected: { value: String(quantity * .02), currency: 'USD' } } : {}) });
        signedPosition += (opening ? 1 : -1) * sign * quantity;
        if (loseReply && !opening) throw new Error('Fixture accepted POST then lost reply');
        return { id };
      }
      throw new Error('Unexpected fixture transport request');
    });
  });
  afterAll(async () => { jest.restoreAllMocks(); process.env = saved; await prisma.$disconnect(); });

  async function open(side: 'YES' | 'NO' = 'YES') {
    // Initial supported live entry planner currently admits integer minimums.
    // This fixture uses min1 for opening, then genuine fractional reduction metadata.
    const list = jest.spyOn(polymarketUSVenue, 'listMarkets');
    list.mockResolvedValueOnce([{ venue: 'polymarket_us', id: 'reduction-market', question: 'offline', category: 'general',
      open: true, executionMetadataVerified: true, feeCoefficient: .0695, tickSize: .01, minQty: 1 }]);
    if (side === 'NO') await prisma.polymarketPrediction.update({ where: { id: 'reduction-prediction' }, data: { decision: 'NO', side: 'NO', fairProb: .2, llmProb: .2 } });
    const result = await executeLivePrediction('reduction-prediction');
    expect(result).toMatchObject({ placed: true, status: 'FILLED' });
    const row = await prisma.predictionExecution.findFirstOrThrow({ where: { ownerId } });
    // Preserve qualification custody: reductions must neither need renewal nor
    // create a fresh qualifying artifact while entry is halted.
    await prisma.strategyQualification.updateMany({ where: { id: row.qualificationId }, data: { expiresAt: new Date(0) } });
    process.env.TRADING_MODE = 'paper'; process.env.POLYMARKET_US_LIVE = 'false'; killed = true;
    return row;
  }

  test.each(['YES', 'NO'] as const)('actual %s entry → fractional terminal partial → restart recovery → full close retains basis and exact loss', async side => {
    const opening = await open(side); const originalTrade = await prisma.trade.findUniqueOrThrow({ where: { id: opening.tradeId! } });
    partial = true;
    const first = await reducePredictionHolding(opening.id, { requestKey: 'partial', quantity: 1, sideMinPrice: .3 });
    expect(first).toMatchObject({ reconciled: true, status: 'TERMINAL' });
    const firstClaim = await prisma.predictionReduction.findUniqueOrThrow({ where: { id: first.id } });
    expect(firstClaim.appliedQuantity).toBe(.5);
    expect(posted[1].intent).toBe(side === 'YES' ? 'ORDER_INTENT_SELL_LONG' : 'ORDER_INTENT_SELL_SHORT');
    expect(Number(posted[1].price.value)).toBeCloseTo(side === 'YES' ? .3 : .7);
    const once = await prisma.predictionHolding.findUniqueOrThrow({ where: { openingExecutionId: opening.id } });
    expect(once.remainingQuantity).toBeCloseTo(opening.appliedQuantity - .5);
    expect(once.realizedPnl).toBeCloseTo(-.12); // .15 - .01 - (.25 + .01)
    await Promise.all([reconcilePredictionReduction(first.id), reconcilePredictionReduction(first.id)]);
    expect((await prisma.predictionHolding.findUniqueOrThrow({ where: { openingExecutionId: opening.id } })).realizedPnl).toBeCloseTo(-.12);
    expect(await prisma.predictionReductionObservation.count({ where: { reductionId: first.id } })).toBe(1);
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: opening.tradeId! } })).toEqual(originalTrade);
    // Durable known-ID pending state simulates process recreation against retained DB.
    await prisma.predictionReduction.update({ where: { id: first.id }, data: { status: 'RECONCILIATION_REQUIRED' } });
    expect(await recoverPredictionOrders()).toMatchObject({ unresolved: 0 });
    partial = false;
    const full = await reducePredictionHolding(opening.id, { requestKey: 'remainder', quantity: once.remainingQuantity, sideMinPrice: .3 });
    expect(full).toMatchObject({ reconciled: true, remainingQuantity: 0 });
    const closed = await prisma.predictionHolding.findUniqueOrThrow({ where: { openingExecutionId: opening.id } });
    expect(closed.remainingBasis).toBeCloseTo(0);
    expect(closed.realizedPnl).toBeCloseTo(-.24 * opening.appliedQuantity);
    await reconcilePredictionExecution(opening.id);
    expect((await prisma.predictionHolding.findUniqueOrThrow({ where: { openingExecutionId: opening.id } })).remainingQuantity).toBe(0);
    await expect(prisma.$transaction(tx => assertPredictionRecoveryScope(tx, ownerId, scopeKey))).rejects.toThrow('REDUCTION_LOSS_COVERAGE');
    expect(await prisma.strategyQualification.count({ where: { strategyKey: 'BHISHMA_POLYMARKET_US', revision: 'a'.repeat(40) } })).toBe(1);
    expect((await prisma.strategyQualification.findUniqueOrThrow({ where: { id: opening.qualificationId } })).expiresAt.getTime()).toBe(0);
    expect(posted).toHaveLength(3);
  });

  test('missing commission preserves confirmed remaining exposure and unknown P&L until late evidence', async () => {
    const opening = await open(); unknownFee = true; partial = true;
    const reduction = await reducePredictionHolding(opening.id, { requestKey: 'unknown-fee', quantity: 1, sideMinPrice: .3 });
    expect(reduction.reconciled).toBe(false);
    expect(await prisma.predictionHolding.findUniqueOrThrow({ where: { openingExecutionId: opening.id } })).toMatchObject({
      remainingQuantity: opening.appliedQuantity - .5, realizedPnl: null });
    await expect(reducePredictionHolding(opening.id, { requestKey: 'second', quantity: .5, sideMinPrice: .3 })).rejects.toThrow('PENDING');
    const row = await prisma.predictionReduction.findUniqueOrThrow({ where: { id: reduction.id } });
    brokerOrders.get(row.brokerOrderId!).commissionNotionalTotalCollected = { value: '0.01', currency: 'USD' };
    expect(await reconcilePredictionReduction(row.id)).toMatchObject({ reconciled: true });
    expect((await prisma.predictionHolding.findUniqueOrThrow({ where: { openingExecutionId: opening.id } })).realizedPnl).toBeCloseTo(-.12);
    expect(posted).toHaveLength(2);
  });

  test('accepted POST with lost response retains claim and never sends again during recovery or repeated request', async () => {
    const opening = await open(); loseReply = true;
    const result = await reducePredictionHolding(opening.id, { requestKey: 'lost', quantity: 1, sideMinPrice: .3 });
    expect(result.reconciled).toBe(false);
    const row = await prisma.predictionReduction.findUniqueOrThrow({ where: { id: result.id } });
    expect(row).toMatchObject({ status: 'RECONCILIATION_REQUIRED', brokerOrderId: null, appliedQuantity: 0 });
    await recoverPredictionOrders(); await recoverPredictionOrders();
    await expect(reducePredictionHolding(opening.id, { requestKey: 'lost', quantity: 1, sideMinPrice: .3 })).rejects.toThrow('PENDING');
    expect(posted).toHaveLength(2);
    expect((await prisma.predictionHolding.findUniqueOrThrow({ where: { openingExecutionId: opening.id } })).remainingQuantity).toBe(opening.appliedQuantity);
  });

  test('manual extra contracts and competing claims cannot acquire exposure-reversing authority', async () => {
    const opening = await open(); signedPosition += 1;
    await expect(reducePredictionHolding(opening.id, { requestKey: 'manual', quantity: 1, sideMinPrice: .3 })).rejects.toThrow('DISCREPANCY');
    expect(posted).toHaveLength(1); signedPosition -= 1;
    const results = await Promise.allSettled(['left', 'right'].map(requestKey => reducePredictionHolding(opening.id, { requestKey, quantity: 1, sideMinPrice: .3 })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(posted).toHaveLength(2);
    expect(await prisma.predictionReduction.count({ where: { ownerId } })).toBe(1);
  });

  test('proven terminal zero-fill zero-fee reduction does not manufacture an enduring loss-coverage block', async () => {
    const opening = await open(); zeroFill = true;
    const result = await reducePredictionHolding(opening.id, { requestKey: 'unfilled', quantity: 1, sideMinPrice: .3 });
    expect(result).toMatchObject({ reconciled: true, status: 'TERMINAL', remainingQuantity: opening.appliedQuantity });
    const row = await prisma.predictionReduction.findUniqueOrThrow({ where: { id: result.id } });
    expect(row).toMatchObject({ appliedQuantity: 0, appliedProceeds: 0, appliedFees: 0, terminalObserved: true });
    await expect(prisma.$transaction(tx => assertPredictionRecoveryScope(tx, ownerId, scopeKey))).resolves.toBeUndefined();
    expect((await prisma.predictionHolding.findUniqueOrThrow({ where: { openingExecutionId: opening.id } })).realizedPnl).toBe(0);
    expect((await executeLivePrediction('reduction-prediction')).placed).toBe(false); // Actual entry mode and kill gate remain intact.
    expect(posted).toHaveLength(2);
  });

  test('owner revocation and a different API grant cannot create reduction authority', async () => {
    const opening = await open();
    await prisma.user.update({ where: { id: ownerId }, data: { role: 'USER' } });
    try {
      await expect(reducePredictionHolding(opening.id, { requestKey: 'revoked', quantity: 1, sideMinPrice: .3 })).rejects.toThrow('OWNER');
    } finally { await prisma.user.update({ where: { id: ownerId }, data: { role: 'OWNER' } }); }
    const keyId = process.env.POLYMARKET_KEY_ID;
    process.env.POLYMARKET_KEY_ID = '00000000-0000-4000-8000-000000000092';
    try {
      await expect(reducePredictionHolding(opening.id, { requestKey: 'rotated', quantity: 1, sideMinPrice: .3 })).rejects.toThrow('GRANT');
    } finally { process.env.POLYMARKET_KEY_ID = keyId; }
    expect(await prisma.predictionReduction.count({ where: { ownerId } })).toBe(0);
    expect(posted).toHaveLength(1);
  });

  test('a quote that expires during preparation cannot create or submit a reduction', async () => {
    const opening = await open(), now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    jest.spyOn(polymarketUSVenue, 'getBook').mockImplementationOnce(async () => {
      clock.mockReturnValue(now + 6001);
      return { bids: [{ price: .49, size: 100 }], asks: [{ price: .5, size: 100 }], state: 'MARKET_STATE_OPEN', fetchedAt: now };
    });
    try {
      await expect(reducePredictionHolding(opening.id, { requestKey: 'stale', quantity: 1, sideMinPrice: .3 })).rejects.toThrow('MARKET');
    } finally { clock.mockRestore(); }
    expect(await prisma.predictionReduction.count({ where: { ownerId } })).toBe(0); expect(posted).toHaveLength(1);
  });

  test('identity changes after durable consumption prevent POST while retaining the uncertain claim', async () => {
    const opening = await open();
    const originalTransaction = prisma.$transaction.bind(prisma), secret = process.env.POLYMARKET_SECRET_KEY;
    const transaction = jest.spyOn(prisma, '$transaction').mockImplementation((async (...args: any[]) => {
      const result = await (originalTransaction as any)(...args);
      const consumed = await prisma.predictionReduction.findFirst({ where: { ownerId, status: 'SUBMITTING', brokerOrderId: null } });
      if (consumed) process.env.POLYMARKET_SECRET_KEY = Buffer.alloc(32, 2).toString('base64');
      return result;
    }) as any);
    try {
      const result = await reducePredictionHolding(opening.id, { requestKey: 'identity', quantity: 1, sideMinPrice: .3 });
      expect(result.reconciled).toBe(false);
      expect(await prisma.predictionReduction.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({
        status: 'RECONCILIATION_REQUIRED', brokerOrderId: null, appliedQuantity: 0 });
    } finally { transaction.mockRestore(); process.env.POLYMARKET_SECRET_KEY = secret; }
    expect(posted).toHaveLength(1);
    await expect(prisma.$transaction(tx => assertPredictionRecoveryScope(tx, ownerId, scopeKey))).rejects.toThrow('REDUCTION_LOSS_COVERAGE');
  });
});
