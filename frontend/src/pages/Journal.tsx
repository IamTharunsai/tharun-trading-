// Journal Page
import { useQuery } from '@tanstack/react-query';
import { getJournals } from '../services/api';
import { BookOpen, TrendingUp, TrendingDown } from 'lucide-react';

export default function JournalPage() {
  const { data: journals = [] } = useQuery({ queryKey: ['journals'], queryFn: getJournals, refetchInterval: 60000 });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BookOpen size={20} className="text-apex-accent" />
        <h1 className="font-sans font-bold text-2xl text-apex-text">Trading Journal</h1>
        <span className="font-mono text-xs text-apex-muted ml-2">AI-generated daily entries</span>
      </div>

      <div className="space-y-4">
        {journals.map((j: any) => (
          <div key={j.id} className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-apex-accent">{j.date}</span>
                <span className={`font-mono text-sm font-bold flex items-center gap-1 ${(j.pnlDay || 0) >= 0 ? 'text-apex-green' : 'text-apex-red'}`}>
                  {(j.pnlDay || 0) >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {(j.pnlDay || 0) >= 0 ? '+' : ''}${(j.pnlDay || 0).toFixed(2)} ({(j.pnlDayPct || 0).toFixed(2)}%)
                </span>
              </div>
              <span className="font-mono text-xs text-apex-muted">{j.totalTrades} trades</span>
            </div>
            <p className="font-sans text-sm text-apex-text/80 leading-relaxed whitespace-pre-line">{j.summary}</p>
            {(j.bestTrade || j.worstTrade) && (
              <div className="mt-3 pt-3 border-t border-apex-border flex gap-6">
                {j.bestTrade && <div className="font-mono text-xs"><span className="text-apex-muted">Best: </span><span className="text-apex-green">{j.bestTrade.asset} +${j.bestTrade.pnl?.toFixed(2)}</span></div>}
                {j.worstTrade && <div className="font-mono text-xs"><span className="text-apex-muted">Worst: </span><span className="text-apex-red">{j.worstTrade.asset} ${j.worstTrade.pnl?.toFixed(2)}</span></div>}
              </div>
            )}
          </div>
        ))}
        {journals.length === 0 && (
          <div className="card text-center py-12">
            <BookOpen size={32} className="text-apex-muted mx-auto mb-3" />
            <p className="font-mono text-xs text-apex-muted">Journal entries are generated nightly at 11:59 PM</p>
          </div>
        )}
      </div>
    </div>
  );
}
