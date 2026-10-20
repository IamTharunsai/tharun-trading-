import { createHash } from 'crypto';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { isKillSwitchActive } from '../agents/orchestrator';
import { getPolymarketUSCredentialScope, getPolymarketUSExecutionSnapshot, getPolymarketUSOrder,
  submitPolymarketUSExecution, polymarketUSVenue, POLYMARKET_LIVE_STRATEGY, PredictionSubmissionRefused } from '../services/polymarketUS';
import { polymarketLiveAllowed, getPolymarketMaxOrderUsd } from './liveGate';
import { validateLiveQualification } from './liveQualification';
import { parsePredictionOrderEvidence } from './predictionOrderEvidence';
import { assertPredictionRecoveryScope } from './predictionRecoveryScope';
import { bestAsk, bestBid, buyLevels, takerFeePerShare, sizeBetUsd } from './predictionMath';
import type { PmUsExecutionSnapshot } from '../services/polymarketUS';
import type { VenueMarket, VenueBook } from '../services/predictionVenue';
import { predictionPendingStates as pendingStates, predictionActiveStates as activeStates,
  predictionRiskPolicyHash, readPredictionGeneration, advancePredictionGeneration, predictionAccountExposure,
  assertPredictionFillsReflected, predictionDailyRealizedPnl } from './predictionAuthority';
export { predictionAccountExposure } from './predictionAuthority';

const db = prisma as any;
const strategyRevision = () => process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RELEASE_COMMIT_SHA;

export async function getPredictionLiveReadiness() {
  const gate = polymarketLiveAllowed(process.env, isKillSwitchActive());
  if (!gate.allowed) return { ready: false as const, reason: gate.reason };
  const scope = getPolymarketUSCredentialScope();
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const owner = email ? await db.user.findUnique({ where: { email }, select: { id: true, role: true } }) : null;
  if (!owner || owner.role !== 'OWNER') return { ready: false as const, reason: 'Prediction owner authority unavailable' };
  const revision = strategyRevision();
  const qualification = revision ? await db.strategyQualification.findFirst({
    where: { strategyKey: POLYMARKET_LIVE_STRATEGY, revision }, orderBy: { createdAt: 'desc' },
  }) : null;
  const check = validateLiveQualification(qualification, POLYMARKET_LIVE_STRATEGY, revision);
  if (!check.approved) return { ready: false as const, reason: check.reason };
  if (qualification?.evidence?.credentialScopeKey !== scope.scopeKey) return { ready: false as const, reason: 'Prediction qualification is not bound to this API grant' };
  return { ready: true as const, reason: 'Current verified strategy and API grant qualification passed', ownerId: owner.id,
    qualificationId: qualification.id, qualificationExpiresAt: new Date(qualification.expiresAt).getTime(), ...scope };
}

/** Reserve a conservative $1 per outstanding binary contract. Provider cost
 * basis is not equity, and signed NO cost fields are not used as bankroll.
 * Open broker orders must reconcile before another IOC entry. */

const bounded = (v: unknown, low: number, high: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high;
/** Derive a new live plan from the persisted forecast, actual funds, current
 * exchange book/minimum/tick/fees and the owner's stored risk settings. */
export function planLivePrediction(prediction: any, market: VenueMarket, book: VenueBook,
  snapshot: PmUsExecutionSnapshot, risk: any, now = Date.now()) {
  const created = new Date(prediction?.createdAt).getTime();
  if (prediction?.venue !== 'polymarket_us' || prediction.marketSlug !== market.id || prediction.resolvedAt
    || !['YES', 'NO'].includes(prediction.decision) || prediction.side !== prediction.decision
    || !bounded(prediction.fairProb, 0, 1) || !bounded(prediction.llmProb, 0, 1)
    || !bounded(prediction.evidenceWeight, 0, 1) || prediction.evidenceWeight <= 0
    || !Number.isFinite(created) || created > now + 5000 || now - created > 300000) throw new Error('Persisted prediction evidence is missing, stale or inconsistent');
  if (!market.open || market.executionMetadataVerified !== true || book.state !== 'MARKET_STATE_OPEN' || !Number.isFinite(book.fetchedAt)
    || book.fetchedAt > now + 1000 || now - book.fetchedAt > 5000
    || !Number.isFinite(snapshot.observedAt) || now - snapshot.observedAt > 5000 || snapshot.observedAt > now + 1000
    || !bounded(snapshot.cash, 0, Number.MAX_SAFE_INTEGER / 100) || !bounded(snapshot.buyingPower, 0, Number.MAX_SAFE_INTEGER / 100)
    || !bounded(market.feeCoefficient, 0, 1) || !bounded(market.tickSize, 0.000001, 0.1)
    || !Number.isSafeInteger(market.minQty) || market.minQty < 1) throw new Error('Current exchange execution evidence unavailable');
  const bid = bestBid(book), ask = bestAsk(book);
  if (bid == null || ask == null || ask <= bid) throw new Error('Prediction two-sided execution book unavailable');
  for (const name of ['maxPositionSizePct', 'maxRiskPerTradePct', 'dailyLossLimitPct']) {
    if (!bounded(risk?.[name], 0.01, 100)) throw new Error('Prediction owner risk policy invalid');
  }
  const exposure = predictionAccountExposure(snapshot);
  if (exposure.slugs.has(market.id)) throw new Error('Broker already holds this prediction market');
  const side = prediction.decision as 'YES' | 'NO';
  const price = side === 'YES' ? ask : 1 - bid;
  const yesLimit = side === 'YES' ? price : 1 - price;
  if (!bounded(price, 0.01, 0.99) || Math.abs(yesLimit / market.tickSize - Math.round(yesLimit / market.tickSize)) > 1e-6) throw new Error('Prediction price is outside exchange bounds or tick');
  const fee = takerFeePerShare(market.feeCoefficient, price);
  const fairSide = side === 'YES' ? prediction.fairProb : 1 - prediction.fairProb;
  const minEdge = Number(process.env.POLYMARKET_MIN_EDGE ?? 0.05);
  if (!bounded(minEdge, 0, 1) || fairSide - price - fee < minEdge) throw new Error('Current net prediction edge does not clear costs');
  // Cash alone is the conservative sizing denominator until marked account
  // equity and provider cost semantics have independent reconciliation proof.
  const capital = snapshot.cash;
  const available = Math.min(snapshot.cash, snapshot.buyingPower);
  const policyMax = Math.min(getPolymarketMaxOrderUsd(), capital * risk.maxPositionSizePct / 100,
    capital * risk.maxRiskPerTradePct / 100, Math.max(0, capital * risk.dailyLossLimitPct / 100 - exposure.cost));
  const kelly = Number(process.env.POLYMARKET_KELLY_FRACTION ?? 0.25);
  if (!bounded(kelly, 0, 1) || !Number.isFinite(capital) || capital <= 0) throw new Error('Prediction capital or sizing policy invalid');
  const budget = sizeBetUsd({ fairSide, costPerShare: price + fee, confidence: prediction.evidenceWeight,
    bankrollUsd: capital, kellyMultiplier: kelly, maxBetUsd: Math.min(policyMax, available), maxBetPctOfBankroll: risk.maxPositionSizePct / 100 });
  const top = buyLevels(book, side)[0];
  if (!top || !Number.isFinite(top.size) || top.size <= 0) throw new Error('Prediction executable depth unavailable');
  const centBudget = Math.floor(Math.min(budget, available) * 100 + 1e-9) / 100;
  const quantity = Math.floor(Math.min(centBudget / (price + fee), top.size));
  if (!Number.isSafeInteger(quantity) || quantity < market.minQty) throw new Error('Verified funds/risk budget is below the exchange minimum quantity');
  if (Math.ceil(quantity * (price + fee) * 100 - 1e-9) / 100 > centBudget + 1e-8) throw new Error('Prediction fee-inclusive reservation exceeds budget');
  return { side, quantity, sideLimitPrice: price, reservedUsd: Math.ceil(quantity * (price + fee) * 100 - 1e-9) / 100,
    planNetEdge: fairSide - price - fee, planExpiresAt: new Date(Math.min(book.fetchedAt + 5000, snapshot.observedAt + 5000, created + 300000)),
    riskPolicyHash: predictionRiskPolicyHash(risk) };
}

/** Apply cumulative broker evidence once under the same account lock as claims.
 * No Trade is created for an acknowledgement or an unknown commission. */
export async function reconcilePredictionExecution(id: string) {
  const scope = getPolymarketUSCredentialScope();
  const row = await db.predictionExecution.findUnique({ where: { id } });
  if (!row || row.credentialScopeKey !== scope.scopeKey || !row.brokerOrderId) return { reconciled: false, reason: 'Broker order identity unavailable; submission will not be retried' };
  let raw: unknown;
  try {
    raw = await getPolymarketUSOrder(row.brokerOrderId, row.credentialScopeKey);
    const observed = parsePredictionOrderEvidence(raw, { orderId: row.brokerOrderId, marketSlug: row.marketSlug,
      side: row.side, quantity: row.quantity, sideLimitPrice: row.sideLimitPrice });
    if (observed.quantity > 0 && observed.fees === null) throw new Error('Confirmed cumulative commission unavailable');
    return await db.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${row.credentialScopeKey}))`;
      const current = await tx.predictionExecution.findUnique({ where: { id } });
      if (!current || current.brokerOrderId !== row.brokerOrderId || current.credentialScopeKey !== scope.scopeKey) throw new Error('Prediction reconciliation authority changed');
      if (observed.quantity < current.appliedQuantity || (observed.fees !== null && observed.fees < current.appliedFees)) throw new Error('Broker cumulative execution regressed');
      const addedQuantity = observed.quantity - current.appliedQuantity;
      const addedNotional = observed.notional - current.appliedNotional;
      if (!Number.isFinite(current.appliedNotional) || current.appliedNotional < 0
        || addedNotional < -1e-8
        || (addedQuantity === 0 && Math.abs(addedNotional) > 1e-8)
        || (addedQuantity > 0 && (addedNotional <= 0 || addedNotional > addedQuantity * current.sideLimitPrice + 1e-8))) {
        throw new Error('Broker cumulative purchase cost is inconsistent with incremental fills');
      }
      const same = observed.quantity === current.appliedQuantity && observed.notional === current.appliedNotional
        && (observed.fees ?? 0) === current.appliedFees;
      let tradeId = current.tradeId;
      if (observed.quantity > 0 && !same) {
        const data = { asset: 'POLYMARKET', market: 'prediction', type: current.side === 'YES' ? 'BUY' : 'SELL',
          entryPrice: observed.outcomePrice, quantity: observed.quantity, fees: observed.fees,
          status: 'OPEN', brokerConfirmed: true, brokerOrderId: current.brokerOrderId,
          accountId: current.credentialScopeKey, brokerMode: 'live',
          metadata: { venue: 'polymarket_us', paper: false, marketSlug: current.marketSlug, side: current.side,
            predictionId: current.predictionId, executionId: current.id, ownerId: current.ownerId, basisSource: 'BROKER_ORDER_AVERAGE' } };
        if (tradeId) {
          const prior = await tx.trade.findUnique({ where: { id: tradeId } });
          if (!prior || prior.status !== 'OPEN' || prior.accountId !== current.credentialScopeKey) throw new Error('Prediction fill ledger requires independent reconciliation');
          await tx.trade.update({ where: { id: tradeId }, data });
        } else tradeId = (await tx.trade.create({ data })).id;
      }
      const status = observed.terminal ? (observed.quantity === 0 ? 'TERMINAL_UNFILLED'
        : observed.quantity === current.quantity ? 'FILLED' : 'TERMINAL_PARTIAL') : observed.quantity > 0 ? 'PARTIALLY_FILLED' : 'SUBMITTED';
      await tx.predictionExecution.update({ where: { id }, data: { status, tradeId, brokerState: observed,
        appliedQuantity: observed.quantity, appliedNotional: observed.notional, appliedFees: observed.fees ?? 0,
        reservedUsd: observed.terminal ? 0 : current.reservedUsd, error: null } });
      if (!same || status !== current.status || (observed.terminal && current.reservedUsd !== 0)) {
        await advancePredictionGeneration(tx, scope.scopeKey);
      }
      return { reconciled: true, status, filledQuantity: observed.quantity };
    });
  } catch {
    await db.predictionExecution.updateMany({ where: { id, credentialScopeKey: scope.scopeKey },
      data: { status: 'RECONCILIATION_REQUIRED', error: 'Broker fill/commission evidence unavailable or inconsistent' } });
    return { reconciled: false, reason: 'Broker fill/commission evidence unavailable or inconsistent' };
  }
}

export async function reconcilePendingPredictionExecutions() {
  const scope = getPolymarketUSCredentialScope();
  const rows = await db.predictionExecution.findMany({ where: { credentialScopeKey: scope.scopeKey,
    status: { in: pendingStates }, brokerOrderId: { not: null } }, orderBy: { createdAt: 'asc' }, take: 50 });
  for (const row of rows) await reconcilePredictionExecution(row.id);
  return rows.length;
}

export async function executeLivePrediction(predictionId: string) {
  const readiness = await getPredictionLiveReadiness();
  if (!readiness.ready) return { placed: false, reason: readiness.reason };
  await reconcilePendingPredictionExecutions();
  const prediction = await db.polymarketPrediction.findUnique({ where: { id: predictionId } });
  const market = (await polymarketUSVenue.listMarkets(500)).find(m => m.id === prediction?.marketSlug);
  if (!market) return { placed: false, reason: 'Prediction market is not in the current exchange listing' };
  const generation = await readPredictionGeneration(db, readiness.scopeKey);
  const [book, snapshot, risk] = await Promise.all([polymarketUSVenue.getBook(market.id), getPolymarketUSExecutionSnapshot(),
    db.settings.findUnique({ where: { id: 'settings-1' } })]);
  if (!book || snapshot.scopeKey !== readiness.scopeKey || snapshot.identity !== readiness.identity) return { placed: false, reason: 'Prediction account or book authority changed' };
  let claim: any;
  try {
    const plan = planLivePrediction(prediction, market, book, snapshot, risk);
    claim = await db.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${snapshot.scopeKey}))`;
      await assertPredictionRecoveryScope(tx, readiness.ownerId, snapshot.scopeKey);
      if (Date.now() - snapshot.observedAt > 5000) throw new Error('Prediction account snapshot expired while claiming');
      if (await readPredictionGeneration(tx, snapshot.scopeKey) !== generation) throw new Error('Prediction snapshot predates an account mutation');
      const currentRisk = await tx.settings.findUnique({ where: { id: 'settings-1' } });
      if (predictionRiskPolicyHash(currentRisk) !== plan.riskPolicyHash) throw new Error('Prediction risk policy changed while claiming');
      const pending = await tx.predictionExecution.findFirst({ where: { credentialScopeKey: snapshot.scopeKey, status: { in: pendingStates } } });
      const held = await tx.predictionExecution.findFirst({ where: { credentialScopeKey: snapshot.scopeKey, marketSlug: market.id, status: { in: activeStates } } });
      if (pending || held) throw new Error('An existing prediction claim or holding owns this account/market');
      const pnl = await predictionDailyRealizedPnl(tx, snapshot.scopeKey);
      const exposure = predictionAccountExposure(snapshot);
      // Refuse a broker snapshot that has not yet reflected our confirmed fills.
      await assertPredictionFillsReflected(tx, snapshot);
      if (exposure.cost + plan.reservedUsd > snapshot.cash * risk.dailyLossLimitPct / 100 + Math.min(0, pnl) + 1e-8) throw new Error('Prediction daily risk/loss budget exhausted');
      const authorityGeneration = await advancePredictionGeneration(tx, snapshot.scopeKey);
      return tx.predictionExecution.create({ data: { claimKey: createHash('sha256').update(JSON.stringify([readiness.ownerId, snapshot.scopeKey, predictionId])).digest('hex'),
        ownerId: readiness.ownerId, credentialScopeKey: snapshot.scopeKey, credentialIdentity: snapshot.identity,
        predictionId, marketSlug: market.id, ...plan, planExpiresAt: new Date(Math.min(plan.planExpiresAt.getTime(), readiness.qualificationExpiresAt)),
        qualificationId: readiness.qualificationId, authorityGeneration, status: 'PREPARING' } });
    });
  } catch (error: any) { return { placed: false, reason: error?.code === 'P2002' ? 'Prediction already has an execution claim' : 'Prediction funds, risk or durable claim check failed' }; }
  try {
    const acknowledgement = await submitPolymarketUSExecution(claim.id);
    logger.info('prediction_order_acknowledged', { executionId: claim.id, brokerOrderId: acknowledgement.id, credentialScopeKey: claim.credentialScopeKey });
    await db.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claim.credentialScopeKey}))`;
      await tx.predictionExecution.update({ where: { id: claim.id }, data: { brokerOrderId: acknowledgement.id, status: 'SUBMITTED',
        executionReferences: acknowledgement.executionReferences ?? { status: 'UNPROVEN_PROVIDER_JOIN', references: [] } } });
      await advancePredictionGeneration(tx, claim.credentialScopeKey);
    });
    const observed = await reconcilePredictionExecution(claim.id);
    return { placed: true, kind: 'live-order', id: claim.id, brokerOrderId: acknowledgement.id, ...observed };
  } catch (error) {
    const refused = error instanceof PredictionSubmissionRefused;
    const safelyAborted = await db.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claim.credentialScopeKey}))`;
      const current = await tx.predictionExecution.findUnique({ where: { id: claim.id } });
      // This invocation's refusal does not prove that a different writer has
      // not already consumed/submitted the claim. Release only PREPARING.
      const abort = refused && current?.status === 'PREPARING';
      await tx.predictionExecution.updateMany({ where: { id: claim.id, status: { in: pendingStates } },
        data: { status: abort ? 'ABORTED' : 'RECONCILIATION_REQUIRED', ...(abort ? { reservedUsd: 0 } : {}),
          error: abort ? 'Authorization refused before POST' : 'Submission result uncertain; no automatic retry' } });
      await advancePredictionGeneration(tx, claim.credentialScopeKey);
      return abort;
    });
    return { placed: false, id: claim.id, reason: safelyAborted ? 'Authorization refused before POST' : 'Submission result uncertain; no automatic retry' };
  }
}
