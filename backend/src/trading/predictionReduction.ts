import { createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { getPolymarketUSCredentialScope, getPolymarketUSExecutionSnapshot, getPolymarketUSOrder, polymarketUSVenue } from '../services/polymarketUS';
import { bindPolymarketUSRest } from '../services/polymarketUSRest';
import { readPredictionGeneration, advancePredictionGeneration, predictionPendingStates } from './predictionAuthority';
import { ensurePredictionRecoveryScope } from './predictionRecoveryScope';
import { parsePredictionReductionEvidence, assertReductionProgress, projectPredictionHolding } from './predictionReductionEvidence';

const db = prisma as any;
const pending = ['PREPARING', 'SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'];
const requestSchema = z.object({ requestKey: z.string().min(1).max(128), quantity: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER / 100),
  sideMinPrice: z.number().finite().min(.01).max(.99) });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function assertOwner(tx: any, ownerId: string) {
  const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { role: true, email: true } });
  if (owner?.role !== 'OWNER' || owner.email !== process.env.OWNER_EMAIL?.trim().toLowerCase()) throw new Error('REDUCTION_OWNER_UNAVAILABLE');
}

function assertPosition(snapshot: any, holding: any, now = Date.now()) {
  if (snapshot.scopeKey !== holding.credentialScopeKey || now - snapshot.observedAt > 5000 || snapshot.observedAt > now + 1000
    || snapshot.openOrders.length) throw new Error('REDUCTION_ACCOUNT_INCOMPLETE');
  const p = snapshot.positions[holding.marketSlug], raw = p?.netPositionDecimal ?? p?.netPosition;
  if (p?.expired !== false || typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error('REDUCTION_POSITION_UNAVAILABLE');
  const signed = Number(raw), expected = (holding.side === 'YES' ? 1 : -1) * holding.remainingQuantity;
  // Exact attribution: never flatten additional manual contracts, infer that
  // a disappeared position settled, or sell across zero into new exposure.
  if (!Number.isFinite(signed) || Math.abs(signed - expected) > 1e-8 || holding.remainingQuantity <= 0) throw new Error('REDUCTION_POSITION_DISCREPANCY');
}

async function loadHolding(tx: any, openingId: string) {
  const opening = await tx.predictionExecution.findUnique({ where: { id: openingId } });
  if (!opening || !['FILLED', 'TERMINAL_PARTIAL'].includes(opening.status) || !opening.brokerOrderId
    || !['YES', 'NO'].includes(opening.side) || opening.appliedQuantity <= 0 || !Number.isFinite(opening.appliedQuantity)
    || !Number.isFinite(opening.appliedNotional) || opening.appliedNotional <= 0
    || !Number.isFinite(opening.appliedFees) || opening.appliedFees < 0 || !opening.tradeId) throw new Error('REDUCTION_OPENING_UNCONFIRMED');
  if (await tx.predictionExecution.findFirst({ where: { credentialScopeKey: opening.credentialScopeKey, marketSlug: opening.marketSlug,
    id: { not: openingId }, status: { in: [...predictionPendingStates, 'FILLED', 'TERMINAL_PARTIAL'] } } })) {
    throw new Error('REDUCTION_OWNERSHIP_AMBIGUOUS');
  }
  const trade = await tx.trade.findUnique({ where: { id: opening.tradeId } });
  if (!trade || trade.status !== 'OPEN' || trade.accountId !== opening.credentialScopeKey || trade.brokerConfirmed !== true
    || trade.brokerMode !== 'live' || trade.quantity !== opening.appliedQuantity || trade.fees !== opening.appliedFees
    || Math.abs(trade.entryPrice * trade.quantity - opening.appliedNotional) > 1e-8) throw new Error('REDUCTION_OPENING_LEDGER_CONFLICT');
  const prior = await tx.predictionHolding.findUnique({ where: { openingExecutionId: openingId } });
  if (prior) {
    if (prior.ownerId !== opening.ownerId || prior.credentialScopeKey !== opening.credentialScopeKey || prior.marketSlug !== opening.marketSlug
      || prior.side !== opening.side || prior.openingQuantity !== opening.appliedQuantity || prior.openingNotional !== opening.appliedNotional
      || prior.openingFees !== opening.appliedFees || prior.openingQualificationId !== opening.qualificationId) throw new Error('REDUCTION_OPENING_BASIS_CHANGED');
    return prior;
  }
  return tx.predictionHolding.create({ data: { openingExecutionId: openingId, ownerId: opening.ownerId,
    credentialScopeKey: opening.credentialScopeKey, marketSlug: opening.marketSlug, side: opening.side,
    openingQuantity: opening.appliedQuantity, openingNotional: opening.appliedNotional, openingFees: opening.appliedFees,
    openingQualificationId: opening.qualificationId, remainingQuantity: opening.appliedQuantity,
    remainingBasis: opening.appliedNotional + opening.appliedFees, realizedPnl: 0 } });
}

/** Explicit service capability only; no route or automatic policy calls it.
 * Entry flags/qualification expiry do not authorize or prevent reduction. */
export async function reducePredictionHolding(openingId: string, input: z.infer<typeof requestSchema>) {
  const plan = requestSchema.parse(input), scope = getPolymarketUSCredentialScope();
  const opening = await db.predictionExecution.findUnique({ where: { id: openingId } });
  if (!opening || opening.credentialScopeKey !== scope.scopeKey) throw new Error('REDUCTION_GRANT_UNAVAILABLE');
  const generation = await readPredictionGeneration(db, scope.scopeKey);
  const snapshot = await getPolymarketUSExecutionSnapshot();
  const market = (await polymarketUSVenue.listMarkets(500)).find(m => m.id === opening.marketSlug);
  const book = market ? await polymarketUSVenue.getBook(market.id) : null;
  const now = Date.now();
  if (!market || !market.open || !market.executionMetadataVerified || !Number.isFinite(market.tickSize) || market.tickSize < .000001 || market.tickSize > .1
    || !Number.isFinite(market.minQty) || market.minQty <= 0 || plan.quantity < market.minQty
    || Math.abs(plan.quantity / market.minQty - Math.round(plan.quantity / market.minQty)) > 1e-6
    || !book || book.state !== 'MARKET_STATE_OPEN'
    || !Number.isFinite(book.fetchedAt) || now - book.fetchedAt > 5000 || book.fetchedAt > now + 1000) throw new Error('REDUCTION_MARKET_UNAVAILABLE');
  const yesLimit = opening.side === 'YES' ? plan.sideMinPrice : 1 - plan.sideMinPrice;
  if (Math.abs(yesLimit / market.tickSize - Math.round(yesLimit / market.tickSize)) > 1e-6
    || Math.abs(Number(yesLimit.toFixed(6)) - yesLimit) > 1e-8) throw new Error('REDUCTION_TICK_INVALID');
  const claim = await db.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.scopeKey}))`;
    await ensurePredictionRecoveryScope(tx, opening.ownerId, scope.scopeKey);
    await assertOwner(tx, opening.ownerId);
    if (await readPredictionGeneration(tx, scope.scopeKey) !== generation || snapshot.identity !== scope.identity) throw new Error('REDUCTION_AUTHORITY_CHANGED');
    if (await tx.predictionExecution.findFirst({ where: { credentialScopeKey: scope.scopeKey, status: { in: predictionPendingStates } } })
      || await tx.predictionReduction.findFirst({ where: { credentialScopeKey: scope.scopeKey, status: { in: pending } } })) throw new Error('REDUCTION_PENDING_ACCOUNT_MUTATION');
    const holding = await loadHolding(tx, openingId);
    assertPosition(snapshot, holding);
    if (plan.quantity > holding.remainingQuantity + 1e-8) throw new Error('REDUCTION_EXCEEDS_OWNERSHIP');
    const authorityGeneration = await advancePredictionGeneration(tx, scope.scopeKey);
    return tx.predictionReduction.create({ data: { claimKey: hash([opening.ownerId, scope.scopeKey, openingId, plan.requestKey]),
      openingExecutionId: openingId, ownerId: opening.ownerId, credentialScopeKey: scope.scopeKey, credentialIdentity: scope.identity,
      marketSlug: holding.marketSlug, side: holding.side, quantity: plan.quantity, sideMinPrice: plan.sideMinPrice,
      authorityGeneration, planExpiresAt: new Date(Math.min(snapshot.observedAt, book.fetchedAt) + 5000) } });
  });
  return submitPredictionReduction(claim.id);
}

async function submitPredictionReduction(id: string) {
  const scope = getPolymarketUSCredentialScope();
  let consumed = false;
  try {
    const claim = await db.predictionReduction.findUnique({ where: { id } });
    if (!claim || claim.status !== 'PREPARING' || claim.credentialScopeKey !== scope.scopeKey || claim.credentialIdentity !== scope.identity) throw new Error('REDUCTION_CLAIM_UNAVAILABLE');
    const request = bindPolymarketUSRest(process.env.POLYMARKET_KEY_ID!, process.env.POLYMARKET_SECRET_KEY!);
    const snapshot = await getPolymarketUSExecutionSnapshot();
    await db.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.scopeKey}))`;
      await ensurePredictionRecoveryScope(tx, claim.ownerId, scope.scopeKey);
      await assertOwner(tx, claim.ownerId);
      const current = await tx.predictionReduction.findUnique({ where: { id } });
      if (!current || current.status !== 'PREPARING' || hash([current.openingExecutionId, current.quantity, current.sideMinPrice, current.side, current.marketSlug,
        current.ownerId, current.credentialScopeKey, current.credentialIdentity, current.authorityGeneration, current.planExpiresAt]) !== hash([claim.openingExecutionId,
        claim.quantity, claim.sideMinPrice, claim.side, claim.marketSlug, claim.ownerId, claim.credentialScopeKey, claim.credentialIdentity, claim.authorityGeneration, claim.planExpiresAt])
        || await readPredictionGeneration(tx, scope.scopeKey) !== claim.authorityGeneration
        || snapshot.identity !== scope.identity || new Date(claim.planExpiresAt).getTime() <= Date.now()) throw new Error('REDUCTION_AUTHORITY_CHANGED');
      if (await tx.predictionExecution.findFirst({ where: { credentialScopeKey: scope.scopeKey, status: { in: predictionPendingStates } } })
        || await tx.predictionReduction.findFirst({ where: { credentialScopeKey: scope.scopeKey, status: { in: pending }, id: { not: id } } })) throw new Error('REDUCTION_PENDING_ACCOUNT_MUTATION');
      const holding = await loadHolding(tx, claim.openingExecutionId);
      assertPosition(snapshot, holding);
      if (claim.quantity > holding.remainingQuantity + 1e-8) throw new Error('REDUCTION_EXCEEDS_OWNERSHIP');
      const taken = await tx.predictionReduction.updateMany({ where: { id, status: 'PREPARING' }, data: { status: 'SUBMITTING' } });
      if (taken.count !== 1) throw new Error('REDUCTION_ALREADY_CONSUMED');
      await advancePredictionGeneration(tx, scope.scopeKey);
    });
    consumed = true;
    if (scope.identity !== getPolymarketUSCredentialScope().identity || new Date(claim.planExpiresAt).getTime() <= Date.now()
      || Date.now() - snapshot.observedAt > 5000) throw new Error('REDUCTION_FINAL_AUTHORITY_CHANGED');
    // Supported explicit quantity, never the all-position close endpoint.
    // https://docs.polymarket.us/api-reference/orders/create-order
    const ack = await request('POST', '/v1/orders', { marketSlug: claim.marketSlug, quantity: claim.quantity,
      intent: claim.side === 'YES' ? 'ORDER_INTENT_SELL_LONG' : 'ORDER_INTENT_SELL_SHORT', type: 'ORDER_TYPE_LIMIT',
      price: { value: (claim.side === 'YES' ? claim.sideMinPrice : 1 - claim.sideMinPrice).toFixed(6), currency: 'USD' },
      tif: 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL', manualOrderIndicator: 'MANUAL_ORDER_INDICATOR_AUTOMATIC' });
    if (typeof ack?.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ack.id)) throw new Error('REDUCTION_ACK_UNKNOWN');
    await db.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.scopeKey}))`;
      await tx.predictionReduction.update({ where: { id }, data: { brokerOrderId: ack.id, status: 'SUBMITTED' } });
      await advancePredictionGeneration(tx, scope.scopeKey);
    });
    return { id, ...await reconcilePredictionReduction(id) };
  } catch {
    // Refusal by this invocation cannot abort another writer's consumed claim.
    if (!consumed) await db.predictionReduction.updateMany({ where: { id, status: 'PREPARING' }, data: {
      status: 'ABORTED', error: 'Reduction refused before submission' } });
    else await db.predictionReduction.updateMany({ where: { id, status: { in: pending } }, data: {
      status: 'RECONCILIATION_REQUIRED', error: 'Reduction outcome uncertain; no automatic retry' } });
    return { id, reconciled: false };
  }
}

export async function reconcilePredictionReduction(id: string) {
  const scope = getPolymarketUSCredentialScope();
  const row = await db.predictionReduction.findUnique({ where: { id } });
  if (!row || row.credentialScopeKey !== scope.scopeKey || !row.brokerOrderId) return { reconciled: false };
  try {
    const evidence = parsePredictionReductionEvidence(await getPolymarketUSOrder(row.brokerOrderId, scope.scopeKey), {
      orderId: row.brokerOrderId, marketSlug: row.marketSlug, side: row.side, quantity: row.quantity, sideMinPrice: row.sideMinPrice });
    return await db.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.scopeKey}))`;
      const current = await tx.predictionReduction.findUnique({ where: { id } });
      if (!current || current.brokerOrderId !== row.brokerOrderId || current.credentialScopeKey !== scope.scopeKey
        || current.openingExecutionId !== row.openingExecutionId || current.side !== row.side || current.quantity !== row.quantity
        || current.marketSlug !== row.marketSlug || current.sideMinPrice !== row.sideMinPrice) throw new Error('REDUCTION_RECONCILIATION_CHANGED');
      assertReductionProgress({ ...current, terminal: current.terminalObserved }, evidence, current.sideMinPrice);
      const holding = await loadHolding(tx, current.openingExecutionId);
      const observationId = hash([id, evidence]);
      await tx.predictionReductionObservation.upsert({ where: { id: observationId }, create: { id: observationId, reductionId: id, evidence }, update: {} });
      const status = evidence.quantity > 0 && evidence.fees === null ? 'RECONCILIATION_REQUIRED'
        : evidence.terminal ? 'TERMINAL' : evidence.quantity > 0 ? 'PARTIALLY_FILLED' : 'SUBMITTED';
      await tx.predictionReduction.update({ where: { id }, data: { status, appliedQuantity: evidence.quantity,
        appliedProceeds: evidence.proceeds, appliedFees: evidence.fees, terminalObserved: evidence.terminal,
        error: evidence.quantity > 0 && evidence.fees === null ? 'Collected reduction commission unknown' : null } });
      const reductions = await tx.predictionReduction.findMany({ where: { openingExecutionId: current.openingExecutionId } });
      const projection = projectPredictionHolding({ quantity: holding.openingQuantity, notional: holding.openingNotional, fees: holding.openingFees }, reductions);
      await tx.predictionHolding.update({ where: { openingExecutionId: holding.openingExecutionId }, data: projection });
      if (current.appliedQuantity !== evidence.quantity || current.appliedProceeds !== evidence.proceeds || current.appliedFees !== evidence.fees
        || current.terminalObserved !== evidence.terminal || current.status !== status) await advancePredictionGeneration(tx, scope.scopeKey);
      return { reconciled: evidence.fees !== null, status, remainingQuantity: projection.remainingQuantity };
    });
  } catch {
    await db.predictionReduction.updateMany({ where: { id, credentialScopeKey: scope.scopeKey }, data: {
      status: 'RECONCILIATION_REQUIRED', error: 'Reduction evidence unavailable or inconsistent' } });
    return { reconciled: false };
  }
}

/** Bounded read-only recovery; unknown identities retain ownership reservation. */
export async function recoverPredictionReductions(ownerId: string, scopeKey: string) {
  const rows = await db.predictionReduction.findMany({ where: { ownerId, credentialScopeKey: scopeKey,
    status: { in: pending } }, orderBy: { updatedAt: 'asc' }, take: 20 });
  let unresolved = 0; const started = Date.now();
  for (const row of rows) {
    if (Date.now() - started > 10000) break;
    if (!row.brokerOrderId) {
      unresolved++;
      await db.predictionReduction.updateMany({ where: { id: row.id, brokerOrderId: null }, data: { error: 'Reduction identity unavailable; no automatic retry' } });
    } else if (!(await reconcilePredictionReduction(row.id)).reconciled) unresolved++;
  }
  return unresolved;
}
