import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from '../../store';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { getUniverseSymbols } from '../../services/api';
import { num } from '../../utils/format';
import { CRYPTO_LIST } from '../../constants/assets';

interface TickerItem { symbol: string; price: number; change: number | null }

export default function LiveTicker() {
  const prices = useStore(s => s.prices);

  // Stocks come from the server's 'most_active' universe category — no hardcoded list.
  const mostActiveQ = useQuery({
    queryKey: ['universe-symbols', 'most_active', '', 25],
    queryFn: () => getUniverseSymbols({ category: 'most_active', limit: 25 }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });

  const items: TickerItem[] = useMemo(() => {
    const seen = new Set<string>();
    const out: TickerItem[] = [];
    const push = (symbol: string, price: unknown, change: unknown) => {
      const sym = String(symbol || '').toUpperCase();
      const p = num(price);
      if (!sym || p === null || p <= 0 || seen.has(sym)) return;
      seen.add(sym);
      out.push({ symbol: sym, price: p, change: num(change) });
    };
    const socketPrices = Object.values(prices || {});
    for (const s of mostActiveQ.data?.symbols || []) {
      if (s.market === 'crypto') continue;
      // Prefer a fresher socket quote if we have one for the same symbol.
      const live = (prices || {})[s.symbol];
      push(s.symbol, live?.price ?? s.price, live?.change24h ?? s.changePct);
    }
    // Then crypto (socket feed), then any remaining socket symbols.
    for (const p of socketPrices) if (CRYPTO_LIST.includes(String(p.asset).toUpperCase())) push(p.asset, p.price, p.change24h);
    for (const p of socketPrices) push(p.asset, p.price, p.change24h);
    return out;
  }, [prices, mostActiveQ.data]);

  if (!items.length) {
    // No live feed yet: say so instead of showing hard-coded prices that look real.
    return (
      <div className="h-8 bg-white border-b border-slate-200 flex items-center overflow-hidden flex-shrink-0 text-xs font-mono" data-testid="live-ticker">
        <div className="px-3 text-blue-700 font-bold border-r border-slate-200 h-full flex items-center text-[10px] tracking-wider bg-slate-50">
          MARKETS
        </div>
        <div className="px-4 text-slate-500">Waiting for live price feed… (no quotes received yet)</div>
      </div>
    );
  }

  const doubled = [...items, ...items];

  return (
    <div className="h-8 bg-white border-b border-slate-200 flex items-center overflow-hidden flex-shrink-0 text-xs font-mono" data-testid="live-ticker">
      <div className="px-3 text-blue-700 font-bold border-r border-slate-200 h-full flex items-center text-[10px] tracking-wider bg-slate-50">
        MARKETS
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="animate-ticker flex gap-8 whitespace-nowrap pl-4">
          {doubled.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-2">
              <span className="text-slate-600 font-semibold">{p.symbol}</span>
              <span className="text-slate-900 font-bold tabular-nums">${p.price.toFixed(2)}</span>
              {p.change === null ? (
                <span className="text-slate-400">—</span>
              ) : (
                <span className={`inline-flex items-center gap-0.5 tabular-nums font-semibold ${p.change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {p.change >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {p.change >= 0 ? '+' : ''}{p.change.toFixed(2)}%
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
