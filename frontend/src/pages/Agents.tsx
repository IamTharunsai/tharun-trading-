import { useQuery } from '@tanstack/react-query';
import { getAgentDecisions } from '../services/api';
import { useStore } from '../store';
import { format } from 'date-fns';
import { Bot, PlayCircle, Zap } from 'lucide-react';
import { useState } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { AGENTS as ALL_AGENTS } from '../constants/agents';
import { STOCK_LIST, CRYPTO_LIST } from '../constants/assets';

export default function AgentsPage() {
  const { data, refetch } = useQuery({ queryKey: ['decisions'], queryFn: () => getAgentDecisions(1), refetchInterval: 10000 });
  const { agentCouncil, currentAnalysis } = useStore();
  const decisions = data || [];
  const [running, setRunning] = useState(false);
  const [trading, setTrading] = useState(false);
  const [symbol, setSymbol] = useState('NVDA');
  const [market, setMarket] = useState<'stocks' | 'crypto'>('stocks');

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    try {
      await api.post('/agents/trigger-debate', { asset: symbol, market });
      toast.success(`🏛️ Committee convening for ${symbol} — watch agents vote live on DebateRoom!`, { duration: 5000 });
      setTimeout(() => { refetch(); setRunning(false); }, 4000);
    } catch {
      toast.error('Failed to trigger debate');
      setRunning(false);
    }
  };

  const runAndTrade = async () => {
    if (trading) return;
    setTrading(true);
    try {
      const r = await api.post('/agents/run-and-trade', { asset: symbol, market });
      toast.success(r.data.message || `🏛️ Full debate started for ${symbol}`, { duration: 6000 });
      setTimeout(() => { refetch(); setTrading(false); }, 5000);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Debate failed');
      setTrading(false);
    }
  };

  const forceBuy = async () => {
    if (!confirm(`Place a real paper BUY order for ${symbol} right now, skipping the 13-agent debate? This executes immediately.`)) return;
    try {
      const r = await api.post('/agents/force-trade', { asset: symbol, market, direction: 'BUY' });
      toast.success(r.data.message || `✅ Paper trade executed!`, { duration: 6000 });
      setTimeout(refetch, 2000);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Force trade failed');
    }
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-sans font-bold text-2xl text-apex-text">Agent Council</h1>
          <p className="font-mono text-xs text-apex-muted mt-1">13 specialist agents — 3-round debate before every trade</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {currentAnalysis && (
            <span className="font-mono text-xs text-apex-yellow flex items-center gap-2 px-3 py-1.5 rounded-lg bg-apex-yellow/10 border border-apex-yellow/30">
              <span className="animate-spin">◌</span> Voting on {currentAnalysis}
            </span>
          )}

          {/* Market + Symbol selectors */}
          <select value={market} onChange={e => { setMarket(e.target.value as any); setSymbol(e.target.value === 'crypto' ? 'BTC' : 'NVDA'); }}
            style={{ fontFamily: 'Space Mono', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid #DCDFE6', background: '#F8F9FC', color: '#14171F' }}>
            <option value="stocks">Stocks</option>
            <option value="crypto">Crypto</option>
          </select>
          <select value={symbol} onChange={e => setSymbol(e.target.value)}
            style={{ fontFamily: 'Space Mono', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid #DCDFE6', background: '#F8F9FC', color: '#14171F' }}>
            {(market === 'crypto' ? CRYPTO_LIST : STOCK_LIST).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Run debate only */}
          <button onClick={runNow} disabled={running || !!currentAnalysis}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
              background: (running || !!currentAnalysis) ? 'rgba(201,162,75,0.1)' : '#C9A24B',
              border: 'none', color: (running || !!currentAnalysis) ? '#C9A24B' : '#fff',
              fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, cursor: (running || !!currentAnalysis) ? 'not-allowed' : 'pointer' }}>
            <PlayCircle size={13} />
            {running ? 'RUNNING...' : 'DEBATE'}
          </button>

          {/* Run debate + auto-trade */}
          <button onClick={runAndTrade} disabled={trading || !!currentAnalysis}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
              background: (trading || !!currentAnalysis) ? 'rgba(18,128,95,0.1)' : '#12805F',
              border: 'none', color: (trading || !!currentAnalysis) ? '#12805F' : '#fff',
              fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, cursor: (trading || !!currentAnalysis) ? 'not-allowed' : 'pointer' }}>
            <Zap size={13} />
            {trading ? 'DEBATING...' : 'DEBATE & TRADE'}
          </button>

          {/* Force immediate buy */}
          <button onClick={forceBuy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
              background: 'rgba(176,38,59,0.12)', border: '1px solid #B0263B',
              color: '#B0263B', fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            ⚡ FORCE BUY
          </button>
        </div>
      </div>

      {/* 13 Agent grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {ALL_AGENTS.map(agent => {
          const state = agentCouncil[agent.id];
          const vote = state?.vote;
          const status = state?.status || 'idle';
          const voteColor = vote?.vote === 'BUY' ? '#12805F' : vote?.vote === 'SELL' ? '#B0263B' : vote?.vote === 'HOLD' ? '#C9A24B' : undefined;
          return (
            <div key={agent.id} style={{
              background: '#F8F9FC',
              border: `1px solid ${voteColor || '#DCDFE6'}`,
              borderRadius: 10,
              padding: 12,
              transition: 'all .3s',
              boxShadow: voteColor ? `0 0 10px ${voteColor}30` : 'none',
            }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{agent.icon}</div>
              <div style={{ fontFamily: 'Manrope', fontSize: 11, fontWeight: 700, color: '#14171F', lineHeight: 1.2, marginBottom: 2 }}>{agent.name}</div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: '#5B6472', marginBottom: 6 }}>{agent.role}</div>
              {agent.veto && <div style={{ fontFamily: 'Space Mono', fontSize: 8, color: '#B0263B', marginBottom: 4 }}>⚡ VETO</div>}

              {status === 'analyzing' && !vote && (
                <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: '#C9A24B', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Analyzing...
                </div>
              )}
              {vote && (
                <div>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: voteColor }}>{vote.vote}</div>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: '#5B6472' }}>{vote.confidence}%</div>
                  <div style={{ height: 2, background: '#DCDFE6', borderRadius: 1, marginTop: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${vote.confidence}%`, background: voteColor, transition: 'width .5s' }} />
                  </div>
                  {vote.reasoning && (
                    <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: '#5B6472', marginTop: 4, lineHeight: 1.4,
                      overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {vote.reasoning}
                    </div>
                  )}
                </div>
              )}
              {!vote && status === 'idle' && (
                <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: '#C4A882' }}>STANDBY</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent Decisions */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Bot size={16} className="text-apex-accent" />
          <span className="font-sans font-semibold text-apex-text">Recent Council Decisions</span>
          <span className="font-mono text-[10px] text-apex-muted ml-auto">Auto-refreshes every 10s</span>
        </div>
        <div className="space-y-3">
          {decisions.slice(0, 20).map((d: any) => {
            const votes: any[] = d.agentVotes || [];
            const buy  = votes.filter((v: any) => (v.finalVote || v.vote) === 'BUY').length;
            const sell = votes.filter((v: any) => (v.finalVote || v.vote) === 'SELL').length;
            const hold = votes.filter((v: any) => (v.finalVote || v.vote) === 'HOLD').length;
            const decision = d.finalVote || d.signal;
            return (
              <div key={d.id} className="p-3 rounded-lg bg-apex-surface border border-apex-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-sans font-bold text-apex-text">{d.asset}</span>
                    <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${decision === 'BUY' ? 'bg-apex-green/10 text-apex-green' : decision === 'SELL' ? 'bg-apex-red/10 text-apex-red' : 'bg-apex-surface text-apex-muted'}`}>
                      {decision}
                    </span>
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${d.executed ? 'bg-apex-green/10 text-apex-green' : 'bg-apex-surface text-apex-muted'}`}>
                      {d.executed ? '✅ EXECUTED' : '⏸ HELD'}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-apex-muted">{format(new Date(d.timestamp), 'MM/dd HH:mm')}</span>
                </div>
                <div className="flex items-center gap-4 mt-2">
                  <span className="font-mono text-xs text-apex-green">BUY: {buy}</span>
                  <span className="font-mono text-xs text-apex-red">SELL: {sell}</span>
                  <span className="font-mono text-xs text-apex-muted">HOLD: {hold}</span>
                  <span className="font-mono text-xs text-apex-accent ml-auto">{d.avgConfidence?.toFixed(1)}% avg</span>
                </div>
                {!d.executed && d.executionReason && (
                  <p className="font-mono text-[10px] text-apex-muted mt-1 opacity-70">⚠️ {d.executionReason}</p>
                )}
              </div>
            );
          })}
          {decisions.length === 0 && (
            <div className="text-center py-8 font-mono text-xs text-apex-muted">
              No decisions yet — click DEBATE or DEBATE & TRADE above to start
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
