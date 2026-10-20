/** Version-one owner readback. Only allowlisted fields leave this boundary. */
export const TEAM_READBACK_CAPS = { maxSessions: 32, maxEntriesPerSession: 96, retentionMs: 3_600_000, maxTextChars: 2048 } as const;
export const TEAM_SPECIALIST_NAMES = ['The Technician', 'The Newshound', 'The Sentiment Analyst', 'The Fundamental Analyst',
  'The Risk Manager', 'The Trend Prophet', 'The Volume Detective', 'The Whale Watcher', 'The Macro Economist',
  "The Devil's Advocate", 'Elliott Wave', 'Options Flow', 'Arbitrageur', 'Quant Forecaster'] as const;
export const TEAM_ERROR_LABELS = { opening_unavailable: 'Opening research unavailable', final_unavailable: 'Final research unavailable',
  cross_examination_unavailable: 'Cross-examination unavailable', coordinator_unavailable: 'Coordinator research unavailable',
  decision_persistence_failed: 'Decision persistence failed', session_failed: 'Committee session failed' } as const;
export type TeamErrorCode = keyof typeof TEAM_ERROR_LABELS;
export type TeamReceiptKind = 'start' | 'round' | 'analyzing' | 'opening-vote' | 'challenge' | 'rebuttal' | 'final-vote' | 'coordinator' | 'complete' | 'error';
export interface TeamReadbackReceipt {
  processId: string; sequence: number; receivedAt: number; event: string; kind: TeamReceiptKind;
  source: 'investment-committee-event'; sourceEventAt: number | null; round?: 1 | 2 | 3; agentId?: number; agentName?: string;
  content?: string; contentTruncated?: boolean; originalCharacters?: number; vote?: 'BUY' | 'SELL' | 'HOLD'; confidence?: number;
  errorCode?: TeamErrorCode; fatal?: boolean;
}
export interface TeamReadbackResult {
  decision?: 'BUY' | 'SELL' | 'HOLD'; confidence?: number; committeeApproved: boolean; synthesis: string;
  synthesisTruncated: boolean; synthesisOriginalCharacters: number; blockReason: string; blockReasonTruncated: boolean;
  blockReasonOriginalCharacters: number; decisionId?: string; transcriptCreatedAt: number | null; tradeExecution: 'not-observed';
}
export interface TeamReadbackSession {
  id: string; asset: string; market: 'stocks' | 'crypto' | 'forex'; purpose: 'ENTRY' | 'RESEARCH';
  firstObservedAt: number; lastObservedAt: number; lastSequence: number; status: 'incomplete' | 'complete' | 'failed';
  stage: 'started' | 'opening' | 'cross-examination' | 'final-voting' | 'coordinator' | 'complete' | 'failed';
  marketSnapshotAt: number; exchangeObservedAt: null; resumedFromCheckpoint: boolean; checkpointStage?: 'ROUND1_DONE' | 'ROUND2_DONE';
  agents: Record<number, { agentId: number; name: string; lastObservation: TeamReadbackReceipt }>;
  coordinator?: { name: 'Master Coordinator'; lastObservation: TeamReadbackReceipt };
  entries: TeamReadbackReceipt[]; observedEventCount: number; droppedEntryCount: number; entriesTruncated: boolean; result?: TeamReadbackResult;
}
export interface TeamReadbackSnapshot {
  schemaVersion: 1; capturedAt: number; process: { id: string; coverageStartedAt: number; scope: 'current-process-only'; durable: false };
  source: 'investment-committee-event'; limits: { maxSessions: number; maxEntriesPerSession: number; retentionMs: number; maxTextChars: number };
  counters: { acceptedEvents: number; ignoredEvents: number; expiredSessions: number; evictedSessions: number; evictedEntries: number };
  semantics: { executionLiveness: 'unknown'; heartbeat: false; socketDelivery: 'not-tracked'; lastSocketTransportAvailable: boolean | null };
  sessions: TeamReadbackSession[];
}
export class InvalidTeamSnapshotError extends Error {
  readonly code = 'INVALID_TEAM_SNAPSHOT';
  constructor() { super('The server session snapshot could not be verified.'); this.name = 'InvalidTeamSnapshotError'; }
}
function fail(): never { throw new InvalidTeamSnapshotError(); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  return value as Record<string, unknown>;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail();
}
function time(value: unknown): number { return integer(value, 0, 8_640_000_000_000_000); }
function nullableTime(value: unknown): number | null { return value === null ? null : time(value); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : fail(); }
function text(value: unknown, max: number): string {
  return typeof value === 'string' && value.length <= max ? value : fail();
}
function identity(value: unknown, max: number): string {
  const result = text(value, max); return result.trim() && result.trim() === result && !/[\u0000-\u001f\u007f]/.test(result) ? result : fail();
}
function choice<T extends string>(value: unknown, values: readonly T[]): T { return values.includes(value as T) ? value as T : fail(); }
function array(value: unknown, max: number): unknown[] { return Array.isArray(value) && value.length <= max ? value : fail(); }
function specialist(value: unknown): number { return integer(value, 1, 14); }
function specialistName(id: number, value: unknown): string { return value === TEAM_SPECIALIST_NAMES[id - 1] ? value as string : fail(); }
function optionalConfidence(value: unknown): number | undefined {
  return value === undefined ? undefined : typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : fail();
}
function optionalVote(value: unknown) { return value === undefined ? undefined : choice(value, ['BUY', 'SELL', 'HOLD'] as const); }
function truncated(value: unknown, original: unknown, flag: unknown, max: number) {
  const content = text(value, max), originalCharacters = integer(original, content.length), contentTruncated = bool(flag);
  if (contentTruncated ? content.length !== max || originalCharacters <= max : originalCharacters !== content.length) return fail();
  return { content, originalCharacters, contentTruncated };
}
const eventKinds: Record<string, readonly TeamReceiptKind[]> = {
  'debate:start': ['start'], 'debate:round': ['round'], 'debate:agent-speaking': ['analyzing'], 'debate:agent-voted': ['opening-vote'],
  'debate:cross-examination': ['challenge', 'rebuttal'], 'debate:final-vote': ['final-vote'],
  'debate:master-thinking': ['coordinator'], 'debate:complete': ['complete'], 'debate:agent-error': ['error'], 'debate:error': ['error'],
};
function receipt(value: unknown, processId: string, lastSequence: number, maxText: number): TeamReadbackReceipt {
  const data = record(value), event = identity(data.event, 40), kinds = Object.prototype.hasOwnProperty.call(eventKinds, event) ? eventKinds[event] : fail();
  const kind = choice(data.kind, kinds);
  if (data.processId !== processId || data.source !== 'investment-committee-event') return fail();
  const result: TeamReadbackReceipt = { processId, sequence: integer(data.sequence, 1, lastSequence), receivedAt: time(data.receivedAt), event,
    kind, source: 'investment-committee-event', sourceEventAt: nullableTime(data.sourceEventAt) };
  if (data.round !== undefined) result.round = integer(data.round, 1, 3) as 1 | 2 | 3;
  const isAgent = ['analyzing', 'opening-vote', 'challenge', 'rebuttal', 'final-vote'].includes(kind) || event === 'debate:agent-error';
  if (isAgent) { result.agentId = specialist(data.agentId); result.agentName = specialistName(result.agentId, data.agentName); }
  else if (data.agentId !== undefined || data.agentName !== undefined) return fail();
  const expectedRound = kind === 'analyzing' || kind === 'opening-vote' ? 1 : kind === 'challenge' || kind === 'rebuttal' ? 2 : kind === 'final-vote' ? 3 : undefined;
  if ((expectedRound && result.round !== expectedRound) || ((kind === 'round' || event === 'debate:agent-error') && !result.round)) return fail();
  if (data.content !== undefined) Object.assign(result, truncated(data.content, data.originalCharacters, data.contentTruncated, maxText));
  else if (data.originalCharacters !== undefined || data.contentTruncated !== undefined) return fail();
  const vote = optionalVote(data.vote), confidence = optionalConfidence(data.confidence);
  if (vote !== undefined) result.vote = vote;
  if (confidence !== undefined) result.confidence = confidence;
  if (data.errorCode !== undefined) result.errorCode = choice(data.errorCode, Object.keys(TEAM_ERROR_LABELS) as TeamErrorCode[]);
  if (kind === 'error' && !result.errorCode) return fail();
  if (data.fatal !== undefined) result.fatal = bool(data.fatal);
  if (kind !== 'error' && result.errorCode && (kind !== 'opening-vote' || result.errorCode !== 'opening_unavailable')) return fail();
  if (result.fatal && event !== 'debate:error') return fail();
  if (event === 'debate:agent-error' && (result.errorCode !== 'final_unavailable' || result.round !== 3)) return fail();
  if (event === 'debate:error' && (result.errorCode === 'opening_unavailable' || result.errorCode === 'final_unavailable'
    || (result.errorCode === 'session_failed') !== (result.fatal === true))) return fail();
  return result;
}
function completion(value: unknown, maxText: number): TeamReadbackResult {
  const data = record(value);
  if (data.tradeExecution !== 'not-observed') return fail();
  const synthesis = truncated(data.synthesis, data.synthesisOriginalCharacters, data.synthesisTruncated, maxText);
  const block = truncated(data.blockReason, data.blockReasonOriginalCharacters, data.blockReasonTruncated, maxText);
  const result: TeamReadbackResult = { committeeApproved: bool(data.committeeApproved), synthesis: synthesis.content,
    synthesisTruncated: synthesis.contentTruncated, synthesisOriginalCharacters: synthesis.originalCharacters,
    blockReason: block.content, blockReasonTruncated: block.contentTruncated, blockReasonOriginalCharacters: block.originalCharacters,
    transcriptCreatedAt: nullableTime(data.transcriptCreatedAt), tradeExecution: 'not-observed' };
  const decision = optionalVote(data.decision), confidence = optionalConfidence(data.confidence);
  if (decision !== undefined) result.decision = decision;
  if (confidence !== undefined) result.confidence = confidence;
  if (data.decisionId !== undefined) result.decisionId = identity(data.decisionId, 160);
  return result;
}
function session(value: unknown, processId: string, limits: TeamReadbackSnapshot['limits']): TeamReadbackSession {
  const data = record(value);
  if (data.exchangeObservedAt !== null) return fail();
  const status = choice(data.status, ['incomplete', 'complete', 'failed'] as const);
  const stage = choice(data.stage, ['started', 'opening', 'cross-examination', 'final-voting', 'coordinator', 'complete', 'failed'] as const);
  if ((status === 'complete') !== (stage === 'complete') || (status === 'failed') !== (stage === 'failed')) return fail();
  const result: TeamReadbackSession = { id: identity(data.id, 160), asset: identity(data.asset, 100),
    market: choice(data.market, ['stocks', 'crypto', 'forex'] as const), purpose: choice(data.purpose, ['ENTRY', 'RESEARCH'] as const),
    firstObservedAt: time(data.firstObservedAt), lastObservedAt: time(data.lastObservedAt), lastSequence: integer(data.lastSequence, 1),
    status, stage, marketSnapshotAt: time(data.marketSnapshotAt), exchangeObservedAt: null, resumedFromCheckpoint: bool(data.resumedFromCheckpoint),
    agents: {}, entries: [], observedEventCount: integer(data.observedEventCount, 1), droppedEntryCount: integer(data.droppedEntryCount), entriesTruncated: bool(data.entriesTruncated) };
  if (data.checkpointStage !== undefined) result.checkpointStage = choice(data.checkpointStage, ['ROUND1_DONE', 'ROUND2_DONE'] as const);
  result.entries = array(data.entries, limits.maxEntriesPerSession).map(entry => receipt(entry, processId, result.lastSequence, limits.maxTextChars))
    .sort((a, b) => a.sequence - b.sequence || a.kind.localeCompare(b.kind));
  if (!result.entries.length || result.entries[result.entries.length - 1].sequence !== result.lastSequence
    || result.entriesTruncated !== (result.droppedEntryCount > 0)
    || result.observedEventCount > result.entries.length + result.droppedEntryCount) return fail();
  const perSequence = new Map<number, TeamReadbackReceipt[]>();
  for (const entry of result.entries) {
    const group = perSequence.get(entry.sequence) ?? []; group.push(entry); perSequence.set(entry.sequence, group);
    if (group.length > 2 || (group.length === 2 && (group[0].event !== 'debate:cross-examination' || group[1].event !== group[0].event
      || group[0].kind === group[1].kind || group[0].agentId === group[1].agentId))) return fail();
  }
  if (perSequence.size > result.observedEventCount) return fail();
  const agents = record(data.agents), keys = Object.keys(agents);
  if (keys.length > 14) return fail();
  for (const key of keys) {
    const id = specialist(Number(key)); if (String(id) !== key) return fail();
    const item = record(agents[key]), observation = receipt(item.lastObservation, processId, result.lastSequence, limits.maxTextChars);
    if (item.agentId !== id || observation.agentId !== id) return fail();
    const name = specialistName(id, item.name);
    for (const entry of result.entries.filter(entry => entry.agentId === id)) {
      if (entry.sequence > observation.sequence || (entry.sequence === observation.sequence && JSON.stringify(entry) !== JSON.stringify(observation))) return fail();
    }
    result.agents[id] = { agentId: id, name, lastObservation: observation };
  }
  if (result.entries.some(entry => entry.agentId && !result.agents[entry.agentId])) return fail();
  if (data.coordinator !== undefined) {
    const item = record(data.coordinator), observation = receipt(item.lastObservation, processId, result.lastSequence, limits.maxTextChars);
    if (item.name !== 'Master Coordinator' || !(observation.kind === 'coordinator' || observation.errorCode === 'coordinator_unavailable')) return fail();
    result.coordinator = { name: 'Master Coordinator', lastObservation: observation };
  }
  if (status === 'complete') {
    if (result.entries[result.entries.length - 1].kind !== 'complete') return fail();
    result.result = completion(data.result, limits.maxTextChars);
  } else if (data.result !== undefined) return fail();
  if (status === 'failed' && !result.entries.some(entry => entry.sequence === result.lastSequence && entry.fatal)) return fail();
  return result;
}

/** Reject the entire malformed response; never join fragments or retain raw payloads. */
export function parseTeamSessionSnapshot(value: unknown): TeamReadbackSnapshot {
  const data = record(value), process = record(data.process), limits = record(data.limits), counters = record(data.counters), semantics = record(data.semantics);
  const id = identity(process.id, 36);
  const included = array(semantics.includes, 2), excluded = array(semantics.excludes, 1);
  if (data.schemaVersion !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
    || process.scope !== 'current-process-only' || process.durable !== false || data.source !== 'investment-committee-event'
    || semantics.executionLiveness !== 'unknown' || semantics.heartbeat !== false || semantics.socketDelivery !== 'not-tracked'
    || included.length !== 2 || included[0] !== 'ENTRY' || included[1] !== 'RESEARCH' || excluded.length !== 1 || excluded[0] !== 'POSITION_REVIEW') return fail();
  const boundedLimits = { maxSessions: integer(limits.maxSessions, 1, TEAM_READBACK_CAPS.maxSessions),
    maxEntriesPerSession: integer(limits.maxEntriesPerSession, 1, TEAM_READBACK_CAPS.maxEntriesPerSession),
    retentionMs: integer(limits.retentionMs, 1, TEAM_READBACK_CAPS.retentionMs), maxTextChars: integer(limits.maxTextChars, 1, TEAM_READBACK_CAPS.maxTextChars) };
  const roster = record(data.roster), roles = array(roster.specialists, 14), coordinator = record(roster.coordinator);
  if (roles.length !== 14 || coordinator.name !== 'Master Coordinator') return fail();
  const ids = new Set<number>();
  for (const value of roles) { const role = record(value), roleId = specialist(role.id); specialistName(roleId, role.name); if (ids.has(roleId)) return fail(); ids.add(roleId); }
  const sessions = array(data.sessions, boundedLimits.maxSessions).map(value => session(value, id, boundedLimits)).sort((a, b) => b.lastSequence - a.lastSequence);
  if (new Set(sessions.map(item => item.id)).size !== sessions.length) return fail();
  const acceptedEvents = integer(counters.acceptedEvents);
  if (sessions.some(item => item.lastSequence > acceptedEvents) || sessions.reduce((sum, item) => sum + item.observedEventCount, 0) > acceptedEvents) return fail();
  const eventOwners = new Map<number, string>();
  for (const item of sessions) for (const entry of [...item.entries, ...Object.values(item.agents).map(agent => agent.lastObservation), ...(item.coordinator ? [item.coordinator.lastObservation] : [])]) {
    const owner = eventOwners.get(entry.sequence); if (owner !== undefined && owner !== item.id) return fail(); eventOwners.set(entry.sequence, item.id);
  }
  return { schemaVersion: 1, capturedAt: time(data.capturedAt), process: { id, coverageStartedAt: time(process.coverageStartedAt), scope: 'current-process-only', durable: false },
    source: 'investment-committee-event', limits: boundedLimits,
    counters: { acceptedEvents, ignoredEvents: integer(counters.ignoredEvents), expiredSessions: integer(counters.expiredSessions),
      evictedSessions: integer(counters.evictedSessions), evictedEntries: integer(counters.evictedEntries) },
    semantics: { executionLiveness: 'unknown', heartbeat: false, socketDelivery: 'not-tracked',
      lastSocketTransportAvailable: semantics.lastSocketTransportAvailable === null ? null : bool(semantics.lastSocketTransportAvailable) }, sessions };
}
