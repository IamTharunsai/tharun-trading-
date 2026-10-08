import { HistoricalBar } from './historicalBars';

export interface ReplaySettings {
  initialCapital: number; feePct: number; slippageBps: number; riskPct: number;
  maxPositionPct: number; stopLossPct: number; maxHoldBars: number;
}
export interface ReplayTrade {
  symbol: string; signalAt: number; enteredAt: number; exitedAt: number;
  entryPrice: number; exitPrice: number; quantity: number; fees: number; pnl: number;
  exitReason: 'STOP' | 'TIME' | 'END_OF_DATA';
}
export interface ReplayPoint { timestamp: number; cash: number; holdings: number; equity: number }
type Position = { entryPrice: number; quantity: number; fee: number; stop: number; signalAt: number; enteredAt: number; index: number };

/** Shared cash account, no borrowing. Decisions receive completed history only.
 * An entry waits one full bar before the following open; same-boundary fills are
 * deliberately not assumed executable. Stop fills use the worse of open/stop.
 * OHLC execution is an explicit research model, not proof of venue fills.
 */
export function replayLedger(data: Record<string, HistoricalBar[]>, settings: ReplaySettings,
  signal: (symbol: string, completedHistory: readonly HistoricalBar[]) => boolean) {
  const { initialCapital, feePct, slippageBps, riskPct, maxPositionPct, stopLossPct, maxHoldBars } = settings;
  if (![initialCapital, feePct, slippageBps, riskPct, maxPositionPct, stopLossPct, maxHoldBars].every(Number.isFinite)
    || initialCapital <= 0 || feePct < 0 || feePct > 10 || slippageBps < 0 || slippageBps > 1000
    || riskPct <= 0 || riskPct > 100 || maxPositionPct <= 0 || maxPositionPct > 100
    || stopLossPct <= 0 || stopLossPct >= 100 || !Number.isInteger(maxHoldBars) || maxHoldBars < 1) {
    throw new Error('Invalid replay risk, costs or holding period');
  }
  const feeRate = feePct / 100, slip = slippageBps / 10000;
  let cash = initialCapital;
  const positions = new Map<string, Position>();
  const marks = new Map<string, number>();
  const pending = new Map<string, { index: number; signalAt: number }>();
  const trades: ReplayTrade[] = [], equity: ReplayPoint[] = [];
  const events: { time: number; phase: 'OPEN' | 'CLOSE'; symbol: string; index: number }[] = [];
  for (const [symbol, bars] of Object.entries(data)) {
    if (!bars.length) throw new Error(`No replay bars for ${symbol}`);
    bars.forEach((bar, index) => {
      if (![bar.openTime, bar.timestamp, bar.open, bar.close, bar.high, bar.low, bar.volume].every(Number.isFinite)
        || bar.open <= 0 || bar.close <= 0 || bar.low <= 0 || bar.high < Math.max(bar.open, bar.close)
        || bar.low > Math.min(bar.open, bar.close) || bar.volume < 0 || bar.timestamp <= bar.openTime
        || (index > 0 && bar.openTime < bars[index - 1].timestamp)) throw new Error('Invalid replay bars');
      events.push({ time: bar.openTime, phase: 'OPEN', symbol, index }, { time: bar.timestamp, phase: 'CLOSE', symbol, index });
    });
  }
  // Close information is available before processing an open at that boundary.
  events.sort((a, b) => a.time - b.time || (a.phase === b.phase ? a.symbol.localeCompare(b.symbol) : a.phase === 'CLOSE' ? -1 : 1));
  const value = () => cash + [...positions.entries()].reduce((sum, [s, p]) => sum + p.quantity * (marks.get(s) ?? p.entryPrice), 0);
  const close = (symbol: string, rawPrice: number, time: number, reason: ReplayTrade['exitReason']) => {
    const position = positions.get(symbol)!;
    const price = rawPrice * (1 - slip), proceeds = price * position.quantity, exitFee = proceeds * feeRate;
    cash += proceeds - exitFee;
    trades.push({ symbol, signalAt: position.signalAt, enteredAt: position.enteredAt, exitedAt: time,
      entryPrice: position.entryPrice, exitPrice: price, quantity: position.quantity,
      fees: position.fee + exitFee, pnl: proceeds - exitFee - position.entryPrice * position.quantity - position.fee, exitReason: reason });
    positions.delete(symbol);
  };
  for (let cursor = 0; cursor < events.length;) {
    let end = cursor + 1;
    while (end < events.length && events[end].time === events[cursor].time) end++;
    const group = events.slice(cursor, end);
    let openingMarksApplied = false;
    for (const event of group) {
      const bars = data[event.symbol], bar = bars[event.index];
      if (event.phase === 'OPEN') {
        // Reserve from one simultaneous account valuation, rather than mixing
        // current opens for early tickers with stale closes for later tickers.
        if (!openingMarksApplied) {
          for (const opening of group.filter(item => item.phase === 'OPEN')) {
            marks.set(opening.symbol, data[opening.symbol][opening.index].open);
          }
          // All already-due exits release cash before any new entry reserves it.
          for (const opening of group.filter(item => item.phase === 'OPEN')) {
            const holding = positions.get(opening.symbol), openingBar = data[opening.symbol][opening.index];
            if (holding && openingBar.open <= holding.stop) close(opening.symbol, openingBar.open, opening.time, 'STOP');
            else if (holding && opening.index - holding.index >= maxHoldBars) close(opening.symbol, openingBar.open, opening.time, 'TIME');
          }
          openingMarksApplied = true;
        }
        marks.set(event.symbol, bar.open);
        // The OHLC opening print is the stated fill assumption. The completed
        // hour's volume is future information and cannot decide an opening fill.
        const intent = pending.get(event.symbol);
        if (intent && event.index >= intent.index) {
          pending.delete(event.symbol);
          if (!positions.has(event.symbol) && event.time > intent.signalAt) {
            const accountValue = value(), price = bar.open * (1 + slip), stop = price * (1 - stopLossPct / 100);
            const riskPerUnit = price - stop * (1 - slip) + feeRate * (price + stop * (1 - slip));
            const units = Math.min(accountValue * riskPct / 100 / riskPerUnit,
              accountValue * maxPositionPct / 100 / price, cash / (price * (1 + feeRate)));
            const quantity = Math.floor(units * 1e6) / 1e6;
            if (quantity > 0) {
              const fee = quantity * price * feeRate;
              cash -= quantity * price + fee;
              positions.set(event.symbol, { entryPrice: price, quantity, fee, stop, signalAt: intent.signalAt, enteredAt: event.time, index: event.index });
            }
          }
        }
      } else {
        const position = positions.get(event.symbol);
        if (position && bar.volume > 0 && bar.low <= position.stop) {
          // Intrabar order is unknown; this model uses a conservative stop and
          // records the observation time, not an invented intra-hour timestamp.
          close(event.symbol, Math.min(bar.open, position.stop), event.time, 'STOP');
        }
        marks.set(event.symbol, bar.close);
        if (event.index === bars.length - 1) {
          if (positions.has(event.symbol) && bar.volume > 0) close(event.symbol, bar.close, event.time, 'END_OF_DATA');
          pending.delete(event.symbol);
        } else if (!positions.has(event.symbol) && !pending.has(event.symbol)
          && event.index + 2 < bars.length && signal(event.symbol, bars.slice(0, event.index + 1))) {
          pending.set(event.symbol, { index: event.index + 2, signalAt: event.time });
        }
      }
    }
    const accountValue = value();
    if (!Number.isFinite(accountValue) || cash < -1e-7) throw new Error('Replay cash/valuation invariant violated');
    equity.push({ timestamp: group[0].time, cash, holdings: accountValue - cash, equity: accountValue });
    cursor = end;
  }
  const finalEquity = value();
  let peak = initialCapital, maxDrawdown = 0;
  for (const point of equity) { peak = Math.max(peak, point.equity); maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak * 100); }
  return { trades, equity, finalEquity, cash, openPositions: positions.size, maxDrawdown,
    totalFees: trades.reduce((sum, t) => sum + t.fees, 0) + [...positions.values()].reduce((sum, p) => sum + p.fee, 0) };
}
