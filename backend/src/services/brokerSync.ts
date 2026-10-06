// ── BROKER SYNC ───────────────────────────────────────────────────────────────
// The broker (Alpaca) is the source of truth for what we actually own. The
// local DB drifted from it before: AMZN and NVDA were marked CLOSED locally by a
// stop-loss that never reached the broker, so Alpaca still held both while the
// dashboard said "0 open positions" and NAV $0.
//
// Every minute this job:
//   1. refreshes the cached Alpaca account (cash / equity / buying power),
//   2. imports any broker position the DB doesn't know about (status OPEN,
//      reconciliationStatus IMPORTED_FROM_BROKER) so it is shown and monitored,
//   3. updates quantity / price / P&L of known positions from the broker,
//   4. closes DB positions the broker no longer holds, using the broker's real
//      exit fill when it can find one.
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { getTradingBroker, getActiveMode } from '../trading/brokerRouter';

export interface BrokerSyncResult { imported: string[]; updated: string[]; closed: string[]; skipped?: string }

let lastResult: BrokerSyncResult & { at?: string } = { imported: [], updated: [], closed: [] };
export function getLastBrokerSync() { return lastResult; }

function pct(entry: number, current: number, side: string) {
  if (!(entry > 0)) return 0;
  return side === 'SELL' ? ((entry - current) / entry) * 100 : ((current - entry) / entry) * 100;
}

export async function syncBrokerPositions(): Promise<BrokerSyncResult> {
  const broker: any = getTradingBroker();
  if (!broker) return (lastResult = { imported: [], updated: [], closed: [], skipped: 'no broker configured' });

  // 1. refresh account cache used by getPortfolioState()
  try {
    const { accountManager } = await import('./accountManager');
    await accountManager.refreshAlpaca?.();
  } catch { /* optional */ }

  let brokerPositions: any[];
  try {
    // Call the API directly: AlpacaBroker.getPositions() swallows errors and returns [],
    // which would look like "broker is flat" and wrongly close every DB position.
    const res = await broker.client.get('/v2/positions');
    brokerPositions = res.data;
  } catch (err: any) {
    return (lastResult = { imported: [], updated: [], closed: [], skipped: `broker positions unavailable: ${err?.message}` });
  }
  if (!Array.isArray(brokerPositions)) brokerPositions = [];

  const result: BrokerSyncResult = { imported: [], updated: [], closed: [] };
  const held = new Map<string, any>();
  for (const p of brokerPositions) {
    const sym = String(p.symbol || '').toUpperCase();
    if (!sym || p.asset_class === 'crypto' || sym.includes('/')) continue;
    held.set(sym, p);
  }

  const dbOpen = await prisma.position.findMany({ where: { status: 'OPEN', market: 'stocks' } });
  const dbBySym = new Map(dbOpen.map((p: any) => [p.asset, p]));

  for (const [sym, p] of held) {
    const qty = Math.abs(parseFloat(p.qty));
    const entry = parseFloat(p.avg_entry_price);
    const current = parseFloat(p.current_price) || entry;
    const side = p.side === 'short' ? 'SELL' : 'BUY';
    const unrealizedPnl = parseFloat(p.unrealized_pl) || 0;
    const existing = dbBySym.get(sym) as any;
    if (existing) {
      await prisma.position.update({
        where: { id: existing.id },
        data: { quantity: qty, currentPrice: current, unrealizedPnl, unrealizedPnlPct: pct(existing.entryPrice, current, existing.side), brokerPositionId: p.asset_id || existing.brokerPositionId },
      }).catch(() => {});
      result.updated.push(sym);
      continue;
    }
    // Unknown to the DB → import it (an older phantom "CLOSED" row may exist; that's history).
    // Default protection for an imported position: 2x ATR-ish fallback of 5% stop / 10% target,
    // monitored by the app until the next debate re-evaluates it.
    const stop = side === 'BUY' ? entry * 0.95 : entry * 1.05;
    const target = side === 'BUY' ? entry * 1.10 : entry * 0.90;
    await prisma.position.upsert({
      where: { asset: sym },
      create: {
        asset: sym, market: 'stocks', side, quantity: qty, entryPrice: entry, currentPrice: current,
        stopLossPrice: stop, takeProfitPrice: target, unrealizedPnl, unrealizedPnlPct: pct(entry, current, side),
        protectionStatus: 'BROKER_SYNCED', brokerPositionId: p.asset_id || null, status: 'OPEN',
      },
      update: {
        side, quantity: qty, entryPrice: entry, currentPrice: current, stopLossPrice: stop, takeProfitPrice: target,
        unrealizedPnl, unrealizedPnlPct: pct(entry, current, side), protectionStatus: 'BROKER_SYNCED',
        brokerPositionId: p.asset_id || null, status: 'OPEN', openedAt: new Date(),
      },
    });
    const openTrade = await prisma.trade.findFirst({ where: { asset: sym, status: 'OPEN' } });
    if (!openTrade) {
      await prisma.trade.create({
        data: {
          asset: sym, market: 'stocks', type: side as any, entryPrice: entry, quantity: qty, status: 'OPEN',
          brokerConfirmed: true, stopLossPrice: stop, takeProfitPrice: target,
          reconciliationStatus: 'IMPORTED_FROM_BROKER', metadata: { source: 'brokerSync', mode: getActiveMode() } as any,
        },
      });
    }
    result.imported.push(sym);
  }

  // DB says open, broker says flat → it was closed at the broker (bracket leg, manual close…).
  for (const pos of dbOpen) {
    if (held.has(pos.asset)) continue;
    const trade = await prisma.trade.findFirst({ where: { asset: pos.asset, status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
    if (trade && !trade.brokerConfirmed) continue; // local simulation — the app's own monitor owns it
    let exitPrice = pos.currentPrice;
    try {
      const orders: any[] = await broker.getOrders('closed', 50);
      const exit = orders.find(o => o.symbol === pos.asset && o.status === 'filled' && o.side === (pos.side === 'BUY' ? 'sell' : 'buy'));
      if (exit?.filled_avg_price) exitPrice = parseFloat(exit.filled_avg_price);
    } catch { /* keep last price */ }
    await prisma.position.update({ where: { id: pos.id }, data: { status: 'CLOSED', currentPrice: exitPrice } }).catch(() => {});
    if (trade) {
      const dir = trade.type === 'SELL' ? -1 : 1;
      const pnl = (exitPrice - trade.entryPrice) * trade.quantity * dir;
      await prisma.trade.update({
        where: { id: trade.id },
        data: {
          status: 'CLOSED', exitPrice, closedAt: new Date(), pnl, pnlPct: (pnl / (trade.entryPrice * trade.quantity)) * 100,
          exitReason: 'Closed at broker (reconciled)', reconciliationStatus: 'BROKER_RECONCILED',
        },
      }).catch(() => {});
    }
    result.closed.push(pos.asset);
  }

  if (result.imported.length || result.closed.length) {
    logger.info(`🔄 Broker sync: imported [${result.imported.join(', ')}] closed [${result.closed.join(', ')}]`);
  }
  lastResult = { ...result, at: new Date().toISOString() } as any;
  return result;
}
