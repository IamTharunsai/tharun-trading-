import { useStore } from '../../store';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function LiveTicker() {
  const prices = useStore(s => s.prices);
  const items = Object.values(prices);
  if (!items.length) return null;

  const doubled = [...items, ...items];

  return (
    <div style={{
      borderBottom: '1px solid #E8D5C4',
      background: '#FFFFFF',
      overflow: 'hidden',
      height: 36,
      display: 'flex',
      alignItems: 'center',
      flexShrink: 0,
    }}>
      <div style={{
        flexShrink: 0,
        padding: '0 12px',
        fontFamily: 'Space Mono',
        fontSize: 10,
        fontWeight: 700,
        color: '#FF8C42',
        borderRight: '1px solid #E8D5C4',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
      }}>
        LIVE
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div className="animate-ticker" style={{ display: 'flex', gap: 32, whiteSpace: 'nowrap' }}>
          {doubled.map((p, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'Space Mono', fontSize: 11 }}>
              <span style={{ color: '#8B6F47' }}>{p.asset}</span>
              <span style={{ color: '#2C1810', fontWeight: 700 }}>${p.price?.toFixed(2)}</span>
              <span style={{ color: (p.change24h || 0) >= 0 ? '#2D8A4A' : '#DC2626', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                {(p.change24h || 0) >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                {p.change24h?.toFixed(2)}%
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
