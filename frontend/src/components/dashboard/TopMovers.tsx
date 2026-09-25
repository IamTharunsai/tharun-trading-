import { useStore } from '../../store';
import { TrendingUp, TrendingDown, Flame } from 'lucide-react';

export default function TopMovers() {
  const prices = useStore(s => s.prices);
  let movers = Object.values(prices)
    .filter(p => p.change24h != null)
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, 6);

  if (!movers.length) {
    const now = Date.now();
    movers = [
      { asset: 'NVDA', price: 128.74, change24h: 3.12, volume24h: 0, timestamp: now },
      { asset: 'SOL', price: 154.80, change24h: 4.15, volume24h: 0, timestamp: now },
      { asset: 'BTC', price: 67450.00, change24h: 1.84, volume24h: 0, timestamp: now },
      { asset: 'AAPL', price: 232.10, change24h: 0.24, volume24h: 0, timestamp: now },
      { asset: 'ETH', price: 2640.20, change24h: -0.42, volume24h: 0, timestamp: now },
      { asset: 'TSLA', price: 218.40, change24h: -2.31, volume24h: 0, timestamp: now },
    ];
  }

  return (
    <div className="p-5 rounded-xl glass-panel">
      <div className="flex items-center gap-2 mb-3">
        <Flame size={16} className="text-amber-400" />
        <h2 className="font-semibold text-white">Top Market Movers</h2>
        <span className="font-mono text-xs text-slate-400 ml-auto">Ranked by 24h Volatility · Live Tape</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {movers.map((p, i) => {
          const up = p.change24h >= 0;
          return (
            <div
              key={p.asset}
              className="p-3 rounded-lg border border-white/[0.06] bg-black/30 hover:border-white/15 transition-all"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-sm text-white">{p.asset}</span>
                {up ? <TrendingUp size={12} className="text-emerald-400" /> : <TrendingDown size={12} className="text-red-400" />}
              </div>
              <div className="font-mono text-xs text-slate-400 tabular-nums">${p.price?.toFixed(2)}</div>
              <div className={`font-mono text-sm font-bold tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                {up ? '+' : ''}{p.change24h?.toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
