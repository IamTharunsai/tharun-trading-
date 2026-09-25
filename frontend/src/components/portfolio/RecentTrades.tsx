import { useQuery } from '@tanstack/react-query';
import { getTrades } from '../../services/api';
import { useStore } from '../../store';
import { ArrowLeftRight, TrendingUp, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';

export default function RecentTrades() {
  const { data } = useQuery({ queryKey: ['trades'], queryFn: () => getTrades(1, 10), refetchInterval: 10000 });
  const recentFromSocket = useStore(s => s.recentTrades);

  const trades = data?.trades || [];

  return (
    <div className="p-5 rounded-xl glass-panel">
      <div className="flex items-center gap-2 mb-4">
        <ArrowLeftRight size={16} className="text-emerald-400" />
        <span className="font-semibold text-white">Recent Institutional Executions</span>
        <span className="ml-auto font-mono text-xs text-slate-400">{trades.length} logged</span>
      </div>

      {trades.length === 0 ? (
        <div className="text-center py-8 font-mono text-xs text-slate-500">No trades yet — autonomous agents watching the tape</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] text-slate-400">
                {['Asset', 'Type', 'Entry', 'Exit', 'P&L', 'Status', 'Time'].map(h => (
                  <th key={h} className="pb-2.5 px-2 text-[10px] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {trades.map((t: any) => {
                const isPos = (t.pnl || 0) >= 0;
                return (
                  <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-2.5 px-2 font-bold text-white max-w-[140px] truncate">{t.asset}</td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded font-bold ${
                        t.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                      }`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-slate-200 tabular-nums">${t.entryPrice?.toFixed(2)}</td>
                    <td className="py-2.5 px-2 text-slate-400 tabular-nums">{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '—'}</td>
                    <td className="py-2.5 px-2">
                      {t.pnl != null ? (
                        <span className={`font-bold tabular-nums flex items-center gap-1 ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isPos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                          {isPos ? '+' : ''}${t.pnl.toFixed(2)}
                        </span>
                      ) : <span className="text-slate-500">running</span>}
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        t.status === 'OPEN' ? 'bg-amber-500/20 text-amber-300' : t.status === 'CLOSED' ? 'bg-white/5 text-slate-400' : 'bg-red-500/20 text-red-300'
                      }`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-[10px] text-slate-500">{format(new Date(t.openedAt || t.createdAt || Date.now()), 'MM/dd HH:mm')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
