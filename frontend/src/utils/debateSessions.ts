import { isErrorVote } from './votes';

export interface DebateAgent {
  status: 'analyzing' | 'voted';
  vote?: 'BUY' | 'SELL' | 'HOLD';
  confidence?: number;
  reasoning?: string;
  error?: boolean;
  /** Browser receipt of this specialist's evidence, not a provider timestamp. */
  lastReceivedAt?: number;
  /** Stage established by the specialist event; never inferred from session progress. */
  round?: number;
}
export interface DebateEntry {
  agentId?: number;
  agentName: string;
  content: string;
  round: number;
  vote?: string;
  /** Receipt of the event or complete transcript containing this entry. */
  receivedAt?: number;
}
export interface DebateSession {
  id: string;
  asset: string;
  status: 'running' | 'complete';
  round: number;
  agents: Record<number, DebateAgent>;
  entries: DebateEntry[];
  receivedAt: number;
  result?: {
    decision: string;
    confidence?: number;
    approved: boolean;
    purpose?: string;
    blockReason?: string;
    synthesis?: string;
  };
}
export type DebateSessions = Record<string, DebateSession>;
const object = (value: unknown): Record<string, any> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
const text = (value: unknown, limit = 16000) => typeof value === 'string' ? value.slice(0, limit) : '';
const confidence = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
const vote = (value: unknown) => value === 'BUY' || value === 'SELL' || value === 'HOLD' ? value : undefined;
const validAgentId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100;
const evidenceRound = (value: unknown): number | undefined =>
  value === 1 || value === 2 || value === 3 ? value : undefined;

// Explicit roster aliases accommodate frontend labels, server labels and the
// legacy unprefixed names. Unknown names stay unattributed; no fuzzy matching.
const agentNameAliases: readonly (readonly [number, readonly string[]])[] = [
  [1, ['The Technician', 'Technician']],
  [2, ['The Newshound', 'Newshound']],
  [3, ['The Sentiment Analyst', 'Sentiment Analyst']],
  [4, ['The Fundamental Analyst', 'Fundamental Analyst']],
  [5, ['The Risk Manager', 'Risk Manager']],
  [6, ['The Trend Prophet', 'Trend Prophet']],
  [7, ['The Volume Detective', 'Volume Detective']],
  [8, ['The Whale Watcher', 'Whale Watcher']],
  [9, ['The Macro Economist', 'Macro Economist']],
  [10, ["The Devil's Advocate", "Devil's Advocate"]],
  [11, ['Elliott Wave']],
  [12, ['Options Flow']],
  [13, ['Arbitrageur']],
  [14, ['Quant Forecaster']],
];
const agentAliases: Readonly<Record<string, number>> = Object.fromEntries(
  agentNameAliases.flatMap(([id, names]) => names.map(name => [name.toLowerCase(), id]))
);
const crossExamAgentId = (name: unknown): number | undefined =>
  typeof name === 'string' && Object.prototype.hasOwnProperty.call(agentAliases, name.trim().toLowerCase())
    ? agentAliases[name.trim().toLowerCase()] : undefined;

// Only explicit server debate IDs join events. Asset names alone cannot safely
// distinguish concurrent research, entry and held-position review sessions.
export function reduceDebateEvent(previous: DebateSessions, event: string, payload: unknown, now: number): DebateSessions {
  const data = object(payload);
  const id = text(data?.debateId, 160);
  if (!data || !id) return previous;
  const old = previous[id];
  if (old?.status === 'complete' && event !== 'debate:complete') return previous;
  let session: DebateSession = old ?? {
    id, asset: text(data.asset, 100), status: 'running', round: 0, agents: {}, entries: [], receivedAt: now,
  };
  session = { ...session, receivedAt: now, asset: text(data.asset, 100) || session.asset };
  const agentId = data.agentId;
  if (event === 'debate:start') {
    // Repeated start messages must not erase already observed evidence.
    session.round = Math.max(session.round, 1);
  } else if (event === 'debate:round') {
    if ([1, 2, 3].includes(data.round)) session.round = Math.max(session.round, data.round);
  } else if (event === 'debate:master-thinking') {
    session.round = 4;
  } else if (event === 'debate:agent-speaking') {
    if (!validAgentId(agentId)) return previous;
    session.agents = { ...session.agents, [agentId]: {
      ...session.agents[agentId], status: 'analyzing', lastReceivedAt: now, round: evidenceRound(data.round),
    } };
  } else if (event === 'debate:agent-voted' || event === 'debate:final-vote') {
    if (!validAgentId(agentId)) return previous;
    const final = event === 'debate:final-vote';
    const reasoning = text(final ? data.finalReason : (data.openingArgument ?? data.argument ?? data.reasoning));
    const state: DebateAgent = {
      status: 'voted', vote: vote(data.finalVote ?? data.vote), confidence: confidence(data.confidence), reasoning,
      error: isErrorVote({ ...data, reasoning }),
      lastReceivedAt: now, round: final ? 3 : 1,
    };
    session.agents = { ...session.agents, [agentId]: state };
    session.entries = [...session.entries, { agentId, agentName: text(data.agentName, 100) || `Specialist ${agentId}`, content: reasoning || 'No argument supplied', round: final ? 3 : 1, vote: state.vote, receivedAt: now }].slice(-300);
  } else if (event === 'debate:agent-error') {
    // A specialist's final vote failed: mark the agent errored so the tally
    // and council panel show the failure instead of a silent gap.
    if (!validAgentId(agentId)) return previous;
    const prior = session.agents[agentId];
    session.agents = { ...session.agents, [agentId]: {
      status: prior?.status ?? 'analyzing', vote: prior?.vote, confidence: prior?.confidence,
      reasoning: prior?.reasoning, error: true, lastReceivedAt: now, round: evidenceRound(data.round) ?? prior?.round,
    } };
  } else if (event === 'debate:cross-examination') {
    session.entries = [...session.entries,
      { agentId: crossExamAgentId(data.challenger), agentName: text(data.challenger, 100), content: text(data.challenge), round: 2, receivedAt: now },
      { agentId: crossExamAgentId(data.target), agentName: text(data.target, 100), content: text(data.rebuttal), round: 2, receivedAt: now },
    ].slice(-300);
  } else if (event === 'debate:complete') {
    const transcript = object(data.transcript);
    if (!transcript) return previous;
    session.status = 'complete';
    session.asset = text(transcript.asset, 100) || session.asset;
    session.result = {
      decision: vote(transcript.finalDecision) ?? 'Unknown', confidence: confidence(transcript.finalConfidence),
      approved: transcript.executionApproved === true, purpose: text(transcript.purpose, 100) || undefined,
      blockReason: text(transcript.blockReason), synthesis: text(transcript.masterSynthesis),
    };
    // A complete transcript restores evidence when the screen opened mid-session.
    if (Array.isArray(transcript.round3)) {
      const agents: Record<number, DebateAgent> = {};
      for (const item of transcript.round3) {
        const row = object(item);
        if (!row || !validAgentId(row.agentId)) continue;
        agents[row.agentId] = { status: 'voted', vote: vote(row.finalVote), confidence: confidence(row.confidence), reasoning: text(row.reason), error: isErrorVote(row), lastReceivedAt: now, round: 3 };
      }
      session.agents = agents;
    }
    const entries: DebateEntry[] = [];
    for (const row of Array.isArray(transcript.round1) ? transcript.round1 : []) {
      entries.push({ agentId: validAgentId(row?.agentId) ? row.agentId : undefined, agentName: text(row?.agentName, 100), content: text(row?.argument), round: 1, vote: vote(row?.vote), receivedAt: now });
    }
    for (const row of Array.isArray(transcript.round2) ? transcript.round2 : []) {
      entries.push({ agentId: crossExamAgentId(row?.challenger), agentName: text(row?.challenger, 100), content: text(row?.challenge), round: 2, receivedAt: now }, { agentId: crossExamAgentId(row?.target), agentName: text(row?.target, 100), content: text(row?.rebuttal), round: 2, receivedAt: now });
    }
    for (const row of Array.isArray(transcript.round3) ? transcript.round3 : []) {
      entries.push({ agentId: validAgentId(row?.agentId) ? row.agentId : undefined, agentName: text(row?.agentName, 100), content: text(row?.reason), round: 3, vote: vote(row?.finalVote), receivedAt: now });
    }
    if (entries.length) session.entries = entries.slice(-300);
  } else return previous;
  const all = { ...previous, [id]: session };
  // Preserve active sessions before completed history, with a bounded browser cache.
  const retained = Object.values(all).sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.receivedAt - a.receivedAt).slice(0, 32);
  return Object.fromEntries(retained.map(item => [item.id, item]));
}

export function debateTally(session?: DebateSession) {
  const states = Object.values(session?.agents ?? {});
  const valid = states.filter(state => state.status === 'voted' && !state.error);
  return {
    buy: valid.filter(state => state.vote === 'BUY').length,
    sell: valid.filter(state => state.vote === 'SELL').length,
    hold: valid.filter(state => state.vote === 'HOLD').length,
    errors: states.filter(state => state.error).length,
  };
}
