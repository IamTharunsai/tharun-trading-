// ── TRADES PAGE ───────────────────────────────────────────────────────────────
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTrades, getTradeStats } from '../services/api';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown, ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react';
import StatCard from '../components/common/StatCard';

const PAGE_SIZE = 25;

export function TradesPage() {
  const [page, setPage] = useState(1);
  const { data } = useQuery({ queryKey: ['trades-full', page], queryFn: () => getTrades(page, PAGE_SIZE), refetchInterval: 15000 });
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats });
  const trades = data?.trades || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <h1 className="font-sans font-bold text-2xl text-apex-text">Trade History</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Trades" value={stats?.totalTrades || 0} mono />
        <StatCard label="Win Rate" value={`${stats?.winRate || 0}%`} trend={parseFloat(stats?.winRate || '0') >= 50 ? 'up' : 'down'} mono />
        <StatCard label="Total P&L" value={`$${stats?.totalPnl || '0.00'}`} trend={parseFloat(stats?.totalPnl || '0') >= 0 ? 'up' : 'down'} mono />
        <StatCard label="Profit Factor" value={stats?.profitFactor || '—'} mono />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-apex-border">
              {['Asset', 'Market', 'Type', 'Qty', 'Entry', 'Exit', 'P&L', 'P&L%', 'Status', 'Reason', 'Opened'].map(h => (
                <th key={h} className="pb-3 text-left font-mono text-[10px] text-apex-muted uppercase tracking-widest pr-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((t: any) => {
              const isPos = (t.pnl || 0) >= 0;
              return (
                <tr key={t.id} className="border-b border-apex-border/30 hover:bg-apex-surface/50 transition-colors">
                  <td className="py-2.5 font-sans font-bold text-apex-text pr-4">{t.asset}</td>
                  <td className="py-2.5 font-mono text-xs text-apex-muted pr-4">{t.market}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`font-mono text-xs px-2 py-0.5 rounded font-bold ${t.type === 'BUY' ? 'bg-apex-green/10 text-apex-green' : 'bg-apex-red/10 text-apex-red'}`}>{t.type}</span>
                  </td>
                  <td className="py-2.5 font-mono text-xs text-apex-text pr-4">{t.quantity?.toFixed(4)}</td>
                  <td className="py-2.5 font-mono text-xs text-apex-text pr-4">${t.entryPrice?.toFixed(2)}</td>
                  <td className="py-2.5 font-mono text-xs text-apex-muted pr-4">{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '—'}</td>
                  <td className={`py-2.5 font-mono text-xs font-bold pr-4 ${t.pnl != null ? (isPos ? 'text-apex-green' : 'text-apex-red') : 'text-apex-muted'}`}>
                    {t.pnl != null ? `${isPos ? '+' : ''}$${t.pnl.toFixed(2)}` : '—'}
                  </td>
                  <td className={`py-2.5 font-mono text-xs pr-4 ${isPos ? 'text-apex-green' : 'text-apex-red'}`}>
                    {t.pnlPct != null ? `${isPos ? '+' : ''}${t.pnlPct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${t.status === 'OPEN' ? 'bg-apex-yellow/10 text-apex-yellow' : 'bg-apex-surface text-apex-muted'}`}>{t.status}</span>
                  </td>
                  <td className="py-2.5 font-mono text-[10px] text-apex-muted pr-4">{t.exitReason || '—'}</td>
                  <td className="py-2.5 font-mono text-[10px] text-apex-muted">{format(new Date(t.openedAt), 'MM/dd HH:mm')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {trades.length === 0 && <div className="text-center py-12 font-mono text-xs text-apex-muted">No trades recorded yet</div>}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-apex-border mt-2">
            <span className="font-mono text-xs text-apex-muted">
              {total} trades · page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-apex-border text-apex-muted hover:text-apex-text hover:border-apex-accent disabled:opacity-40 transition"
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
                    className={`w-7 h-7 rounded-lg font-mono text-xs transition ${p === page ? 'bg-apex-accent text-white' : 'border border-apex-border text-apex-muted hover:text-apex-text'}`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-apex-border text-apex-muted hover:text-apex-text hover:border-apex-accent disabled:opacity-40 transition"
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
