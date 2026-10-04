/**
 * INTEGRATION: OpenTerminal → APEX
 * Sector Heatmap Panel (from OpenTerminal's SectorHeatmap component)
 *
 * OpenTerminal ref: https://github.com/ErTasselli/OpenTerminal
 * APEX file location: frontend/src/components/panels/SectorHeatmap.tsx
 */

import React, { useEffect, useState } from 'react';

interface SectorData {
  name: string;
  changePercent: number;
  marketCap: number;
  volume: number;
  topMover: { symbol: string; change: number };
}

const SECTORS: string[] = [
  'Technology', 'Healthcare', 'Financials', 'Energy',
  'Consumer Discretionary', 'Industrials', 'Communication Services',
  'Utilities', 'Materials', 'Real Estate', 'Consumer Staples',
];

function getHeatColor(changePercent: number): string {
  if (changePercent > 3) return '#16a34a';
  if (changePercent > 1.5) return '#22c55e';
  if (changePercent > 0.5) return '#4ade80';
  if (changePercent > -0.5) return '#6b7280';
  if (changePercent > -1.5) return '#f87171';
  if (changePercent > -3) return '#ef4444';
  return '#b91c1c';
}

function getSectorSize(marketCap: number, maxCap: number): number {
  return Math.max(0.6, (marketCap / maxCap));
}

interface SectorHeatmapProps {
  onSectorClick?: (sector: string) => void;
}

export const SectorHeatmap: React.FC<SectorHeatmapProps> = ({ onSectorClick }) => {
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    fetchSectorData();
    const interval = setInterval(fetchSectorData, 5 * 60 * 1000); // refresh every 5min
    return () => clearInterval(interval);
  }, []);

  async function fetchSectorData() {
    try {
      const res = await fetch('/api/market/sectors');
      if (!res.ok) throw new Error('Failed to fetch sectors');
      const data = await res.json();
      setSectors(data.sectors);
      setLastUpdated(new Date());
    } catch (err) {
      // Fallback to mock data for demo
      setSectors(SECTORS.map(name => ({
        name,
        changePercent: (Math.random() - 0.48) * 8,
        marketCap: Math.random() * 8000 + 1000,
        volume: Math.random() * 50 + 5,
        topMover: { symbol: 'DEMO', change: (Math.random() - 0.48) * 10 },
      })));
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
        Loading sector data…
      </div>
    );
  }

  const maxCap = Math.max(...sectors.map(s => s.marketCap));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
          S&amp;P 500 Sector Heatmap
        </span>
        {lastUpdated && (
          <span style={{ fontSize: 11, color: '#4b5563' }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
        gap: 6,
        flex: 1,
      }}>
        {sectors.map(sector => {
          const size = getSectorSize(sector.marketCap, maxCap);
          const bg = getHeatColor(sector.changePercent);
          const isPos = sector.changePercent >= 0;

          return (
            <div
              key={sector.name}
              onClick={() => onSectorClick?.(sector.name)}
              style={{
                background: bg + '33',
                border: `1px solid ${bg}66`,
                borderRadius: 8,
                padding: `${8 + size * 8}px 10px`,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = bg)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = bg + '66')}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#e5e7eb', lineHeight: 1.2 }}>
                {sector.name.replace('Consumer ', 'Cons. ').replace(' Services', ' Svcs')}
              </div>
              <div style={{
                fontSize: 16,
                fontWeight: 700,
                color: bg,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {isPos ? '+' : ''}{sector.changePercent.toFixed(2)}%
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>
                MCap: ${(sector.marketCap / 1000).toFixed(1)}T
              </div>
              <div style={{ fontSize: 10, color: isPos ? '#22c55e' : '#ef4444' }}>
                ▲ {sector.topMover.symbol} {sector.topMover.change > 0 ? '+' : ''}{sector.topMover.change.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SectorHeatmap;
