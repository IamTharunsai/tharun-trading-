import { useStore } from '../../store';
import { TrendingUp, TrendingDown, Flame } from 'lucide-react';

export default function TopMovers() {
  const prices = useStore(s => s.prices);
  const movers = Object.values(prices)
    .filter(p => p.change24h != null)
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, 6);

  if (!movers.length) return null;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Flame size={16} className="text-apex-accent" />
        <h2 className="font-sans font-semibold text-apex-text">Top Movers</h2>
        <span className="font-mono text-[10px] text-apex-muted ml-auto">Ranked by 24h move · live</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {movers.map((p, i) => {
          const up = p.change24h >= 0;
          return (
            <div
              key={p.asset}
              className="p-3 rounded-lg border border-apex-border bg-apex-surface"
              style={{ animation: `mover-in 0.35s cubic-bezier(0.22,1,0.36,1) ${i * 0.05}s both` }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-sans font-bold text-sm text-apex-text">{p.asset}</span>
                {up ? <TrendingUp size={12} className="text-apex-green" /> : <TrendingDown size={12} className="text-apex-red" />}
              </div>
              <div className="font-mono text-xs text-apex-muted">${p.price?.toFixed(2)}</div>
              <div className={`font-mono text-sm font-bold ${up ? 'text-apex-green' : 'text-apex-red'}`}>
                {up ? '+' : ''}{p.change24h?.toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
