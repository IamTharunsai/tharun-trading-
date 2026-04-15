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
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <ArrowLeftRight size={16} className="text-apex-accent" />
        <span className="font-sans font-semibold text-apex-text">Recent Trades</span>
        <span className="ml-auto font-mono text-xs text-apex-muted">{trades.length} shown</span>
      </div>

      {trades.length === 0 ? (
        <div className="text-center py-8 font-mono text-xs text-apex-muted">No trades yet — agents are watching the markets</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-apex-border">
                {['Asset', 'Type', 'Entry', 'Exit', 'P&L', 'Status', 'Time'].map(h => (
                  <th key={h} className="pb-2 text-left font-mono text-[10px] text-apex-muted uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t: any) => {
                const isPos = (t.pnl || 0) >= 0;
                return (
                  <tr key={t.id} className="border-b border-apex-border/40 hover:bg-apex-surface/50 transition-colors">
                    <td className="py-2 font-sans font-bold text-sm text-apex-text">{t.asset}</td>
                    <td className="py-2">
                      <span className={`font-mono text-xs px-2 py-0.5 rounded font-bold ${t.type === 'BUY' ? 'bg-apex-green/10 text-apex-green' : 'bg-apex-red/10 text-apex-red'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="py-2 font-mono text-xs text-apex-text">${t.entryPrice?.toFixed(2)}</td>
                    <td className="py-2 font-mono text-xs text-apex-muted">{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '—'}</td>
                    <td className="py-2">
                      {t.pnl != null ? (
                        <span className={`font-mono text-xs font-bold flex items-center gap-0.5 ${isPos ? 'text-apex-green' : 'text-apex-red'}`}>
                          {isPos ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {isPos ? '+' : ''}${t.pnl.toFixed(2)}
                        </span>
                      ) : <span className="text-apex-muted font-mono text-xs">open</span>}
                    </td>
                    <td className="py-2">
                      <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${t.status === 'OPEN' ? 'bg-apex-yellow/10 text-apex-yellow' : t.status === 'CLOSED' ? 'bg-apex-surface text-apex-muted' : 'bg-apex-red/10 text-apex-red'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="py-2 font-mono text-[10px] text-apex-muted">{format(new Date(t.openedAt), 'MM/dd HH:mm')}</td>
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
