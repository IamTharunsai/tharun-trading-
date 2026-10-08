import type { TradeSignal } from '../agents/types';

export function buildStockOrder(signal: TradeSignal, quantity: number) {
  if (signal.market !== 'stocks' || !['BUY', 'SELL'].includes(signal.direction)
    || !Number.isFinite(quantity) || quantity <= 0) return null;
  // Whole-share brackets cannot contain fractional quantities. Never round up risk.
  const whole = Math.floor(quantity);
  if (whole === 0 && signal.direction === 'SELL') return null;
  const qty = whole > 0 ? whole : Math.floor(quantity * 1e6) / 1e6;
  if (qty <= 0) return null;
  const payload: any = { symbol: signal.asset, qty, side: signal.direction === 'BUY' ? 'buy' : 'sell', type: 'market', time_in_force: 'day' };
  if (whole > 0 && Number.isFinite(signal.stopLossPrice) && Number.isFinite(signal.takeProfitPrice)
    && signal.stopLossPrice > 0 && signal.takeProfitPrice > 0) {
    payload.order_class = 'bracket';
    payload.time_in_force = 'gtc';
    payload.stop_loss = { stop_price: Number(signal.stopLossPrice.toFixed(2)) };
    payload.take_profit = { limit_price: Number(signal.takeProfitPrice.toFixed(2)) };
    return { payload, protection: 'BROKER_HOSTED' };
  }
  return { payload, protection: 'APPLICATION_MONITORED' };
}
