import { useStore } from '../../store';
import { AGENTS } from '../../constants/agents';
import { Bot, CheckCircle, Clock, AlertCircle } from 'lucide-react';

const voteColor = (vote?: string) => {
  if (vote === 'BUY') return 'text-emerald-700 border-emerald-200 bg-emerald-50';
  if (vote === 'SELL') return 'text-red-700 border-red-200 bg-red-50';
  return 'text-slate-600 border-slate-200 bg-slate-50';
};

const confidenceBar = (conf: number) => {
  const colorClass = conf >= 75 ? 'bg-emerald-600' : conf >= 50 ? 'bg-amber-500' : 'bg-red-600';
  return (
    <div className="mt-1 h-1 bg-slate-200 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${colorClass}`} style={{ width: `${conf}%` }} />
    </div>
  );
};

export default function AgentCouncilPanel() {
  const { agentCouncil, currentAnalysis } = useStore();

  return (
    <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-blue-600" />
          <span className="font-semibold text-slate-900 text-sm">Autonomous Agent Committee</span>
          <span className="font-mono text-xs text-slate-500">({AGENTS.length} Specialized Agents)</span>
        </div>
        {currentAnalysis ? (
          <span className="font-mono text-xs text-blue-700 font-bold flex items-center gap-1.5 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
            <Clock size={11} className="animate-spin text-blue-600" />
            Active Deliberation: {currentAnalysis}
          </span>
        ) : (
          <span className="font-mono text-xs text-emerald-600 font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
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
                status === 'analyzing' ? 'border-blue-300 bg-blue-50 text-blue-800' :
                'border-slate-200 bg-slate-50/70 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500 font-semibold">
                  <span>{agent.icon}</span>
                  <span>#{agentId}</span>
                </span>
                {status === 'analyzing' && <Clock size={10} className="text-blue-600 animate-spin" />}
                {status === 'voted' && vote?.vote !== 'HOLD' && <CheckCircle size={10} className="text-emerald-600" />}
                {status === 'voted' && vote?.vote === 'HOLD' && <AlertCircle size={10} className="text-slate-400" />}
              </div>
              <div className="font-semibold text-[11px] text-slate-900 truncate">{agent.name}</div>
              {vote && (
                <>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`font-mono font-bold text-[10px] ${vote.vote === 'BUY' ? 'text-emerald-700' : vote.vote === 'SELL' ? 'text-red-700' : 'text-slate-600'}`}>
                      {vote.vote}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500 tabular-nums">{vote.confidence}%</span>
                  </div>
                  {confidenceBar(vote.confidence)}
                </>
              )}
              {status === 'analyzing' && (
                <div className="mt-1 h-1 bg-blue-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full animate-pulse" style={{ width: '60%' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
