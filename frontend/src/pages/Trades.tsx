// ── TRADES PAGE ───────────────────────────────────────────────────────────────
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTrades, getTradeStats } from '../services/api';
import { format } from 'date-fns';
import {
  TrendingUp, TrendingDown, ArrowLeftRight, ChevronLeft, ChevronRight,
  Download, CheckCircle, XCircle, Clock
} from 'lucide-react';
import StatCard from '../components/common/StatCard';
import LastUpdated from '../components/common/LastUpdated';
import { tradeOutcome, tradeAssetLabel, tradeMeta as meta, OUTCOME_CLS } from '../utils/trades';

const PAGE_SIZE = 25;

const truncate = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function TradesPage() {
  const [page, setPage] = useState(1);
  const [filterMarket, setFilterMarket] = useState<'all' | 'stocks' | 'crypto' | 'polymarket'>('all');
  const [filterOutcome, setFilterOutcome] = useState<'all' | 'winners' | 'losers' | 'open' | 'rejected'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['trades-full', page, filterMarket],
    queryFn: () => getTrades(page, PAGE_SIZE, filterMarket !== 'all' ? { market: filterMarket } : undefined),
    refetchInterval: 15000
  });

  const { data: stats } = useQuery({
    queryKey: ['trade-stats', filterMarket],
    queryFn: () => getTradeStats()
  });

  // Base list of trades with safe array check
  const rawTrades: any[] = useMemo(() => {
    if (Array.isArray(data?.trades)) return data.trades;
    if (Array.isArray(data)) return data;
    return [];
  }, [data]);

  // Strict zero-mock trade history: Display only authentic database trades
  const trades: any[] = useMemo(() => {
    let list = [...rawTrades];

    // Filter by Market
    if (filterMarket !== 'all') {
      list = list.filter((t: any) => t.market?.toLowerCase() === filterMarket.toLowerCase());
    }

    // Filter by Outcome
    if (filterOutcome === 'winners') {
      list = list.filter((t: any) => tradeOutcome(t) === 'WIN');
    } else if (filterOutcome === 'losers') {
      list = list.filter((t: any) => tradeOutcome(t) === 'LOSS');
    } else if (filterOutcome === 'open') {
      list = list.filter((t: any) => tradeOutcome(t) === 'OPEN');
    } else if (filterOutcome === 'rejected') {
      list = list.filter((t: any) => tradeOutcome(t) === 'REJECTED');
    }

    return list;
  }, [rawTrades, filterMarket, filterOutcome]);

  // KPIs from CLOSED trades only (rejections / opens never count toward win rate or P&L).
  const currentStats = useMemo(() => {
    const scope = rawTrades.filter((t: any) => filterMarket === 'all' || String(t.market || '').toLowerCase() === filterMarket);
    const closed = scope.filter((t: any) => String(t.status || '').toUpperCase() === 'CLOSED' && tradeOutcome(t) !== 'REJECTED');
    const winners = closed.filter((t: any) => tradeOutcome(t) === 'WIN');
    const losers = closed.filter((t: any) => tradeOutcome(t) === 'LOSS');
    const pnlOf = (t: any) => (Number.isFinite(Number(t.pnl)) ? Number(t.pnl) : 0);
    const totalPnl = closed.reduce((sum: number, t: any) => sum + pnlOf(t), 0);
    const totalWinsAmount = winners.reduce((sum: number, t: any) => sum + pnlOf(t), 0);
    const totalLossesAmount = Math.abs(losers.reduce((sum: number, t: any) => sum + pnlOf(t), 0));
    return {
      count: scope.length,
      closedCount: closed.length,
      rejectedCount: scope.filter((t: any) => tradeOutcome(t) === 'REJECTED').length,
      winRate: closed.length > 0 ? (winners.length / closed.length) * 100 : null,
      totalPnl: closed.length > 0 ? totalPnl : null,
      winnersCount: winners.length,
      losersCount: losers.length,
      profitFactor: totalLossesAmount > 0 ? totalWinsAmount / totalLossesAmount : null,
    };
  }, [rawTrades, filterMarket]);

  const total = data?.total || trades.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportCSV = () => {
    const headers = ['Asset', 'Market', 'Side', 'Qty', 'EntryPrice', 'ExitPrice', 'PnL', 'PnLPct', 'Status', 'OpenedAt'];
    const rows = trades.map(t => [
      `"${tradeAssetLabel(t).replace(/"/g, "'")}"`,
      t.market,
      t.type,
      t.quantity,
      t.entryPrice,
      t.exitPrice || '',
      t.pnl || 0,
      t.pnlPct || 0,
      tradeOutcome(t),
      t.openedAt
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `apex_trades_${filterMarket}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-2xl text-slate-900 tracking-tight font-display">
              Execution Ledger & Trade History
            </h1>
            <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              24/7 MULTI-ASSET ENGINE
            </span>
          </div>
          <p className="font-mono text-xs text-slate-500 mt-1">
            Complete institutional audit trail across Stocks, Crypto, and Polymarket Arbitrage
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            data-testid="export-trades-csv"
            onClick={exportCSV}
            className="flex items-center gap-2 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono text-slate-700 font-bold transition shadow-xs"
          >
            <Download size={13} />
            EXPORT AUDIT CSV
          </button>
          <LastUpdated />
        </div>
      </div>

      {/* Connected Financial KPIs Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          testId="stat-trade-count"
          label={filterMarket === 'polymarket' ? 'Polymarket Wagers' : filterMarket === 'stocks' ? 'Stock Trades' : 'Total Orders (this page)'}
          value={currentStats.count}
          sub={`${currentStats.closedCount} closed · ${currentStats.rejectedCount} rejected`}
          mono
        />
        <StatCard
          testId="stat-win-rate"
          label="Win Rate (closed)"
          value={currentStats.winRate === null ? '—' : `${currentStats.winRate.toFixed(1)}%`}
          sub={`${currentStats.winnersCount}W / ${currentStats.losersCount}L`}
          trend={currentStats.winRate === null ? undefined : currentStats.winRate >= 50 ? 'up' : 'down'}
          mono
        />
        <StatCard
          testId="stat-realized-pnl"
          label="Net Realized P&L"
          value={currentStats.totalPnl === null ? '—' : `${currentStats.totalPnl >= 0 ? '+' : '-'}$${Math.abs(currentStats.totalPnl).toFixed(2)}`}
          trend={currentStats.totalPnl === null ? undefined : currentStats.totalPnl >= 0 ? 'up' : 'down'}
          mono
        />
        <StatCard
          testId="stat-profit-factor"
          label="Profit Factor"
          value={currentStats.profitFactor === null ? '—' : currentStats.profitFactor.toFixed(2)}
          mono
        />
      </div>

      {/* Primary Market Switcher & Outcome Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        {/* Asset Class Tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-slate-500 uppercase font-semibold mr-1">Market:</span>
          {[
            { id: 'all', label: 'All Markets' },
            { id: 'stocks', label: 'Stocks & ETFs' },
            { id: 'crypto', label: 'Crypto Assets' },
            { id: 'polymarket', label: 'Polymarket Alpha' },
          ].map(m => (
            <button
              key={m.id}
              data-testid={`trades-market-${m.id}`}
              onClick={() => { setFilterMarket(m.id as any); setPage(1); }}
              className={`px-3.5 py-1.5 rounded-lg font-mono text-xs font-bold transition-all ${
                filterMarket === m.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Outcome Filter Tabs: All, Winners, Losers, Open */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-slate-500 uppercase font-semibold mr-1">Outcome:</span>
          {[
            { id: 'all', label: 'All Trades', icon: ArrowLeftRight },
            { id: 'winners', label: `Winners (${currentStats.winnersCount})`, icon: CheckCircle, color: 'text-emerald-600' },
            { id: 'losers', label: `Losers (${currentStats.losersCount})`, icon: XCircle, color: 'text-red-600' },
            { id: 'open', label: 'Open Positions', icon: Clock, color: 'text-blue-600' },
            { id: 'rejected', label: `Rejected (${currentStats.rejectedCount})`, icon: XCircle, color: 'text-slate-400' },
          ].map(o => {
            const Icon = o.icon;
            const active = filterOutcome === o.id;
            return (
              <button
                key={o.id}
                data-testid={`trades-outcome-${o.id}`}
                onClick={() => { setFilterOutcome(o.id as any); setPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all ${
                  active
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Icon size={12} className={o.color || ''} />
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Execution Table */}
      <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100 text-xs font-mono">
          <div className="text-slate-500 font-medium">
            Displaying <span className="text-slate-900 font-bold">{trades.length}</span> executed orders
            {filterMarket !== 'all' && <span className="ml-1 text-blue-700 font-bold">in {filterMarket.toUpperCase()}</span>}
            {filterOutcome !== 'all' && <span className="ml-1 text-slate-700">({filterOutcome.toUpperCase()})</span>}
          </div>

        </div>

        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">Asset / Contract</th>
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">Market</th>
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">Side</th>
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">Qty / Shares</th>
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">Entry</th>
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">Exit / Current</th>
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">Net P&L ($)</th>
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">ROI (%)</th>
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">Status</th>
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">Alpha / Strategy</th>
              <th className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {trades.map((t: any) => {
              const isPolymarket = t.market?.toLowerCase() === 'polymarket';
              const isPos = (t.pnl || 0) >= 0;
              const outcome = tradeOutcome(t);
              const m = meta(t);
              const assetLabel = tradeAssetLabel(t);
              const isIntraday = m.lane === 'INTRADAY';
              const isSynced = t.reconciliationStatus === 'IMPORTED_FROM_BROKER';

              return (
                <tr key={t.id} data-testid="trade-row" data-outcome={outcome} className={`hover:bg-slate-50/80 transition-colors ${outcome === 'REJECTED' ? 'opacity-60' : ''}`}>
                  {/* Asset */}
                  <td className="py-3 px-3 font-bold text-slate-900 max-w-[260px]" title={assetLabel}>
                    <div className="truncate">{truncate(assetLabel)}</div>
                    {(isIntraday || isSynced) && (
                      <div className="flex gap-1 mt-0.5">
                        {isIntraday && <span data-testid="badge-intraday" className="px-1.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">INTRADAY</span>}
                        {isSynced && <span data-testid="badge-synced" className="px-1.5 rounded text-[9px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200">SYNCED FROM BROKER</span>}
                      </div>
                    )}
                  </td>

                  {/* Market Badge */}
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      isPolymarket
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : t.market === 'crypto'
                        ? 'bg-purple-50 text-purple-700 border border-purple-200'
                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                    }`}>
                      {t.market?.toUpperCase()}
                    </span>
                  </td>

                  {/* Side */}
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                      t.type === 'BUY'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                      {isPolymarket ? (t.type === 'BUY' ? 'YES' : 'NO') : t.type}
                    </span>
                  </td>

                  {/* Qty */}
                  <td className="py-3 px-3 text-slate-700 tabular-nums">
                    {t.quantity != null ? Number(t.quantity).toFixed(isPolymarket ? 2 : 4) : '—'}
                  </td>

                  {/* Entry */}
                  <td className="py-3 px-3 text-slate-700 tabular-nums">
                    {t.entryPrice != null ? `$${Number(t.entryPrice).toFixed(2)}` : '—'}
                  </td>

                  {/* Exit */}
                  <td className="py-3 px-3 text-slate-700 tabular-nums">
                    {t.exitPrice != null ? `$${Number(t.exitPrice).toFixed(isPolymarket ? 2 : 2)}` : '—'}
                  </td>

                  {/* PnL */}
                  <td className={`py-3 px-3 font-bold tabular-nums ${t.pnl != null && outcome !== 'REJECTED' ? (isPos ? 'text-emerald-600' : 'text-red-600') : 'text-slate-400'}`}>
                    {t.pnl != null && outcome !== 'REJECTED' ? `${isPos ? '+' : '-'}$${Math.abs(Number(t.pnl)).toFixed(2)}` : '—'}
                  </td>

                  {/* ROI */}
                  <td className={`py-3 px-3 font-bold tabular-nums ${t.pnlPct != null && outcome !== 'REJECTED' ? (isPos ? 'text-emerald-600' : 'text-red-600') : 'text-slate-400'}`}>
                    {t.pnlPct != null && outcome !== 'REJECTED' ? `${isPos ? '+' : ''}${Number(t.pnlPct).toFixed(2)}%` : '—'}
                  </td>

                  {/* Status */}
                  <td className="py-3 px-3">
                    <span data-testid="trade-outcome" className={`px-2 py-0.5 rounded font-bold text-[10px] ${OUTCOME_CLS[outcome]}`}>
                      {outcome}
                    </span>
                  </td>

                  {/* Strategy */}
                  <td className="py-3 px-3 text-slate-500 truncate max-w-[200px]" title={t.exitReason || t.entryReason || m.setup || ''}>
                    {t.exitReason || t.entryReason || m.setup || '—'}
                  </td>

                  {/* Timestamp */}
                  <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                    {(() => { const d = new Date(t.openedAt || t.createdAt); return Number.isFinite(d.getTime()) ? format(d, 'MM/dd HH:mm:ss') : '—'; })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {trades.length === 0 && (
          <div className="text-center py-16 font-mono text-xs text-slate-400">
            No trades match the selected market and outcome filters.
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-3">
            <span className="font-mono text-xs text-slate-500">
              {total} total recorded trades · page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition"
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                const p = start + i;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded-lg font-mono text-xs font-bold transition ${
                      p === page
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TradesPage;
