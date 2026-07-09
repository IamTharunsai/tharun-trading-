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
  { id: 1,  name: 'The Technician',       icon: '📊', role: 'Technical Analysis', color: '#C9A24B' },
  { id: 2,  name: 'The Newshound',        icon: '📰', role: 'News & Events',      color: '#C9A24B' },
  { id: 3,  name: 'Sentiment Analyst',    icon: '🧠', role: 'Market Sentiment',   color: '#12805F' },
  { id: 4,  name: 'Fundamental Analyst',  icon: '📈', role: 'Fundamentals',      color: '#C9A24B' },
  { id: 5,  name: 'Risk Manager',         icon: '🛡️', role: 'Risk Guard',        color: '#B0263B', veto: true },
  { id: 6,  name: 'Trend Prophet',        icon: '🔮', role: 'Future Prediction', color: '#12805F' },
  { id: 7,  name: 'Volume Detective',     icon: '🔍', role: 'Volume Analysis',   color: '#C9A24B' },
  { id: 8,  name: 'Whale Watcher',        icon: '🐋', role: 'Whale Activity',    color: '#12805F' },
  { id: 9,  name: 'Macro Economist',      icon: '🌍', role: 'Macro Economics',   color: '#C9A24B' },
  { id: 10, name: "Devil's Advocate",     icon: '😈', role: 'Counter-Argument',  color: '#B0263B' },
  { id: 11, name: 'Elliott Wave',         icon: '🌊', role: 'Wave Structure',    color: '#4A90D9' },
  { id: 12, name: 'Options Flow',         icon: '📉', role: 'Smart Money Flow',  color: '#5B6472' },
  { id: 13, name: 'Arbitrageur',          icon: '⚖️', role: 'Mispricing Detector', color: '#C9A24B' },
];

export const AGENTS_BY_ID: Record<number, Agent> = Object.fromEntries(AGENTS.map(a => [a.id, a]));

export function voteColor(vote?: string): string {
  if (vote === 'BUY') return '#12805F';
  if (vote === 'SELL') return '#B0263B';
  if (vote === 'HOLD') return '#C9A24B';
  return 'var(--apex-border)';
}
