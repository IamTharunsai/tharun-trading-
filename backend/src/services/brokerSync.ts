import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { AccountScope, getVerifiedAccountScope, positionScopeKey } from '../trading/accountScope';
import { reconcileExecutionIntents } from '../trading/executionEngine';
import { reconcilePositionExits, requestPositionExit } from '../trading/positionExits';

export interface BrokerSyncResult { imported: string[]; updated: string[]; closed: string[]; unresolved?: string[]; skipped?: string; }
let lastResult: BrokerSyncResult & { at?: string } = { imported: [], updated: [], closed: [] };
export function getLastBrokerSync() { return lastResult; }

/** Broker observations never create guessed fills or realized profit. */
export async function syncBrokerPositions(suppliedScope?: AccountScope): Promise<BrokerSyncResult> {
  let scope: AccountScope;
  let observations: any[];
  try {
    scope = suppliedScope ?? await getVerifiedAccountScope();
    await reconcileExecutionIntents(scope);
    await reconcilePositionExits(scope);
    observations = await scope.broker.listPositionsVerified();
  } catch (error: any) {
    return lastResult = { imported: [], updated: [], closed: [], skipped: `broker evidence unavailable: ${error?.message}` };
  }
  const result: BrokerSyncResult = { imported: [], updated: [], closed: [], unresolved: [] };
  const held = new Map<string, any>();
  for (const observation of observations) {
    if (!['us_equity', 'crypto'].includes(observation.asset_class)) {
      return lastResult = { ...result, skipped: `unsupported broker asset class: ${observation.asset_class}` };
    }
    const market = observation.asset_class === 'crypto' ? 'crypto' : 'stocks';
    const asset = market === 'crypto' ? String(observation.symbol).replace(/\/?USD$/, '') : String(observation.symbol);
    const quantity = Math.abs(Number(observation.qty));
    const entryPrice = Number(observation.avg_entry_price);
    const currentPrice = Number(observation.current_price);
    if (!asset || ![quantity, entryPrice, currentPrice].every(value => Number.isFinite(value) && value > 0)
      || !['long', 'short'].includes(observation.side)) {
      return lastResult = { ...result, skipped: 'invalid broker holding evidence; no absence reconciliation performed' };
    }
    held.set(asset, { asset, market, quantity, entryPrice, currentPrice, side: observation.side === 'short' ? 'SELL' : 'BUY',
      unrealizedPnl: Number(observation.unrealized_pl), brokerPositionId: observation.asset_id });
  }
  const dbOpen = await prisma.position.findMany({ where: { accountId: scope.accountId, brokerMode: scope.mode, status: 'OPEN' } });
  for (const [asset, observation] of held) {
    const scopeKey = positionScopeKey(scope.accountId, scope.mode, asset);
    const pending = await prisma.executionIntent.findFirst({ where: { asset, accountId: scope.accountId, mode: scope.mode,
      status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'] } } });
    const existing = await prisma.position.findUnique({ where: { scopeKey } });
    const plan = pending?.executionPlan as any;
    const fields = {
      ...observation, accountId: scope.accountId, brokerMode: scope.mode, status: 'OPEN',
      brokerObservedQuantity: observation.quantity,
      unrealizedPnl: Number.isFinite(observation.unrealizedPnl) ? observation.unrealizedPnl : 0,
      unrealizedPnlPct: (observation.currentPrice - observation.entryPrice) / observation.entryPrice * 100 * (observation.side === 'SELL' ? -1 : 1),
      pendingEntryIntentId: pending?.id ?? null,
    };
    const position = await prisma.position.upsert({ where: { scopeKey },
      create: { scopeKey, ...fields, stopLossPrice: plan?.stopLossPrice ?? 0, takeProfitPrice: plan?.takeProfitPrice ?? 0,
        protectionStatus: pending ? 'ENTRY_RECONCILIATION_PENDING' : 'UNVERIFIED_PROTECTION' },
      update: { ...fields, ...(existing?.status === 'CLOSED' ? { openedAt: new Date() } : {}),
        ...(pending ? { protectionStatus: 'ENTRY_RECONCILIATION_PENDING' } : {}) },
    });
    if (!pending) {
      const trade = await prisma.trade.findFirst({ where: { positionId: position.id, status: 'OPEN', accountId: scope.accountId, brokerMode: scope.mode } });
      if (!trade) await prisma.trade.create({ data: { positionId: position.id, accountId: scope.accountId, brokerMode: scope.mode,
        asset, market: observation.market, type: observation.side as any, entryPrice: observation.entryPrice,
        quantity: observation.quantity, status: 'OPEN', brokerConfirmed: true,
        reconciliationStatus: 'IMPORTED_HOLDING_COST_BASIS', metadata: { source: 'verifiedBrokerHolding', historyAvailable: false } } });
    }
    (existing?.status === 'OPEN' ? result.updated : result.imported).push(asset);
  }
  for (const position of dbOpen) {
    if (held.has(position.asset)) continue;
    const exit = await requestPositionExit(position.id, 'BROKER_PROTECTION_RECONCILIATION', scope);
    if (exit.closed) result.closed.push(position.asset);
    else {
      result.unresolved!.push(position.asset);
      await prisma.position.update({ where: { id: position.id }, data: {
        brokerObservedQuantity: 0, protectionStatus: 'EXIT_EVIDENCE_REQUIRED',
      } });
    }
  }
  lastResult = { ...result, at: new Date().toISOString() };
  logger.info('Broker holdings reconciled', { accountId: scope.accountId, mode: scope.mode, result });
  return result;
}
