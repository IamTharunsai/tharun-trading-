import { useStore } from '../../store';
import { AGENTS } from '../../constants/agents';
import { Bot, CheckCircle, Clock, AlertCircle } from 'lucide-react';

const voteColor = (vote?: string) => {
  if (vote === 'BUY') return 'text-emerald-300 border-emerald-500/40 bg-emerald-500/15';
  if (vote === 'SELL') return 'text-red-300 border-red-500/40 bg-red-500/15';
  return 'text-slate-400 border-white/10 bg-black/40';
};

const confidenceBar = (conf: number) => {
  const colorClass = conf >= 75 ? 'bg-emerald-400' : conf >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${colorClass}`} style={{ width: `${conf}%` }} />
    </div>
  );
};

export default function AgentCouncilPanel() {
  const { agentCouncil, currentAnalysis } = useStore();

  return (
    <div className="p-5 rounded-xl glass-panel">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-amber-400" />
          <span className="font-semibold text-white">Autonomous Agent Committee</span>
          <span className="font-mono text-xs text-slate-400">({AGENTS.length} Specialized Agents)</span>
        </div>
        {currentAnalysis ? (
          <span className="font-mono text-xs text-amber-300 flex items-center gap-1.5 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
            <Clock size={11} className="animate-spin text-amber-400" />
            Active Deliberation: {currentAnalysis}
          </span>
        ) : (
          <span className="font-mono text-xs text-emerald-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Consensus Engine Armed
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
        {AGENTS.map((agent) => {
          const agentId = agent.id;
          const state = agentCouncil[agentId];
          const status = state?.status || 'idle';
          const vote = state?.vote;

          return (
            <div key={agentId}
              className={`p-2.5 rounded-lg border text-xs transition-all ${
                status === 'voted' && vote ? voteColor(vote.vote) :
                status === 'analyzing' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' :
                'border-white/[0.06] bg-black/30 hover:border-white/10'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="flex items-center gap-1 font-mono text-[10px] text-slate-400">
                  <span>{agent.icon}</span>
                  <span>#{agentId}</span>
                </span>
                {status === 'analyzing' && <Clock size={10} className="text-amber-400 animate-spin" />}
                {status === 'voted' && vote?.vote !== 'HOLD' && <CheckCircle size={10} className="text-emerald-400" />}
                {status === 'voted' && vote?.vote === 'HOLD' && <AlertCircle size={10} className="text-slate-400" />}
              </div>
              <div className="font-medium text-[11px] text-white truncate">{agent.name}</div>
              {vote && (
                <>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`font-mono font-bold text-[10px] ${vote.vote === 'BUY' ? 'text-emerald-400' : vote.vote === 'SELL' ? 'text-red-400' : 'text-slate-400'}`}>
                      {vote.vote}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400 tabular-nums">{vote.confidence}%</span>
                  </div>
                  {confidenceBar(vote.confidence)}
                </>
              )}
              {status === 'analyzing' && (
                <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400/70 rounded-full animate-pulse" style={{ width: '60%' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
