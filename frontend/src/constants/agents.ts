export interface Agent {
  id: number;
  name: string;
  icon: string;
  role: string;
  color: string;
  veto?: boolean;
}

// Canonical 13-agent roster — mirrors backend/src/agents/debateEngine.ts AGENTS list.
// Single source of truth: every page (Agents, DebateRoom, AgentMonitor, AgentChat)
// imports this instead of maintaining its own copy.
export const AGENTS: Agent[] = [
  { id: 1,  name: 'The Technician',       icon: '📊', role: 'Technical Analysis', color: '#FF8C42' },
  { id: 2,  name: 'The Newshound',        icon: '📰', role: 'News & Events',      color: '#F5A623' },
  { id: 3,  name: 'Sentiment Analyst',    icon: '🧠', role: 'Market Sentiment',   color: '#2D8A4A' },
  { id: 4,  name: 'Fundamental Analyst',  icon: '📈', role: 'Fundamentals',      color: '#FF8C42' },
  { id: 5,  name: 'Risk Manager',         icon: '🛡️', role: 'Risk Guard',        color: '#DC2626', veto: true },
  { id: 6,  name: 'Trend Prophet',        icon: '🔮', role: 'Future Prediction', color: '#2D8A4A' },
  { id: 7,  name: 'Volume Detective',     icon: '🔍', role: 'Volume Analysis',   color: '#F5A623' },
  { id: 8,  name: 'Whale Watcher',        icon: '🐋', role: 'Whale Activity',    color: '#2D8A4A' },
  { id: 9,  name: 'Macro Economist',      icon: '🌍', role: 'Macro Economics',   color: '#FF8C42' },
  { id: 10, name: "Devil's Advocate",     icon: '😈', role: 'Counter-Argument',  color: '#DC2626' },
  { id: 11, name: 'Elliott Wave',         icon: '🌊', role: 'Wave Structure',    color: '#4A90D9' },
  { id: 12, name: 'Options Flow',         icon: '📉', role: 'Smart Money Flow',  color: '#8B6F47' },
  { id: 13, name: 'Arbitrageur',          icon: '⚖️', role: 'Mispricing Detector', color: '#F5A623' },
];

export const AGENTS_BY_ID: Record<number, Agent> = Object.fromEntries(AGENTS.map(a => [a.id, a]));

export function voteColor(vote?: string): string {
  if (vote === 'BUY') return '#2D8A4A';
  if (vote === 'SELL') return '#DC2626';
  if (vote === 'HOLD') return '#F5A623';
  return 'var(--apex-border)';
}
