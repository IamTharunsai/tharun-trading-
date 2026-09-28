import { useStore } from '../../store';
import { TrendingUp, TrendingDown, Flame, Activity } from 'lucide-react';

export default function TopMovers() {
  const prices = useStore(s => s.prices);
  const movers = Object.values(prices)
    .filter(p => p && p.change24h != null && !isNaN(p.change24h))
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, 6);

  return (
    <div className="p-5 rounded-xl glass-panel bg-[#0B101D]/80 border border-white/10">
      <div className="flex items-center gap-2 mb-3">
        <Flame size={16} className="text-amber-400" />
        <h2 className="font-semibold text-white">Top Market Movers</h2>
        <span className="font-mono text-xs text-slate-400 ml-auto">Ranked by 24h Volatility · Authenticated Feed</span>
      </div>

      {movers.length === 0 ? (
        <div className="py-6 px-4 text-center rounded-lg border border-dashed border-white/10 text-slate-400 font-mono text-xs flex flex-col items-center justify-center gap-2">
          <Activity size={18} className="text-slate-500 animate-pulse" />
          <span>Awaiting live market data stream... Movers will populate as quotes are received.</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {movers.map((p) => {
            const up = (p.change24h || 0) >= 0;
            return (
              <div
                key={p.asset}
                className="p-3 rounded-lg border border-white/[0.06] bg-black/40 hover:border-white/20 transition-all"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm text-white">{p.asset}</span>
                  {up ? <TrendingUp size={12} className="text-emerald-400" /> : <TrendingDown size={12} className="text-red-400" />}
                </div>
                <div className="font-mono text-xs text-slate-400 tabular-nums">
                  ${p.price != null ? p.price.toFixed(2) : '0.00'}
                </div>
                <div className={`font-mono text-sm font-bold tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
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
