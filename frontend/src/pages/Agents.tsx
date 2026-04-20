import { useQuery } from '@tanstack/react-query';
import { getAgentDecisions } from '../services/api';
import { useStore } from '../store';
import { format } from 'date-fns';
import { Bot, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';

const AGENT_NAMES = ['The Technician','The Newshound','The Sentiment Analyst','The Fundamental Analyst','The Risk Manager','The Trend Prophet','The Volume Detective','The Whale Watcher','The Macro Economist',"The Devil's Advocate"];
const AGENT_ICONS = ['📊','📰','🧠','📈','🛡️','🔮','🔍','🐋','🌍','😈'];
const AGENT_ROLES = ['Technical Analysis','News & Events','Market Sentiment','Fundamentals','Risk Manager (VETO)','Future Prediction','Volume Analysis','Whale Activity','Macro Economics','Devil\'s Advocate'];

const POPULAR_STOCKS = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOGL', 'SPY', 'QQQ', 'BTC', 'ETH'];

export default function AgentsPage() {
  const { data, refetch } = useQuery({ queryKey: ['decisions'], queryFn: () => getAgentDecisions(1), refetchInterval: 15000 });
  const { agentCouncil, currentAnalysis } = useStore();
  const decisions = data || [];
  const [running, setRunning] = useState(false);
  const [symbol, setSymbol] = useState('NVDA');
  const [market, setMarket] = useState<'stocks' | 'crypto'>('stocks');

  const runNow = async () => {
    setRunning(true);
    try {
      await api.post('/agents/trigger-debate', { asset: symbol, market });
      toast.success(`🏛️ Committee convening for ${symbol} — watch the agents vote live!`);
      setTimeout(() => { refetch(); setRunning(false); }, 3000);
    } catch {
      toast.error('Failed to trigger debate');
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-sans font-bold text-2xl text-apex-text">Agent Council</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {currentAnalysis && (
            <span className="font-mono text-xs text-apex-yellow flex items-center gap-2 px-3 py-1.5 rounded-lg bg-apex-yellow/10 border border-apex-yellow/30">
              <span className="animate-spin">◌</span> Voting on {currentAnalysis}
            </span>
          )}
          {/* Manual trigger */}
          <select value={market} onChange={e => { setMarket(e.target.value as any); setSymbol(e.target.value === 'crypto' ? 'BTC' : 'NVDA'); }}
            style={{ fontFamily: 'Space Mono', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid #E8D5C4', background: '#FFF8F2', color: '#2C1810' }}>
            <option value="stocks">Stocks</option>
            <option value="crypto">Crypto</option>
          </select>
          <select value={symbol} onChange={e => setSymbol(e.target.value)}
            style={{ fontFamily: 'Space Mono', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid #E8D5C4', background: '#FFF8F2', color: '#2C1810' }}>
            {(market === 'crypto' ? ['BTC', 'ETH', 'SOL', 'BNB'] : ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOGL', 'SPY', 'QQQ', 'AMD', 'PLTR']).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={runNow} disabled={running}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
              background: running ? 'rgba(255,140,66,0.1)' : '#FF8C42', border: 'none',
              color: running ? '#FF8C42' : '#fff', fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, cursor: running ? 'not-allowed' : 'pointer' }}>
            <PlayCircle size={14} />
            {running ? 'RUNNING...' : 'RUN NOW'}
          </button>
        </div>
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {AGENT_NAMES.map((name, i) => {
          const state = agentCouncil[i + 1];
          const vote = state?.vote;
          const status = state?.status || 'idle';
          return (
            <div key={i} className={`card transition-all ${status === 'analyzing' ? 'border-apex-yellow/40 bg-apex-yellow/5' : vote?.vote === 'BUY' ? 'border-apex-green/40' : vote?.vote === 'SELL' ? 'border-apex-red/40' : ''}`}>
              <div className="text-2xl mb-2">{AGENT_ICONS[i]}</div>
              <div className="font-sans font-bold text-sm text-apex-text">{name}</div>
              <div className="font-mono text-[10px] text-apex-muted mt-0.5">{AGENT_ROLES[i]}</div>
              {vote && (
                <div className="mt-3">
                  <div className={`font-mono font-bold text-sm ${vote.vote === 'BUY' ? 'text-apex-green' : vote.vote === 'SELL' ? 'text-apex-red' : 'text-apex-muted'}`}>
                    {vote.vote} • {vote.confidence}%
                  </div>
                  <p className="font-mono text-[10px] text-apex-muted mt-1 leading-relaxed line-clamp-3">{vote.reasoning}</p>
                </div>
              )}
              {status === 'analyzing' && (
                <div className="mt-3 font-mono text-[10px] text-apex-yellow flex items-center gap-1">
                  <span className="animate-spin">◌</span> Analyzing...
                </div>
              )}
              {i + 1 === 5 && <div className="mt-2 font-mono text-[10px] text-apex-red">⚡ HAS VETO POWER</div>}
            </div>
          );
        })}
      </div>

      {/* Recent Decisions */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Bot size={16} className="text-apex-accent" />
          <span className="font-sans font-semibold text-apex-text">Recent Council Decisions</span>
        </div>
        <div className="space-y-3">
          {decisions.slice(0, 15).map((d: any) => {
            const votes: any[] = d.agentVotes || [];
            const buy = votes.filter((v: any) => v.vote === 'BUY').length;
            const sell = votes.filter((v: any) => v.vote === 'SELL').length;
            const hold = votes.filter((v: any) => v.vote === 'HOLD').length;
            return (
              <div key={d.id} className="p-3 rounded-lg bg-apex-surface border border-apex-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-sans font-bold text-apex-text">{d.asset}</span>
                    <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${d.finalVote === 'BUY' ? 'bg-apex-green/10 text-apex-green' : d.finalVote === 'SELL' ? 'bg-apex-red/10 text-apex-red' : 'bg-apex-surface text-apex-muted'}`}>
                      {d.finalVote}
                    </span>
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${d.executed ? 'bg-apex-green/10 text-apex-green' : 'bg-apex-surface text-apex-muted'}`}>
                      {d.executed ? 'EXECUTED' : 'HELD'}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-apex-muted">{format(new Date(d.timestamp), 'MM/dd HH:mm:ss')}</span>
                </div>
                <div className="flex items-center gap-4 mt-2">
                  <span className="font-mono text-xs text-apex-green">BUY: {buy}</span>
                  <span className="font-mono text-xs text-apex-red">SELL: {sell}</span>
                  <span className="font-mono text-xs text-apex-muted">HOLD: {hold}</span>
                  <span className="font-mono text-xs text-apex-accent ml-auto">Avg confidence: {d.avgConfidence?.toFixed(1)}%</span>
                </div>
                {!d.executed && d.executionReason && (
                  <p className="font-mono text-[10px] text-apex-muted mt-1 opacity-70">{d.executionReason}</p>
                )}
              </div>
            );
          })}
          {decisions.length === 0 && <div className="text-center py-8 font-mono text-xs text-apex-muted">No decisions yet</div>}
        </div>
      </div>
    </div>
  );
}
