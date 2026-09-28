import { useQuery } from '@tanstack/react-query';
import { getTrades } from '../../services/api';
import { useStore } from '../../store';
import { ArrowLeftRight, TrendingUp, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';

export default function RecentTrades() {
  const { data } = useQuery({ queryKey: ['trades'], queryFn: () => getTrades(1, 10), refetchInterval: 10000 });
  const recentFromSocket = useStore(s => s.recentTrades);

  const trades = Array.isArray(data?.trades) ? data.trades : Array.isArray(data) ? data : [];

  return (
    <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <ArrowLeftRight size={16} className="text-blue-600" />
        <span className="font-semibold text-slate-900 text-sm">Recent Institutional Executions</span>
        <span className="ml-auto font-mono text-xs text-slate-500 font-semibold">{trades.length} logged</span>
      </div>

      {trades.length === 0 ? (
        <div className="text-center py-8 font-mono text-xs text-slate-400">No trades yet — autonomous agents watching the tape</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
                {['Asset', 'Type', 'Entry', 'Exit', 'P&L', 'Status', 'Time'].map(h => (
                  <th key={h} className="py-2 px-2.5 text-[10px] uppercase font-bold tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trades.map((t: any) => {
                const isPos = (t.pnl || 0) >= 0;
                return (
                  <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-2.5 font-bold text-slate-900 max-w-[140px] truncate">{t.asset}</td>
                    <td className="py-2.5 px-2.5">
                      <span className={`text-[11px] px-2 py-0.5 rounded font-bold ${
                        t.type === 'BUY' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-2.5 text-slate-800 tabular-nums">${t.entryPrice?.toFixed(2)}</td>
                    <td className="py-2.5 px-2.5 text-slate-500 tabular-nums">{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '—'}</td>
                    <td className="py-2.5 px-2.5">
                      {t.pnl != null ? (
                        <span className={`font-bold tabular-nums flex items-center gap-1 ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>
                          {isPos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                          {isPos ? '+' : ''}${t.pnl.toFixed(2)}
                        </span>
                      ) : <span className="text-slate-400">running</span>}
                    </td>
                    <td className="py-2.5 px-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        t.status === 'OPEN' ? 'bg-amber-50 text-amber-700 border border-amber-200' : t.status === 'CLOSED' ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-2.5 text-[10px] text-slate-500">{format(new Date(t.openedAt || t.createdAt || Date.now()), 'MM/dd HH:mm')}</td>
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
