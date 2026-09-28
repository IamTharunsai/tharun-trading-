import { useStore } from '../../store';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function LiveTicker() {
  const prices = useStore(s => s.prices);
  const items = Object.values(prices);
  if (!items.length) {
    // No live feed yet: say so instead of showing hard-coded prices that look real.
    return (
      <div className="h-8 bg-white border-b border-slate-200 flex items-center overflow-hidden flex-shrink-0 text-xs font-mono">
        <div className="px-3 text-blue-700 font-bold border-r border-slate-200 h-full flex items-center text-[10px] tracking-wider bg-slate-50">
          MARKETS
        </div>
        <div className="px-4 text-slate-500">Waiting for live price feed… (no quotes received yet)</div>
      </div>
    );
  }

  const doubled = [...items, ...items];

  return (
    <div className="h-8 bg-white border-b border-slate-200 flex items-center overflow-hidden flex-shrink-0 text-xs font-mono">
      <div className="px-3 text-blue-700 font-bold border-r border-slate-200 h-full flex items-center text-[10px] tracking-wider bg-slate-50">
        MARKETS
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="animate-ticker flex gap-8 whitespace-nowrap pl-4">
          {doubled.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-2">
              <span className="text-slate-600 font-semibold">{p.asset}</span>
              <span className="text-slate-900 font-bold tabular-nums">${p.price?.toFixed(2)}</span>
              <span className={`inline-flex items-center gap-0.5 tabular-nums font-semibold ${(p.change24h || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {(p.change24h || 0) >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {(p.change24h || 0) >= 0 ? '+' : ''}{p.change24h?.toFixed(2)}%
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
