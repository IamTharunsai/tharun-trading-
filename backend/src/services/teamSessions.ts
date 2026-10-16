import { randomUUID } from 'crypto';

export const TEAM_SPECIALISTS = [
  { id: 1, name: 'The Technician' }, { id: 2, name: 'The Newshound' },
  { id: 3, name: 'The Sentiment Analyst' }, { id: 4, name: 'The Fundamental Analyst' },
  { id: 5, name: 'The Risk Manager' }, { id: 6, name: 'The Trend Prophet' },
  { id: 7, name: 'The Volume Detective' }, { id: 8, name: 'The Whale Watcher' },
  { id: 9, name: 'The Macro Economist' }, { id: 10, name: "The Devil's Advocate" },
  { id: 11, name: 'Elliott Wave' }, { id: 12, name: 'Options Flow' },
  { id: 13, name: 'Arbitrageur' }, { id: 14, name: 'Quant Forecaster' },
] as const;
export const TEAM_SESSION_LIMITS = { maxSessions: 32, maxEntriesPerSession: 96, retentionMs: 60 * 60_000, maxTextChars: 2048 } as const;
type Stage = 'started' | 'opening' | 'cross-examination' | 'final-voting' | 'coordinator' | 'complete' | 'failed';
type Kind = 'start' | 'round' | 'analyzing' | 'opening-vote' | 'challenge' | 'rebuttal' | 'final-vote' | 'coordinator' | 'complete' | 'error';
export type TeamEvent = 'debate:start' | 'debate:round' | 'debate:agent-speaking' | 'debate:agent-voted'
  | 'debate:cross-examination' | 'debate:final-vote' | 'debate:agent-error' | 'debate:master-thinking' | 'debate:error' | 'debate:complete';
export interface TeamSessionContext {
  debateId: string; asset: string; market: 'stocks' | 'crypto' | 'forex';
  purpose: 'ENTRY' | 'RESEARCH' | 'POSITION_REVIEW'; marketSnapshotAt: number;
}
export interface SessionObservation { processId: string; sequence: number; receivedAt: number }
export interface TeamReceipt extends SessionObservation {
  event: TeamEvent; kind: Kind; source: 'investment-committee-event'; sourceEventAt: number | null;
  round?: 1 | 2 | 3; agentId?: number; agentName?: string;
  content?: string; contentTruncated?: boolean; originalCharacters?: number;
  vote?: 'BUY' | 'SELL' | 'HOLD'; confidence?: number; errorCode?: string; fatal?: boolean;
}
export interface TeamSession {
  id: string; asset: string; market: TeamSessionContext['market']; purpose: 'ENTRY' | 'RESEARCH';
  firstObservedAt: number; lastObservedAt: number; lastSequence: number;
  status: 'incomplete' | 'complete' | 'failed'; stage: Stage;
  marketSnapshotAt: number; exchangeObservedAt: null; resumedFromCheckpoint: boolean; checkpointStage?: 'ROUND1_DONE' | 'ROUND2_DONE';
  agents: Record<number, { agentId: number; name: string; lastObservation: TeamReceipt }>;
  coordinator?: { name: 'Master Coordinator'; lastObservation: TeamReceipt };
  entries: TeamReceipt[]; observedEventCount: number; droppedEntryCount: number; entriesTruncated: boolean;
  result?: { decision?: 'BUY' | 'SELL' | 'HOLD'; confidence?: number; committeeApproved: boolean;
    synthesis: string; synthesisTruncated: boolean; synthesisOriginalCharacters: number;
    blockReason: string; blockReasonTruncated: boolean; blockReasonOriginalCharacters: number;
    decisionId?: string; transcriptCreatedAt: number | null; tradeExecution: 'not-observed' };
}
const object = (value: unknown): Record<string, any> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
const boundedIdentity = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const agent = (value: unknown) => typeof value === 'number' && Number.isInteger(value) ? TEAM_SPECIALISTS.find(item => item.id === value) : undefined;
const round = (value: unknown): 1 | 2 | 3 | undefined => value === 1 || value === 2 || value === 3 ? value : undefined;
const vote = (value: unknown) => value === 'BUY' || value === 'SELL' || value === 'HOLD' ? value : undefined;
const confidence = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
const timestamp = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
function content(value: unknown) {
  const text = typeof value === 'string' ? value : '';
  return { content: text.slice(0, TEAM_SESSION_LIMITS.maxTextChars), originalCharacters: text.length, contentTruncated: text.length > TEAM_SESSION_LIMITS.maxTextChars };
}
const knownErrors = {
  opening_unavailable: 'Opening research unavailable', final_unavailable: 'Final research unavailable',
  cross_examination_unavailable: 'Cross-examination unavailable', coordinator_unavailable: 'Coordinator research unavailable',
  decision_persistence_failed: 'Decision persistence failed', session_failed: 'Committee session failed',
} as const;

/** Process-local observations, never a scheduler/heartbeat or a durable execution ledger. */
export class TeamSessionRegistry {
  private readonly sessions = new Map<string, TeamSession>();
  private readonly processId = randomUUID();
  private readonly coverageStartedAt: number;
  private sequence = 0;
  private readonly counters = { acceptedEvents: 0, ignoredEvents: 0, expiredSessions: 0, evictedSessions: 0, evictedEntries: 0 };
  constructor(private readonly clock: () => number = Date.now) { this.coverageStartedAt = clock(); }
  private prune(now: number) {
    for (const [id, session] of this.sessions) {
      if (now - session.lastObservedAt > TEAM_SESSION_LIMITS.retentionMs) { this.sessions.delete(id); this.counters.expiredSessions++; }
    }
  }
  observe(context: TeamSessionContext, event: TeamEvent, payload: unknown, socketTransportAvailable: boolean): SessionObservation | null {
    const now = this.clock(); this.prune(now);
    const data = object(payload);
    const rejected = () => { this.counters.ignoredEvents++; return null; };
    if (!data || context.purpose === 'POSITION_REVIEW' || !['ENTRY', 'RESEARCH'].includes(context.purpose)
      || !boundedIdentity(context.debateId, 160) || data.debateId !== context.debateId || !boundedIdentity(context.asset, 100)
      || !['stocks', 'crypto', 'forex'].includes(context.market) || timestamp(context.marketSnapshotAt) === null
      || (data.asset !== undefined && data.asset !== context.asset)) return rejected();
    const old = this.sessions.get(context.debateId);
    // No cross-session attribution or resurrection from a later fragment after retention.
    if (!old && event !== 'debate:start') return rejected();
    if (old && event === 'debate:start') return rejected();
    if (old && (old.asset !== context.asset || old.market !== context.market || old.purpose !== context.purpose || old.status !== 'incomplete')) return rejected();
    const receipt: TeamReceipt = { processId: this.processId, sequence: this.sequence + 1, receivedAt: now,
      event, kind: 'round', source: 'investment-committee-event', sourceEventAt: timestamp(data.timestamp) };
    const additions: TeamReceipt[] = [];
    let stage: Stage | undefined;
    if (event === 'debate:start') { receipt.kind = 'start'; stage = 'started'; }
    else if (event === 'debate:round') {
      receipt.round = round(data.round); if (!receipt.round) return rejected();
      stage = receipt.round === 1 ? 'opening' : receipt.round === 2 ? 'cross-examination' : 'final-voting';
    } else if (event === 'debate:master-thinking') { receipt.kind = 'coordinator'; stage = 'coordinator'; }
    else if (event === 'debate:complete') {
      const transcript = object(data.transcript);
      if (!transcript || transcript.id !== context.debateId || transcript.asset !== context.asset
        || transcript.market !== context.market || transcript.purpose !== context.purpose) return rejected();
      receipt.kind = 'complete'; stage = 'complete';
    }
    else if (event === 'debate:error' || event === 'debate:agent-error') {
      const code = data.errorCode as keyof typeof knownErrors;
      if (!Object.prototype.hasOwnProperty.call(knownErrors, code)) return rejected();
      receipt.kind = 'error'; receipt.errorCode = code; Object.assign(receipt, content(knownErrors[code]));
      if (event === 'debate:agent-error') {
        const canonical = agent(data.agentId); if (!canonical || !round(data.round)) return rejected();
        receipt.agentId = canonical.id; receipt.agentName = canonical.name; receipt.round = round(data.round);
      } else { receipt.fatal = data.fatal === true; if (receipt.fatal) stage = 'failed'; }
    } else if (event === 'debate:cross-examination') {
      const challenger = agent(data.challengerId), target = agent(data.targetId);
      if (!challenger || !target) return rejected();
      receipt.kind = 'challenge'; receipt.round = 2; receipt.agentId = challenger.id; receipt.agentName = challenger.name;
      Object.assign(receipt, content(data.challenge));
      additions.push({ ...receipt, kind: 'rebuttal', agentId: target.id, agentName: target.name, ...content(data.rebuttal) });
    } else if (event === 'debate:agent-speaking' || event === 'debate:agent-voted' || event === 'debate:final-vote') {
      const canonical = agent(data.agentId); if (!canonical) return rejected();
      receipt.agentId = canonical.id; receipt.agentName = canonical.name;
      if (event === 'debate:agent-speaking') {
        // Current engine only emits a specialist start for opening analysis.
        if (data.round !== 1) return rejected(); receipt.kind = 'analyzing'; receipt.round = 1;
      } else {
        receipt.kind = event === 'debate:final-vote' ? 'final-vote' : 'opening-vote';
        receipt.round = event === 'debate:final-vote' ? 3 : 1;
        receipt.vote = vote(data.finalVote ?? data.vote); receipt.confidence = confidence(data.confidence);
        Object.assign(receipt, content(event === 'debate:final-vote' ? data.finalReason : data.openingArgument));
        if (data.failureState === true) receipt.errorCode = 'opening_unavailable';
      }
    } else return rejected();

    const session: TeamSession = old ?? { id: context.debateId, asset: context.asset, market: context.market,
      purpose: context.purpose as 'ENTRY' | 'RESEARCH', firstObservedAt: now, lastObservedAt: now, lastSequence: receipt.sequence,
      status: 'incomplete', stage: 'started', marketSnapshotAt: context.marketSnapshotAt, exchangeObservedAt: null,
      resumedFromCheckpoint: data.resumedFromCheckpoint === true,
      ...(data.checkpointStage === 'ROUND1_DONE' || data.checkpointStage === 'ROUND2_DONE' ? { checkpointStage: data.checkpointStage } : {}),
      agents: {}, entries: [], observedEventCount: 0, droppedEntryCount: 0, entriesTruncated: false };
    this.sequence++; this.counters.acceptedEvents++; session.observedEventCount++;
    session.lastObservedAt = now; session.lastSequence = receipt.sequence;
    if (stage) session.stage = stage;
    for (const entry of [receipt, ...additions]) {
      session.entries.push(entry);
      if (entry.agentId) session.agents[entry.agentId] = { agentId: entry.agentId, name: entry.agentName!, lastObservation: entry };
    }
    if (event === 'debate:master-thinking' || (event === 'debate:error' && data.errorCode === 'coordinator_unavailable')) {
      session.coordinator = { name: 'Master Coordinator', lastObservation: receipt };
    }
    if (stage === 'failed') session.status = 'failed';
    if (event === 'debate:complete') {
      const transcript = object(data.transcript)!;
      const synthesis = content(transcript.masterSynthesis), block = content(transcript.blockReason);
      session.status = 'complete';
      session.result = { decision: vote(transcript.finalDecision), confidence: confidence(transcript.finalConfidence),
        committeeApproved: transcript.executionApproved === true, synthesis: synthesis.content, synthesisTruncated: synthesis.contentTruncated,
        synthesisOriginalCharacters: synthesis.originalCharacters, blockReason: block.content, blockReasonTruncated: block.contentTruncated,
        blockReasonOriginalCharacters: block.originalCharacters, transcriptCreatedAt: timestamp(transcript.timestamp),
        ...(boundedIdentity(transcript.decisionId, 160) ? { decisionId: transcript.decisionId } : {}), tradeExecution: 'not-observed' };
    }
    const overflow = Math.max(0, session.entries.length - TEAM_SESSION_LIMITS.maxEntriesPerSession);
    if (overflow) { session.entries.splice(0, overflow); session.droppedEntryCount += overflow; session.entriesTruncated = true; this.counters.evictedEntries += overflow; }
    this.sessions.delete(session.id); this.sessions.set(session.id, session);
    while (this.sessions.size > TEAM_SESSION_LIMITS.maxSessions) { this.sessions.delete(this.sessions.keys().next().value!); this.counters.evictedSessions++; }
    // Transport availability never claims a subscriber received an event.
    this.lastSocketTransportAvailable = socketTransportAvailable;
    return { processId: this.processId, sequence: receipt.sequence, receivedAt: now };
  }
  private lastSocketTransportAvailable: boolean | null = null;
  snapshot() {
    const now = this.clock(); this.prune(now);
    return { schemaVersion: 1 as const, capturedAt: now,
      process: { id: this.processId, coverageStartedAt: this.coverageStartedAt, scope: 'current-process-only' as const, durable: false as const },
      source: 'investment-committee-event' as const, limits: { ...TEAM_SESSION_LIMITS }, counters: { ...this.counters },
      semantics: { executionLiveness: 'unknown' as const, heartbeat: false as const, socketDelivery: 'not-tracked' as const,
        lastSocketTransportAvailable: this.lastSocketTransportAvailable, includes: ['ENTRY', 'RESEARCH'], excludes: ['POSITION_REVIEW'],
        marketSnapshotAt: 'context assembly timestamp; not proof of exchange freshness', sourceEventAt: 'explicit event timestamp when supplied; otherwise null',
        history: 'process observations only; restart, other replicas, retention and entry/content caps leave gaps' },
      roster: { specialists: TEAM_SPECIALISTS.map(item => ({ ...item })), coordinator: { name: 'Master Coordinator' } },
      sessions: [...this.sessions.values()].reverse().map(session => JSON.parse(JSON.stringify(session)) as TeamSession) };
  }
}
export const teamSessionRegistry = new TeamSessionRegistry();
