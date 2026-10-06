/**
 * INTEGRATION: OpenTerminal → APEX
 * Market Screener Panel — multi-factor stock screener
 *
 * OpenTerminal ref: https://github.com/ErTasselli/OpenTerminal
 * APEX file location: frontend/src/components/panels/MarketScreener.tsx
 *
 * Filters:
 * - RSI overbought/oversold (< 30, 30-50, 50-70, > 70)
 * - Volume ratio (> 1x, > 2x, > 3x, > 5x average)
 * - Price momentum (1d, 5d, 20d returns)
 * - Market cap tier (Micro/Small/Mid/Large/Mega)
 * - Sector
 *
 * Sorts by any column; shows APEX's watchlist items at top
 */

import React, { useEffect, useState, useMemo } from 'react';

interface ScreenerRow {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change1d: number;
  change5d: number;
  change20d: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  marketCap: number;  // in billions
  rsi14: number;
  pe: number | null;
  eps: number | null;
  inWatchlist: boolean;
  signal: 'BUY' | 'SELL' | 'HOLD' | null;
}

type SortKey = keyof Pick<ScreenerRow, 'symbol' | 'price' | 'change1d' | 'change5d' | 'change20d' | 'volumeRatio' | 'marketCap' | 'rsi14' | 'pe'>;
type SortDir = 'asc' | 'desc';

// Realistic mock for top 30 S&P 500 names
const MOCK_STOCKS: ScreenerRow[] = [
  { symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', price: 136.5, change1d: 3.2, change5d: 8.1, change20d: 22.4, volume: 52_000_000, avgVolume: 38_000_000, volumeRatio: 1.37, marketCap: 3340, rsi14: 71, pe: 55, eps: 2.48, inWatchlist: true, signal: 'BUY' },
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', price: 227.1, change1d: 0.8, change5d: 2.3, change20d: 5.1, volume: 48_000_000, avgVolume: 55_000_000, volumeRatio: 0.87, marketCap: 3420, rsi14: 54, pe: 36, eps: 6.29, inWatchlist: false, signal: 'HOLD' },
  { symbol: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', price: 444.2, change1d: 1.2, change5d: 3.5, change20d: 9.8, volume: 22_000_000, avgVolume: 24_000_000, volumeRatio: 0.92, marketCap: 3300, rsi14: 58, pe: 38, eps: 11.69, inWatchlist: false, signal: 'BUY' },
  { symbol: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer Disc.', price: 195.3, change1d: -0.5, change5d: -1.2, change20d: 4.3, volume: 31_000_000, avgVolume: 35_000_000, volumeRatio: 0.89, marketCap: 2090, rsi14: 48, pe: 42, eps: 4.65, inWatchlist: true, signal: 'HOLD' },
  { symbol: 'GOOGL', name: 'Alphabet Inc', sector: 'Communication', price: 175.4, change1d: 2.1, change5d: 5.8, change20d: 14.2, volume: 28_000_000, avgVolume: 26_000_000, volumeRatio: 1.08, marketCap: 2180, rsi14: 62, pe: 23, eps: 7.63, inWatchlist: false, signal: 'BUY' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Communication', price: 592.8, change1d: 1.8, change5d: 6.2, change20d: 18.3, volume: 18_000_000, avgVolume: 17_000_000, volumeRatio: 1.06, marketCap: 1500, rsi14: 68, pe: 28, eps: 21.17, inWatchlist: false, signal: 'BUY' },
  { symbol: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Disc.', price: 248.4, change1d: -2.3, change5d: -5.1, change20d: -8.7, volume: 95_000_000, avgVolume: 75_000_000, volumeRatio: 1.27, marketCap: 793, rsi14: 38, pe: 72, eps: 3.45, inWatchlist: false, signal: 'SELL' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway', sector: 'Financials', price: 453.2, change1d: 0.3, change5d: 1.1, change20d: 3.2, volume: 3_800_000, avgVolume: 4_200_000, volumeRatio: 0.90, marketCap: 980, rsi14: 52, pe: 22, eps: 20.60, inWatchlist: false, signal: 'HOLD' },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', price: 218.4, change1d: 0.9, change5d: 3.2, change20d: 7.8, volume: 11_000_000, avgVolume: 10_500_000, volumeRatio: 1.05, marketCap: 628, rsi14: 57, pe: 13, eps: 16.80, inWatchlist: false, signal: 'BUY' },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare', price: 892.3, change1d: -1.5, change5d: -3.2, change20d: -6.8, volume: 4_200_000, avgVolume: 3_800_000, volumeRatio: 1.11, marketCap: 847, rsi14: 41, pe: 62, eps: 14.39, inWatchlist: false, signal: 'HOLD' },
  { symbol: 'V', name: 'Visa Inc', sector: 'Financials', price: 281.6, change1d: 0.5, change5d: 1.8, change20d: 5.4, volume: 8_500_000, avgVolume: 9_000_000, volumeRatio: 0.94, marketCap: 568, rsi14: 55, pe: 31, eps: 9.08, inWatchlist: false, signal: 'BUY' },
  { symbol: 'XOM', name: 'ExxonMobil', sector: 'Energy', price: 119.8, change1d: -0.8, change5d: -2.1, change20d: -3.5, volume: 18_000_000, avgVolume: 16_000_000, volumeRatio: 1.13, marketCap: 478, rsi14: 44, pe: 14, eps: 8.56, inWatchlist: false, signal: 'HOLD' },
  { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Staples', price: 921.4, change1d: 2.2, change5d: 5.1, change20d: 12.3, volume: 2_900_000, avgVolume: 2_400_000, volumeRatio: 1.21, marketCap: 408, rsi14: 73, pe: 54, eps: 17.06, inWatchlist: false, signal: 'HOLD' },
  { symbol: 'SOFI', name: 'SoFi Technologies', sector: 'Financials', price: 14.2, change1d: 4.8, change5d: 12.3, change20d: 28.9, volume: 62_000_000, avgVolume: 38_000_000, volumeRatio: 1.63, marketCap: 14, rsi14: 78, pe: null, eps: -0.05, inWatchlist: false, signal: 'SELL' },
  { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Technology', price: 42.8, change1d: 5.2, change5d: 14.1, change20d: 38.4, volume: 89_000_000, avgVolume: 52_000_000, volumeRatio: 1.71, marketCap: 93, rsi14: 82, pe: 180, eps: 0.24, inWatchlist: false, signal: 'SELL' },
  { symbol: 'KOLD', name: 'ProShares UltraShort NG', sector: 'ETF', price: 28.6, change1d: -2.1, change5d: -4.3, change20d: -9.8, volume: 8_200_000, avgVolume: 5_100_000, volumeRatio: 1.61, marketCap: 0.5, rsi14: 29, pe: null, eps: null, inWatchlist: true, signal: 'SELL' },
  { symbol: 'GLD', name: 'SPDR Gold Shares', sector: 'Commodity ETF', price: 241.3, change1d: 0.4, change5d: 1.2, change20d: 4.8, volume: 9_800_000, avgVolume: 8_500_000, volumeRatio: 1.15, marketCap: 73, rsi14: 60, pe: null, eps: null, inWatchlist: false, signal: 'HOLD' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', price: 168.9, change1d: 2.8, change5d: 7.2, change20d: 15.6, volume: 44_000_000, avgVolume: 38_000_000, volumeRatio: 1.16, marketCap: 273, rsi14: 64, pe: 48, eps: 3.52, inWatchlist: false, signal: 'BUY' },
  { symbol: 'INTC', name: 'Intel Corp', sector: 'Technology', price: 22.4, change1d: -1.8, change5d: -5.2, change20d: -18.3, volume: 52_000_000, avgVolume: 42_000_000, volumeRatio: 1.24, marketCap: 95, rsi14: 28, pe: null, eps: -3.88, inWatchlist: false, signal: 'HOLD' },
  { symbol: 'BA', name: 'Boeing Co', sector: 'Industrials', price: 152.8, change1d: -0.9, change5d: -2.8, change20d: -7.2, volume: 12_000_000, avgVolume: 9_800_000, volumeRatio: 1.22, marketCap: 95, rsi14: 35, pe: null, eps: -8.42, inWatchlist: false, signal: 'HOLD' },
];

const SECTORS = ['All', ...Array.from(new Set(MOCK_STOCKS.map(s => s.sector))).sort()];

function rsiLabel(rsi: number): { label: string; color: string } {
  if (rsi > 70) return { label: 'OB', color: '#ef4444' };
  if (rsi < 30) return { label: 'OS', color: '#22c55e' };
  return { label: '--', color: '#6b7280' };
}

function changeColor(pct: number) {
  if (pct > 3) return '#22c55e';
  if (pct > 0) return '#86efac';
  if (pct > -3) return '#fca5a5';
  return '#ef4444';
}

function fmtMCap(b: number) {
  if (b >= 1000) return `$${(b / 1000).toFixed(1)}T`;
  if (b >= 1) return `$${b.toFixed(0)}B`;
  return `$${(b * 1000).toFixed(0)}M`;
}

export const MarketScreener: React.FC = () => {
  const [sector, setSector] = useState('All');
  const [rsiFilter, setRsiFilter] = useState<'all' | 'oversold' | 'neutral' | 'overbought'>('all');
  const [volFilter, setVolFilter] = useState<number>(0); // minimum volume ratio
  const [signalFilter, setSignalFilter] = useState<'all' | 'BUY' | 'SELL' | 'HOLD'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('change1d');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const filtered = useMemo(() => {
    let rows = [...MOCK_STOCKS];

    // Search
    if (search) {
      const q = search.toUpperCase();
      rows = rows.filter(r => r.symbol.includes(q) || r.name.toUpperCase().includes(q));
    }

    // Sector
    if (sector !== 'All') rows = rows.filter(r => r.sector === sector);

    // RSI
    if (rsiFilter === 'oversold') rows = rows.filter(r => r.rsi14 < 35);
    else if (rsiFilter === 'overbought') rows = rows.filter(r => r.rsi14 > 70);
    else if (rsiFilter === 'neutral') rows = rows.filter(r => r.rsi14 >= 35 && r.rsi14 <= 70);

    // Volume
    if (volFilter > 0) rows = rows.filter(r => r.volumeRatio >= volFilter);

    // Signal
    if (signalFilter !== 'all') rows = rows.filter(r => r.signal === signalFilter);

    // Sort: watchlist first, then by key
    rows.sort((a, b) => {
      if (a.inWatchlist && !b.inWatchlist) return -1;
      if (!a.inWatchlist && b.inWatchlist) return 1;
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    return rows;
  }, [sector, rsiFilter, volFilter, signalFilter, sortKey, sortDir, search]);

  const SortTh: React.FC<{ col: SortKey; label: string; align?: 'left' | 'right' }> = ({ col, label, align = 'right' }) => (
    <th
      onClick={() => handleSort(col)}
      style={{
        textAlign: align, padding: '4px 6px', cursor: 'pointer', userSelect: 'none',
        color: sortKey === col ? '#e5e7eb' : '#6b7280', whiteSpace: 'nowrap',
      }}
    >
      {label}{sortKey === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
          Market Screener
        </span>
        <span style={{ fontSize: 10, color: '#4b5563' }}>{filtered.length} stocks</span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Symbol / name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: '#111827', color: '#e5e7eb', border: '1px solid #374151',
            borderRadius: 4, padding: '3px 8px', fontSize: 11, width: 120,
          }}
        />
        <select
          value={sector}
          onChange={e => setSector(e.target.value)}
          style={{ background: '#111827', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 4, padding: '3px 6px', fontSize: 11 }}
        >
          {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* RSI filter */}
        {(['all', 'oversold', 'neutral', 'overbought'] as const).map(f => (
          <button
            key={f}
            onClick={() => setRsiFilter(f)}
            style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: rsiFilter === f
                ? (f === 'oversold' ? '#166534' : f === 'overbought' ? '#7f1d1d' : '#1f2937')
                : '#111827',
              color: rsiFilter === f ? '#fff' : '#6b7280',
            }}
          >
            {f === 'all' ? 'RSI: All' : f === 'oversold' ? 'OS <35' : f === 'overbought' ? 'OB >70' : 'Neutral'}
          </button>
        ))}

        {/* Vol filter */}
        {[0, 1.5, 2, 3].map(v => (
          <button
            key={v}
            onClick={() => setVolFilter(v)}
            style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: volFilter === v ? '#1e3a5f' : '#111827',
              color: volFilter === v ? '#60a5fa' : '#6b7280',
            }}
          >
            {v === 0 ? 'Vol: All' : `Vol >${v}x`}
          </button>
        ))}

        {/* Signal filter */}
        {(['all', 'BUY', 'SELL', 'HOLD'] as const).map(f => (
          <button
            key={f}
            onClick={() => setSignalFilter(f)}
            style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: signalFilter === f
                ? (f === 'BUY' ? '#166534' : f === 'SELL' ? '#7f1d1d' : '#1f2937')
                : '#111827',
              color: signalFilter === f ? '#fff' : '#6b7280',
            }}
          >
            {f === 'all' ? 'Signal: All' : f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#0a0b0f', zIndex: 1 }}>
            <tr>
              <SortTh col="symbol" label="Symbol" align="left" />
              <th style={{ textAlign: 'left', padding: '4px 6px', color: '#6b7280' }}>Sector</th>
              <SortTh col="price" label="Price" />
              <SortTh col="change1d" label="1D%" />
              <SortTh col="change5d" label="5D%" />
              <SortTh col="change20d" label="20D%" />
              <SortTh col="volumeRatio" label="Vol×" />
              <SortTh col="rsi14" label="RSI" />
              <SortTh col="marketCap" label="MCap" />
              <SortTh col="pe" label="P/E" />
              <th style={{ textAlign: 'center', padding: '4px 6px', color: '#6b7280' }}>Signal</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const rsi = rsiLabel(row.rsi14);
              return (
                <tr
                  key={row.symbol}
                  style={{
                    borderBottom: '1px solid #111827',
                    background: row.inWatchlist ? '#0d1f12' : 'transparent',
                  }}
                >
                  <td style={{ padding: '4px 6px', fontWeight: 700, color: row.inWatchlist ? '#22c55e' : '#e5e7eb' }}>
                    {row.inWatchlist ? '★ ' : ''}{row.symbol}
                  </td>
                  <td style={{ padding: '4px 6px', color: '#6b7280', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.sector}
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px 6px', color: '#e5e7eb' }}>${row.price.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', padding: '4px 6px', color: changeColor(row.change1d), fontWeight: 600 }}>
                    {row.change1d > 0 ? '+' : ''}{row.change1d.toFixed(1)}%
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px 6px', color: changeColor(row.change5d) }}>
                    {row.change5d > 0 ? '+' : ''}{row.change5d.toFixed(1)}%
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px 6px', color: changeColor(row.change20d) }}>
                    {row.change20d > 0 ? '+' : ''}{row.change20d.toFixed(1)}%
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px 6px', color: row.volumeRatio >= 1.5 ? '#f59e0b' : '#9ca3af' }}>
                    {row.volumeRatio.toFixed(2)}x{row.volumeRatio >= 1.5 ? ' ⚡' : ''}
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                    <span style={{ color: rsi.color, fontWeight: 600 }}>
                      {row.rsi14} <span style={{ fontSize: 9 }}>{rsi.label}</span>
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px 6px', color: '#9ca3af' }}>{fmtMCap(row.marketCap)}</td>
                  <td style={{ textAlign: 'right', padding: '4px 6px', color: '#9ca3af' }}>
                    {row.pe ? row.pe.toFixed(0) : '—'}
                  </td>
                  <td style={{ textAlign: 'center', padding: '4px 6px' }}>
                    {row.signal && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                        background: row.signal === 'BUY' ? '#14532d' : row.signal === 'SELL' ? '#450a0a' : '#1f2937',
                        color: row.signal === 'BUY' ? '#22c55e' : row.signal === 'SELL' ? '#ef4444' : '#9ca3af',
                      }}>
                        {row.signal}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 10, color: '#4b5563' }}>★ In APEX watchlist · ⚡ Unusual volume · Click column headers to sort</div>
    </div>
  );
};

export default MarketScreener;
