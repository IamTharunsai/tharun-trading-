import { isErrorVote } from './votes';

export interface DebateAgent {
  status: 'analyzing' | 'voted';
  vote?: 'BUY' | 'SELL' | 'HOLD';
  confidence?: number;
  reasoning?: string;
  error?: boolean;
}
export interface DebateEntry {
  agentName: string;
  content: string;
  round: number;
  vote?: string;
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
    if (!Number.isInteger(agentId) || agentId < 1 || agentId > 100) return previous;
    session.agents = { ...session.agents, [agentId]: { ...session.agents[agentId], status: 'analyzing' } };
  } else if (event === 'debate:agent-voted' || event === 'debate:final-vote') {
    if (!Number.isInteger(agentId) || agentId < 1 || agentId > 100) return previous;
    const final = event === 'debate:final-vote';
    const reasoning = text(final ? data.finalReason : (data.openingArgument ?? data.argument ?? data.reasoning));
    const state: DebateAgent = {
      status: 'voted', vote: vote(data.finalVote ?? data.vote), confidence: confidence(data.confidence), reasoning,
      error: isErrorVote({ ...data, reasoning }),
    };
    session.agents = { ...session.agents, [agentId]: state };
    session.entries = [...session.entries, { agentName: text(data.agentName, 100) || `Specialist ${agentId}`, content: reasoning || 'No argument supplied', round: final ? 3 : 1, vote: state.vote }].slice(-300);
  } else if (event === 'debate:cross-examination') {
    session.entries = [...session.entries,
      { agentName: text(data.challenger, 100), content: text(data.challenge), round: 2 },
      { agentName: text(data.target, 100), content: text(data.rebuttal), round: 2 },
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
        if (!row || !Number.isInteger(row.agentId) || row.agentId < 1 || row.agentId > 100) continue;
        agents[row.agentId] = { status: 'voted', vote: vote(row.finalVote), confidence: confidence(row.confidence), reasoning: text(row.reason), error: isErrorVote(row) };
      }
      session.agents = agents;
    }
    const entries: DebateEntry[] = [];
    for (const row of Array.isArray(transcript.round1) ? transcript.round1 : []) {
      entries.push({ agentName: text(row?.agentName, 100), content: text(row?.argument), round: 1, vote: vote(row?.vote) });
    }
    for (const row of Array.isArray(transcript.round2) ? transcript.round2 : []) {
      entries.push({ agentName: text(row?.challenger, 100), content: text(row?.challenge), round: 2 }, { agentName: text(row?.target, 100), content: text(row?.rebuttal), round: 2 });
    }
    for (const row of Array.isArray(transcript.round3) ? transcript.round3 : []) {
      entries.push({ agentName: text(row?.agentName, 100), content: text(row?.reason), round: 3, vote: vote(row?.finalVote) });
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
