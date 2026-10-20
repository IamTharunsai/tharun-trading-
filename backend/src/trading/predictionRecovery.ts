import { randomUUID } from 'crypto';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { getPolymarketUSCredentialScope, getPolymarketUSTradeActivities, cancelPolymarketUSOrder } from '../services/polymarketUS';
import { reconcilePredictionExecution } from './predictionExecution';
import { predictionPendingStates } from './predictionAuthority';
import { ensurePredictionRecoveryScope } from './predictionRecoveryScope';
import { candidateExecutionActivityJoin, parseStoredExecutionReferences } from './predictionActivityEvidence';

const db = prisma as any;
let running = false;
const log = (fields: Record<string, unknown>) => { try { logger.info('prediction_order_recovery', fields); } catch { /* observation only */ } };

/** Read/reconcile only. Deliberately independent of ENTRY readiness, flags,
 * strategy expiry and kill state. No submission or automatic cancel occurs. */
export async function recoverPredictionOrders() {
  if (running) return { outcome: 'ALREADY_RUNNING' as const, processed: 0, unresolved: 0 };
  running = true;
  let ownerId: string | null = null; const leaseId = randomUUID();
  let processed = 0; let unresolved = 0;
  try {
    const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
    const owner = email ? await db.user.findUnique({ where: { email }, select: { id: true, role: true } }) : null;
    if (!owner || owner.role !== 'OWNER') return { outcome: 'OWNER_UNAVAILABLE' as const, processed, unresolved };
    ownerId = owner.id;
    const scope = getPolymarketUSCredentialScope();
    const acquired = await db.$transaction(async (tx: any) => {
      const authority = await ensurePredictionRecoveryScope(tx, owner.id, scope.scopeKey);
      if (authority.state.leaseUntil && new Date(authority.state.leaseUntil).getTime() > Date.now()) return null;
      await tx.predictionRecoveryState.update({ where: { ownerId: owner.id }, data: {
        leaseId, leaseUntil: new Date(Date.now() + 60000), lastStartedAt: new Date(),
      } });
      return authority;
    });
    if (!acquired) return { outcome: 'LEASE_ACTIVE' as const, processed, unresolved };
    const baseWhere = { ownerId: owner.id, credentialScopeKey: scope.scopeKey, status: { in: predictionPendingStates } };
    let rows = await db.predictionExecution.findMany({ where: { ...baseWhere,
      ...(acquired.state.cursorId ? { id: { gt: acquired.state.cursorId } } : {}) }, orderBy: { id: 'asc' }, take: 20 });
    if (!rows.length && acquired.state.cursorId) rows = await db.predictionExecution.findMany({ where: baseWhere, orderBy: { id: 'asc' }, take: 20 });
    const startedAt = Date.now(); let cursorId = acquired.state.cursorId;
    const referenced: Array<{ id: string; refs: ReturnType<typeof parseStoredExecutionReferences> }> = [];
    for (const row of rows) {
      if (Date.now() - startedAt > 20000 || getPolymarketUSCredentialScope().identity !== scope.identity) break;
      cursorId = row.id; processed++;
      if (!row.brokerOrderId) {
        // PREPARING/SUBMITTING with no saved ACK is not proof no POST occurred.
        // Keep the reservation; never guess or create/retry an order here.
        unresolved++;
        await db.predictionExecution.updateMany({ where: { id: row.id, ownerId: owner.id,
          credentialScopeKey: scope.scopeKey, brokerOrderId: null, status: { in: predictionPendingStates } },
          data: { error: 'Order identity unavailable; no automatic resubmission' } });
        continue;
      }
      try {
        if (!(await reconcilePredictionExecution(row.id)).reconciled) unresolved++;
        const refs = parseStoredExecutionReferences(row.executionReferences?.references ?? []);
        if (refs.length) referenced.push({ id: row.id, refs });
      } catch { unresolved++; }
    }
    if (referenced.length && getPolymarketUSCredentialScope().identity === scope.identity) {
      try {
        const activities = await getPolymarketUSTradeActivities(scope.scopeKey);
        for (const row of referenced) {
          const candidate = candidateExecutionActivityJoin(row.refs, activities);
          await db.predictionExecution.updateMany({ where: { id: row.id, ownerId: owner.id, credentialScopeKey: scope.scopeKey },
            data: { activityEvidence: { ...candidate, observedAt: new Date().toISOString(), historicalCoverage: 'UNPROVEN',
              commissionSemantics: 'UNPROVEN', stableAccountIdentity: 'UNPROVEN' } } });
        }
      } catch { unresolved++; }
    }
    const otherGrantPending = await db.predictionExecution.count({ where: { ownerId: owner.id,
      credentialScopeKey: { not: scope.scopeKey }, status: { in: predictionPendingStates } } });
    const pendingCount = await db.predictionExecution.count({ where: { ownerId: owner.id, status: { in: predictionPendingStates } } });
    unresolved = Math.min(1000000, Math.max(unresolved, pendingCount));
    const outcome = !acquired.allowed || otherGrantPending ? 'GRANT_REVIEW_REQUIRED'
      : unresolved ? 'RECOVERY_INCOMPLETE' : processed ? 'KNOWN_ORDERS_OBSERVED' : 'NO_PENDING_ORDERS';
    await db.predictionRecoveryState.updateMany({ where: { ownerId: owner.id, leaseId }, data: {
      cursorId, lastFinishedAt: new Date(), lastOutcome: outcome, lastProcessed: processed,
      lastUnresolved: unresolved, leaseId: null, leaseUntil: null,
    } });
    log({ outcome, processed, unresolved, pendingCount, scope: 'API_GRANT', stableAccountIdentity: 'UNPROVEN', activityJoin: 'UNPROVEN_PROVIDER_JOIN' });
    return { outcome, processed, unresolved };
  } catch {
    log({ outcome: 'RECOVERY_UNAVAILABLE', processed, unresolved });
    return { outcome: 'RECOVERY_UNAVAILABLE' as const, processed, unresolved };
  } finally {
    if (ownerId) {
      try { await db.predictionRecoveryState.updateMany({ where: { ownerId, leaseId }, data: { leaseId: null, leaseUntil: null } }); } catch { /* lease expiry permits another process to recover */ }
    }
    running = false;
  }
}

/** Explicit reduction-only capability, not a route or an automatic cancellation
 * policy. Even an uncertain cancel is followed by the same strict order read. */
export async function cancelPredictionExecution(executionId: string) {
  const row = await db.predictionExecution.findUnique({ where: { id: executionId } });
  if (!row?.brokerOrderId) return { cancellation: 'ORDER_ID_UNAVAILABLE', reconciled: false };
  let cancellation: string;
  try { cancellation = await cancelPolymarketUSOrder(row.brokerOrderId, row.marketSlug, row.id); }
  catch { cancellation = 'UNCONFIRMED'; }
  return { cancellation, ...await reconcilePredictionExecution(row.id) };
}
