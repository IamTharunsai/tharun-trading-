import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { RefreshCw, Sparkles, PieChart, Activity, ArrowUpRight, Zap, AlertTriangle } from 'lucide-react';
import {
  getPredictions, scanPredictions, wagerPrediction, getPortfolioBreakdown, getTrades,
} from '../services/api';
import LastUpdated from '../components/common/LastUpdated';
import { useSystemStatus } from '../hooks/useSystemStatus';
import { tradeAssetLabel, tradeOutcome, OUTCOME_CLS } from '../utils/trades';

// ── Defensive normalisation ──────────────────────────────────────────────────
// Every field the API may omit becomes null; the UI renders "—" instead of crashing
// (the previous version called .toFixed on undefined fields such as expectedValue).

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const prob = (v: unknown): number | null => {
  const n = num(v);
  if (n === null) return null;
  if (n >= 0 && n <= 1) return n;
  if (n > 1 && n <= 100) return n / 100; // stored as percent
  return null;
};

const cents = (p: number | null) => (p === null ? '—' : `${(p * 100).toFixed(0)}¢`);
const pct = (v: number | null, digits = 1, sign = true) => (v === null ? '—' : `${sign && v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
const usd = (v: number | null) => (v === null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`);
const safeDate = (v: unknown) => {
  if (!v) return null;
  const d = new Date(v as any);
  return Number.isFinite(d.getTime()) ? d : null;
};

interface Pred {
  id: string;
  title: string;
  category: string | null;
  yesPrice: number | null;
  noPrice: number | null;
  modelProb: number | null;
  edgePct: number | null;
  evPct: number | null;
  kelly: number | null;
  recommendedBet: 'YES' | 'NO' | 'SKIP' | null;
  reasoning: string | null;
  resolution: Date | null;
}

function normalizePrediction(p: any): Pred | null {
  if (!p || typeof p !== 'object' || !p.id) return null;
  const yes = prob(p.yesPrice);
  const no = prob(p.noPrice) ?? (yes !== null ? 1 - yes : null);
  const edge = num(p.edge);
  const rb = String(p.recommendedBet || '').toUpperCase();
  return {
    id: String(p.id),
    title: String(p.title || p.question || p.asset || 'Untitled market'),
    category: p.category ? String(p.category) : null,
    yesPrice: yes,
    noPrice: no,
    modelProb: prob(p.trueYesProbability ?? p.modelProbability),
    // edge is stored as a fraction (0.08) in some rows and percent (8) in others
    edgePct: edge === null ? null : Math.abs(edge) <= 1 ? edge * 100 : edge,
    evPct: num(p.expectedValue),
    kelly: prob(p.kellyFraction),
    recommendedBet: rb === 'YES' || rb === 'NO' || rb === 'SKIP' ? rb : null,
    reasoning: p.reasoning ? String(p.reasoning) : null,
    resolution: safeDate(p.resolutionDate ?? p.endDate ?? p.timeHorizon),
  };
}

export default function PolymarketPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'scanner' | 'trades' | 'status'>('scanner');
  const [tradeFilter, setTradeFilter] = useState<'all' | 'WIN' | 'LOSS' | 'OPEN' | 'REJECTED'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Pred | null>(null);
  const [wagerOutcome, setWagerOutcome] = useState<'YES' | 'NO'>('YES');
  const [wagerAmount, setWagerAmount] = useState<number>(10);
  const [wagerLoading, setWagerLoading] = useState(false);

  const predsQ = useQuery({ queryKey: ['predictions'], queryFn: getPredictions, refetchInterval: 60000, retry: 1 });
  const breakdownQ = useQuery({ queryKey: ['portfolio-breakdown'], queryFn: getPortfolioBreakdown, refetchInterval: 60000, retry: false });
  const tradesQ = useQuery({
    queryKey: ['polymarket-trades'],
    queryFn: () => getTrades(1, 200, { market: 'polymarket' }),
    refetchInterval: 30000,
    retry: 1,
  });
  const statusQ = useSystemStatus();

  const predictions: Pred[] = useMemo(() => {
    const raw: any[] = Array.isArray(predsQ.data) ? predsQ.data : Array.isArray((predsQ.data as any)?.predictions) ? (predsQ.data as any).predictions : [];
    return raw.map(normalizePrediction).filter((p): p is Pred => p !== null);
  }, [predsQ.data]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    predictions.forEach(p => p.category && set.add(p.category.toLowerCase()));
    return ['all', ...Array.from(set).sort()];
  }, [predictions]);

  const filteredPredictions = predictions.filter(p => selectedCategory === 'all' || (p.category || '').toLowerCase() === selectedCategory);

  const trades: any[] = useMemo(() => {
    const d: any = tradesQ.data;
    const list: any[] = Array.isArray(d?.trades) ? d.trades : Array.isArray(d) ? d : [];
    return list.filter(t => t && String(t.market || '').toLowerCase() === 'polymarket');
  }, [tradesQ.data]);

  const stats = useMemo(() => {
    const closed = trades.filter(t => String(t.status).toUpperCase() === 'CLOSED' && tradeOutcome(t) !== 'REJECTED');
    const wins = closed.filter(t => tradeOutcome(t) === 'WIN');
    const losses = closed.filter(t => tradeOutcome(t) === 'LOSS');
    const realized = closed.reduce((s, t) => s + (num(t.pnl) ?? 0), 0);
    const open = trades.filter(t => tradeOutcome(t) === 'OPEN');
    const openCost = open.reduce((s, t) => s + (num(t.entryPrice) ?? 0) * (num(t.quantity) ?? 0), 0);
    return {
      closedCount: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length ? (wins.length / closed.length) * 100 : null,
      realized: closed.length ? realized : null,
      openCount: open.length,
      openCost: open.length ? openCost : null,
      rejected: trades.filter(t => tradeOutcome(t) === 'REJECTED').length,
    };
  }, [trades]);

  const filteredTrades = tradeFilter === 'all' ? trades : trades.filter(t => tradeOutcome(t) === tradeFilter);

  const pmBreakdown = (breakdownQ.data as any)?.polymarket;
  const walletConnected = !!pmBreakdown?.connected;
  const bankroll = walletConnected ? num(pmBreakdown?.equity) : null;
  const pmMode = statusQ.data?.polymarket?.mode ? String(statusQ.data.polymarket.mode).toUpperCase() : null;
  const usConnected = statusQ.data?.polymarket?.usConnected;

  const handleScan = async () => {
    try {
      setScanning(true);
      const res: any = await scanPredictions();
      const n = Array.isArray(res?.opportunities) ? res.opportunities.length : null;
      await qc.invalidateQueries({ queryKey: ['predictions'] });
      toast.success(n === null ? 'Scan complete' : `Scan complete — ${n} open market${n === 1 ? '' : 's'}`);
    } catch (err: any) {
      toast.error('Scan failed: ' + (err?.response?.data?.error || err?.message || 'unknown error'));
    } finally {
      setScanning(false);
    }
  };

  const openWager = (p: Pred) => {
    setSelected(p);
    setWagerOutcome(p.recommendedBet === 'NO' ? 'NO' : 'YES');
    setWagerAmount(bankroll && p.kelly ? Math.max(1, Math.round(bankroll * p.kelly)) : 10);
  };

  const selectedPrice = selected ? (wagerOutcome === 'YES' ? selected.yesPrice : selected.noPrice) : null;

  const executeWager = async () => {
    if (!selected) return;
    if (!selectedPrice || selectedPrice <= 0 || selectedPrice >= 1) {
      toast.error('This market has no valid price for that outcome.');
      return;
    }
    if (!(wagerAmount > 0)) {
      toast.error('Enter a wager amount greater than 0.');
      return;
    }
    try {
      setWagerLoading(true);
      const res: any = await wagerPrediction(selected.id, wagerOutcome, wagerAmount);
      toast.success(res?.message || `Wager recorded: $${wagerAmount} on ${wagerOutcome} @ ${cents(selectedPrice)}`);
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['polymarket-trades'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to place wager');
    } finally {
      setWagerLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-900">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold text-blue-700 tracking-wider">POLYMARKET</span>
            <span className="text-slate-300">·</span>
            <span data-testid="polymarket-mode" className={`text-xs font-mono font-semibold ${pmMode === 'LIVE' ? 'text-amber-600' : pmMode ? 'text-blue-600' : 'text-slate-400'}`}>
              MODE: {pmMode || 'UNKNOWN'}
            </span>
            {usConnected !== undefined && (
              <>
                <span className="text-slate-300">·</span>
                <span className={`text-xs font-mono font-semibold ${usConnected ? 'text-emerald-600' : 'text-slate-500'}`}>
                  POLYMARKET US API {usConnected ? 'CONNECTED' : 'NOT CONNECTED'}
                </span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">Polymarket Prediction Markets</h1>
          <p className="text-sm text-slate-500 mt-0.5">Open markets, model estimates and the wagers actually recorded by the system.</p>
        </div>
        <div className="flex items-center gap-3">
          <LastUpdated />
          <button
            data-testid="polymarket-scan"
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'SCANNING…' : 'SCAN POLYMARKET'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm" data-testid="pm-bankroll">
          <div className="text-xs font-mono text-slate-500 mb-1 font-semibold">POLYMARKET BANKROLL</div>
          <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums">{usd(bankroll)}</div>
          <div className={`text-xs font-mono mt-1 ${walletConnected ? 'text-emerald-600' : 'text-slate-500'}`}>
            {breakdownQ.isLoading ? 'Loading…' : walletConnected ? 'Connected account' : 'Wallet not connected'}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm" data-testid="pm-winrate">
          <div className="text-xs font-mono text-slate-500 mb-1 font-semibold">WIN RATE (CLOSED)</div>
          <div className="text-2xl font-mono font-bold text-emerald-600 tabular-nums">{pct(stats.winRate, 1, false)}</div>
          <div className="text-xs text-slate-500 font-mono mt-1">{stats.wins} won · {stats.losses} lost</div>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm" data-testid="pm-realized">
          <div className="text-xs font-mono text-slate-500 mb-1 font-semibold">REALIZED P&L</div>
          <div className={`text-2xl font-mono font-bold tabular-nums ${stats.realized === null ? 'text-slate-400' : stats.realized >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {stats.realized === null ? '—' : `${stats.realized >= 0 ? '+' : '-'}$${Math.abs(stats.realized).toFixed(2)}`}
          </div>
          <div className="text-xs text-slate-500 font-mono mt-1">{stats.closedCount} closed wager{stats.closedCount === 1 ? '' : 's'}</div>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm" data-testid="pm-open">
          <div className="text-xs font-mono text-slate-500 mb-1 font-semibold">OPEN WAGERS</div>
          <div className="text-2xl font-mono font-bold text-blue-700 tabular-nums">{stats.openCount}</div>
          <div className="text-xs text-slate-500 font-mono mt-1">Cost basis: {usd(stats.openCost)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-3 border-b border-slate-200 pb-2 flex-wrap">
        {[
          { id: 'scanner', label: `Open Markets (${predictions.length})`, icon: Sparkles },
          { id: 'trades', label: `Recorded Wagers (${trades.length})`, icon: PieChart },
          { id: 'status', label: 'Engine Status', icon: Activity },
        ].map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              data-testid={`pm-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold rounded-lg transition-all ${active ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200'}`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scanner */}
      {activeTab === 'scanner' && (
        <div className="space-y-5">
          {categories.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
              <span className="text-xs font-mono text-slate-500 mr-1 font-semibold">Category:</span>
              {categories.map(cat => (
                <button
                  key={cat}
                  data-testid={`pm-category-${cat}`}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 text-xs font-mono rounded-lg transition-colors capitalize ${selectedCategory === cat ? 'bg-blue-50 text-blue-700 border border-blue-200 font-bold' : 'text-slate-600 hover:text-slate-900 border border-transparent'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {predsQ.isLoading ? (
            <div className="p-12 text-center bg-white border border-slate-200 rounded-xl font-mono text-xs text-slate-400">Loading markets…</div>
          ) : predsQ.isError ? (
            <div className="p-8 text-center bg-white border border-red-200 rounded-xl font-mono text-xs text-red-600 flex flex-col items-center gap-2" data-testid="pm-error">
              <AlertTriangle size={18} />
              Could not load prediction markets: {(predsQ.error as any)?.response?.data?.error || (predsQ.error as any)?.message || 'request failed'}
              <button onClick={() => predsQ.refetch()} className="mt-2 px-3 py-1 rounded border border-slate-200 text-slate-700 bg-white hover:bg-slate-50">Retry</button>
            </div>
          ) : filteredPredictions.length === 0 ? (
            <div className="p-12 text-center bg-white border border-slate-200 rounded-xl font-mono text-xs text-slate-400" data-testid="pm-empty">
              No open prediction markets recorded yet. Run a scan to refresh.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredPredictions.map(p => {
                const stake = bankroll && p.kelly ? bankroll * p.kelly : null;
                return (
                  <div key={p.id} data-testid="pm-market" className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm hover:border-blue-300 transition-all flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-500 font-mono mb-2 gap-2">
                        <span className="uppercase text-blue-700 font-bold px-2 py-0.5 rounded bg-blue-50 border border-blue-200">{p.category || '—'}</span>
                        <span>{p.resolution ? `Resolves ${p.resolution.toLocaleDateString('en-US')}` : 'Resolution date —'}</span>
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 leading-snug mb-3">{p.title}</h3>
                      <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2 mb-3 text-xs font-mono">
                        <div className="flex justify-between"><span className="text-slate-500">Market odds:</span><span className="text-slate-900 font-bold">YES {cents(p.yesPrice)} · NO {cents(p.noPrice)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Model probability (YES):</span><span className="text-slate-900 font-bold">{p.modelProb === null ? '—' : `${(p.modelProb * 100).toFixed(1)}%`}</span></div>
                        {p.yesPrice !== null && (
                          <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                            <div className="bg-slate-500 h-full" style={{ width: `${Math.min(100, Math.max(0, p.yesPrice * 100))}%` }} title="Market YES price" />
                          </div>
                        )}
                        <div className="flex justify-between pt-1 border-t border-slate-200 text-[11px]">
                          <span className={p.edgePct !== null && p.edgePct > 0 ? 'text-emerald-700 font-bold' : 'text-slate-500'}>Edge: {pct(p.edgePct)}</span>
                          <span className="text-slate-600">EV: {pct(p.evPct)}</span>
                        </div>
                      </div>
                      {p.reasoning && <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 mb-4">{p.reasoning}</p>}
                    </div>
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                      <div className="text-xs font-mono">
                        <div className="text-slate-500">Kelly stake{p.kelly !== null ? ` (${(p.kelly * 100).toFixed(1)}%)` : ''}:</div>
                        <div className="text-blue-700 font-bold text-sm">{usd(stake)}</div>
                      </div>
                      <button
                        data-testid="pm-wager-open"
                        onClick={() => openWager(p)}
                        disabled={p.yesPrice === null}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-xs disabled:opacity-40"
                      >
                        <span>{p.recommendedBet && p.recommendedBet !== 'SKIP' ? `BET ${p.recommendedBet}` : 'WAGER'}</span>
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Recorded wagers (from the trades table) */}
      {activeTab === 'trades' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
            <span className="text-xs font-mono text-slate-500 mr-1 font-semibold">Filter:</span>
            {([
              { id: 'all', label: `All (${trades.length})` },
              { id: 'WIN', label: `Won (${stats.wins})` },
              { id: 'LOSS', label: `Lost (${stats.losses})` },
              { id: 'OPEN', label: `Open (${stats.openCount})` },
              { id: 'REJECTED', label: `Rejected (${stats.rejected})` },
            ] as const).map(f => (
              <button
                key={f.id}
                data-testid={`pm-trades-filter-${f.id}`}
                onClick={() => setTradeFilter(f.id)}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition ${tradeFilter === f.id ? 'bg-blue-600 text-white font-bold shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm overflow-x-auto">
            {tradesQ.isLoading ? (
              <div className="text-center py-12 font-mono text-xs text-slate-400">Loading wagers…</div>
            ) : tradesQ.isError ? (
              <div className="text-center py-12 font-mono text-xs text-red-600">Could not load Polymarket trades.</div>
            ) : (
              <>
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
                      {['Market', 'Side', 'Entry', 'Exit', 'Shares', 'Cost', 'P&L', 'Status', 'Opened'].map(h => (
                        <th key={h} className="py-2.5 px-3 uppercase font-bold text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTrades.map((t: any) => {
                      const outcome = tradeOutcome(t);
                      const entry = prob(t.entryPrice);
                      const exit = prob(t.exitPrice);
                      const qty = num(t.quantity);
                      const pnl = num(t.pnl);
                      const opened = safeDate(t.openedAt || t.createdAt);
                      const label = tradeAssetLabel(t);
                      return (
                        <tr key={t.id} data-testid="pm-trade-row" className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-3 text-slate-900 font-medium max-w-[260px] truncate" title={label}>{label}</td>
                          <td className="py-3 px-3">{t.type === 'BUY' ? 'YES' : t.type === 'SELL' ? 'NO' : '—'}</td>
                          <td className="py-3 px-3 tabular-nums">{cents(entry)}</td>
                          <td className="py-3 px-3 tabular-nums">{cents(exit)}</td>
                          <td className="py-3 px-3 tabular-nums">{qty === null ? '—' : qty.toFixed(2)}</td>
                          <td className="py-3 px-3 tabular-nums">{usd(entry !== null && qty !== null ? entry * qty : null)}</td>
                          <td className={`py-3 px-3 tabular-nums font-bold ${pnl === null || outcome === 'REJECTED' ? 'text-slate-400' : pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {pnl === null || outcome === 'REJECTED' ? '—' : `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`}
                          </td>
                          <td className="py-3 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${OUTCOME_CLS[outcome]}`}>{outcome}</span></td>
                          <td className="py-3 px-3 text-slate-500 whitespace-nowrap">{opened ? opened.toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredTrades.length === 0 && (
                  <div className="text-center py-12 font-mono text-xs text-slate-400">No Polymarket wagers recorded{tradeFilter !== 'all' ? ' for this filter' : ''}.</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Engine status — real values only */}
      {activeTab === 'status' && (
        <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm space-y-3 font-mono text-xs" data-testid="pm-status">
          {statusQ.isError || !statusQ.data?.polymarket ? (
            <div className="text-slate-500">Engine status unavailable (GET /api/system/status {statusQ.isLoading ? 'loading…' : 'failed or returned no Polymarket data'}).</div>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-slate-500">Execution mode</span><span className="font-bold">{pmMode}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Polymarket US API</span><span className={`font-bold ${usConnected ? 'text-emerald-600' : 'text-slate-500'}`}>{usConnected ? 'CONNECTED' : 'NOT CONNECTED'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Scheduler</span><span className="font-bold">{String(statusQ.data?.scheduler || '—').toUpperCase()}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Wallet (portfolio breakdown)</span><span className="font-bold">{walletConnected ? 'CONNECTED' : 'NOT CONNECTED'}</span></div>
            </>
          )}
        </div>
      )}

      {/* Wager modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-testid="pm-wager-modal">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-white border border-slate-200 shadow-xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-xs font-mono text-blue-700 font-bold uppercase tracking-wider">Record wager{pmMode ? ` (${pmMode})` : ''}</span>
                <h3 className="text-base font-bold text-slate-900 mt-1">{selected.title}</h3>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="text-slate-400 hover:text-slate-600 text-lg font-bold">✕</button>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs font-mono">
              <div className="flex justify-between"><span className="text-slate-500">Model probability (YES):</span><span className="font-bold">{selected.modelProb === null ? '—' : `${(selected.modelProb * 100).toFixed(1)}%`}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Edge:</span><span className="font-bold">{pct(selected.edgePct)}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['YES', 'NO'] as const).map(o => (
                <button
                  key={o}
                  type="button"
                  data-testid={`pm-wager-${o.toLowerCase()}`}
                  onClick={() => setWagerOutcome(o)}
                  className={`p-3 rounded-xl border text-xs font-mono font-bold flex flex-col items-center gap-1 transition-all ${wagerOutcome === o ? (o === 'YES' ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-red-50 border-red-300 text-red-800') : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  <span>BUY {o}</span>
                  <span className="text-sm font-bold text-slate-900">{cents(o === 'YES' ? selected.yesPrice : selected.noPrice)}</span>
                </button>
              ))}
            </div>
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-500 font-semibold">Wager amount (USD):</span>
                <span className="text-blue-700 font-bold">Est. shares: {selectedPrice ? (wagerAmount / selectedPrice).toFixed(1) : '—'}</span>
              </div>
              <input
                type="number"
                min={1}
                data-testid="pm-wager-amount"
                value={wagerAmount}
                onChange={e => setWagerAmount(Number(e.target.value) || 0)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-900 focus:outline-none focus:border-blue-500 font-bold"
              />
            </div>
            <button
              data-testid="pm-wager-confirm"
              onClick={executeWager}
              disabled={wagerLoading || !selectedPrice}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold rounded-xl text-xs transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {wagerLoading ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
              <span>CONFIRM WAGER</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
