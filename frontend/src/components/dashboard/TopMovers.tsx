import { useStore } from '../../store';
import { TrendingUp, TrendingDown, Flame, Activity } from 'lucide-react';

export default function TopMovers() {
  const prices = useStore(s => s.prices);
  const movers = Object.values(prices)
    .filter(p => p && p.change24h != null && !isNaN(p.change24h))
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, 6);

  return (
    <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Flame size={16} className="text-amber-600" />
        <h2 className="font-semibold text-slate-900 text-sm">Top Market Movers</h2>
        <span className="font-mono text-xs text-slate-500 ml-auto">Ranked by 24h Volatility · Authenticated Feed</span>
      </div>

      {movers.length === 0 ? (
        <div className="py-6 px-4 text-center rounded-lg border border-dashed border-slate-200 text-slate-500 font-mono text-xs flex flex-col items-center justify-center gap-2 bg-slate-50/50">
          <Activity size={18} className="text-slate-400 animate-pulse" />
          <span>Awaiting live market data stream... Movers will populate as quotes are received.</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {movers.map((p) => {
            const up = (p.change24h || 0) >= 0;
            return (
              <div
                key={p.asset}
                className="p-3 rounded-lg border border-slate-200 bg-slate-50 hover:border-slate-300 transition-all"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm text-slate-900">{p.asset}</span>
                  {up ? <TrendingUp size={12} className="text-emerald-600" /> : <TrendingDown size={12} className="text-red-600" />}
                </div>
                <div className="font-mono text-xs text-slate-600 tabular-nums">
                  {p.price != null ? `$${p.price.toFixed(2)}` : '—'}
                </div>
                <div className={`font-mono text-sm font-bold tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}>
                  {up ? '+' : ''}{(p.change24h || 0).toFixed(2)}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
