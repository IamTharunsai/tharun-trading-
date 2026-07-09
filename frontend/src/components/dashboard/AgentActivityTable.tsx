import { useQuery } from '@tanstack/react-query';
import { getStocksUniverse } from '../../services/api';
import { Brain } from 'lucide-react';

export default function AgentActivityTable() {
  const { data: universe = [] } = useQuery({ queryKey: ['stocks-universe'], queryFn: getStocksUniverse, refetchInterval: 30000 });

  const rows = (universe as any[])
    .slice()
    .sort((a, b) => (b.debateCount || 0) - (a.debateCount || 0))
    .slice(0, 8);

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Brain size={16} className="text-apex-accent" />
        <h2 className="font-sans font-semibold text-apex-text">Agent Activity by Asset</h2>
        <span className="font-mono text-[10px] text-apex-muted ml-auto">Most-debated assets · live council reasoning</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-center py-8 font-mono text-xs text-apex-muted">No agent decisions recorded yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-apex-border">
                {['Asset', 'Last Vote', 'Confidence', 'Win Rate', 'Trades', 'Debates', 'Position P&L', 'Adapted Setup'].map(h => (
                  <th key={h} className="py-2 text-left font-mono text-[10px] text-apex-muted uppercase pr-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.symbol} className="border-b border-apex-border/40">
                  <td className="py-2.5 font-sans font-bold text-apex-text pr-3">{r.symbol}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`font-mono text-xs px-2 py-0.5 rounded font-bold ${
                      r.lastVote === 'BUY' ? 'bg-apex-green/10 text-apex-green' :
                      r.lastVote === 'SELL' ? 'bg-apex-red/10 text-apex-red' : 'bg-apex-surface text-apex-muted'
                    }`}>{r.lastVote || '—'}</span>
                  </td>
                  <td className="py-2.5 font-mono text-xs text-apex-muted pr-3">{r.lastConfidence != null ? `${Math.round(r.lastConfidence)}%` : '—'}</td>
                  <td className="py-2.5 font-mono text-xs pr-3">{r.winRate != null ? `${r.winRate}%` : '—'}</td>
                  <td className="py-2.5 font-mono text-xs text-apex-muted pr-3">{r.tradeCount}</td>
                  <td className="py-2.5 font-mono text-xs text-apex-muted pr-3">{r.debateCount}</td>
                  <td className={`py-2.5 font-mono text-xs font-bold pr-3 ${r.hasOpenPosition ? ((r.openPositionPnl || 0) >= 0 ? 'text-apex-green' : 'text-apex-red') : 'text-apex-muted'}`}>
                    {r.hasOpenPosition ? `${(r.openPositionPnl || 0) >= 0 ? '+' : ''}$${(r.openPositionPnl || 0).toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 font-mono text-[10px] text-apex-muted">{r.bestSetup || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
