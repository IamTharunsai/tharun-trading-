import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { getPolymarketUSCredentialScope, getPolymarketUSExecutionSnapshot, getPolymarketUSMarket, polymarketUSVenue } from '../services/polymarketUS';
import { predictionPendingStates } from './predictionAuthority';
import { recoverPredictionOrders } from './predictionRecovery';
import { predictionReductionClaimKey, reducePredictionHolding } from './predictionReduction';
import { planPredictionHoldingReduction, readPredictionExitThresholds } from './predictionHoldingPolicy';

const db = prisma as any;
let running = false;
let observeScope = ''; let observeCursor: string | null = null;
type RowResult = { openingExecutionId: string; status: string; reason?: string; reductionId?: string; quantity?: number; sideMinPrice?: number };

/** Complete but deliberately unscheduled. OBSERVE never creates a claim,
 * holding, order or qualification. Internal callers must explicitly select
 * REDUCE to invoke actual reduction capability; no environment auto-detection. */
export async function runPredictionHoldingMaintenance(options: { mode?: 'OBSERVE' | 'REDUCE' } = {}) {
  const mode = z.enum(['OBSERVE', 'REDUCE']).parse(options.mode ?? 'OBSERVE');
  const report = { mode, outcome: 'NOT_OBSERVED', rows: [] as RowResult[], entryReadiness: 'NOT_CERTIFIED_BY_MAINTENANCE' as const,
    remainingEntryDependencies: ['SETTLEMENT_RECONCILIATION', 'ACCOUNT_WIDE_LOSS_COVERAGE', 'CURRENT_FINANCIAL_QUALIFICATION'] };
  if (running) return { ...report, outcome: 'ALREADY_RUNNING' };
  running = true;
  try {
    const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
    const owner = email ? await db.user.findUnique({ where: { email }, select: { id: true, role: true } }) : null;
    if (!owner || owner.role !== 'OWNER') return { ...report, outcome: 'OWNER_UNAVAILABLE' };
    const scope = getPolymarketUSCredentialScope();
    if (mode === 'REDUCE') {
      const recovery = await recoverPredictionOrders();
      if (['LEASE_ACTIVE', 'ALREADY_RUNNING', 'OWNER_UNAVAILABLE', 'RECOVERY_UNAVAILABLE'].includes(recovery.outcome)) {
        return { ...report, outcome: 'RECOVERY_NOT_READY' };
      }
    }
    const pending = await db.predictionExecution.count({ where: { credentialScopeKey: scope.scopeKey, status: { in: predictionPendingStates } } })
      + await db.predictionReduction.count({ where: { credentialScopeKey: scope.scopeKey, status: { in: predictionPendingStates } } });
    if (pending) return { ...report, outcome: 'RECONCILIATION_REQUIRED' };
    const thresholds = readPredictionExitThresholds();
    const observationScope = owner.id + ':' + scope.scopeKey;
    if (observeScope !== observationScope) { observeScope = observationScope; observeCursor = null; }
    const state = mode === 'REDUCE' ? await db.predictionRecoveryState.findUnique({ where: { ownerId: owner.id } }) : null;
    let cursor = mode === 'REDUCE' ? state?.holdingCursorId ?? null : observeCursor;
    const where = { ownerId: owner.id, credentialScopeKey: scope.scopeKey, status: { in: ['FILLED', 'TERMINAL_PARTIAL'] },
      OR: [{ holding: { is: null } }, { holding: { is: { remainingQuantity: { not: 0 } } } }] };
    const query = (after: string | null) => db.predictionExecution.findMany({ where: { ...where, ...(after ? { id: { gt: after } } : {}) },
      include: { holding: true, prediction: true, trade: true }, orderBy: { id: 'asc' }, take: 20 });
    let openings = await query(cursor);
    if (!openings.length && cursor) openings = await query(null);
    if (!openings.length) return { ...report, outcome: 'NO_ACTUAL_HOLDINGS' };
    const started = Date.now();
    for (const opening of openings) {
      if (Date.now() - started > 20000) { report.outcome = 'BATCH_DEADLINE'; break; }
      const item: RowResult = { openingExecutionId: opening.id, status: 'BLOCKED' };
      report.rows.push(item);
      cursor = opening.id;
      try {
        const trade = opening.trade, h = opening.holding;
        if (!opening.brokerOrderId || !['YES', 'NO'].includes(opening.side) || !Number.isFinite(opening.appliedQuantity) || opening.appliedQuantity <= 0
          || !Number.isFinite(opening.appliedNotional) || opening.appliedNotional <= 0 || !Number.isFinite(opening.appliedFees) || opening.appliedFees < 0
          || !trade || trade.status !== 'OPEN' || trade.asset !== 'POLYMARKET' || trade.market !== 'prediction'
          || trade.type !== (opening.side === 'YES' ? 'BUY' : 'SELL') || trade.brokerMode !== 'live' || trade.brokerConfirmed !== true
          || trade.accountId !== scope.scopeKey || trade.metadata?.paper !== false || trade.metadata?.venue !== 'polymarket_us'
          || trade.quantity !== opening.appliedQuantity || trade.fees !== opening.appliedFees
          || Math.abs(trade.entryPrice * trade.quantity - opening.appliedNotional) > 1e-8) throw new Error('OPENING_BASIS_UNCONFIRMED');
        if (h && (h.ownerId !== owner.id || h.credentialScopeKey !== scope.scopeKey || h.marketSlug !== opening.marketSlug || h.side !== opening.side
          || h.openingQuantity !== opening.appliedQuantity || h.openingNotional !== opening.appliedNotional || h.openingFees !== opening.appliedFees
          || h.openingQualificationId !== opening.qualificationId || !Number.isFinite(h.remainingQuantity) || h.remainingQuantity < 0
          || h.realizedPnl === null)) throw new Error('HOLDING_ACCOUNTING_UNRECONCILED');
        const remaining = h ? h.remainingQuantity : opening.appliedQuantity;
        if (remaining === 0) { item.status = 'CLOSED_BY_LINKED_ORDERS'; continue; }
        const market = await getPolymarketUSMarket(opening.marketSlug);
        if (!market) throw new Error('MARKET_OR_SETTLEMENT_UNAVAILABLE');
        const forecast = await db.polymarketPrediction.findFirst({ where: { venue: 'polymarket_us', marketSlug: opening.marketSlug },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        const snapshot = await getPolymarketUSExecutionSnapshot(), book = await polymarketUSVenue.getBook(opening.marketSlug);
        if (!book) throw new Error('BOOK_UNAVAILABLE');
        if (snapshot.identity !== scope.identity || getPolymarketUSCredentialScope().identity !== scope.identity) throw new Error('GRANT_CHANGED');
        const plan = planPredictionHoldingReduction({ holding: { openingExecutionId: opening.id, credentialScopeKey: scope.scopeKey,
          marketSlug: opening.marketSlug, side: opening.side, remainingQuantity: remaining,
          openingQuantity: opening.appliedQuantity, openingNotional: opening.appliedNotional },
          snapshot, market, book, forecast, entryForecast: opening.prediction, thresholds });
        item.status = plan.status; item.reason = plan.reason;
        if (plan.status !== 'REDUCTION_READY') continue;
        const prior = await db.predictionReduction.findUnique({ where: { claimKey: predictionReductionClaimKey(owner.id, scope.scopeKey, opening.id, plan.requestKey) } });
        if (prior) { item.status = 'DECISION_ALREADY_RECORDED'; item.reductionId = prior.id; continue; }
        item.quantity = plan.quantity; item.sideMinPrice = plan.sideMinPrice;
        if (mode === 'OBSERVE') continue;
        const result = await reducePredictionHolding(opening.id, { requestKey: plan.requestKey, quantity: plan.quantity,
          sideMinPrice: plan.sideMinPrice, policyEvidence: plan.policyEvidence });
        item.reductionId = result.id;
        const persisted = await db.predictionReduction.findUnique({ where: { id: result.id } });
        item.status = persisted?.status === 'ABORTED' ? 'REDUCTION_REFUSED'
          : result.reconciled ? 'REDUCTION_OBSERVED' : 'REDUCTION_RECONCILIATION_REQUIRED';
        // One pending mutation owns the account; do not plan subsequent sales
        // using a snapshot which predates it or unknown commission.
        if (persisted && predictionPendingStates.includes(persisted.status)) break;
      } catch (error) {
        item.status = 'BLOCKED'; item.reason = error instanceof Error ? error.message : 'MAINTENANCE_UNAVAILABLE';
      }
    }
    if (mode === 'REDUCE') await db.predictionRecoveryState.updateMany({ where: { ownerId: owner.id }, data: { holdingCursorId: cursor } });
    else observeCursor = cursor;
    if (report.outcome === 'NOT_OBSERVED') report.outcome = mode === 'OBSERVE' ? 'OBSERVATION_ONLY' : 'MAINTENANCE_OBSERVED';
    return report;
  } catch {
    return { ...report, outcome: 'MAINTENANCE_UNAVAILABLE' };
  } finally { running = false; }
}
