import { useStore } from '../../store';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function LiveTicker() {
  const prices = useStore(s => s.prices);
  const items = Object.values(prices);
  if (!items.length) {
    // Fallback benchmark assets if socket not yet loaded
    const defaultTickers = [
      { asset: 'SPY', price: 588.42, change24h: 0.48 },
      { asset: 'QQQ', price: 492.15, change24h: 0.82 },
      { asset: 'NVDA', price: 128.74, change24h: 3.12 },
      { asset: 'AAPL', price: 232.10, change24h: 0.24 },
      { asset: 'BTC', price: 67450.00, change24h: 1.84 },
      { asset: 'ETH', price: 2640.20, change24h: -0.42 },
      { asset: 'SOL', price: 154.80, change24h: 4.15 },
      { asset: 'POLY:FED', price: 0.68, change24h: 2.40 },
    ];
    return (
      <div className="h-8 bg-[#090E1A] border-b border-white/[0.08] flex items-center overflow-hidden flex-shrink-0 text-xs font-mono">
        <div className="px-3 text-amber-400 font-bold border-r border-white/[0.08] h-full flex items-center text-[10px] tracking-wider">
          MARKETS
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="animate-ticker flex gap-8 whitespace-nowrap pl-4">
            {[...defaultTickers, ...defaultTickers].map((p, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                <span className="text-slate-400 font-semibold">{p.asset}</span>
                <span className="text-white font-bold tabular-nums">${p.price.toFixed(2)}</span>
                <span className={`inline-flex items-center gap-0.5 tabular-nums ${p.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {p.change24h >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {p.change24h >= 0 ? '+' : ''}{p.change24h.toFixed(2)}%
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const doubled = [...items, ...items];

  return (
    <div className="h-8 bg-[#090E1A] border-b border-white/[0.08] flex items-center overflow-hidden flex-shrink-0 text-xs font-mono">
      <div className="px-3 text-amber-400 font-bold border-r border-white/[0.08] h-full flex items-center text-[10px] tracking-wider">
        MARKETS
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="animate-ticker flex gap-8 whitespace-nowrap pl-4">
          {doubled.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-2">
              <span className="text-slate-400 font-semibold">{p.asset}</span>
              <span className="text-white font-bold tabular-nums">${p.price?.toFixed(2)}</span>
              <span className={`inline-flex items-center gap-0.5 tabular-nums ${(p.change24h || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
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
