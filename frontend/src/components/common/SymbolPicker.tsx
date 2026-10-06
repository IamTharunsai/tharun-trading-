import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Search, X, Loader2 } from 'lucide-react';
import { getUniverseCategories, getUniverseSymbols, type UniverseCategory, type UniverseSymbol } from '../../services/api';
import { fmtPrice, num } from '../../utils/format';

export interface SymbolPickerMeta { market: 'stocks' | 'crypto'; name?: string }

interface Props {
  value: string;
  onChange: (symbol: string, meta: SymbolPickerMeta) => void;
  market?: 'stocks' | 'crypto' | 'all';
  placeholder?: string;
  className?: string;
  'data-testid'?: string;
}

const GROUP_LABEL: Record<string, string> = {
  portfolio: 'Portfolio', dynamic: 'Market Movers', sector: 'Sectors', etf: 'ETFs', crypto: 'Crypto',
};
const GROUP_ORDER = ['portfolio', 'dynamic', 'sector', 'etf', 'crypto'];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function SymbolPicker({ value, onChange, market = 'all', placeholder = 'Pick a symbol', className = '', ...rest }: Props) {
  const testId = rest['data-testid'] || 'symbol-picker';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; mobile: boolean } | null>(null);

  // The panel is portalled to <body> with fixed positioning so it is never clipped by
  // an overflow-hidden card. Recompute on open/resize/scroll.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const mobile = vw < 768;
      const width = mobile ? vw - 16 : Math.min(560, vw - 16);
      const left = mobile ? 8 : Math.max(8, Math.min(r.left, vw - width - 8));
      setPos({ top: r.bottom + 4, left, width, mobile });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const q = useDebounced(search.trim(), 250);

  const catsQ = useQuery({
    queryKey: ['universe-categories'],
    queryFn: getUniverseCategories,
    staleTime: 5 * 60_000,
    retry: false,
    enabled: open,
  });

  const categories: UniverseCategory[] = useMemo(() => {
    const all = catsQ.data?.categories || [];
    const filtered = all.filter(c => market === 'all' ? true : market === 'crypto' ? c.group === 'crypto' || c.group === 'portfolio' : c.group !== 'crypto');
    return [...filtered].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  }, [catsQ.data, market]);

  // Pick an initial category once categories load.
  useEffect(() => {
    if (!category && categories.length) {
      const pref = categories.find(c => c.id === (market === 'crypto' ? 'crypto' : 'most_active')) || categories[0];
      setCategory(pref.id);
    }
  }, [categories, category, market]);

  const symsQ = useQuery({
    queryKey: ['universe-symbols', q ? '' : category, q, 50],
    queryFn: () => getUniverseSymbols({ ...(q ? { search: q } : { category }), limit: 50, offset: 0 }),
    enabled: open && (!!q || !!category),
    staleTime: 60_000,
    retry: false,
  });

  const symbols: UniverseSymbol[] = useMemo(() => {
    const list = symsQ.data?.symbols || [];
    const seen = new Set<string>();
    return list.filter(s => {
      if (market !== 'all' && s.market !== market) return false;
      if (seen.has(s.symbol)) return false;
      seen.add(s.symbol);
      return true;
    });
  }, [symsQ.data, market]);

  useEffect(() => { setActiveIdx(0); }, [q, category]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (s: UniverseSymbol) => {
    onChange(s.symbol, { market: s.market === 'crypto' ? 'crypto' : 'stocks', name: s.name });
    setOpen(false);
    setSearch('');
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, Math.max(0, symbols.length - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (symbols[activeIdx]) choose(symbols[activeIdx]);
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const universeEmpty = !catsQ.isLoading && (catsQ.isError || categories.length === 0);
  const grouped = useMemo(() => {
    const m = new Map<string, UniverseCategory[]>();
    for (const c of categories) {
      const g = GROUP_LABEL[c.group] ? c.group : 'dynamic';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c);
    }
    return Array.from(m.entries());
  }, [categories]);

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`} data-testid={testId}>
      <button
        type="button"
        data-testid={`${testId}-button`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 min-w-[140px] justify-between px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-blue-400 text-sm font-mono font-bold text-slate-900 shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      >
        <span className={value ? '' : 'text-slate-400 font-normal'}>{value || placeholder}</span>
        <ChevronDown size={14} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          data-testid={`${testId}-panel`}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: `calc(100vh - ${pos.top + 8}px)` }}
          className="z-[100] bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden flex flex-col"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200">
            <Search size={14} className="text-slate-400" />
            <input
              ref={inputRef}
              data-testid={`${testId}-search`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search all US symbols…"
              className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-700"><X size={14} /></button>
            )}
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="md:hidden text-slate-500 hover:text-slate-800"><X size={16} /></button>
          </div>

          {universeEmpty && !q ? (
            <div className="p-6 text-center text-sm text-slate-500" data-testid={`${testId}-empty`}>
              <div className="font-semibold text-slate-700 mb-1">Universe is syncing…</div>
              <div className="text-xs">Categories aren't available yet. You can still search by ticker above.</div>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row max-h-[60vh] md:max-h-[380px] min-h-0">
              {!q && (
                <div className="md:w-44 flex-shrink-0 border-b md:border-b-0 md:border-r border-slate-200 overflow-x-auto md:overflow-y-auto flex md:block gap-1 p-2 md:p-1 bg-slate-50/60">
                  {catsQ.isLoading && <div className="p-2 text-xs text-slate-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading…</div>}
                  {grouped.map(([g, cats]) => (
                    <div key={g} className="flex md:block gap-1 flex-shrink-0">
                      <div className="hidden md:block px-2 pt-2 pb-1 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">{GROUP_LABEL[g] || g}</div>
                      {cats.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          data-testid={`${testId}-category-${c.id}`}
                          onClick={() => setCategory(c.id)}
                          className={`flex-shrink-0 md:w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center justify-between gap-2 whitespace-nowrap ${category === c.id ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200' : 'text-slate-600 hover:bg-slate-100 border border-transparent'}`}
                        >
                          <span className="truncate">{c.label}</span>
                          {num(c.count) !== null && <span className="text-[10px] text-slate-400 tabular-nums">{c.count}</span>}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <ul ref={listRef} role="listbox" className="flex-1 overflow-y-auto min-h-[160px]" data-testid={`${testId}-results`}>
                {symsQ.isLoading && (
                  <li className="p-4 text-xs text-slate-400 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading symbols…</li>
                )}
                {!symsQ.isLoading && symsQ.isError && (
                  <li className="p-4 text-xs text-slate-500">Universe is syncing… symbol list unavailable right now.</li>
                )}
                {!symsQ.isLoading && !symsQ.isError && symbols.length === 0 && (q || category) && (
                  <li className="p-4 text-xs text-slate-500">{q ? `No symbols match “${q}”.` : 'No symbols in this category yet.'}</li>
                )}
                {symbols.map((s, i) => {
                  const chg = num(s.changePct);
                  return (
                    <li
                      key={s.symbol}
                      role="option"
                      aria-selected={s.symbol === value}
                      data-idx={i}
                      data-testid={`${testId}-option-${s.symbol}`}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => choose(s)}
                      className={`px-3 py-2 cursor-pointer flex items-center gap-3 border-b border-slate-100 last:border-0 ${i === activeIdx ? 'bg-blue-50' : 'hover:bg-slate-50'} ${s.symbol === value ? 'border-l-2 border-l-blue-600' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm text-slate-900">{s.symbol}</span>
                          {s.market === 'crypto' && <span className="text-[9px] font-mono px-1 rounded bg-amber-50 text-amber-700 border border-amber-200">CRYPTO</span>}
                          {s.tradable === false && <span className="text-[9px] font-mono px-1 rounded bg-slate-100 text-slate-500 border border-slate-200">NOT TRADABLE</span>}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">{s.name || '—'}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums">{fmtPrice(s.price)}</div>
                        <div className={`text-[11px] font-mono tabular-nums ${chg === null ? 'text-slate-400' : chg >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {chg === null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
