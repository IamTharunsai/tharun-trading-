import { useState, useEffect, useRef } from 'react';
import { connectSocket } from '../services/socket';
import { useStore } from '../store';
import api from '../services/api';
import toast from 'react-hot-toast';
import { AGENTS } from '../constants/agents';

const CRYPTO_ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'AVAX', 'LINK'];
const STOCK_ASSETS  = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOGL', 'AMD', 'PLTR', 'SPY', 'QQQ'];

function getMarket(asset: string): 'crypto' | 'stocks' {
  return CRYPTO_ASSETS.includes(asset) ? 'crypto' : 'stocks';
}

interface AgentState {
  status: 'idle' | 'analyzing' | 'voted';
  vote?: 'BUY' | 'SELL' | 'HOLD';
  confidence?: number;
  reasoning?: string;
}

interface TranscriptEntry {
  agentId: number;
  agentName: string;
  content: string;
  vote?: string;
  timestamp: number;
}

export default function DebateRoomPage() {
    const [agentStates, setAgentStates] = useState<Record<number, AgentState>>({});
  const [isDebating, setIsDebating] = useState(false);
  const [currentAsset, setCurrentAsset] = useState('BTC');
  const [selectedAsset, setSelectedAsset] = useState('BTC');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [finalDecision, setFinalDecision] = useState<{ decision: string; goVotes: number; noGoVotes: number; confidence: number } | null>(null);
  const [triggering, setTriggering] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;

    // debate engine events (used by debateEngine.ts)
    socket.on('debate:start', (data: any) => {
      setIsDebating(true);
      setCurrentAsset(data.asset);
      setFinalDecision(null);
      setTranscript([]);
      setAgentStates({});
      toast(`🏛️ Investment Committee convening for ${data.asset}`, { icon: '⚡' });
    });

    socket.on('debate:agent-speaking', (data: any) => {
      setAgentStates(prev => ({
        ...prev,
        [data.agentId]: { ...prev[data.agentId], status: 'analyzing' }
      }));
    });

    socket.on('debate:agent-voted', (data: any) => {
      setAgentStates(prev => ({
        ...prev,
        [data.agentId]: { status: 'voted', vote: data.vote || data.finalVote, confidence: data.confidence }
      }));
      setTranscript(prev => [...prev, {
        agentId: data.agentId,
        agentName: data.agentName || `Agent ${data.agentId}`,
        content: data.openingArgument || data.rebuttal || '',
        vote: data.vote || data.finalVote,
        timestamp: Date.now(),
      }]);
    });

    socket.on('debate:final-vote', (data: any) => {
      setAgentStates(prev => ({
        ...prev,
        [data.agentId]: { status: 'voted', vote: data.finalVote, confidence: data.confidence }
      }));
    });

    socket.on('debate:complete', (data: any) => {
      setIsDebating(false);
      const t = data.transcript;
      if (t) {
        const buyCount  = t.round3?.filter((v: any) => v.finalVote === 'BUY').length  || 0;
        const sellCount = t.round3?.filter((v: any) => v.finalVote === 'SELL').length || 0;
        const holdCount = t.round3?.filter((v: any) => v.finalVote === 'HOLD').length || 0;
        setFinalDecision({
          decision: t.finalDecision,
          goVotes: buyCount,
          noGoVotes: sellCount + holdCount,
          confidence: t.finalConfidence,
        });
        toast.success(`✅ Decision: ${t.finalDecision} (${buyCount} buy / ${sellCount} sell)`, { duration: 8000 });
      }
    });

    // orchestrator events (from runAgentCouncil)
    socket.on('council:start', (data: any) => {
      setIsDebating(true);
      setCurrentAsset(data.asset);
      setFinalDecision(null);
      setTranscript([]);
      setAgentStates({});
    });

    socket.on('agent:status', (data: any) => {
      setAgentStates(prev => ({
        ...prev,
        [data.agentId]: { status: data.status, vote: data.vote?.vote, confidence: data.vote?.confidence }
      }));
      if (data.vote) {
        setTranscript(prev => [...prev, {
          agentId: data.agentId,
          agentName: data.vote.agentName || `Agent ${data.agentId}`,
          content: data.vote.reasoning || '',
          vote: data.vote.vote,
          timestamp: Date.now(),
        }]);
      }
    });

    socket.on('council:complete', (data: any) => {
      setIsDebating(false);
      const { result } = data;
      setFinalDecision({
        decision: result.finalDecision,
        goVotes: result.goVotes,
        noGoVotes: result.noGoVotes,
        confidence: result.avgConfidence,
      });
      toast.success(`✅ Decision: ${result.finalDecision} (${result.goVotes}/13 votes)`, { duration: 8000 });
    });

    return () => {
      ['debate:start','debate:agent-speaking','debate:agent-voted','debate:final-vote',
       'debate:complete','council:start','agent:status','council:complete'].forEach(e => socket.off(e));
    };
  }, []);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const triggerDebate = async () => {
    if (triggering || isDebating) return;
    setTriggering(true);
    try {
      await api.post('/agents/trigger-debate', { asset: selectedAsset, market: getMarket(selectedAsset) });
      toast(`🤖 Debate started for ${selectedAsset} — watch agents vote live!`, { duration: 5000 });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to trigger debate');
    } finally {
      setTriggering(false);
    }
  };

  const voteColor = (vote?: string) =>
    vote === 'BUY' ? '#10B981' : vote === 'SELL' ? '#EF4444' : vote === 'HOLD' ? '#F59E0B' : 'rgba(255, 255, 255, 0.12)';

  const buyVotes  = Object.values(agentStates).filter(s => s.vote === 'BUY').length;
  const sellVotes = Object.values(agentStates).filter(s => s.vote === 'SELL').length;
  const holdVotes = Object.values(agentStates).filter(s => s.vote === 'HOLD').length;
  const totalVoted = buyVotes + sellVotes + holdVotes;

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto text-slate-100">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-2xl glass-panel bg-[#0B101D]/80">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-2xl text-white tracking-tight font-display">
              Autonomous Investment Committee
            </h1>
            <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-bold">
              3-ROUND DELIBERATION
            </span>
          </div>
          <p className="font-mono text-xs text-slate-400 mt-1">
            Real-time consensus verification · Multi-agent Wyckoff, order flow & risk vetoes
          </p>
        </div>

        {/* Trigger controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedAsset}
            onChange={e => setSelectedAsset(e.target.value)}
            disabled={isDebating}
            className="px-3 py-2 border border-white/10 bg-black/40 text-white rounded-lg font-mono text-xs cursor-pointer focus:outline-none focus:border-amber-400"
          >
            <optgroup label="Stocks (HFT & Core)">
              {STOCK_ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
            </optgroup>
            <optgroup label="Crypto">
              {CRYPTO_ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
            </optgroup>
          </select>
          <span className="font-mono text-xs text-slate-400">
            [{getMarket(selectedAsset).toUpperCase()}]
          </span>
          <button
            onClick={triggerDebate}
            disabled={triggering || isDebating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-mono text-xs font-bold transition-all shadow-md shadow-amber-500/20 disabled:opacity-40"
          >
            {isDebating ? `⚡ DEBATING ${currentAsset}...` : triggering ? '⏳ Convening...' : `▶ CONVENE COMMITTEE ON ${selectedAsset}`}
          </button>
        </div>
      </div>

      {/* Round explanation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { round: 'Round 1', label: 'Opening Technical & Wire Arguments', color: '#F59E0B' },
          { round: 'Round 2', label: 'Cross-Examination & Bearish Stress-Test', color: '#3B82F6' },
          { round: 'Round 3', label: 'Kelly Position Sizing & Final Verdict', color: '#10B981' },
        ].map(item => (
          <div key={item.round} className="glass-panel p-3.5 rounded-xl border border-white/[0.06]">
            <div className="font-mono text-[10px] text-amber-400 font-bold uppercase mb-1">{item.round}</div>
            <div className="text-xs font-bold text-white">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Vote tally bar */}
      {totalVoted > 0 && (
        <div style={{ background: 'var(--apex-card)', border: '1px solid var(--apex-border)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-muted)', marginBottom: 8 }}>
            LIVE VOTE TALLY — {totalVoted}/15 agents voted
          </div>
          <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
            {buyVotes  > 0 && <div style={{ flex: buyVotes,  background: '#12805F', borderRadius: 4 }} title={`BUY: ${buyVotes}`} />}
            {holdVotes > 0 && <div style={{ flex: holdVotes, background: '#C9A24B', borderRadius: 4 }} title={`HOLD: ${holdVotes}`} />}
            {sellVotes > 0 && <div style={{ flex: sellVotes, background: '#B0263B', borderRadius: 4 }} title={`SELL: ${sellVotes}`} />}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
            <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: '#12805F' }}>BUY: {buyVotes}</span>
            <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: '#C9A24B' }}>HOLD: {holdVotes}</span>
            <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: '#B0263B' }}>SELL: {sellVotes}</span>
          </div>
        </div>
      )}

      {/* Agent Cards */}
      <div className="p-5 rounded-xl glass-panel">
        <div className="font-mono text-xs font-bold text-slate-300 mb-3 uppercase tracking-wider flex items-center justify-between">
          <span>COUNCIL OF SPECIALISTS ({AGENTS.length})</span>
          <span className="text-slate-500 font-normal">Multi-Strategy Neural Committee</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2.5">
          {AGENTS.map(agent => {
            const state = agentStates[agent.id];
            const bc = voteColor(state?.vote);
            const pulse = state?.status === 'analyzing';
            return (
              <div key={agent.id} className="bg-black/30 border rounded-lg p-2.5 transition-all"
                style={{
                  borderColor: state?.vote ? bc : 'rgba(255,255,255,0.08)',
                  boxShadow: state?.vote ? `0 0 10px ${bc}30` : 'none',
                }}
              >
                <div className="text-lg mb-1">{agent.icon}</div>
                <div className="text-xs font-bold text-white truncate mb-1">{agent.name}</div>
                {agent.veto && <div className="font-mono text-[9px] text-red-400 font-bold mb-1">⚡ VETO POWER</div>}
                <div className="font-mono text-[10px] font-bold" style={{ color: bc }}>
                  {state?.vote || (pulse ? 'DELIBERATING...' : 'READY')}
                </div>
                {state?.confidence !== undefined && (
                  <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div style={{ height: '100%', width: `${state.confidence}%`, background: bc, transition: 'width .5s' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Transcript + Decision */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Transcript */}
        <div className="p-5 rounded-xl glass-panel flex flex-col">
          <div className="font-mono text-xs font-bold text-slate-300 mb-3 uppercase tracking-wider">
            REAL-TIME DELIBERATION TRANSCRIPT
          </div>
          <div ref={transcriptRef} className="max-h-80 overflow-y-auto space-y-2.5 pr-1 flex-1 font-mono text-xs">
            {transcript.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                Trigger a council session above to stream real-time debate reasoning.
              </div>
            ) : (
              transcript.map((item, i) => (
                <div key={i} className="p-3 bg-black/30 rounded-lg border-l-2" style={{ borderLeftColor: voteColor(item.vote) }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-amber-300 text-xs">{item.agentName}</span>
                    {item.vote && (
                      <span className="font-bold text-xs px-1.5 py-0.5 rounded" style={{ color: voteColor(item.vote), background: `${voteColor(item.vote)}15` }}>
                        {item.vote}
                      </span>
                    )}
                  </div>
                  <div className="text-slate-300 text-xs leading-relaxed">
                    {item.content}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Final Decision */}
        <div className="p-5 rounded-xl glass-panel flex flex-col justify-between"
          style={{ borderColor: finalDecision ? voteColor(finalDecision.decision) : undefined }}
        >
          <div>
            <div className="font-mono text-xs font-bold text-slate-300 mb-3 uppercase tracking-wider">
              COMMITTEE VERDICT & EXECUTION ORDER
            </div>
            {finalDecision ? (
              <div>
                <div className="text-4xl font-extrabold tracking-tight mb-4 font-mono" style={{ color: voteColor(finalDecision.decision) }}>
                  {finalDecision.decision}
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-black/30 border border-white/10 rounded-lg p-3">
                    <div className="font-mono text-[10px] text-slate-400 uppercase">GO (CONVICTION)</div>
                    <div className="text-2xl font-bold text-emerald-400 font-mono mt-1">{finalDecision.goVotes}</div>
                  </div>
                  <div className="bg-black/30 border border-white/10 rounded-lg p-3">
                    <div className="font-mono text-[10px] text-slate-400 uppercase">NO-GO (REJECT)</div>
                    <div className="text-2xl font-bold text-red-400 font-mono mt-1">{finalDecision.noGoVotes}</div>
                  </div>
                </div>
                <div className="font-mono text-xs text-slate-400">
                  Synthesized Confidence: <strong className="text-white font-mono">{finalDecision.confidence?.toFixed(1)}%</strong>
                </div>
              </div>
            ) : isDebating ? (
              <div className="text-center py-12">
                <div className="text-3xl mb-2 animate-bounce">⚡</div>
                <div className="font-mono text-xs text-amber-300">Council analyzing multi-timeframe liquidity and risk...</div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500 font-mono text-xs">
                Awaiting committee trigger. Select an asset and start deliberation.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
