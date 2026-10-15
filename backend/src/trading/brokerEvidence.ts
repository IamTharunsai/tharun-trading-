import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { AccountScope, brokerSymbol, positionScopeKey } from './accountScope';
import type { AlpacaOrder, AlpacaActivity } from '../services/alpacaBroker';

export const QUANTITY_EPS = 1e-9;
// `stopped` guarantees a trade that has not yet happened. `replaced` needs its
// successor resolved. Neither permits another closing submission.
export const FINAL_ORDER_STATES = new Set(['filled', 'canceled', 'expired', 'rejected']);
const jsonEvidence = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const normalize = (symbol: string) => symbol.replace('/', '').toUpperCase();
export const remainingLotQuantity = (trade: { quantity: number; closedQuantity: number; feeQuantity?: number }) =>
  trade.quantity - trade.closedQuantity - (trade.feeQuantity ?? 0);

export function incrementalFill(order: Pick<AlpacaOrder, 'filled_qty' | 'filled_avg_price'>, appliedQty: number, appliedNotional: number) {
  const quantity = Number(order.filled_qty);
  const price = Number(order.filled_avg_price);
  if (!Number.isFinite(quantity) || quantity < 0 || (quantity > 0 && (!Number.isFinite(price) || price <= 0))) throw new Error('INVALID_BROKER_FILL');
  if (quantity < appliedQty - QUANTITY_EPS) return null; // older observation
  const notional = quantity === 0 ? 0 : quantity * price;
  const deltaQuantity = quantity - appliedQty;
  const deltaNotional = notional - appliedNotional;
  if (Math.abs(deltaQuantity) <= QUANTITY_EPS && Math.abs(deltaNotional) > 1e-7) throw new Error('BROKER_FILL_CORRECTION_REQUIRES_RECONCILIATION');
  if (deltaQuantity > QUANTITY_EPS && !(deltaNotional > 0)) throw new Error('INVALID_INCREMENTAL_BROKER_NOTIONAL');
  return { quantity, notional, deltaQuantity, deltaNotional };
}

export async function markAccountingUnknown(positionId: string, reason: string) {
  await prisma.position.update({ where: { id: positionId }, data: {
    accountingStatus: 'RECONCILIATION_REQUIRED', accountingError: reason,
  } });
}

/** One application path for cumulative exit evidence, whether discovered via a
 * known protection parent or an application exit. No order submission here. */
export async function applyBrokerExitEvidence(scope: AccountScope, positionId: string, order: AlpacaOrder,
  source: 'APPLICATION_EXIT' | 'PROTECTION_LEG', parentOrderId?: string) {
  return prisma.$transaction(async tx => {
    const initial = await tx.position.findUniqueOrThrow({ where: { id: positionId } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${positionScopeKey(scope.accountId, scope.mode, initial.asset)}))`;
    const position = await tx.position.findUniqueOrThrow({ where: { id: positionId } });
    if (position.accountId !== scope.accountId || position.brokerMode !== scope.mode
      || normalize(order.symbol) !== normalize(brokerSymbol(position.asset, position.market))
      || order.side !== (position.side === 'SELL' ? 'buy' : 'sell') || !order.id
      || (source === 'PROTECTION_LEG' && !parentOrderId)) throw new Error('BROKER_EXIT_IDENTITY_MISMATCH');
    const key = { accountId: scope.accountId, brokerMode: scope.mode, brokerOrderId: order.id };
    // Legacy proof is a one-time bootstrap. Once persisted, this cursor is the
    // authority: observeExit subsequently stores a chain array on PositionExit.
    const existingCursor = await tx.brokerOrderEvidence.findUnique({ where: { accountId_brokerMode_brokerOrderId: key } });
    let seedQuantity = 0; let seedNotional = 0; let allocationComplete = true;
    if (!existingCursor) {
      const legacy = await tx.positionExit.findMany({ where: { positionId, accountId: scope.accountId, brokerMode: scope.mode,
        brokerOrderId: order.id, appliedQuantity: { gt: 0 } } });
      if (legacy.length > 1) throw new Error('LEGACY_EXIT_EVIDENCE_AMBIGUOUS');
      const prior = legacy[0];
      if (prior) {
        const saved = prior.brokerEvidence as unknown as AlpacaOrder | null;
        if (!saved || saved.id !== order.id || Number(saved.filled_qty) !== prior.appliedQuantity
          || Math.abs(Number(saved.filled_qty) * Number(saved.filled_avg_price) - prior.appliedNotional) > 1e-7) throw new Error('LEGACY_EXIT_EVIDENCE_UNVERIFIED');
        seedQuantity = prior.appliedQuantity; seedNotional = prior.appliedNotional; allocationComplete = false;
      }
    }
    const cursor = existingCursor ?? await tx.brokerOrderEvidence.upsert({ where: { accountId_brokerMode_brokerOrderId: key },
      create: { ...key, positionId, positionCycleAt: position.openedAt, symbol: order.symbol, side: order.side,
        source, parentOrderId, status: order.status, evidence: jsonEvidence(order),
        appliedQuantity: new Prisma.Decimal(String(seedQuantity)),
        appliedNotional: new Prisma.Decimal(String(seedNotional)), allocationComplete }, update: {} });
    if (cursor.positionId !== positionId || cursor.positionCycleAt.getTime() !== position.openedAt.getTime()) throw new Error('BROKER_ORDER_POSITION_CYCLE_MISMATCH');
    const fill = incrementalFill(order, Number(cursor.appliedQuantity), Number(cursor.appliedNotional));
    if (!fill) return { applied: false, positionClosed: position.status === 'CLOSED', pnl: 0 };
    const lots = await tx.trade.findMany({ where: { positionId, accountId: scope.accountId, brokerMode: scope.mode, status: 'OPEN' },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }] });
    const outstanding = lots.reduce((sum, lot) => sum + remainingLotQuantity(lot), 0);
    let remainingBasis = lots.reduce((sum, lot) => sum + remainingLotQuantity(lot) * lot.entryPrice, 0);
    if (fill.deltaQuantity > outstanding + QUANTITY_EPS) throw new Error('BROKER_EXIT_EXCEEDS_VERIFIED_LOTS');
    let toAllocate = fill.deltaQuantity;
    let pnl = 0;
    if (toAllocate > QUANTITY_EPS) {
      const deltaPrice = fill.deltaNotional / fill.deltaQuantity;
      for (const lot of lots) {
        if (toAllocate <= QUANTITY_EPS) break;
        const allocated = Math.min(toAllocate, remainingLotQuantity(lot));
        if (!(allocated > 0) || lot.type !== position.side) throw new Error('INVALID_BROKER_EXIT_LOT');
        const gross = (deltaPrice - lot.entryPrice) * allocated * (lot.type === 'SELL' ? -1 : 1);
        const net = gross - lot.fees * allocated / lot.quantity;
        const closedQuantity = lot.closedQuantity + allocated;
        const realizedPnl = lot.realizedPnl + net;
        const exitNotional = lot.exitNotional + allocated * deltaPrice;
        const closed = remainingLotQuantity({ ...lot, closedQuantity }) <= QUANTITY_EPS;
        const occurred = order.filled_at ? new Date(order.filled_at) : null;
        await tx.trade.update({ where: { id: lot.id }, data: { closedQuantity, realizedPnl, exitNotional,
          ...(closed ? { status: 'CLOSED', pnl: realizedPnl, pnlPct: realizedPnl / (lot.entryPrice * lot.quantity) * 100,
            exitPrice: exitNotional / closedQuantity, closedAt: occurred && Number.isFinite(occurred.getTime()) ? occurred : new Date(),
            unrealizedPnl: 0, unrealizedPnlPct: 0, exitReason: source === 'PROTECTION_LEG' ? 'BROKER_PROTECTION' : 'BROKER_EXIT' } : {}),
          reconciliationStatus: closed ? 'BROKER_EXIT_CONFIRMED' : 'BROKER_PARTIAL_EXIT' } });
        await tx.brokerFillAllocation.upsert({ where: { orderEvidenceId_tradeId: { orderEvidenceId: cursor.id, tradeId: lot.id } },
          create: { orderEvidenceId: cursor.id, tradeId: lot.id, quantity: new Prisma.Decimal(String(allocated)),
            notional: new Prisma.Decimal(String(allocated * deltaPrice)) },
          update: { quantity: { increment: new Prisma.Decimal(String(allocated)) }, notional: { increment: new Prisma.Decimal(String(allocated * deltaPrice)) } } });
        toAllocate -= allocated; pnl += net; remainingBasis -= lot.entryPrice * allocated;
      }
    }
    const remaining = Math.max(0, outstanding - fill.deltaQuantity);
    await tx.position.update({ where: { id: positionId }, data: { quantity: remaining,
      ...(remaining > QUANTITY_EPS ? { entryPrice: remainingBasis / remaining } : {}),
      // Flat inventory is not a confirmed closed lifecycle while another leg or
      // replacement may still execute. verifyPositionInventory closes it later.
      status: 'OPEN', evidenceVersion: { increment: fill.deltaQuantity > QUANTITY_EPS ? 1 : 0 },
      ...(fill.deltaQuantity > QUANTITY_EPS ? { accountingStatus: 'RECONCILING', accountingError: 'AWAITING_BROKER_INVENTORY_CONFIRMATION' } : {}),
      ...(remaining <= QUANTITY_EPS ? { unrealizedPnl: 0, unrealizedPnlPct: 0 } : {}),
    } });
    await tx.brokerOrderEvidence.update({ where: { id: cursor.id }, data: { status: order.status,
      appliedQuantity: new Prisma.Decimal(String(fill.quantity)), appliedNotional: new Prisma.Decimal(String(fill.notional)),
      evidence: jsonEvidence(order), observedAt: new Date() } });
    return { applied: fill.deltaQuantity > QUANTITY_EPS, positionClosed: remaining <= QUANTITY_EPS, pnl };
  });
}

/** Follow actual known replacement links. A missing successor never releases an
 * order claim. All network reads finish before the accounting transaction. */
export async function readOrderChain(scope: AccountScope, orderId: string): Promise<AlpacaOrder[]> {
  const chain: AlpacaOrder[] = [];
  const seen = new Set<string>();
  let id: string | null = orderId;
  while (id) {
    if (seen.has(id) || chain.length >= 20) throw new Error('INVALID_BROKER_REPLACEMENT_CHAIN');
    seen.add(id);
    const order: AlpacaOrder | null = await scope.broker.getOrderVerified(id);
    if (!order || order.id !== id) throw new Error('BROKER_ORDER_EVIDENCE_UNAVAILABLE');
    if (chain.length && order.replaces !== chain[chain.length - 1].id) throw new Error('BROKER_REPLACEMENT_IDENTITY_MISMATCH');
    chain.push(order);
    if (order.status === 'replaced' && !order.replaced_by) throw new Error('BROKER_REPLACEMENT_UNAVAILABLE');
    id = order.replaced_by || null;
  }
  if (chain.length === 1) return chain;
  // Replacement counters can carry older fills. Only distinct, explicitly
  // order-linked FILL activities establish each replacement's own executions.
  const reconciled: AlpacaOrder[] = [];
  for (const order of chain) {
    const created = new Date(order.created_at);
    if (!Number.isFinite(created.getTime())) throw new Error('REPLACEMENT_ACTIVITY_INTERVAL_UNAVAILABLE');
    const activities = await scope.broker.listActivitiesVerified(new Date(created.getTime() - 86400000).toISOString(), new Date().toISOString(), 20, order.id);
    let quantity = 0; let notional = 0;
    for (const activity of activities.filter(a => a.activity_type === 'FILL')) {
      const qty = Number(activity.qty); const price = Number(activity.price);
      if (activity.order_id !== order.id || (activity.side !== undefined && activity.side !== order.side)
        || !activity.symbol || normalize(activity.symbol) !== normalize(order.symbol)
        || !(Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0)) throw new Error('REPLACEMENT_FILL_ACTIVITY_INVALID');
      quantity += qty; notional += qty * price;
    }
    if (Number(order.filled_qty) > 0 && quantity === 0) throw new Error('REPLACEMENT_FILL_ACTIVITIES_PENDING');
    reconciled.push({ ...order, filled_qty: quantity, filled_avg_price: quantity ? notional / quantity : 0,
      broker_cumulative_snapshot: order, reconciliation_activity_evidence: activities } as AlpacaOrder);
  }
  return reconciled;
}

/** Read every known entry parent's actual children, even when the holding still
 * exists. No inferred price, execution or fee is obtained from a holding. */
export async function reconcileProtectionEvidence(scope: AccountScope, positionId: string) {
  const position = await prisma.position.findUniqueOrThrow({ where: { id: positionId } });
  if (position.accountId !== scope.accountId || position.brokerMode !== scope.mode) throw new Error('POSITION_ACCOUNT_UNVERIFIED');
  const trades = await prisma.trade.findMany({ where: { positionId, accountId: scope.accountId, brokerMode: scope.mode,
    openedAt: { gte: position.openedAt }, brokerOrderId: { not: null } } });
  const seen = new Set<string>();
  for (const trade of trades) {
    const parents = await readOrderChain(scope, trade.brokerOrderId!);
    for (const parent of parents) {
      if (normalize(parent.symbol) !== normalize(brokerSymbol(position.asset, position.market))
        || parent.side !== (trade.type === 'BUY' ? 'buy' : 'sell')) throw new Error('BROKER_PARENT_IDENTITY_MISMATCH');
      for (const leg of parent.legs ?? []) {
        if (seen.has(leg.id)) continue;
        seen.add(leg.id);
        for (const state of await readOrderChain(scope, leg.id)) {
          await applyBrokerExitEvidence(scope, positionId, state, 'PROTECTION_LEG', parent.id);
        }
      }
    }
  }
}

/** Keep non-fill activities as independent provenance. FILL activities are
 * corroboration only: order cumulative deltas are the inventory application path.
 * Fees lacking a documented order identity are never assigned to a guessed lot. */
export async function retainBrokerActivities(scope: AccountScope, activities: AlpacaActivity[]) {
  for (const activity of activities) {
    const when = activity.transaction_time ?? activity.date;
    const effectiveAt = when ? new Date(when) : null;
    if (!activity.id || !activity.activity_type || (effectiveAt && !Number.isFinite(effectiveAt.getTime()))) throw new Error('INVALID_BROKER_ACTIVITY');
    const quantity = activity.qty == null ? null : new Prisma.Decimal(activity.qty);
    const cashAmount = activity.net_amount == null ? null : new Prisma.Decimal(activity.net_amount);
    if ((quantity && !quantity.isFinite()) || (cashAmount && !cashAmount.isFinite())) throw new Error('INVALID_BROKER_ACTIVITY_AMOUNT');
    const key = { accountId: scope.accountId, brokerMode: scope.mode, brokerActivityId: activity.id };
    const retained = await prisma.brokerActivity.upsert({ where: { accountId_brokerMode_brokerActivityId: key }, create: {
      ...key, activityType: activity.activity_type, brokerOrderId: activity.order_id, symbol: activity.symbol,
      currency: activity.currency, quantity, cashAmount, effectiveAt, dateOnly: !activity.transaction_time,
      evidence: jsonEvidence(activity), attributionStatus: activity.activity_type === 'FILL' ? 'CORROBORATION_ONLY' : 'UNATTRIBUTED',
    }, update: {} });
    if (JSON.stringify(retained.evidence) !== JSON.stringify(activity)) {
      await prisma.brokerActivity.update({ where: { id: retained.id }, data: { attributionStatus: 'CORRECTION_REQUIRED' } });
      continue;
    }
    if (['FEE', 'CFEE'].includes(activity.activity_type)) await applyLinkedFee(scope, activity);
  }
}

async function applyLinkedFee(scope: AccountScope, activity: AlpacaActivity) {
  // A currently unique local lot does not prove historical linkage.
  if (!activity.order_id) return;
  const entryLots = await prisma.trade.findMany({ where: { accountId: scope.accountId, brokerMode: scope.mode, brokerOrderId: activity.order_id } });
  const cursor = await prisma.brokerOrderEvidence.findUnique({ where: { accountId_brokerMode_brokerOrderId: {
    accountId: scope.accountId, brokerMode: scope.mode, brokerOrderId: activity.order_id } } });
  const positionId = entryLots.length === 1 ? entryLots[0].positionId : cursor?.positionId;
  if (!positionId) return;
  await prisma.$transaction(async tx => {
    const position = await tx.position.findUniqueOrThrow({ where: { id: positionId } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${positionScopeKey(scope.accountId, scope.mode, position.asset)}))`;
    const retained = await tx.brokerActivity.findUniqueOrThrow({ where: { accountId_brokerMode_brokerActivityId: {
      accountId: scope.accountId, brokerMode: scope.mode, brokerActivityId: activity.id } } });
    if (retained.appliedAt) return;
    let allocations: { tradeId: string; quantity: number }[];
    let feeCash: number;
    let feeQuantity = 0;
    if (activity.activity_type === 'CFEE') {
      const lot = entryLots.length === 1 ? await tx.trade.findUniqueOrThrow({ where: { id: entryLots[0].id } }) : null;
      if (!lot || lot.market !== 'crypto' || lot.type !== 'BUY' || !activity.symbol
        || normalize(activity.symbol) !== normalize(brokerSymbol(lot.asset, lot.market)) || activity.status !== 'executed'
        || !activity.qty || !(Number(activity.qty) < 0) || !activity.price || !(Number(activity.price) > 0)) return;
      feeQuantity = -Number(activity.qty);
      feeCash = feeQuantity * Number(activity.price);
      if (!Number.isFinite(feeCash) || remainingLotQuantity(lot) < feeQuantity - QUANTITY_EPS) return;
      allocations = [{ tradeId: lot.id, quantity: feeQuantity }];
    } else {
      // No currency inferred from a symbol or account default.
      if (activity.currency !== 'USD' || activity.net_amount == null || !(Number(activity.net_amount) < 0)) return;
      feeCash = -Number(activity.net_amount);
      if (!Number.isFinite(feeCash)) return;
      allocations = entryLots.length === 1 ? [{ tradeId: entryLots[0].id, quantity: 1 }]
        : cursor ? (await tx.brokerFillAllocation.findMany({ where: { orderEvidenceId: cursor.id } })).map(a => ({ tradeId: a.tradeId, quantity: Number(a.quantity) })) : [];
      if (!allocations.length || (cursor && (!FINAL_ORDER_STATES.has(cursor.status) || cursor.allocationComplete === false))) return;
    }
    const weight = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    if (!(weight > 0)) return;
    for (const allocation of allocations) {
      const lot = await tx.trade.findUniqueOrThrow({ where: { id: allocation.tradeId } });
      if (lot.accountId !== scope.accountId || lot.brokerMode !== scope.mode || lot.positionId !== positionId) throw new Error('FEE_LOT_IDENTITY_MISMATCH');
      const cost = feeQuantity ? (lot.entryPrice + lot.fees / lot.quantity) * allocation.quantity : feeCash * allocation.quantity / weight;
      const realizedPnl = lot.realizedPnl - cost;
      await tx.trade.update({ where: { id: lot.id }, data: { realizedPnl,
        actualFeeCash: { increment: feeCash * allocation.quantity / weight },
        ...(feeQuantity ? { feeQuantity: { increment: allocation.quantity } } : {}),
        ...(lot.status === 'CLOSED' ? { pnl: realizedPnl, pnlPct: realizedPnl / (lot.entryPrice * lot.quantity) * 100 } : {}) } });
    }
    const remainingLots = feeQuantity ? await tx.trade.findMany({ where: { positionId, accountId: scope.accountId, brokerMode: scope.mode, status: 'OPEN' } }) : [];
    const remaining = remainingLots.reduce((sum, lot) => sum + remainingLotQuantity(lot), 0);
    const basis = remainingLots.reduce((sum, lot) => sum + remainingLotQuantity(lot) * lot.entryPrice, 0);
    await tx.position.update({ where: { id: positionId }, data: {
      ...(feeQuantity ? { quantity: remaining, ...(remaining > QUANTITY_EPS ? { entryPrice: basis / remaining } : {}) } : {}),
      ...(feeQuantity ? { accountingStatus: 'RECONCILING', accountingError: 'AWAITING_BROKER_INVENTORY_CONFIRMATION' } : {}),
      evidenceVersion: { increment: 1 } } });
    await tx.brokerActivity.update({ where: { id: retained.id }, data: { appliedAt: new Date(), attributionStatus: 'APPLIED' } });
  });
}
