/**
 * INTEGRATION: OpenTerminal → APEX
 * Crypto Board Panel (BTC/ETH dominance + top 20 by market cap)
 *
 * OpenTerminal ref: https://github.com/ErTasselli/OpenTerminal
 * APEX file location: frontend/src/components/panels/CryptoBoard.tsx
 */

import React, { useEffect, useState } from 'react';

interface CryptoAsset {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  dominance?: number;
  high24h: number;
  low24h: number;
}

interface MarketOverview {
  totalMarketCap: number;
  totalVolume24h: number;
  btcDominance: number;
  ethDominance: number;
  fearGreedIndex: number;
  fearGreedLabel: string;
}

function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const getColor = (v: number) => {
    if (v < 25) return '#ef4444';
    if (v < 45) return '#f59e0b';
    if (v < 55) return '#6b7280';
    if (v < 75) return '#22c55e';
    return '#16a34a';
  };
  const color = getColor(value);
  const angle = (value / 100) * 180 - 90;

  return (
    <div style={{ textAlign: 'center' }}>
      <svg width="80" height="44" viewBox="0 0 80 44">
        {/* Arc background */}
        <path d="M 8 40 A 32 32 0 0 1 72 40" stroke="#374151" strokeWidth="6" fill="none" strokeLinecap="round"/>
        {/* Arc fill */}
        <path d="M 8 40 A 32 32 0 0 1 72 40" stroke={color} strokeWidth="6" fill="none" strokeLinecap="round"
          strokeDasharray={`${value * 1.005} 100.5`}/>
        {/* Needle */}
        <line
          x1="40" y1="40"
          x2={40 + 24 * Math.cos((angle - 90) * Math.PI / 180)}
          y2={40 + 24 * Math.sin((angle - 90) * Math.PI / 180)}
          stroke={color} strokeWidth="2" strokeLinecap="round"
        />
        <circle cx="40" cy="40" r="3" fill={color}/>
      </svg>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: -4 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6b7280' }}>{label}</div>
    </div>
  );
}

interface CryptoBoardProps {
  onAssetClick?: (symbol: string) => void;
}

export const CryptoBoard: React.FC<CryptoBoardProps> = ({ onAssetClick }) => {
  const [assets, setAssets] = useState<CryptoAsset[]>([]);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'marketCap' | 'change24h' | 'volume24h'>('marketCap');

  useEffect(() => {
    fetchCryptoData();
    const interval = setInterval(fetchCryptoData, 30_000); // 30s
    return () => clearInterval(interval);
  }, []);

  async function fetchCryptoData() {
    try {
      const [assetsRes, overviewRes] = await Promise.all([
        fetch('/api/market/crypto/top20'),
        fetch('/api/market/crypto/overview'),
      ]);
      if (assetsRes.ok) setAssets(await assetsRes.json());
      if (overviewRes.ok) setOverview(await overviewRes.json());
    } catch {
      // Mock data fallback
      const SYMBOLS = ['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','DOT','LINK','MATIC','UNI','ATOM','LTC','BCH','NEAR','APT','OP','ARB','FTM'];
      setAssets(SYMBOLS.map((symbol, i) => ({
        symbol,
        name: symbol,
        price: Math.random() * 50000 + 100,
        change24h: (Math.random() - 0.48) * 12,
        volume24h: Math.random() * 10e9,
        marketCap: Math.max(1e9, (20 - i) * 50e9 * Math.random()),
        high24h: Math.random() * 55000 + 110,
        low24h: Math.random() * 45000 + 90,
      })));
      setOverview({
        totalMarketCap: 2.4e12,
        totalVolume24h: 98e9,
        btcDominance: 54.2,
        ethDominance: 18.1,
        fearGreedIndex: 62,
        fearGreedLabel: 'Greed',
      });
    } finally {
      setLoading(false);
    }
  }

  const sorted = [...assets].sort((a, b) => b[sortBy] - a[sortBy]);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>Loading crypto data…</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Overview bar */}
      {overview && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1f2937' }}>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total MCap</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>${(overview.totalMarketCap / 1e12).toFixed(2)}T</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>BTC Dom.</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b' }}>{overview.btcDominance.toFixed(1)}%</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>ETH Dom.</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#818cf8' }}>{overview.ethDominance.toFixed(1)}%</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>24h Vol</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>${(overview.totalVolume24h / 1e9).toFixed(1)}B</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <FearGreedGauge value={overview.fearGreedIndex} label={overview.fearGreedLabel}/>
          </div>
        </div>
      )}

      {/* Sort tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['marketCap', 'change24h', 'volume24h'] as const).map(key => (
          <button
            key={key}
            onClick={() => setSortBy(key)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              background: sortBy === key ? '#4f7cff' : '#1f2937',
              color: sortBy === key ? 'white' : '#6b7280',
            }}
          >
            {key === 'marketCap' ? 'Market Cap' : key === 'change24h' ? '24h Change' : '24h Volume'}
          </button>
        ))}
      </div>

      {/* Asset table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#0a0b0f' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#4b5563', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>#</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#4b5563', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Asset</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: '#4b5563', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Price</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: '#4b5563', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>24h</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: '#4b5563', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>MCap</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 20).map((asset, i) => (
              <tr
                key={asset.symbol}
                onClick={() => onAssetClick?.(asset.symbol)}
                style={{ borderBottom: '1px solid #111827', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '7px 8px', color: '#4b5563', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                <td style={{ padding: '7px 8px' }}>
                  <div style={{ fontWeight: 600 }}>{asset.symbol}</div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{asset.name}</div>
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  ${asset.price >= 1000 ? asset.price.toFixed(0) : asset.price.toFixed(3)}
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: asset.change24h >= 0 ? '#22c55e' : '#ef4444' }}>
                  {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right', color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                  ${(asset.marketCap / 1e9).toFixed(1)}B
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CryptoBoard;
