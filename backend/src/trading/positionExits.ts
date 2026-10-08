import { createHash } from 'crypto';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { AccountScope, brokerSymbol, getVerifiedAccountScope } from './accountScope';

export interface ExitResult { closed: boolean; pending?: boolean; orderId?: string; pnl?: number; pnlPct?: number; error?: string; }
const ACTIVE = ['PREPARING', 'SUBMITTING', 'SUBMITTED', 'PARTIAL', 'RECONCILIATION_REQUIRED'];
const TERMINAL = ['filled', 'canceled', 'expired', 'rejected', 'stopped'];
const EPS = 1e-7;

/** All prices and quantities below come from broker evidence, never the HTTP caller. */
export async function requestPositionExit(positionId: string, reason: string, suppliedScope?: AccountScope): Promise<ExitResult> {
  try {
    if (process.env.DRY_RUN === 'true') return { closed: false, error: 'DRY_RUN: no broker exit submitted' };
    const scope = suppliedScope ?? await getVerifiedAccountScope();
    const position = await prisma.position.findUnique({ where: { id: positionId } });
    if (!position || position.accountId !== scope.accountId || position.brokerMode !== scope.mode
      || !['stocks', 'crypto'].includes(position.market)) return { closed: false, error: 'POSITION_ACCOUNT_UNVERIFIED' };
    if (position.status === 'CLOSED') return { closed: true, pnl: 0 };
    const cycleBase = `${position.id}:${position.openedAt.toISOString()}:`;
    let intent = await prisma.positionExit.findFirst({ where: { positionId, cycleKey: { startsWith: cycleBase } }, orderBy: { createdAt: 'desc' } });
    let attempt = 1;
    if (intent && ['TERMINAL_PARTIAL', 'TERMINAL_UNFILLED'].includes(intent.status)) {
      const maxAttempts = Number(process.env.EXIT_MAX_ATTEMPTS ?? 3);
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 || intent.attempt >= maxAttempts) {
        return { closed: false, error: 'EXIT_RETRY_LIMIT_REQUIRES_REVIEW' };
      }
      if (Date.now() - intent.updatedAt.getTime() < 15000) return { closed: false, pending: true };
      attempt = intent.attempt + 1;
      intent = null;
    }
    const cycleKey = cycleBase + attempt;
    if (!intent) {
      try {
        intent = await prisma.positionExit.create({ data: {
          cycleKey, positionId: position.id, accountId: scope.accountId, brokerMode: scope.mode,
          symbol: brokerSymbol(position.asset, position.market), side: position.side === 'SELL' ? 'buy' : 'sell',
          quantity: position.quantity, clientOrderId: `bx-${createHash('sha256').update(cycleKey).digest('hex').slice(0, 40)}`,
          reason, attempt, status: 'PREPARING',
        } });
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        intent = await prisma.positionExit.findUnique({ where: { cycleKey } });
      }
    }
    if (!intent) throw new Error('Cannot save exit identity');
    if (intent.status === 'RECORDED') return { closed: true, orderId: intent.brokerOrderId ?? undefined };
    if (intent.status !== 'PREPARING') return await observeExit(intent, scope);

    const orders = await scope.broker.listOrdersVerified('open', 500);
    if (orders.length >= 500) throw new Error('Open order scan exceeded its bound');
    const symbolOrders = orders.flatMap(order => [order, ...(order.legs ?? [])]).filter(order => order.symbol === intent!.symbol && !TERMINAL.includes(order.status));
    for (const order of symbolOrders) await scope.broker.cancelOrder(order.id);
    for (const order of symbolOrders) {
      const state = await scope.broker.getOrder(order.id);
      if (!state || !TERMINAL.includes(state.status)) throw new Error('CANCELLATION_UNCONFIRMED');
    }
    const holding = await scope.broker.getPosition(intent.symbol);
    if (!holding) {
      // Broker brackets can fill before this monitor runs. Only a known parent
      // order's filled exit leg can establish the price; a quote cannot.
      const trades = await prisma.trade.findMany({ where: { positionId, status: 'OPEN' } });
      if (trades.length === 1 && trades[0].brokerOrderId) {
        const parent = await scope.broker.getOrder(trades[0].brokerOrderId);
        const legs = (parent?.legs ?? []).filter((leg: any) => leg.symbol === intent!.symbol && leg.side === intent!.side
          && leg.status === 'filled' && Math.abs(Number(leg.filled_qty) - intent!.quantity) < EPS);
        if (legs.length === 1) {
          await prisma.positionExit.updateMany({ where: { id: intent.id, status: 'PREPARING' }, data: { brokerOrderId: legs[0].id, evidenceKind: 'PROTECTION_LEG', status: 'SUBMITTED' } });
          return await applyExitObservation(intent, legs[0], scope, true);
        }
      }
      throw new Error('BROKER_FLAT_EXIT_EVIDENCE_REQUIRED');
    }
    const quantity = Math.abs(Number(holding.qty));
    const side = holding.side === 'short' ? 'buy' : 'sell';
    if (!(Number.isFinite(quantity) && quantity > 0) || Math.abs(quantity - intent.quantity) > EPS || side !== intent.side) {
      throw new Error('POSITION_QUANTITY_OR_SIDE_DRIFT');
    }
    const claimed = await prisma.positionExit.updateMany({ where: { id: intent.id, status: 'PREPARING' }, data: { status: 'SUBMITTING' } });
    if (claimed.count !== 1) return { closed: false, pending: true };
    // Stable client identity is persisted before POST. No timeout path reposts.
    const order = await scope.broker.createOrder({ symbol: intent.symbol, qty: quantity, side: intent.side as 'buy' | 'sell',
      type: 'market', time_in_force: position.market === 'crypto' ? 'gtc' : 'day', client_order_id: intent.clientOrderId });
    if (!order?.id) throw new Error('Broker exit returned no identity');
    await prisma.positionExit.updateMany({ where: { id: intent.id, status: { in: ACTIVE } }, data: { brokerOrderId: order.id, status: 'SUBMITTED' } });
    return await observeExit({ ...intent, brokerOrderId: order.id, status: 'SUBMITTED' }, scope);
  } catch (error: any) {
    logger.error('Position exit not confirmed', { positionId, error: error?.message });
    // PREPARING remains retryable because no submission claim was acquired yet.
    await prisma.positionExit.updateMany({ where: { positionId, status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIAL', 'RECONCILIATION_REQUIRED'] } },
      data: { status: 'RECONCILIATION_REQUIRED', error: error?.message } }).catch(() => {});
    return { closed: false, pending: true, error: error?.message || 'EXIT_UNAVAILABLE' };
  }
}

async function observeExit(intent: any, scope: AccountScope): Promise<ExitResult> {
  const order = intent.brokerOrderId ? await scope.broker.getOrder(intent.brokerOrderId)
    : await scope.broker.getOrderByClientOrderId(intent.clientOrderId);
  if (!order) {
    await prisma.positionExit.updateMany({ where: { id: intent.id, status: { in: ACTIVE } },
      data: { error: 'EXIT_ORDER_UNAVAILABLE' } });
    return { closed: false, pending: true, error: 'EXIT_ORDER_UNAVAILABLE' };
  }
  return applyExitObservation(intent, order, scope, intent.evidenceKind === 'PROTECTION_LEG');
}

async function applyExitObservation(intent: any, order: any, scope: AccountScope, protectionLeg = false): Promise<ExitResult> {
  if (order.symbol !== intent.symbol || order.side !== intent.side || !order.id
    || (!protectionLeg && order.client_order_id !== intent.clientOrderId)
    || (protectionLeg && intent.brokerOrderId && order.id !== intent.brokerOrderId)) throw new Error('EXIT_ORDER_IDENTITY_MISMATCH');
  const filledQuantity = Number(order.filled_qty);
  const filledPrice = Number(order.filled_avg_price);
  const terminal = TERMINAL.includes(order.status);
  if (!Number.isFinite(filledQuantity) || filledQuantity < 0 || filledQuantity > intent.quantity + EPS) throw new Error('INVALID_EXIT_FILL_QUANTITY');
  if (filledQuantity === 0) {
    await prisma.positionExit.updateMany({ where: { id: intent.id, status: { in: ACTIVE } }, data: {
      status: terminal ? 'TERMINAL_UNFILLED' : 'SUBMITTED', brokerOrderId: order.id,
      brokerEvidence: JSON.parse(JSON.stringify(order)),
    } });
    return { closed: false, pending: !terminal, orderId: order.id, ...(terminal ? { error: `EXIT_${order.status.toUpperCase()}` } : {}) };
  }
  if (!Number.isFinite(filledPrice) || filledPrice <= 0) throw new Error('INVALID_EXIT_FILL_PRICE');
  const remaining = Math.max(0, intent.quantity - filledQuantity);
  const holding = await scope.broker.getPosition(intent.symbol);
  const brokerRemaining = holding ? Math.abs(Number(holding.qty)) : 0;
  if (!Number.isFinite(brokerRemaining) || Math.abs(brokerRemaining - remaining) > EPS
    || (holding && (holding.side === 'short' ? 'buy' : 'sell') !== intent.side)) throw new Error('EXIT_FILL_AND_HOLDING_DISAGREE');
  const notional = filledQuantity * filledPrice;
  return prisma.$transaction(async tx => {
    const current = await tx.positionExit.findUnique({ where: { id: intent.id } });
    if (!current || current.accountId !== scope.accountId || current.brokerMode !== scope.mode) throw new Error('EXIT_ACCOUNT_MISMATCH');
    if (current.status === 'RECORDED') return { closed: true, orderId: order.id };
    if (filledQuantity < current.appliedQuantity - EPS) return { closed: false, pending: true, orderId: order.id };
    const deltaQuantity = filledQuantity - current.appliedQuantity;
    const deltaNotional = notional - current.appliedNotional;
    const claimed = await tx.positionExit.updateMany({ where: { id: intent.id, appliedQuantity: current.appliedQuantity,
      appliedNotional: current.appliedNotional, status: { in: ACTIVE } }, data: { status: 'RECORDING' } });
    if (claimed.count !== 1) return { closed: false, pending: true, orderId: order.id };
    let pnl = 0;
    let basisDelta = 0;
    const trades = await tx.trade.findMany({ where: { positionId: intent.positionId, accountId: scope.accountId,
      brokerMode: scope.mode, status: 'OPEN' }, orderBy: [{ openedAt: 'asc' }, { id: 'asc' }] });
    const outstanding = trades.reduce((sum, trade) => sum + trade.quantity - trade.closedQuantity, 0);
    const previouslyRemaining = intent.quantity - current.appliedQuantity;
    if (Math.abs(outstanding - previouslyRemaining) > EPS) throw new Error('EXIT_LOT_ATTRIBUTION_UNAVAILABLE');
    if (deltaQuantity > EPS) {
      const deltaPrice = deltaNotional / deltaQuantity;
      if (!Number.isFinite(deltaPrice) || deltaPrice <= 0) throw new Error('INVALID_INCREMENTAL_EXIT_PRICE');
      let toAllocate = deltaQuantity;
      for (const trade of trades) {
        if (toAllocate <= EPS) break;
        const allocated = Math.min(toAllocate, trade.quantity - trade.closedQuantity);
        const gross = (deltaPrice - trade.entryPrice) * allocated * (trade.type === 'SELL' ? -1 : 1);
        const realizedPnl = trade.realizedPnl + gross - trade.fees * allocated / trade.quantity;
        const closedQuantity = trade.closedQuantity + allocated;
        const exitNotional = trade.exitNotional + deltaPrice * allocated;
        const lotClosed = Math.abs(closedQuantity - trade.quantity) < EPS;
        pnl += gross - trade.fees * allocated / trade.quantity;
        basisDelta += trade.entryPrice * allocated;
        await tx.trade.update({ where: { id: trade.id }, data: {
          closedQuantity, realizedPnl, exitNotional,
          ...(lotClosed ? { status: 'CLOSED', pnl: realizedPnl, pnlPct: realizedPnl / (trade.entryPrice * trade.quantity) * 100,
            exitPrice: exitNotional / closedQuantity, closedAt: new Date(), exitReason: intent.reason } : {}),
          reconciliationStatus: lotClosed ? 'BROKER_EXIT_CONFIRMED' : 'BROKER_PARTIAL_EXIT',
        } });
        toAllocate -= allocated;
      }
    }
    const closed = terminal && remaining < EPS;
    const cycleRealized = current.realizedPnl + pnl;
    const cycleBasis = current.entryBasis + basisDelta;
    await tx.position.update({ where: { id: intent.positionId }, data: {
      quantity: remaining, brokerObservedQuantity: brokerRemaining, status: closed ? 'CLOSED' : 'OPEN', currentPrice: filledPrice,
      ...(closed ? { unrealizedPnl: 0, unrealizedPnlPct: 0 } : {}),
    } });
    await tx.positionExit.update({ where: { id: intent.id }, data: {
      status: closed ? 'RECORDED' : terminal ? 'TERMINAL_PARTIAL' : 'PARTIAL',
      brokerOrderId: order.id, appliedQuantity: filledQuantity, appliedNotional: notional,
      realizedPnl: cycleRealized, entryBasis: cycleBasis,
      brokerEvidence: JSON.parse(JSON.stringify(order)), error: null,
    } });
    return { closed, pending: !terminal, orderId: order.id, pnl: closed ? cycleRealized : pnl,
      ...(closed && cycleBasis > 0 ? { pnlPct: cycleRealized / cycleBasis * 100 } : {}) };
  });
}

export async function reconcilePositionExits(scope?: AccountScope): Promise<void> {
  if (process.env.DRY_RUN === 'true') return;
  const verified = scope ?? await getVerifiedAccountScope();
  const intents = await prisma.positionExit.findMany({ where: { accountId: verified.accountId,
    brokerMode: verified.mode, status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIAL', 'RECONCILIATION_REQUIRED'] } },
    orderBy: { updatedAt: 'asc' }, take: 50 });
  for (const intent of intents) {
    try { await observeExit(intent, verified); }
    catch (error: any) {
      await prisma.positionExit.updateMany({ where: { id: intent.id, status: { in: ACTIVE } }, data: {
        status: 'RECONCILIATION_REQUIRED', error: error?.message,
      } });
    }
  }
}
