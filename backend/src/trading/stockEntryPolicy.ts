import type { TradeSignal } from '../agents/types';

export interface StockEntryPolicy { sourceMaxAgeMs: number; quoteMaxAgeMs: number; maxDeviationBps: number; maxSpreadBps: number; clockSkewMs: number; }
export function readStockEntryPolicy(env: NodeJS.ProcessEnv = process.env): StockEntryPolicy {
  const read = (name: string, fallback: number, min: number, max: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error('STOCK_ENTRY_POLICY_INVALID');
    return value;
  };
  return { sourceMaxAgeMs: read('STOCK_ENTRY_SOURCE_MAX_AGE_MS', 300000, 1000, 300000),
    quoteMaxAgeMs: read('STOCK_ENTRY_QUOTE_MAX_AGE_MS', 3000, 1, 10000),
    maxDeviationBps: read('STOCK_ENTRY_MAX_DEVIATION_BPS', 50, 0.01, 100),
    maxSpreadBps: read('STOCK_ENTRY_MAX_SPREAD_BPS', 50, 0.01, 100),
    clockSkewMs: read('STOCK_ENTRY_CLOCK_SKEW_MS', 500, 0, 1000) };
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;

/** Stock-specific source age, distinct from assembly and pre-submit quote age.
 * Crypto needs its own real exchange provenance adapter; never synthesize it. */
export function assertStockEntrySource(snapshot: any, now = Date.now(), policy = readStockEntryPolicy()): void {
  const evidence = snapshot?.dataEvidence;
  if (snapshot?.market !== 'stocks' || evidence?.source !== 'Alpaca IEX' || evidence.timeframe !== '1Day'
    || !Number.isInteger(evidence.completedBars) || evidence.completedBars < 200
    || !finite(now) || !finite(evidence.receivedAt) || evidence.receivedAt > now
    || ![evidence.priceObservedAt, evidence.quoteObservedAt].every(value => positive(value)
      && value <= evidence.receivedAt + policy.clockSkewMs && now - value <= policy.sourceMaxAgeMs)) {
    throw new Error('STOCK_ENTRY_SOURCE_UNAVAILABLE_OR_STALE');
  }
}

export interface StockEntryQuote {
  symbol: string; source: 'Alpaca IEX'; bid: number; ask: number; observedAt: number; receivedAt: number;
}
export function assertStockEntryQuote(quote: StockEntryQuote, signal: TradeSignal, now = Date.now(), policy = readStockEntryPolicy()): number {
  if (signal.market !== 'stocks' || quote.symbol !== signal.asset || quote.source !== 'Alpaca IEX'
    || !positive(quote.bid) || !positive(quote.ask) || quote.bid > quote.ask
    || !positive(quote.observedAt) || !positive(quote.receivedAt) || !finite(now)
    || quote.receivedAt > now || quote.observedAt > quote.receivedAt + policy.clockSkewMs
    || now - quote.observedAt > policy.quoteMaxAgeMs
    || (quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2) * 10000 > policy.maxSpreadBps) {
    throw new Error('STOCK_ENTRY_QUOTE_UNAVAILABLE_OR_STALE');
  }
  const price = signal.direction === 'BUY' ? quote.ask : signal.direction === 'SELL' ? quote.bid : NaN;
  const stop = signal.stopLossPrice, target = signal.takeProfitPrice;
  if (!positive(price) || !positive(signal.entryPrice) || !positive(stop) || !positive(target)
    || Math.abs(price - signal.entryPrice) / signal.entryPrice * 10000 > policy.maxDeviationBps
    || (signal.direction === 'BUY' ? !(stop < price && price < target) : !(target < price && price < stop))
    // Existing top-trader LAW 3: at least 2:1 at the NEW side price.
    || Math.abs(target - price) / Math.abs(price - stop) < 2) throw new Error('STOCK_ENTRY_PRICE_OUTSIDE_APPROVED_PLAN');
  return price;
}

export function reduceStockEntryQuantity(signal: TradeSignal, notionalBudget: number, quotePrice: number): number {
  if (![signal.entryPrice, signal.stopLossPrice, notionalBudget, quotePrice].every(positive)) throw new Error('STOCK_ENTRY_BUDGET_INVALID');
  const originalQuantity = notionalBudget / signal.entryPrice;
  const originalStopBudget = originalQuantity * Math.abs(signal.entryPrice - signal.stopLossPrice);
  return Math.min(originalQuantity, notionalBudget / quotePrice, originalStopBudget / Math.abs(quotePrice - signal.stopLossPrice));
}
export function assertStockEntryBudget(signal: TradeSignal, quantity: number, price: number, notionalBudget: number, originalStopBudget: number): void {
  if (![quantity, price, notionalBudget, originalStopBudget].every(positive)
    || quantity * price > notionalBudget + 1e-8 || quantity * Math.abs(price - signal.stopLossPrice) > originalStopBudget + 1e-8) {
    throw new Error('STOCK_ENTRY_BUDGET_CHANGED');
  }
}
