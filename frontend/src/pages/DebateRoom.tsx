import { useState, useEffect, useRef } from 'react';
import { connectSocket } from '../services/socket';
import { useStore } from '../store';
import api from '../services/api';
import toast from 'react-hot-toast';
import { AGENTS } from '../constants/agents';

const CRYPTO_ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'AVAX', 'LINK'];

export const SECTOR_CATEGORIES: Record<string, string[]> = {
  'AI & Hyperscale Compute': ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'AMD', 'PLTR', 'AVGO', 'MRVL'],
  'Power & Nuclear (AI Boom)': ['CEG', 'VST', 'OKLO', 'CCJ', 'TLN', 'NEE', 'SO', 'DUK'],
  'Grid Hardware & Cooling': ['ETN', 'PWR', 'GEV', 'VRT', 'HUBB'],
  'Defense, Drones & Aerospace': ['LMT', 'RTX', 'NOC', 'GD', 'AVAV', 'KTOS', 'BA'],
  'Healthcare & GLP-1 Therapeutics': ['LLY', 'NVO', 'WST', 'CTLS', 'JNJ', 'PFE', 'ISRG', 'MDT'],
  'Energy, Tankers & Offshore': ['XOM', 'CVX', 'OXY', 'SLB', 'BKR', 'HAL', 'STNG', 'FRO'],
  'Financials & Regional Banks': ['JPM', 'BAC', 'GS', 'MS', 'KRE', 'HBAN', 'CFG', 'V', 'MA'],
  'Industrials, Steel & Infrastructure': ['CAT', 'DE', 'URI', 'NUE', 'STLD', 'ACM', 'FLR', 'VMC'],
  'Broad Market & Liquid ETFs': ['SPY', 'QQQ', 'IWM', 'XBI', 'XLE', 'XLF', 'XLV', 'XLI'],
  'Crypto Venues': ['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'AVAX', 'LINK'],
};

function getMarket(asset: string): 'crypto' | 'stocks' {
  return CRYPTO_ASSETS.includes(asset.toUpperCase()) ? 'crypto' : 'stocks';
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
    vote === 'BUY' ? '#059669' : vote === 'SELL' ? '#DC2626' : vote === 'HOLD' ? '#D97706' : '#94A3B8';

  const buyVotes  = Object.values(agentStates).filter(s => s.vote === 'BUY').length;
  const sellVotes = Object.values(agentStates).filter(s => s.vote === 'SELL').length;
  const holdVotes = Object.values(agentStates).filter(s => s.vote === 'HOLD').length;
  const totalVoted = buyVotes + sellVotes + holdVotes;

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto text-slate-900">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-2xl text-slate-900 tracking-tight font-display">
              Autonomous Investment Committee
            </h1>
            <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold">
              3-ROUND DELIBERATION
            </span>
          </div>
          <p className="font-mono text-xs text-slate-500 mt-1">
            Real-time consensus verification · Multi-agent Wyckoff, order flow & risk vetoes
          </p>
        </div>

        {/* Trigger controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <select
              value={selectedAsset}
              onChange={e => setSelectedAsset(e.target.value.toUpperCase())}
              disabled={isDebating}
              className="px-3 py-2 border border-slate-300 bg-white text-slate-900 rounded-lg font-mono text-xs cursor-pointer focus:outline-none focus:border-blue-500"
            >
              {Object.entries(SECTOR_CATEGORIES).map(([cat, symbols]) => (
                <optgroup key={cat} label={cat}>
                  {symbols.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            <span className="text-xs text-slate-400 font-mono font-bold">OR</span>

            <input
              type="text"
              placeholder="ANY US TICKER (e.g. OKLO)"
              value={selectedAsset}
              onChange={e => setSelectedAsset(e.target.value.trim().toUpperCase())}
              disabled={isDebating}
              className="w-40 px-2.5 py-1.5 border border-slate-300 bg-white text-slate-900 font-mono text-xs rounded-lg uppercase placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <span className="font-mono text-xs text-slate-500 font-bold">
            [{getMarket(selectedAsset).toUpperCase()}]
          </span>
          <button
            onClick={triggerDebate}
            disabled={triggering || isDebating || !selectedAsset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold transition-all shadow-xs disabled:opacity-40"
          >
            {isDebating ? `⚡ DEBATING ${currentAsset}...` : triggering ? '⏳ Convening...' : `▶ CONVENE COMMITTEE ON ${selectedAsset}`}
          </button>
        </div>
      </div>

      {/* Round explanation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { round: 'Round 1', label: 'Opening Technical & Wire Arguments', color: '#D97706' },
          { round: 'Round 2', label: 'Cross-Examination & Bearish Stress-Test', color: '#2563EB' },
          { round: 'Round 3', label: 'Kelly Position Sizing & Final Verdict', color: '#059669' },
        ].map(item => (
          <div key={item.round} className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
            <div className="font-mono text-[10px] font-bold uppercase mb-1" style={{ color: item.color }}>{item.round}</div>
            <div className="text-xs font-bold text-slate-900">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Vote tally bar */}
      {totalVoted > 0 && (
        <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm">
          <div className="font-mono text-xs text-slate-500 font-semibold mb-2">
            LIVE VOTE TALLY — {totalVoted}/15 agents voted
          </div>
          <div className="flex h-3 rounded-full overflow-hidden gap-1 bg-slate-100 p-0.5">
            {buyVotes  > 0 && <div style={{ flex: buyVotes,  background: '#059669', borderRadius: 4 }} title={`BUY: ${buyVotes}`} />}
            {holdVotes > 0 && <div style={{ flex: holdVotes, background: '#D97706', borderRadius: 4 }} title={`HOLD: ${holdVotes}`} />}
            {sellVotes > 0 && <div style={{ flex: sellVotes, background: '#DC2626', borderRadius: 4 }} title={`SELL: ${sellVotes}`} />}
          </div>
          <div className="flex gap-4 mt-2 font-mono text-xs font-bold">
            <span className="text-emerald-600">BUY: {buyVotes}</span>
            <span className="text-amber-600">HOLD: {holdVotes}</span>
            <span className="text-red-600">SELL: {sellVotes}</span>
          </div>
        </div>
      )}

      {/* Agent Cards */}
      <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div className="font-mono text-xs font-bold text-slate-700 mb-3 uppercase tracking-wider flex items-center justify-between">
          <span>COUNCIL OF SPECIALISTS ({AGENTS.length})</span>
          <span className="text-slate-500 font-semibold">Multi-Strategy Neural Committee</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2.5">
          {AGENTS.map(agent => {
            const state = agentStates[agent.id];
            const bc = voteColor(state?.vote);
            const pulse = state?.status === 'analyzing';
            return (
              <div key={agent.id} className="bg-slate-50 border rounded-lg p-2.5 transition-all"
                style={{
                  borderColor: state?.vote ? bc : '#E2E8F0',
                  boxShadow: state?.vote ? `0 0 8px ${bc}25` : 'none',
                }}
              >
                <div className="text-lg mb-1">{agent.icon}</div>
                <div className="text-xs font-bold text-slate-900 truncate mb-1">{agent.name}</div>
                {agent.veto && <div className="font-mono text-[9px] text-red-600 font-bold mb-1">⚡ VETO POWER</div>}
                <div className="font-mono text-[10px] font-bold" style={{ color: bc }}>
                  {state?.vote || (pulse ? 'DELIBERATING...' : 'READY')}
                </div>
                {state?.confidence !== undefined && (
                  <div className="mt-2 h-1 bg-slate-200 rounded-full overflow-hidden">
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
        <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm flex flex-col">
          <div className="font-mono text-xs font-bold text-slate-700 mb-3 uppercase tracking-wider">
            REAL-TIME DELIBERATION TRANSCRIPT
          </div>
          <div ref={transcriptRef} className="max-h-80 overflow-y-auto space-y-2.5 pr-1 flex-1 font-mono text-xs">
            {transcript.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                Trigger a council session above to stream real-time debate reasoning.
              </div>
            ) : (
              transcript.map((item, i) => (
                <div key={i} className="p-3 bg-slate-50 rounded-lg border-l-4 border border-slate-200" style={{ borderLeftColor: voteColor(item.vote) }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-slate-900 text-xs">{item.agentName}</span>
                    {item.vote && (
                      <span className="font-bold text-xs px-1.5 py-0.5 rounded" style={{ color: voteColor(item.vote), background: `${voteColor(item.vote)}15` }}>
                        {item.vote}
                      </span>
                    )}
                  </div>
                  <div className="text-slate-700 text-xs leading-relaxed font-sans">
                    {item.content}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Final Decision */}
        <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm flex flex-col justify-between"
          style={{ borderColor: finalDecision ? voteColor(finalDecision.decision) : undefined }}
        >
          <div>
            <div className="font-mono text-xs font-bold text-slate-700 mb-3 uppercase tracking-wider">
              COMMITTEE VERDICT & EXECUTION ORDER
            </div>
            {finalDecision ? (
              <div>
                <div className="text-4xl font-extrabold tracking-tight mb-4 font-mono" style={{ color: voteColor(finalDecision.decision) }}>
                  {finalDecision.decision}
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="font-mono text-[10px] text-slate-500 uppercase font-semibold">GO (CONVICTION)</div>
                    <div className="text-2xl font-bold text-emerald-600 font-mono mt-1">{finalDecision.goVotes}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="font-mono text-[10px] text-slate-500 uppercase font-semibold">NO-GO (REJECT)</div>
                    <div className="text-2xl font-bold text-red-600 font-mono mt-1">{finalDecision.noGoVotes}</div>
                  </div>
                </div>
                <div className="font-mono text-xs text-slate-600 font-medium">
                  Synthesized Confidence: <strong className="text-slate-900 font-mono">{finalDecision.confidence?.toFixed(1)}%</strong>
                </div>
              </div>
            ) : isDebating ? (
              <div className="text-center py-12">
                <div className="text-3xl mb-2 animate-bounce">⚡</div>
                <div className="font-mono text-xs text-blue-700 font-bold">Council analyzing multi-timeframe liquidity and risk...</div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 font-mono text-xs">
                Awaiting committee trigger. Select an asset and start deliberation.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
