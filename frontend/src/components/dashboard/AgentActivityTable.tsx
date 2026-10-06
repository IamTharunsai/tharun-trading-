import { useQuery } from '@tanstack/react-query';
import { getStocksUniverse } from '../../services/api';
import { Brain } from 'lucide-react';

export default function AgentActivityTable() {
  const { data: universe = [] } = useQuery({ queryKey: ['stocks-universe'], queryFn: getStocksUniverse, refetchInterval: 30000 });

  const list = Array.isArray(universe) ? universe : Array.isArray((universe as any)?.stocks) ? (universe as any).stocks : [];

  const rows = list
    .slice()
    .sort((a: any, b: any) => (b.debateCount || 0) - (a.debateCount || 0))
    .slice(0, 8);

  return (
    <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Brain size={16} className="text-blue-600" />
        <h2 className="font-semibold text-slate-900 text-sm">Agent Deliberation & Asset Memory</h2>
        <span className="font-mono text-xs text-slate-500 ml-auto">Most-Debated Equities · Multi-Agent Neural Consensus</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-center py-8 font-mono text-xs text-slate-400">No agent decisions recorded yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
                {['Asset', 'Last Vote', 'Confidence', 'Win Rate', 'Trades', 'Debates', 'Position P&L', 'Adapted Setup'].map(h => (
                  <th key={h} className="py-2 px-2.5 text-[10px] uppercase font-bold tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any) => (
                <tr key={r.symbol} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-2.5 px-2.5 font-bold text-slate-900">{r.symbol}</td>
                  <td className="py-2.5 px-2.5">
                    <span className={`text-[11px] px-2 py-0.5 rounded font-bold ${
                      r.lastVote === 'BUY' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      r.lastVote === 'SELL' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-600'
                    }`}>{r.lastVote || '—'}</span>
                  </td>
                  <td className="py-2.5 px-2.5 text-slate-700 tabular-nums">{r.lastConfidence != null ? `${Math.round(r.lastConfidence)}%` : '—'}</td>
                  <td className="py-2.5 px-2.5 text-emerald-600 font-bold tabular-nums">{r.winRate != null ? `${r.winRate}%` : '—'}</td>
                  <td className="py-2.5 px-2.5 text-slate-600 tabular-nums">{r.tradeCount}</td>
                  <td className="py-2.5 px-2.5 text-slate-600 tabular-nums">{r.debateCount}</td>
                  <td className={`py-2.5 px-2.5 font-bold tabular-nums ${r.hasOpenPosition ? ((r.openPositionPnl || 0) >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-slate-400'}`}>
                    {r.hasOpenPosition ? `${(r.openPositionPnl || 0) >= 0 ? '+' : ''}$${(r.openPositionPnl || 0).toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 px-2.5 text-[11px] text-blue-700 font-medium">{r.bestSetup || 'Breakout Expansion'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
