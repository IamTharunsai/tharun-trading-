import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { AccountScope, getVerifiedAccountScope, positionScopeKey } from '../trading/accountScope';
import { reconcileExecutionIntents } from '../trading/executionEngine';
import { reconcilePositionExits, verifyPositionInventory } from '../trading/positionExits';
import { markAccountingUnknown, reconcileProtectionEvidence, retainBrokerActivities } from '../trading/brokerEvidence';
import { operatingError } from '../trading/operatingDiagnostics';

export interface BrokerSyncResult { imported: string[]; updated: string[]; closed: string[]; unresolved?: string[]; skipped?: string; activityEvidence?: string; }
let lastResult: BrokerSyncResult & { at?: string } = { imported: [], updated: [], closed: [] };
export function getLastBrokerSync() { return lastResult; }

/** Observations never replace execution inventory or immutable entry evidence. */
export async function syncBrokerPositions(suppliedScope?: AccountScope): Promise<BrokerSyncResult> {
  let scope: AccountScope;
  let observations: Awaited<ReturnType<AccountScope['broker']['listPositionsVerified']>>;
  try {
    scope = suppliedScope ?? await getVerifiedAccountScope();
    await reconcileExecutionIntents(scope);
    await reconcilePositionExits(scope);
    observations = await scope.broker.listPositionsVerified();
  } catch {
    return lastResult = { imported: [], updated: [], closed: [], skipped: 'Broker account evidence unavailable' };
  }
  const result: BrokerSyncResult = { imported: [], updated: [], closed: [], unresolved: [] };
  let activityFailureReason: string | null = null;
  const unresolvedReasonCounts: Record<string, number> = {};
  const held = new Map<string, { asset: string; market: string; quantity: number; entryPrice: number; currentPrice: number; side: string; brokerPositionId: string }>();
  for (const observation of observations) {
    if (!['us_equity', 'crypto'].includes(observation.asset_class)) return lastResult = { ...result, skipped: 'Unsupported broker asset class' };
    const market = observation.asset_class === 'crypto' ? 'crypto' : 'stocks';
    const asset = market === 'crypto' ? observation.symbol.replace(/\/?USD$/, '') : observation.symbol;
    const quantity = Math.abs(Number(observation.qty));
    const entryPrice = Number(observation.avg_entry_price);
    const currentPrice = Number(observation.current_price);
    if (!asset || ![quantity, entryPrice, currentPrice].every(value => Number.isFinite(value) && value > 0)
      || !['long', 'short'].includes(observation.side) || held.has(asset)) return lastResult = { ...result, skipped: 'Invalid or duplicate broker holding evidence' };
    held.set(asset, { asset, market, quantity, entryPrice, currentPrice, side: observation.side === 'short' ? 'SELL' : 'BUY', brokerPositionId: observation.asset_id });
  }
  // Overlap creation-time scans for delayed fees. This bounded scan is explicitly
  // not proof of complete historical activity or fee finality.
  try {
    await retainBrokerActivities(scope, await scope.broker.listActivitiesVerified(new Date(Date.now() - 30 * 86400000).toISOString(), new Date().toISOString()));
    result.activityEvidence = 'RECENT_ACTIVITY_RETAINED_HISTORY_NOT_CERTIFIED';
  } catch (error) { result.activityEvidence = 'ACTIVITY_EVIDENCE_UNAVAILABLE'; activityFailureReason = operatingError(error); }
  const dbOpen = await prisma.position.findMany({ where: { accountId: scope.accountId, brokerMode: scope.mode, status: 'OPEN' } });
  const positionIds = new Set(dbOpen.map(position => position.id));
  for (const [asset, observation] of held) {
    const scopeKey = positionScopeKey(scope.accountId, scope.mode, asset);
    await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeKey}))`;
    const pending = await tx.executionIntent.findFirst({ where: { asset, accountId: scope.accountId, mode: scope.mode,
      status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'] } } });
    let existing = await tx.position.findUnique({ where: { scopeKey } });
    const plan = pending?.executionPlan as { stopLossPrice?: number; takeProfitPrice?: number } | undefined;
    const observed = { brokerObservedQuantity: observation.quantity, brokerObservedEntryPrice: observation.entryPrice,
      brokerObservedAt: new Date(), brokerPositionId: observation.brokerPositionId, currentPrice: observation.currentPrice };
    const precedingClosedPositionId = existing?.status === 'CLOSED' ? existing.id : null;
    if (precedingClosedPositionId) {
      // Preserve the closed historical row and its Trade relations. The scope
      // key selects the current position; a fresh observed opening balance must
      // be OPEN and visible to exposure/risk/research/exit consumers.
      await tx.position.update({ where: { id: precedingClosedPositionId }, data: { scopeKey: null } });
      existing = null;
    }
    const openingBalance = !existing || existing.status === 'CLOSED';
    const position = await tx.position.upsert({ where: { scopeKey }, create: { scopeKey,
      accountId: scope.accountId, brokerMode: scope.mode, asset, market: observation.market, side: observation.side,
      entryPrice: observation.entryPrice, quantity: pending ? 0 : observation.quantity,
      ...observed, status: 'OPEN', pendingEntryIntentId: pending?.id ?? null,
      stopLossPrice: plan?.stopLossPrice ?? 0, takeProfitPrice: plan?.takeProfitPrice ?? 0,
      protectionStatus: pending ? 'ENTRY_RECONCILIATION_PENDING' : 'UNVERIFIED_PROTECTION',
    }, update: { ...observed, pendingEntryIntentId: pending?.id ?? null,
      ...(openingBalance ? { status: 'OPEN', openedAt: new Date(), side: observation.side,
        entryPrice: observation.entryPrice, quantity: pending ? 0 : observation.quantity,
        accountingStatus: 'UNVERIFIED', accountingError: null, evidenceVersion: { increment: 1 } } : {}),
    } });
    positionIds.add(position.id);
    if (openingBalance && !pending) {
      await tx.trade.create({ data: { positionId: position.id, accountId: scope.accountId, brokerMode: scope.mode,
        asset, market: observation.market, type: observation.side as 'BUY' | 'SELL', entryPrice: observation.entryPrice,
        quantity: observation.quantity, status: 'OPEN', brokerConfirmed: false,
        reconciliationStatus: 'IMPORTED_OPENING_BALANCE', metadata: { source: 'verifiedBrokerHolding', historyAvailable: false,
          openingBalanceOnly: true, precedingClosedPositionId } } });
    }
    (openingBalance ? result.imported : result.updated).push(asset);
    });
  }
  // Never submit an order from an absent holding. Apply only actual known order
  // evidence; a flat account with unknown exits remains explicitly incomplete.
  for (const positionId of positionIds) {
    const position = await prisma.position.findUniqueOrThrow({ where: { id: positionId } });
    try {
      await reconcileProtectionEvidence(scope, positionId);
      const verified = await verifyPositionInventory(positionId, scope);
      if (verified.quantity === 0) result.closed.push(position.asset);
    } catch (error: any) {
      const reason = operatingError(error);
      unresolvedReasonCounts[reason] = Math.min(1000000, (unresolvedReasonCounts[reason] ?? 0) + 1);
      result.unresolved!.push(position.asset);
      await markAccountingUnknown(positionId, error?.message || 'BROKER_EVIDENCE_UNAVAILABLE');
    }
  }
  lastResult = { ...result, at: new Date().toISOString() };
  logger.info('broker_reconciliation_observed', { mode: scope.mode, unresolved: Math.min(1000000, result.unresolved?.length ?? 0),
    activityEvidence: result.activityEvidence, activityFailureReason, unresolvedReasonCounts });
  return lastResult;
}
