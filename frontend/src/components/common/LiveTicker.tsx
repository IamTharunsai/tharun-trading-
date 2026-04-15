import { useStore } from '../../store';
import { TrendingUp, TrendingDown } from 'lucide-react';

// ── LIVE TICKER ───────────────────────────────────────────────────────────────
export default function LiveTicker() {
  const prices = useStore(s => s.prices);
  const items = Object.values(prices);
  if (!items.length) return null;

  const doubled = [...items, ...items]; // loop seamlessly

  return (
    <div className="border-b border-apex-border bg-apex-surface overflow-hidden h-9 flex items-center">
      <div className="flex-shrink-0 px-3 text-xs font-mono text-apex-accent border-r border-apex-border h-full flex items-center">
        LIVE
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="flex animate-ticker gap-8 whitespace-nowrap">
          {doubled.map((p, i) => (
            <span key={i} className="flex items-center gap-1.5 text-xs font-mono">
              <span className="text-apex-muted">{p.asset}</span>
              <span className="text-apex-text">${p.price?.toFixed(2)}</span>
              <span className={p.change24h >= 0 ? 'text-apex-green flex items-center gap-0.5' : 'text-apex-red flex items-center gap-0.5'}>
                {p.change24h >= 0 ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
                {p.change24h?.toFixed(2)}%
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
