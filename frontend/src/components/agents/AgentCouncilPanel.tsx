import { useStore } from '../../store';
import { Bot, CheckCircle, Clock, AlertCircle } from 'lucide-react';

const AGENT_NAMES = [
  'The Technician',
  'The Newshound',
  'The Sentiment Analyst',
  'The Fundamental Analyst',
  'The Risk Manager',
  'The Trend Prophet',
  'The Volume Detective',
  'The Whale Watcher',
  'The Macro Economist',
  "The Devil's Advocate",
];

const AGENT_ICONS = ['📊', '📰', '🧠', '📈', '🛡️', '🔮', '🔍', '🐋', '🌍', '😈'];

const voteColor = (vote?: string) => {
  if (vote === 'BUY') return 'text-apex-green border-apex-green/30 bg-apex-green/5';
  if (vote === 'SELL') return 'text-apex-red border-apex-red/30 bg-apex-red/5';
  return 'text-apex-muted border-apex-border bg-apex-surface';
};

const confidenceBar = (conf: number) => {
  const color = conf >= 75 ? '#2D8A4A' : conf >= 50 ? '#F5A623' : '#DC2626';
  return (
    <div className="mt-1 h-1 bg-apex-border rounded-full overflow-hidden">
      <div style={{ width: `${conf}%`, background: color, height: '100%', borderRadius: '99px', transition: 'width 0.5s ease' }} />
    </div>
  );
};

export default function AgentCouncilPanel() {
  const { agentCouncil, currentAnalysis } = useStore();

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-apex-accent" />
          <span className="font-sans font-semibold text-apex-text">Agent Council</span>
          <span className="font-mono text-xs text-apex-muted">(10 agents)</span>
        </div>
        {currentAnalysis && (
          <span className="font-mono text-xs text-apex-yellow flex items-center gap-1.5">
            <Clock size={11} className="animate-spin" />
            Voting on {currentAnalysis}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {AGENT_NAMES.map((name, i) => {
          const agentId = i + 1;
          const state = agentCouncil[agentId];
          const status = state?.status || 'idle';
          const vote = state?.vote;

          return (
            <div key={agentId}
              className={`p-2.5 rounded-lg border text-xs transition-all ${
                status === 'voted' && vote ? voteColor(vote.vote) :
                status === 'analyzing' ? 'border-apex-yellow/30 bg-apex-yellow/5' :
                'border-apex-border bg-apex-surface'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="flex items-center gap-1 font-mono text-[10px] text-apex-muted">
                  <span>{AGENT_ICONS[i]}</span>
                  <span>#{agentId}</span>
                </span>
                {status === 'analyzing' && <Clock size={10} className="text-apex-yellow animate-spin" />}
                {status === 'voted' && vote?.vote !== 'HOLD' && <CheckCircle size={10} className="text-apex-green" />}
                {status === 'voted' && vote?.vote === 'HOLD' && <AlertCircle size={10} className="text-apex-muted" />}
              </div>
              <div className="font-sans font-medium text-[11px] text-apex-text truncate">{name}</div>
              {vote && (
                <>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`font-mono font-bold text-[10px] ${vote.vote === 'BUY' ? 'text-apex-green' : vote.vote === 'SELL' ? 'text-apex-red' : 'text-apex-muted'}`}>
                      {vote.vote}
                    </span>
                    <span className="font-mono text-[10px] text-apex-muted">{vote.confidence}%</span>
                  </div>
                  {confidenceBar(vote.confidence)}
                </>
              )}
              {status === 'analyzing' && (
                <div className="mt-1 h-1 bg-apex-border rounded-full overflow-hidden">
                  <div className="h-full bg-apex-yellow/50 rounded-full animate-pulse" style={{ width: '60%' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
