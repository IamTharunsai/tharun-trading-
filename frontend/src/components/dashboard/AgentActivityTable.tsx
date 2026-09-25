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
    <div className="p-5 rounded-xl glass-panel">
      <div className="flex items-center gap-2 mb-4">
        <Brain size={16} className="text-amber-400" />
        <h2 className="font-semibold text-white">Agent Deliberation & Asset Memory</h2>
        <span className="font-mono text-xs text-slate-400 ml-auto">Most-Debated Equities · Multi-Agent Neural Consensus</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-center py-8 font-mono text-xs text-slate-500">No agent decisions recorded yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] text-slate-400">
                {['Asset', 'Last Vote', 'Confidence', 'Win Rate', 'Trades', 'Debates', 'Position P&L', 'Adapted Setup'].map(h => (
                  <th key={h} className="pb-2.5 px-2 text-[10px] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {rows.map((r: any) => (
                <tr key={r.symbol} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-2 font-bold text-white">{r.symbol}</td>
                  <td className="py-2.5 px-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded font-bold ${
                      r.lastVote === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' :
                      r.lastVote === 'SELL' ? 'bg-red-500/20 text-red-300' : 'bg-white/5 text-slate-400'
                    }`}>{r.lastVote || '—'}</span>
                  </td>
                  <td className="py-2.5 px-2 text-slate-300 tabular-nums">{r.lastConfidence != null ? `${Math.round(r.lastConfidence)}%` : '—'}</td>
                  <td className="py-2.5 px-2 text-emerald-400 font-bold tabular-nums">{r.winRate != null ? `${r.winRate}%` : '—'}</td>
                  <td className="py-2.5 px-2 text-slate-400 tabular-nums">{r.tradeCount}</td>
                  <td className="py-2.5 px-2 text-slate-400 tabular-nums">{r.debateCount}</td>
                  <td className={`py-2.5 px-2 font-bold tabular-nums ${r.hasOpenPosition ? ((r.openPositionPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}`}>
                    {r.hasOpenPosition ? `${(r.openPositionPnl || 0) >= 0 ? '+' : ''}$${(r.openPositionPnl || 0).toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 px-2 text-[11px] text-amber-300/80">{r.bestSetup || 'Breakout Expansion'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
