import { useState, useEffect, useRef } from 'react';
import { connectSocket } from '../services/socket';
import { useStore } from '../store';
import axios from 'axios';
import toast from 'react-hot-toast';

const AGENTS = [
  { id: 1,  name: 'Technician',  icon: '📊' },
  { id: 2,  name: 'Newshound',   icon: '📰' },
  { id: 3,  name: 'Sentiment',   icon: '🧠' },
  { id: 4,  name: 'Fundamental', icon: '📈' },
  { id: 5,  name: 'Risk Mgr',    icon: '🛡️', veto: true },
  { id: 6,  name: 'Trend',       icon: '🔮' },
  { id: 7,  name: 'Volume',      icon: '🔍' },
  { id: 8,  name: 'Whale Watch', icon: '🐋' },
  { id: 9,  name: 'Macro',       icon: '🌍' },
  { id: 10, name: "Devil's Adv", icon: '😈' },
  { id: 11, name: 'Elliott Wave',icon: '🌊' },
  { id: 12, name: 'Options Flow',icon: '📉' },
  { id: 13, name: 'Polymarket',  icon: '🎯' },
  { id: 14, name: 'Arbitrageur', icon: '⚖️' },
  { id: 15, name: 'Coordinator', icon: '🧩', master: true },
];

const ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'AAPL', 'TSLA', 'NVDA'];

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
  const token = useStore(s => s.token);
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
      toast.success(`✅ Decision: ${result.finalDecision} (${result.goVotes}/15 votes)`, { duration: 8000 });
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
      await axios.post('/api/agents/trigger-debate',
        { asset: selectedAsset, market: 'crypto' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast(`🤖 Debate started for ${selectedAsset} — watch agents vote live!`, { duration: 5000 });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to trigger debate');
    } finally {
      setTriggering(false);
    }
  };

  const voteColor = (vote?: string) =>
    vote === 'BUY' ? '#2D8A4A' : vote === 'SELL' ? '#DC2626' : vote === 'HOLD' ? '#F5A623' : 'var(--apex-border)';

  const buyVotes  = Object.values(agentStates).filter(s => s.vote === 'BUY').length;
  const sellVotes = Object.values(agentStates).filter(s => s.vote === 'SELL').length;
  const holdVotes = Object.values(agentStates).filter(s => s.vote === 'HOLD').length;
  const totalVoted = buyVotes + sellVotes + holdVotes;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 800, color: 'var(--apex-text)', marginBottom: 4 }}>
            Investment Committee
          </h1>
          <p style={{ fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-muted)' }}>
            15-agent 3-round debate before every trade
          </p>
        </div>

        {/* Trigger controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={selectedAsset}
            onChange={e => setSelectedAsset(e.target.value)}
            disabled={isDebating}
            style={{ padding: '8px 12px', border: '1px solid var(--apex-border)', background: 'var(--apex-surface)', color: 'var(--apex-text)', borderRadius: 8, fontFamily: 'Space Mono', fontSize: 11, cursor: 'pointer' }}
          >
            {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button
            onClick={triggerDebate}
            disabled={triggering || isDebating}
            style={{
              padding: '8px 20px', borderRadius: 8, fontFamily: 'Space Mono', fontWeight: 700, fontSize: 11, cursor: triggering || isDebating ? 'not-allowed' : 'pointer',
              background: isDebating ? 'rgba(255,215,0,.1)' : 'var(--apex-accent)', color: isDebating ? '#FFD700' : '#fff',
              border: isDebating ? '1px solid rgba(255,215,0,.5)' : 'none', opacity: (triggering || isDebating) ? 0.7 : 1, transition: 'all .2s'
            }}
          >
            {isDebating ? `⚡ DEBATING ${currentAsset}...` : triggering ? '⏳ Starting...' : '▶ TRIGGER DEBATE'}
          </button>
        </div>
      </div>

      {/* Round explanation */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { round: 'Round 1', label: 'Opening Arguments', color: '#FF8C42' },
          { round: 'Round 2', label: 'Cross-Examination',  color: '#F5A623' },
          { round: 'Round 3', label: 'Final Verdict',      color: '#2D8A4A' },
        ].map(item => (
          <div key={item.round} style={{ background: 'var(--apex-card)', border: `1px solid ${item.color}40`, borderRadius: 10, padding: 14 }}>
            <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: item.color, textTransform: 'uppercase', marginBottom: 4 }}>{item.round}</div>
            <div style={{ fontFamily: 'Syne', fontSize: 13, fontWeight: 700, color: 'var(--apex-text)' }}>{item.label}</div>
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
            {buyVotes  > 0 && <div style={{ flex: buyVotes,  background: '#2D8A4A', borderRadius: 4 }} title={`BUY: ${buyVotes}`} />}
            {holdVotes > 0 && <div style={{ flex: holdVotes, background: '#F5A623', borderRadius: 4 }} title={`HOLD: ${holdVotes}`} />}
            {sellVotes > 0 && <div style={{ flex: sellVotes, background: '#DC2626', borderRadius: 4 }} title={`SELL: ${sellVotes}`} />}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
            <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: '#2D8A4A' }}>BUY: {buyVotes}</span>
            <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: '#F5A623' }}>HOLD: {holdVotes}</span>
            <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: '#DC2626' }}>SELL: {sellVotes}</span>
          </div>
        </div>
      )}

      {/* 15 Agent Cards */}
      <div style={{ background: 'var(--apex-card)', border: '1px solid var(--apex-border)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-text)', marginBottom: 12 }}>
          AGENT COUNCIL — 15 SPECIALISTS
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {AGENTS.map(agent => {
            const state = agentStates[agent.id];
            const bc = voteColor(state?.vote);
            const pulse = state?.status === 'analyzing';
            return (
              <div key={agent.id} style={{
                background: 'var(--apex-surface)', border: `1px solid ${bc}`,
                borderRadius: 8, padding: 10, transition: 'all .3s',
                boxShadow: state?.vote ? `0 0 8px ${bc}40` : 'none',
                animation: pulse ? 'pulse .8s infinite' : 'none',
              }}>
                <div style={{ fontSize: 18, marginBottom: 3 }}>{agent.icon}</div>
                <div style={{ fontFamily: 'Syne', fontSize: 10, fontWeight: 700, color: 'var(--apex-text)', marginBottom: 2 }}>{agent.name}</div>
                {agent.veto   && <div style={{ fontFamily: 'Space Mono', fontSize: 7, color: '#DC2626', marginBottom: 3 }}>⚡ VETO</div>}
                {agent.master && <div style={{ fontFamily: 'Space Mono', fontSize: 7, color: '#F5A623', marginBottom: 3 }}>👑 MASTER</div>}
                <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: bc, fontWeight: 700 }}>
                  {state?.vote || (state?.status === 'analyzing' ? '...' : 'IDLE')}
                </div>
                {state?.confidence !== undefined && (
                  <div style={{ marginTop: 4, height: 2, background: 'var(--apex-border)', borderRadius: 1, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${state.confidence}%`, background: bc, transition: 'width .5s' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Transcript + Decision */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Transcript */}
        <div style={{ background: 'var(--apex-card)', border: '1px solid var(--apex-border)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-text)', marginBottom: 12 }}>
            LIVE TRANSCRIPT
          </div>
          <div ref={transcriptRef} style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {transcript.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-muted)' }}>
                Trigger a debate to see agents argue live.
              </div>
            ) : (
              transcript.map((item, i) => (
                <div key={i} style={{ padding: '8px 10px', background: 'var(--apex-surface)', borderRadius: 6, borderLeft: `3px solid ${voteColor(item.vote)}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'Syne', fontSize: 11, fontWeight: 700, color: 'var(--apex-accent)' }}>{item.agentName}</span>
                    {item.vote && <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: voteColor(item.vote), fontWeight: 700 }}>{item.vote}</span>}
                  </div>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-text)', lineHeight: 1.5 }}>
                    {item.content.slice(0, 150)}{item.content.length > 150 ? '...' : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Final Decision */}
        <div style={{ background: 'var(--apex-card)', border: `1px solid ${finalDecision ? voteColor(finalDecision.decision) : 'var(--apex-border)'}`, borderRadius: 12, padding: 14, transition: 'border .3s' }}>
          <div style={{ fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-text)', marginBottom: 12 }}>
            FINAL DECISION
          </div>
          {finalDecision ? (
            <div>
              <div style={{ fontSize: 48, fontWeight: 900, color: voteColor(finalDecision.decision), marginBottom: 12, fontFamily: 'Syne' }}>
                {finalDecision.decision}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: 'var(--apex-surface)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)', marginBottom: 4 }}>GO VOTES</div>
                  <div style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 700, color: '#2D8A4A' }}>{finalDecision.goVotes}</div>
                </div>
                <div style={{ background: 'var(--apex-surface)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)', marginBottom: 4 }}>NO-GO VOTES</div>
                  <div style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 700, color: '#DC2626' }}>{finalDecision.noGoVotes}</div>
                </div>
              </div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-muted)' }}>
                Avg confidence: {finalDecision.confidence?.toFixed(1)}%
              </div>
            </div>
          ) : isDebating ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 12, animation: 'pulse 1s infinite' }}>⚡</div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 10, color: '#FFD700' }}>Agents deliberating...</div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-muted)' }}>
              Trigger a debate to see the committee's verdict here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
