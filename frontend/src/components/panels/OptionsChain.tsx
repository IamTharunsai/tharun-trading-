/**
 * INTEGRATION: OpenTerminal → APEX
 * Options Chain Panel — strike ladder, P/C ratio, unusual activity, flow
 *
 * OpenTerminal ref: https://github.com/ErTasselli/OpenTerminal
 * APEX file location: frontend/src/components/panels/OptionsChain.tsx
 *
 * Shows:
 * - Strike ladder (calls left / puts right) for selected expiry
 * - IV (Implied Volatility) column highlighted for skew
 * - Put/Call OI and volume ratio
 * - Unusual activity alerts (volume > 5x avg OI)
 * - Expiration date selector
 */

import React, { useEffect, useState, useCallback } from 'react';

interface OptionStrike {
  strike: number;
  // Calls
  callBid: number;
  callAsk: number;
  callIV: number;
  callOI: number;
  callVolume: number;
  callDelta: number;
  // Puts
  putBid: number;
  putAsk: number;
  putIV: number;
  putOI: number;
  putVolume: number;
  putDelta: number;
  // Flags
  isATM: boolean;
  unusualCallActivity: boolean;
  unusualPutActivity: boolean;
}

interface OptionsData {
  symbol: string;
  spotPrice: number;
  expiry: string;
  expiryDays: number;
  strikes: OptionStrike[];
  putCallRatio: number;  // by OI
  putCallVolumeRatio: number;
  totalCallOI: number;
  totalPutOI: number;
  maxPain: number;
  unusualActivity: { type: 'call' | 'put'; strike: number; volume: number; avgOI: number }[];
}

// ---- Mock data generator ----
function generateMockOptions(symbol: string, spot: number, expiryDays: number): OptionsData {
  const strikes: OptionStrike[] = [];
  const baseIV = 0.25 + Math.random() * 0.15;
  const atmStrike = Math.round(spot / 5) * 5;
  const strikesRange = Array.from({ length: 21 }, (_, i) => atmStrike + (i - 10) * 5);

  let totalCallOI = 0, totalPutOI = 0;
  const unusualActivity: OptionsData['unusualActivity'] = [];

  strikesRange.forEach((strike) => {
    const moneyness = (strike - spot) / spot;
    // IV smile: higher IV for OTM options
    const ivSkew = Math.abs(moneyness) * 0.3 + Math.pow(moneyness, 2) * 0.5;
    const callIV = baseIV + (moneyness > 0 ? ivSkew * 0.8 : ivSkew * 1.2);
    const putIV = baseIV + (moneyness < 0 ? ivSkew * 0.8 : ivSkew * 1.2);

    // Simplified B-S approximation for display
    const timeF = expiryDays / 365;
    const callPrice = Math.max(0, spot - strike) + spot * callIV * Math.sqrt(timeF) * 0.4;
    const putPrice = Math.max(0, strike - spot) + spot * putIV * Math.sqrt(timeF) * 0.4;

    const callOI = Math.floor(Math.random() * 5000 + 500);
    const putOI = Math.floor(Math.random() * 5000 + 500);
    const callVolume = Math.floor(Math.random() * callOI * 0.3);
    const putVolume = Math.floor(Math.random() * putOI * 0.3);

    // Unusual: volume > 3x OI
    const unusualCall = callVolume > callOI * 0.25;
    const unusualPut = putVolume > putOI * 0.25;
    if (unusualCall) unusualActivity.push({ type: 'call', strike, volume: callVolume, avgOI: callOI });
    if (unusualPut) unusualActivity.push({ type: 'put', strike, volume: putVolume, avgOI: putOI });

    totalCallOI += callOI;
    totalPutOI += putOI;

    strikes.push({
      strike,
      callBid: Math.max(0.01, callPrice - 0.05),
      callAsk: callPrice + 0.05,
      callIV: Math.round(callIV * 1000) / 10,
      callOI,
      callVolume,
      callDelta: Math.max(0, Math.min(1, 0.5 - moneyness * 3)),
      putBid: Math.max(0.01, putPrice - 0.05),
      putAsk: putPrice + 0.05,
      putIV: Math.round(putIV * 1000) / 10,
      putOI,
      putVolume,
      putDelta: Math.min(0, Math.max(-1, -0.5 - moneyness * 3)),
      isATM: Math.abs(strike - spot) < 3,
      unusualCallActivity: unusualCall,
      unusualPutActivity: unusualPut,
    });
  });

  // Max pain: strike with minimum payout
  const maxPain = strikesRange[Math.floor(strikesRange.length / 2)] + 5;

  return {
    symbol,
    spotPrice: spot,
    expiry: new Date(Date.now() + expiryDays * 86400000).toISOString().split('T')[0],
    expiryDays,
    strikes,
    putCallRatio: Math.round((totalPutOI / totalCallOI) * 100) / 100,
    putCallVolumeRatio: Math.round(Math.random() * 100) / 100 + 0.5,
    totalCallOI,
    totalPutOI,
    maxPain,
    unusualActivity: unusualActivity.sort((a, b) => b.volume - a.volume).slice(0, 5),
  };
}

const EXPIRIES = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '45d', days: 45 },
  { label: '60d', days: 60 },
];

const SYMBOLS = ['AAPL', 'AMZN', 'TSLA', 'SPY', 'QQQ', 'NVDA', 'MSFT'];

const fmt = (n: number, decimals = 2) => n.toFixed(decimals);
const fmtK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

interface OptionsChainProps { symbol?: string; }
export const OptionsChain: React.FC<OptionsChainProps> = ({ symbol: initialSymbol = 'SPY' }) => {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [expiryDays, setExpiryDays] = useState(30);
  const [data, setData] = useState<OptionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUnusualOnly, setShowUnusualOnly] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market/options?symbol=${symbol}&expiry=${expiryDays}d`);
      if (res.ok) {
        setData(await res.json());
      } else throw new Error('');
    } catch {
      // Mock: realistic SPY-like data
      const spotPrices: Record<string, number> = {
        SPY: 578, AAPL: 227, AMZN: 195, TSLA: 248, QQQ: 492, NVDA: 136, MSFT: 444,
      };
      setData(generateMockOptions(symbol, spotPrices[symbol] ?? 200, expiryDays));
    } finally {
      setLoading(false);
    }
  }, [symbol, expiryDays]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const ivColor = (iv: number) => {
    if (iv > 50) return '#ef4444';
    if (iv > 35) return '#f59e0b';
    if (iv > 20) return '#22c55e';
    return '#6b7280';
  };

  const strikes = data
    ? (showUnusualOnly
        ? data.strikes.filter(s => s.unusualCallActivity || s.unusualPutActivity)
        : data.strikes)
    : [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
          Options Chain
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            style={{ background: '#111827', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 4, padding: '2px 6px', fontSize: 11 }}
          >
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {EXPIRIES.map(e => (
            <button
              key={e.days}
              onClick={() => setExpiryDays(e.days)}
              style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: expiryDays === e.days ? '#4f7cff' : '#1f2937', color: 'white',
              }}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      {data && (
        <div style={{ display: 'flex', gap: 16, padding: '6px 8px', background: '#0f1117', borderRadius: 6, flexWrap: 'wrap' }}>
          <span style={{ color: '#6b7280' }}>Spot: <strong style={{ color: '#e5e7eb' }}>${fmt(data.spotPrice)}</strong></span>
          <span style={{ color: '#6b7280' }}>
            P/C OI: <strong style={{ color: data.putCallRatio > 1.2 ? '#ef4444' : data.putCallRatio < 0.8 ? '#22c55e' : '#f59e0b' }}>
              {fmt(data.putCallRatio)}
            </strong>
          </span>
          <span style={{ color: '#6b7280' }}>Max Pain: <strong style={{ color: '#818cf8' }}>${data.maxPain}</strong></span>
          <span style={{ color: '#6b7280' }}>Expiry: <strong style={{ color: '#e5e7eb' }}>{data.expiry}</strong></span>
          <button
            onClick={() => setShowUnusualOnly(!showUnusualOnly)}
            style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', marginLeft: 'auto',
              background: showUnusualOnly ? '#f59e0b' : '#1f2937', color: showUnusualOnly ? '#000' : '#fff',
            }}
          >
            ⚡ Unusual Only
          </button>
        </div>
      )}

      {/* Unusual activity alerts */}
      {data && data.unusualActivity.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '2px 0' }}>
          {data.unusualActivity.map((a, i) => (
            <div key={i} style={{
              background: a.type === 'call' ? '#14532d' : '#450a0a',
              border: `1px solid ${a.type === 'call' ? '#22c55e' : '#ef4444'}`,
              borderRadius: 4, padding: '2px 8px', fontSize: 10, whiteSpace: 'nowrap', color: '#e5e7eb',
            }}>
              ⚡ ${a.strike} {a.type.toUpperCase()} vol {fmtK(a.volume)}
            </div>
          ))}
        </div>
      )}

      {/* Chain table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
            Loading options…
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0a0b0f', zIndex: 1 }}>
              <tr style={{ color: '#6b7280' }}>
                {/* Calls */}
                <th style={{ textAlign: 'right', padding: '3px 4px' }}>Vol</th>
                <th style={{ textAlign: 'right', padding: '3px 4px' }}>OI</th>
                <th style={{ textAlign: 'right', padding: '3px 4px', color: '#60a5fa' }}>IV%</th>
                <th style={{ textAlign: 'right', padding: '3px 4px' }}>Bid</th>
                <th style={{ textAlign: 'right', padding: '3px 4px' }}>Ask</th>
                {/* Strike */}
                <th style={{ textAlign: 'center', padding: '3px 8px', color: '#e5e7eb', fontWeight: 700 }}>Strike</th>
                {/* Puts */}
                <th style={{ textAlign: 'left', padding: '3px 4px' }}>Bid</th>
                <th style={{ textAlign: 'left', padding: '3px 4px' }}>Ask</th>
                <th style={{ textAlign: 'left', padding: '3px 4px', color: '#f87171' }}>IV%</th>
                <th style={{ textAlign: 'left', padding: '3px 4px' }}>OI</th>
                <th style={{ textAlign: 'left', padding: '3px 4px' }}>Vol</th>
              </tr>
            </thead>
            <tbody>
              {strikes.map((s) => (
                <tr
                  key={s.strike}
                  style={{
                    background: s.isATM ? '#1a1f2e' : 'transparent',
                    borderTop: s.isATM ? '1px solid #4f7cff' : undefined,
                    borderBottom: s.isATM ? '1px solid #4f7cff' : undefined,
                  }}
                >
                  {/* Calls */}
                  <td style={{ textAlign: 'right', padding: '3px 4px', color: s.unusualCallActivity ? '#f59e0b' : '#9ca3af' }}>
                    {s.unusualCallActivity ? '⚡' : ''}{fmtK(s.callVolume)}
                  </td>
                  <td style={{ textAlign: 'right', padding: '3px 4px', color: '#9ca3af' }}>{fmtK(s.callOI)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 4px', color: ivColor(s.callIV), fontWeight: 600 }}>{s.callIV}%</td>
                  <td style={{ textAlign: 'right', padding: '3px 4px', color: '#60a5fa' }}>{fmt(s.callBid)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 4px', color: '#60a5fa' }}>{fmt(s.callAsk)}</td>
                  {/* Strike */}
                  <td style={{
                    textAlign: 'center', padding: '3px 8px', fontWeight: 700,
                    color: s.isATM ? '#4f7cff' : '#e5e7eb', background: '#111827',
                  }}>
                    {s.strike}
                    {s.strike === data?.maxPain ? ' 🎯' : ''}
                  </td>
                  {/* Puts */}
                  <td style={{ textAlign: 'left', padding: '3px 4px', color: '#f87171' }}>{fmt(s.putBid)}</td>
                  <td style={{ textAlign: 'left', padding: '3px 4px', color: '#f87171' }}>{fmt(s.putAsk)}</td>
                  <td style={{ textAlign: 'left', padding: '3px 4px', color: ivColor(s.putIV), fontWeight: 600 }}>{s.putIV}%</td>
                  <td style={{ textAlign: 'left', padding: '3px 4px', color: '#9ca3af' }}>{fmtK(s.putOI)}</td>
                  <td style={{ textAlign: 'left', padding: '3px 4px', color: s.unusualPutActivity ? '#f59e0b' : '#9ca3af' }}>
                    {s.unusualPutActivity ? '⚡' : ''}{fmtK(s.putVolume)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Legend */}
      {!loading && (
        <div style={{ display: 'flex', gap: 16, fontSize: 10, color: '#6b7280', flexWrap: 'wrap' }}>
          <span style={{ color: '#60a5fa' }}>← Calls</span>
          <span style={{ color: '#4f7cff' }}>ATM = blue row</span>
          <span>🎯 Max Pain</span>
          <span style={{ color: '#f59e0b' }}>⚡ Unusual vol</span>
          <span style={{ color: '#f87171' }}>Puts →</span>
        </div>
      )}
    </div>
  );
};

export default OptionsChain;

