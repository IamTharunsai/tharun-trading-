// History Page
import { useQuery } from '@tanstack/react-query';
import { getTrades } from '../services/api';
import { format } from 'date-fns';
import { History } from 'lucide-react';

export default function HistoryPage() {
  const { data } = useQuery({ queryKey: ['history'], queryFn: () => getTrades(1, 500), refetchInterval: 30000 });
  const trades = data?.trades || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <History size={20} className="text-apex-accent" />
        <h1 className="font-sans font-bold text-2xl text-apex-text">Full History</h1>
        <span className="font-mono text-xs text-apex-muted ml-2">{data?.total || 0} total trades — archived forever</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-apex-border">
              {['Date', 'Asset', 'Market', 'Type', 'Entry', 'Exit', 'Qty', 'P&L', 'P&L%', 'Exit Reason'].map(h => (
                <th key={h} className="pb-3 text-left font-mono text-[10px] text-apex-muted uppercase tracking-widest pr-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((t: any) => {
              const isPos = (t.pnl || 0) >= 0;
              return (
                <tr key={t.id} className="border-b border-apex-border/20 hover:bg-apex-surface/40 transition-colors">
                  <td className="py-2 font-mono text-[10px] text-apex-muted pr-4">{format(new Date(t.openedAt), 'yyyy-MM-dd HH:mm')}</td>
                  <td className="py-2 font-sans font-bold text-sm text-apex-text pr-4">{t.asset}</td>
                  <td className="py-2 font-mono text-xs text-apex-muted pr-4">{t.market}</td>
                  <td className="py-2 pr-4">
                    <span className={`font-mono text-xs px-1.5 py-0.5 rounded font-bold ${t.type === 'BUY' ? 'bg-apex-green/10 text-apex-green' : 'bg-apex-red/10 text-apex-red'}`}>{t.type}</span>
                  </td>
                  <td className="py-2 font-mono text-xs text-apex-text pr-4">${t.entryPrice?.toFixed(2)}</td>
                  <td className="py-2 font-mono text-xs text-apex-muted pr-4">{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '—'}</td>
                  <td className="py-2 font-mono text-xs text-apex-muted pr-4">{t.quantity?.toFixed(4)}</td>
                  <td className={`py-2 font-mono text-xs font-bold pr-4 ${t.pnl != null ? (isPos ? 'text-apex-green' : 'text-apex-red') : 'text-apex-muted'}`}>
                    {t.pnl != null ? `${isPos ? '+' : ''}$${t.pnl.toFixed(2)}` : '—'}
                  </td>
                  <td className={`py-2 font-mono text-xs pr-4 ${isPos ? 'text-apex-green' : 'text-apex-red'}`}>
                    {t.pnlPct != null ? `${isPos ? '+' : ''}${t.pnlPct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="py-2 font-mono text-[10px] text-apex-muted">{t.exitReason || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {trades.length === 0 && <div className="text-center py-12 font-mono text-xs text-apex-muted">No trade history yet</div>}
      </div>
    </div>
  );
}
