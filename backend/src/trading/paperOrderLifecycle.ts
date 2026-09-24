import { Trade } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { AlpacaBroker, createAlpacaBroker } from '../services/alpacaBroker';
import { getIO } from '../websocket/server';
import { assertPaperTrading } from './paperConfig';

export const entryClientId = (tradeId: string): string => `entry-${tradeId}`;

export interface OrderObservation {
  id: string;
  status: string;
  filled_qty: number | string;
  filled_avg_price: number | string | null;
  symbol?: string;
  side?: string;
}

export function classifyEntryOrder(order: OrderObservation): 'pending' | 'partial' | 'filled' | 'cancelled' | 'rejected' {
  const qty = Number(order.filled_qty);
  if (!Number.isFinite(qty) || qty < 0) throw new Error('Invalid broker filled quantity');
  if (qty > 0 && (!Number.isFinite(Number(order.filled_avg_price)) || Number(order.filled_avg_price) <= 0)) {
    throw new Error('Invalid broker fill price');
  }
  const terminal = ['filled', 'canceled', 'expired', 'rejected'].includes(order.status);
  if (order.status === 'filled' && qty === 0) throw new Error('Filled order has zero quantity');
  // A canceled order may already have bought/sold shares. Preserve that exposure.
  if (terminal && qty > 0) return 'filled';
  if (order.status === 'rejected') return 'rejected';
  if (order.status === 'canceled' || order.status === 'expired') return 'cancelled';
  return qty > 0 ? 'partial' : 'pending';
}

/** OPEN + brokerConfirmed=false is a durable pending entry, not a filled position. */
export async function applyEntryObservation(trade: Trade, order: OrderObservation): Promise<boolean> {
  if ((order.symbol && order.symbol !== trade.asset) || (order.side && order.side !== trade.type.toLowerCase())) {
    throw new Error('Broker order identity does not match the trade');
  }
  const state = classifyEntryOrder(order);
  if (state === 'pending' || state === 'partial') {
    await prisma.trade.updateMany({
      where: { id: trade.id, status: 'OPEN', brokerConfirmed: false },
      data: { brokerOrderId: order.id, exitReason: `Entry pending: ${order.status}; filled ${order.filled_qty}/${trade.quantity}` },
    });
    return false;
  }
  if (state === 'cancelled' || state === 'rejected') {
    await prisma.trade.updateMany({
      where: { id: trade.id, status: 'OPEN', brokerConfirmed: false },
      data: { brokerOrderId: order.id, status: state === 'rejected' ? 'FAILED' : 'CANCELLED', exitReason: `Broker entry ${order.status}` },
    });
    return false;
  }
  const fillPrice = Number(order.filled_avg_price);
  const fillQty = Number(order.filled_qty);
  if (fillQty > trade.quantity + 1e-6) throw new Error('Broker filled more than the reserved quantity');
  if (!trade.stopLossPrice || !trade.takeProfitPrice) throw new Error('Entry has no protective price levels');

  const confirmed = await prisma.$transaction(async tx => {
    // Claim the observation before touching the position. Repeated polls cannot
    // resurrect a position that was closed after this entry was confirmed.
    const claim = await tx.trade.updateMany({
      where: { id: trade.id, status: 'OPEN', brokerConfirmed: false },
      data: { brokerOrderId: order.id, brokerConfirmed: true, entryPrice: fillPrice, quantity: fillQty, exitReason: null },
    });
    if (claim.count !== 1) return null;
    const existing = await tx.position.findUnique({ where: { asset: trade.asset } });
    if (existing?.status === 'OPEN') throw new Error('Existing position requires reconciliation; refusing to overwrite it');
    const position = { market: trade.market, side: trade.type, quantity: fillQty, entryPrice: fillPrice,
      currentPrice: fillPrice, stopLossPrice: trade.stopLossPrice!, takeProfitPrice: trade.takeProfitPrice!,
      status: 'OPEN', unrealizedPnl: 0, unrealizedPnlPct: 0, openedAt: new Date() };
    await tx.position.upsert({ where: { asset: trade.asset }, create: { asset: trade.asset, ...position }, update: position });
    if (trade.agentDecisionId) await tx.agentDecision.update({ where: { id: trade.agentDecisionId }, data: { executed: true } });
    return tx.trade.findUnique({ where: { id: trade.id } });
  });
  if (confirmed) getIO()?.emit('trade:executed', { trade: confirmed, mode: 'paper' });
  return Boolean(confirmed);
}

export async function reconcilePaperEntry(trade: Trade, broker: AlpacaBroker): Promise<boolean> {
  assertPaperTrading();
  const order = trade.brokerOrderId && !trade.brokerOrderId.startsWith('CLIENT:')
    ? await broker.getOrder(trade.brokerOrderId)
    : await broker.getOrderByClientId(entryClientId(trade.id));
  // An unavailable response is not evidence of rejection. Keep the reservation.
  if (!order) return false;
  const state = classifyEntryOrder(order);
  const filled = await applyEntryObservation(trade, order);
  if (state === 'partial') {
    // Settle the cumulative fill before allowing exits. A cancel response itself
    // is not a final fill: the next reconciliation must observe terminal status.
    await broker.cancelOrder(order.id).catch(() => undefined);
  }
  return filled;
}

let reconciliationRunning = false;
export async function reconcilePendingPaperEntries(): Promise<void> {
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  try {
    assertPaperTrading();
    const broker = createAlpacaBroker(true);
    if (!broker) return;
    const pending = await prisma.trade.findMany({ where: { market: 'stocks', status: 'OPEN', brokerConfirmed: false }, orderBy: { openedAt: 'asc' } });
    for (const trade of pending) {
      try { await reconcilePaperEntry(trade, broker); }
      catch (error) { logger.warn('Paper entry still requires reconciliation', { tradeId: trade.id, error: (error as Error).message }); }
    }
  } finally { reconciliationRunning = false; }
}
