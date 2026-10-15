import { createHash } from 'crypto';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import type { AlpacaOrder } from '../services/alpacaBroker';
import { AccountScope, brokerSymbol, getVerifiedAccountScope, positionScopeKey } from './accountScope';
import { applyBrokerExitEvidence, FINAL_ORDER_STATES, markAccountingUnknown, QUANTITY_EPS,
  readOrderChain, reconcileProtectionEvidence, remainingLotQuantity } from './brokerEvidence';

export interface ExitResult { closed: boolean; pending?: boolean; orderId?: string; pnl?: number; pnlPct?: number; error?: string; }
const ACTIVE = ['PREPARING', 'SUBMITTING', 'SUBMITTED', 'PARTIAL', 'RECONCILIATION_REQUIRED'];
const norm = (value: string) => value.replace('/', '').toUpperCase();

/** Holdings verify inventory; they never supply realized price or P&L. */
export async function verifyPositionInventory(positionId: string, scope: AccountScope) {
  const position = await prisma.position.findUniqueOrThrow({ where: { id: positionId } });
  if (position.accountId !== scope.accountId || position.brokerMode !== scope.mode) throw new Error('POSITION_ACCOUNT_UNVERIFIED');
  const holding = await scope.broker.getPosition(brokerSymbol(position.asset, position.market));
  const quantity = holding ? Math.abs(Number(holding.qty)) : 0;
  if (!Number.isFinite(quantity) || (holding && (holding.side === 'short' ? 'SELL' : 'BUY') !== position.side)) throw new Error('POSITION_SIDE_OR_QUANTITY_UNVERIFIED');
  const trades = await prisma.trade.findMany({ where: { positionId, accountId: scope.accountId, brokerMode: scope.mode, status: 'OPEN' } });
  const outstanding = trades.reduce((sum, trade) => sum + remainingLotQuantity(trade), 0);
  const pending = await prisma.executionIntent.count({ where: { accountId: scope.accountId, mode: scope.mode, asset: position.asset,
    status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'] } } });
  const executableOrders = quantity <= QUANTITY_EPS ? await prisma.brokerOrderEvidence.count({ where: { positionId,
    positionCycleAt: position.openedAt, status: { notIn: [...FINAL_ORDER_STATES, 'replaced'] } } }) : 0;
  const agrees = pending === 0 && executableOrders === 0 && Math.abs(quantity - outstanding) <= QUANTITY_EPS && Math.abs(position.quantity - outstanding) <= QUANTITY_EPS;
  const observed = await prisma.position.updateMany({ where: { id: positionId, evidenceVersion: position.evidenceVersion }, data: { brokerObservedQuantity: quantity,
    brokerObservedAt: new Date(), ...(holding ? { brokerObservedEntryPrice: Number(holding.avg_entry_price) } : {}),
    accountingStatus: agrees ? 'RECONCILED' : 'RECONCILIATION_REQUIRED',
    ...(agrees && quantity <= QUANTITY_EPS ? { status: 'CLOSED' } : {}),
    accountingError: agrees ? null : 'BROKER_INVENTORY_AND_EXECUTION_LOTS_DISAGREE' } });
  if (observed.count !== 1) throw new Error('POSITION_EVIDENCE_CHANGED');
  if (!agrees) throw new Error('BROKER_INVENTORY_AND_EXECUTION_LOTS_DISAGREE');
  return { position, quantity, version: position.evidenceVersion };
}

export async function requestPositionExit(positionId: string, reason: string, suppliedScope?: AccountScope): Promise<ExitResult> {
  try {
    if (process.env.DRY_RUN === 'true') return { closed: false, error: 'DRY_RUN: no broker exit submitted' };
    const scope = suppliedScope ?? await getVerifiedAccountScope();
    const position = await prisma.position.findUnique({ where: { id: positionId } });
    if (!position || position.accountId !== scope.accountId || position.brokerMode !== scope.mode
      || !['stocks', 'crypto'].includes(position.market)) return { closed: false, error: 'POSITION_ACCOUNT_UNVERIFIED' };
    if (position.status === 'CLOSED') return { closed: true };
    const cycleBase = `${position.id}:${position.openedAt.toISOString()}:`;
    let intent = await prisma.positionExit.findFirst({ where: { positionId, cycleKey: { startsWith: cycleBase } }, orderBy: { createdAt: 'desc' } });
    let attempt = 1;
    if (intent && ['TERMINAL_PARTIAL', 'TERMINAL_UNFILLED'].includes(intent.status)) {
      const limit = Number(process.env.EXIT_MAX_ATTEMPTS ?? 3);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || intent.attempt >= limit) return { closed: false, pending: true, error: 'EXIT_RETRY_LIMIT_REQUIRES_REVIEW' };
      if (Date.now() - intent.updatedAt.getTime() < 15000) return { closed: false, pending: true };
      attempt = intent.attempt + 1; intent = null;
    }
    if (intent?.status === 'RECORDED') return { closed: false, pending: true, orderId: intent.brokerOrderId ?? undefined };
    if (intent && intent.status !== 'PREPARING') return observeExit(intent, scope);
    if (!intent) {
      const cycleKey = cycleBase + attempt;
      try {
        intent = await prisma.positionExit.create({ data: { cycleKey, positionId, accountId: scope.accountId, brokerMode: scope.mode,
          symbol: brokerSymbol(position.asset, position.market), side: position.side === 'SELL' ? 'buy' : 'sell', quantity: position.quantity,
          clientOrderId: `bx-${createHash('sha256').update(cycleKey).digest('hex').slice(0, 40)}`, reason, attempt, status: 'PREPARING' } });
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        intent = await prisma.positionExit.findUnique({ where: { cycleKey } });
      }
    }
    if (!intent) throw new Error('EXIT_IDENTITY_UNAVAILABLE');
    await reconcileProtectionEvidence(scope, positionId);
    // Unknown inventory must not first cancel functioning protective orders.
    await verifyPositionInventory(positionId, scope);
    const orders = await scope.broker.listOrdersVerified('open', 500);
    if (orders.length >= 500) throw new Error('OPEN_ORDER_SCAN_BOUND_EXCEEDED');
    const symbolOrders = new Map<string, AlpacaOrder>(orders.flatMap(order => [order, ...(order.legs ?? [])])
      .filter(order => norm(order.symbol) === norm(intent!.symbol)).map(order => [order.id, order] as const));
    for (const order of symbolOrders.values()) {
      if (!FINAL_ORDER_STATES.has(order.status)) await scope.broker.cancelOrder(order.id);
      const chain = await readOrderChain(scope, order.id);
      if (!FINAL_ORDER_STATES.has(chain[chain.length - 1].status)) throw new Error('CANCELLATION_UNCONFIRMED');
      for (const state of chain) {
        if (Number(state.filled_qty) > 0) {
          if (state.side !== intent.side) throw new Error('OPENING_ORDER_FILL_REQUIRES_ENTRY_RECONCILIATION');
          await applyBrokerExitEvidence(scope, positionId, state, 'APPLICATION_EXIT');
        }
      }
    }
    await reconcileProtectionEvidence(scope, positionId);
    const verified = await verifyPositionInventory(positionId, scope);
    if (verified.quantity <= QUANTITY_EPS) {
      await prisma.positionExit.update({ where: { id: intent.id }, data: { status: 'RECORDED' } });
      return { closed: true };
    }
    // The same account/symbol lock as entries and evidence application. No
    // network operations inside the transaction; reject a changed evidence version.
    const claimed = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${positionScopeKey(scope.accountId, scope.mode, position.asset)}))`;
      const latest = await tx.position.findUniqueOrThrow({ where: { id: positionId } });
      const lots = await tx.trade.findMany({ where: { positionId, accountId: scope.accountId, brokerMode: scope.mode, status: 'OPEN' } });
      const outstanding = lots.reduce((sum, lot) => sum + remainingLotQuantity(lot), 0);
      const pending = await tx.executionIntent.count({ where: { asset: position.asset, accountId: scope.accountId, mode: scope.mode,
        status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'] } } });
      const otherExit = await tx.positionExit.count({ where: { positionId, id: { not: intent!.id }, status: { in: ACTIVE } } });
      if (latest.evidenceVersion !== verified.version || latest.openedAt.getTime() !== position.openedAt.getTime()
        || latest.accountingStatus !== 'RECONCILED' || pending || otherExit
        || Math.abs(outstanding - verified.quantity) > QUANTITY_EPS || Math.abs(latest.quantity - outstanding) > QUANTITY_EPS) throw new Error('EXIT_PREFLIGHT_CHANGED');
      return tx.positionExit.updateMany({ where: { id: intent!.id, status: 'PREPARING' }, data: { status: 'SUBMITTING', quantity: verified.quantity } });
    });
    if (claimed.count !== 1) return { closed: false, pending: true };
    const order = await scope.broker.createOrder({ symbol: intent.symbol, qty: verified.quantity, side: intent.side as 'buy' | 'sell',
      type: 'market', time_in_force: position.market === 'crypto' ? 'gtc' : 'day', client_order_id: intent.clientOrderId });
    if (!order?.id) throw new Error('BROKER_EXIT_IDENTITY_UNAVAILABLE');
    await prisma.positionExit.updateMany({ where: { id: intent.id, status: { in: ACTIVE } }, data: { brokerOrderId: order.id, status: 'SUBMITTED' } });
    return observeExit({ ...intent, quantity: verified.quantity, brokerOrderId: order.id }, scope);
  } catch (error: any) {
    const message = error?.message || 'EXIT_UNAVAILABLE';
    logger.warn('Exit evidence or submission remains pending', { positionId, reason: message });
    await markAccountingUnknown(positionId, message).catch(() => {});
    await prisma.positionExit.updateMany({ where: { positionId, status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIAL', 'RECONCILIATION_REQUIRED'] } },
      data: { status: 'RECONCILIATION_REQUIRED', error: message } }).catch(() => {});
    return { closed: false, pending: true, error: message };
  }
}

async function observeExit(intent: any, scope: AccountScope): Promise<ExitResult> {
  const initial = intent.brokerOrderId ? await scope.broker.getOrderVerified(intent.brokerOrderId)
    : await scope.broker.getOrderByClientOrderId(intent.clientOrderId);
  if (!initial) return { closed: false, pending: true, error: 'EXIT_ORDER_UNAVAILABLE' };
  if (initial.client_order_id !== intent.clientOrderId || norm(initial.symbol) !== norm(intent.symbol) || initial.side !== intent.side) throw new Error('EXIT_ORDER_IDENTITY_MISMATCH');
  const chain = await readOrderChain(scope, initial.id);
  let pnl = 0;
  for (const state of chain) {
    const applied = await applyBrokerExitEvidence(scope, intent.positionId, state, 'APPLICATION_EXIT'); pnl += applied.pnl;
  }
  const last = chain[chain.length - 1];
  const verified = await verifyPositionInventory(intent.positionId, scope);
  const closed = verified.quantity <= QUANTITY_EPS;
  const terminal = FINAL_ORDER_STATES.has(last.status);
  await prisma.positionExit.update({ where: { id: intent.id }, data: { brokerOrderId: initial.id,
    status: closed ? 'RECORDED' : terminal ? (chain.some(order => Number(order.filled_qty) > 0) ? 'TERMINAL_PARTIAL' : 'TERMINAL_UNFILLED') : 'PARTIAL',
    brokerEvidence: JSON.parse(JSON.stringify(chain)), realizedPnl: { increment: pnl }, error: null } });
  return { closed, pending: !closed, orderId: initial.id, ...(pnl !== 0 ? { pnl } : {}) };
}

export async function reconcilePositionExits(suppliedScope?: AccountScope): Promise<void> {
  if (process.env.DRY_RUN === 'true') return;
  const scope = suppliedScope ?? await getVerifiedAccountScope();
  const intents = await prisma.positionExit.findMany({ where: { accountId: scope.accountId, brokerMode: scope.mode,
    status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIAL', 'RECONCILIATION_REQUIRED'] } }, orderBy: { updatedAt: 'asc' }, take: 50 });
  for (const intent of intents) {
    try { await observeExit(intent, scope); }
    catch (error: any) {
      await markAccountingUnknown(intent.positionId, error?.message || 'EXIT_EVIDENCE_UNAVAILABLE');
      await prisma.positionExit.update({ where: { id: intent.id }, data: { status: 'RECONCILIATION_REQUIRED', error: error?.message } });
    }
  }
}
