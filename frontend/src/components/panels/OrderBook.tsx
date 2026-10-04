/**
 * INTEGRATION: OpenTerminal → APEX
 * Order Book / Level 2 Panel — real-time bid/ask depth visualization
 *
 * OpenTerminal ref: https://github.com/ErTasselli/OpenTerminal
 * APEX file location: frontend/src/components/panels/OrderBook.tsx
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';

interface OrderLevel {
  price: number;
  size: number;
  total: number;    // cumulative
  pct: number;      // % of max cumulative (for bar fill)
  count?: number;   // order count
}

interface OrderBookData {
  symbol: string;
  exchange: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
  spread: number;
  spreadPct: number;
  midPrice: number;
  lastPrice: number;
  lastChange: number;
  lastChangePct: number;
  imbalance: number;  // bid volume / (bid + ask) — >0.5 bullish
  timestamp: number;
}

interface Trade {
  price: number;
  size: number;
  side: 'buy' | 'sell';
  ts: number;
}

/** Generate realistic order book data with slight variation each call */
function generateOrderBook(symbol: string, basePrice: number): OrderBookData {
  const jitter = () => (Math.random() - 0.5) * 0.001;
  const mid = basePrice * (1 + jitter());
  const spread = mid * 0.0003 + mid * Math.random() * 0.0002;
  const bestBid = mid - spread / 2;
  const bestAsk = mid + spread / 2;
  const LEVELS = 12;

  const bids: Omit<OrderLevel, 'total' | 'pct'>[] = Array.from({ length: LEVELS }, (_, i) => ({
    price: bestBid - i * (mid * 0.0001 + Math.random() * mid * 0.00005),
    size: 100 + Math.floor(Math.random() * 2000) + (i === 0 ? 500 : 0),
    count: 1 + Math.floor(Math.random() * 8),
  }));

  const asks: Omit<OrderLevel, 'total' | 'pct'>[] = Array.from({ length: LEVELS }, (_, i) => ({
    price: bestAsk + i * (mid * 0.0001 + Math.random() * mid * 0.00005),
    size: 80 + Math.floor(Math.random() * 2000) + (i === 0 ? 300 : 0),
    count: 1 + Math.floor(Math.random() * 8),
  }));

  // Compute cumulative totals
  let bidCum = 0;
  const bidsWithTotal = bids.map(b => { bidCum += b.size; return { ...b, total: bidCum, pct: 0 }; });
  let askCum = 0;
  const asksWithTotal = asks.map(a => { askCum += a.size; return { ...a, total: askCum, pct: 0 }; });
  const maxCum = Math.max(bidCum, askCum);
  bidsWithTotal.forEach(b => { b.pct = b.total / maxCum; });
  asksWithTotal.forEach(a => { a.pct = a.total / maxCum; });

  const bidVol = bids.reduce((s, b) => s + b.size, 0);
  const askVol = asks.reduce((s, a) => s + a.size, 0);

  return {
    symbol,
    exchange: symbol.includes('/') ? 'Binance' : 'NYSE/NASDAQ',
    bids:     bidsWithTotal,
    asks:     asksWithTotal,
    spread:   parseFloat((bestAsk - bestBid).toFixed(4)),
    spreadPct: parseFloat(((bestAsk - bestBid) / mid * 100).toFixed(4)),
    midPrice:  parseFloat(mid.toFixed(2)),
    lastPrice: parseFloat((mid + (Math.random() - 0.5) * spread).toFixed(2)),
    lastChange: parseFloat(((Math.random() - 0.45) * mid * 0.005).toFixed(2)),
    lastChangePct: parseFloat(((Math.random() - 0.45) * 0.5).toFixed(3)),
    imbalance: bidVol / (bidVol + askVol),
    timestamp: Date.now(),
  };
}

function generateTrade(midPrice: number): Trade {
  const side = Math.random() > 0.48 ? 'buy' : 'sell';
  return {
    price: parseFloat((midPrice + (side === 'buy' ? 1 : -1) * midPrice * 0.0001 * Math.random()).toFixed(2)),
    size: Math.floor(10 + Math.random() * 500),
    side,
    ts: Date.now(),
  };
}

const SYMBOLS: { label: string; price: number }[] = [
  { label: 'SPY',   price: 574.2  },
  { label: 'QQQ',   price: 489.6  },
  { label: 'AAPL',  price: 226.5  },
  { label: 'TSLA',  price: 258.3  },
  { label: 'BTC/USD', price: 61250 },
  { label: 'ETH/USD', price: 2485  },
];

export const OrderBook: React.FC = () => {
  const [symbol,    setSymbol]    = useState(SYMBOLS[0]);
  const [book,      setBook]      = useState<OrderBookData | null>(null);
  const [trades,    setTrades]    = useState<Trade[]>([]);
  const [view,      setView]      = useState<'book' | 'depth' | 'tape'>('book');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    const newBook = generateOrderBook(symbol.label, symbol.price);
    setBook(newBook);
    setTrades(prev => {
      const t = generateTrade(newBook.midPrice);
      return [t, ...prev].slice(0, 40);
    });
  }, [symbol]);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, 1200);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refresh]);

  if (!book) return null;

  const priceColor = book.lastChange >= 0 ? '#22c55e' : '#ef4444';
  const imbalancePct = Math.round(book.imbalance * 100);
  const imbalanceBias = imbalancePct > 55 ? '📈 Bid-Heavy' : imbalancePct < 45 ? '📉 Ask-Heavy' : '⚖️ Balanced';

  return (
    <div style={{
      background: 'var(--panel-bg, #0f0f0f)',
      border: '1px solid var(--border, #1e2a3a)',
      borderRadius: 12,
      padding: 20,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      color: 'var(--text, #e2e8f0)',
      fontSize: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>📊</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.5, fontFamily: 'system-ui' }}>Order Book</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim, #64748b)', fontFamily: 'system-ui' }}>Level 2 Depth · {book.exchange}</div>
          </div>
        </div>

        {/* Symbol selector */}
        <select
          value={symbol.label}
          onChange={e => {
            const s = SYMBOLS.find(x => x.label === e.target.value)!;
            setSymbol(s);
          }}
          style={{
            background: 'var(--surface, #141a24)', color: 'var(--text, #e2e8f0)',
            border: '1px solid var(--border, #1e2a3a)', borderRadius: 6,
            padding: '4px 8px', fontSize: 12, cursor: 'pointer',
          }}
        >
          {SYMBOLS.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
        </select>
      </div>

      {/* Price + stats row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: priceColor }}>
          ${book.lastPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div style={{ fontSize: 12, color: priceColor }}>
          {book.lastChange >= 0 ? '+' : ''}{book.lastChange.toFixed(2)} ({book.lastChangePct >= 0 ? '+' : ''}{book.lastChangePct.toFixed(2)}%)
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim, #64748b)', marginLeft: 'auto' }}>
          Spread: <b style={{ color: 'var(--text, #e2e8f0)' }}>{book.spread.toFixed(4)} ({book.spreadPct.toFixed(3)}%)</b>
        </div>
      </div>

      {/* Order imbalance bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim, #64748b)' }}>
          <span style={{ color: '#22c55e' }}>BID {imbalancePct}%</span>
          <span style={{ fontFamily: 'system-ui' }}>{imbalanceBias}</span>
          <span style={{ color: '#ef4444' }}>ASK {100 - imbalancePct}%</span>
        </div>
        <div style={{ height: 6, background: '#ef4444', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${imbalancePct}%`, background: '#22c55e', transition: 'width 0.8s ease' }} />
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border, #1e2a3a)' }}>
        {(['book', 'depth', 'tape'] as const).map(t => (
          <button key={t} onClick={() => setView(t)} style={{
            padding: '5px 12px', border: 'none', cursor: 'pointer', fontSize: 11,
            background: 'transparent', fontFamily: 'system-ui', fontWeight: 600,
            color: view === t ? '#3b82f6' : 'var(--text-dim, #64748b)',
            borderBottom: view === t ? '2px solid #3b82f6' : '2px solid transparent',
            textTransform: 'capitalize',
          }}>{t === 'book' ? '📋 L2 Book' : t === 'depth' ? '📈 Depth' : '🔁 Tape'}</button>
        ))}
      </div>

      {/* L2 Order Book */}
      {view === 'book' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
            fontSize: 10, color: 'var(--text-dim, #64748b)',
            fontWeight: 600, letterSpacing: 0.5, marginBottom: 6,
            borderBottom: '1px solid var(--border, #1e2a3a)', paddingBottom: 4,
          }}>
            <span>COUNT</span><span style={{ textAlign: 'right' }}>SIZE</span>
            <span style={{ textAlign: 'right' }}>PRICE</span><span style={{ textAlign: 'right' }}>TOTAL</span>
          </div>

          {/* Asks (reversed — highest at top) */}
          {[...book.asks].reverse().map((level, i) => (
            <div key={`ask-${i}`} style={{ position: 'relative', marginBottom: 2 }}>
              <div style={{
                position: 'absolute', right: 0, top: 0, bottom: 0,
                width: `${level.pct * 100}%`, background: 'rgba(239,68,68,0.12)',
                borderRadius: 2,
              }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '2px 0', position: 'relative' }}>
                <span style={{ color: 'var(--text-dim, #64748b)', fontSize: 10 }}>{level.count}</span>
                <span style={{ textAlign: 'right', color: '#ef4444' }}>{level.size.toLocaleString()}</span>
                <span style={{ textAlign: 'right', color: '#ef4444', fontWeight: 600 }}>{level.price.toFixed(2)}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-dim, #64748b)', fontSize: 10 }}>{level.total.toLocaleString()}</span>
              </div>
            </div>
          ))}

          {/* Spread indicator */}
          <div style={{
            textAlign: 'center', padding: '6px 0', fontSize: 10,
            color: '#f59e0b', borderTop: '1px dashed #f59e0b30', borderBottom: '1px dashed #f59e0b30',
            margin: '4px 0', letterSpacing: 0.5,
          }}>
            SPREAD  {book.spread.toFixed(4)}  ·  MID {book.midPrice.toFixed(2)}
          </div>

          {/* Bids */}
          {book.bids.map((level, i) => (
            <div key={`bid-${i}`} style={{ position: 'relative', marginBottom: 2 }}>
              <div style={{
                position: 'absolute', right: 0, top: 0, bottom: 0,
                width: `${level.pct * 100}%`, background: 'rgba(34,197,94,0.12)',
                borderRadius: 2,
              }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '2px 0', position: 'relative' }}>
                <span style={{ color: 'var(--text-dim, #64748b)', fontSize: 10 }}>{level.count}</span>
                <span style={{ textAlign: 'right', color: '#22c55e' }}>{level.size.toLocaleString()}</span>
                <span style={{ textAlign: 'right', color: '#22c55e', fontWeight: 600 }}>{level.price.toFixed(2)}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-dim, #64748b)', fontSize: 10 }}>{level.total.toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Depth Chart (SVG) */}
      {view === 'depth' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <svg width="100%" height="180" style={{ overflow: 'visible' }}>
            {(() => {
              const W = 400, H = 160;
              const allBids = [...book.bids].sort((a, b) => b.price - a.price);
              const allAsks = [...book.asks].sort((a, b) => a.price - b.price);
              const minPrice = allBids[allBids.length - 1]?.price || 0;
              const maxPrice = allAsks[allAsks.length - 1]?.price || 1;
              const maxCum   = Math.max(allBids[allBids.length - 1]?.total || 0, allAsks[allAsks.length - 1]?.total || 0);
              const px = (p: number) => ((p - minPrice) / (maxPrice - minPrice)) * W;
              const py = (v: number) => H - (v / maxCum) * H;

              const bidPath = allBids.map((b, i) => `${i === 0 ? 'M' : 'L'} ${px(b.price).toFixed(1)} ${py(b.total).toFixed(1)}`).join(' ');
              const askPath = allAsks.map((a, i) => `${i === 0 ? 'M' : 'L'} ${px(a.price).toFixed(1)} ${py(a.total).toFixed(1)}`).join(' ');

              return (
                <>
                  <defs>
                    <linearGradient id="bidGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="askGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* Bid area */}
                  <path d={`${bidPath} L ${px(minPrice).toFixed(1)} ${H} Z`} fill="url(#bidGrad)" />
                  <path d={bidPath} fill="none" stroke="#22c55e" strokeWidth="1.5" />
                  {/* Ask area */}
                  <path d={`${askPath} L ${px(maxPrice).toFixed(1)} ${H} Z`} fill="url(#askGrad)" />
                  <path d={askPath} fill="none" stroke="#ef4444" strokeWidth="1.5" />
                  {/* Mid line */}
                  <line x1={px(book.midPrice)} y1={0} x2={px(book.midPrice)} y2={H} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4,3" opacity="0.7" />
                </>
              );
            })()}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim, #64748b)' }}>
            <span style={{ color: '#22c55e' }}>▶ Bids</span>
            <span style={{ color: '#f59e0b' }}>Mid {book.midPrice.toFixed(2)}</span>
            <span style={{ color: '#ef4444' }}>Asks ◀</span>
          </div>
        </div>
      )}

      {/* Time & Sales tape */}
      {view === 'tape' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            fontSize: 10, color: 'var(--text-dim, #64748b)', fontWeight: 600,
            marginBottom: 6, borderBottom: '1px solid var(--border, #1e2a3a)', paddingBottom: 4,
          }}>
            <span>TIME</span><span style={{ textAlign: 'right' }}>PRICE</span><span style={{ textAlign: 'right' }}>SIZE</span>
          </div>
          {trades.map((t, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
              background: i === 0 ? (t.side === 'buy' ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)') : 'transparent',
            }}>
              <span style={{ color: 'var(--text-dim, #64748b)', fontSize: 10 }}>
                {new Date(t.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span style={{ textAlign: 'right', color: t.side === 'buy' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                {t.price.toFixed(2)}
              </span>
              <span style={{ textAlign: 'right', color: 'var(--text, #e2e8f0)' }}>
                {t.size.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OrderBook;
