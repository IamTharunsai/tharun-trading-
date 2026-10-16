import { EMPTY_WORKSPACE, SpecialistObservation, WorkspaceModel, WorkspaceReview } from '../components/workspace/workspaceModel';
import { InvalidTeamSnapshotError, TEAM_ERROR_LABELS, TeamReadbackReceipt, TeamReadbackSession, TeamReadbackSnapshot } from '../services/teamSessionSnapshot';

export const TEAM_READBACK_STALE_MS = 30_000;
const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
/** Civil Eastern time includes the date and actual EDT/EST offset for that instant. */
export function formatTeamReceiptTime(timestamp: number): string { return eastern.format(new Date(timestamp)); }
export interface LoadedTeamReadback { snapshot: TeamReadbackSnapshot; receivedAt: number; authEpoch: number }
export interface TeamReadbackError { code: 'forbidden' | 'unauthorized' | 'invalid-response' | 'unavailable'; message: string; retryable: boolean }
export function classifyTeamReadbackError(error: unknown): TeamReadbackError {
  if (error instanceof InvalidTeamSnapshotError) return { code: 'invalid-response', message: 'The server session snapshot could not be verified.', retryable: true };
  const status = (error as { response?: { status?: unknown } } | undefined)?.response?.status;
  if (status === 403) return { code: 'forbidden', message: 'Current owner access is required to read committee sessions.', retryable: false };
  if (status === 401) return { code: 'unauthorized', message: 'Sign in again to read committee sessions.', retryable: false };
  return { code: 'unavailable', message: 'Server session readback is unavailable. Current execution is unknown.', retryable: true };
}
export const TEAM_READBACK_CAVEATS = [
  'Last observed receipts do not establish current execution; there is no heartbeat.',
  'Coverage belongs to one process. Restart and other replicas leave gaps; this is not durable history.',
  'Retention, session/entry caps and text limits can omit observations. A new readback replaces prior server coverage.',
  'Socket delivery and client disconnects are not tracked by this readback.',
  'Server receipt and snapshot assembly times are not verified exchange quote timestamps.',
  'Committee completion and approval do not prove a broker fill. Account, mode and positions remain unverified.',
] as const;
export interface TeamWorkspaceReadbackMeta {
  state: 'signed-out' | 'loading' | 'ready' | 'empty' | 'stale' | 'forbidden' | 'unauthorized' | 'invalid-response' | 'unavailable';
  stale: boolean; isRefreshing: boolean; executionLiveness: 'unknown'; connectionKind: 'http-readback';
  asOfLabel: string; serverCapturedAt: number | null; browserReceivedAt: number | null; readbackAgeMs: number | null;
  coverage: null | { processId: string; startedAt: number; startedLabel: string; scope: 'current-process-only'; durable: false;
    retainedSessions: number; limits: TeamReadbackSnapshot['limits']; counters: TeamReadbackSnapshot['counters']; partial: boolean };
  previousReadback?: { processId: string; serverCapturedAt: number; browserReceivedAt: number; retainedSessions: number };
  sessions: Record<string, { processId: string; purpose: TeamReadbackSession['purpose']; status: TeamReadbackSession['status'];
    executionLiveness: 'unknown'; lastSequence: number; lastObservedAt: number; receiptLabel: string; observationAgeAtCaptureMs: number | null;
    olderObservation: boolean; clockOrderUncertain: boolean; marketSnapshotAt: number; exchangeObservedAt: null;
    resumedFromCheckpoint: boolean; checkpointStage?: TeamReadbackSession['checkpointStage']; entriesTruncated: boolean; droppedEntryCount: number;
    observedEventCount: number; contentTruncated: boolean; coordinator?: TeamReadbackSession['coordinator']; result?: TeamReadbackSession['result'];
    failures: Array<{ sequence: number; code: keyof typeof TEAM_ERROR_LABELS; label: string; agentId?: number; receivedAt: number }> }>;
  observedFailureReceipts: number; caveats: readonly string[];
}
export interface TeamWorkspaceProjection { model: WorkspaceModel; meta: TeamWorkspaceReadbackMeta; error: TeamReadbackError | null }
const stageLabels = { started: 'session start', opening: 'opening research', 'cross-examination': 'cross-examination',
  'final-voting': 'final voting', coordinator: 'coordinator synthesis', complete: 'committee complete', failed: 'session failure' } as const;
function receiptText(entry: TeamReadbackReceipt): string {
  if (entry.errorCode) return TEAM_ERROR_LABELS[entry.errorCode];
  if (entry.kind === 'analyzing') return 'Opening analysis receipt observed; current execution is unknown.';
  const prefix = entry.vote ? `${entry.vote}${entry.confidence === undefined ? '' : ` · ${entry.confidence}% reported confidence`}` : '';
  return [prefix, entry.content].filter(Boolean).join(' · ') || 'Receipt observed; no research text supplied.';
}
function allReceipts(session: TeamReadbackSession): TeamReadbackReceipt[] {
  const unique = new Map<string, TeamReadbackReceipt>();
  for (const entry of [...session.entries, ...Object.values(session.agents).map(agent => agent.lastObservation), ...(session.coordinator ? [session.coordinator.lastObservation] : [])]) {
    unique.set(`${entry.sequence}:${entry.kind}:${entry.agentId ?? 'coordinator'}`, entry);
  }
  return [...unique.values()].sort((a, b) => b.sequence - a.sequence);
}
function specialistObservation(receipt: TeamReadbackReceipt, session: TeamReadbackSession): SpecialistObservation {
  const notes = ['Source: explicit investment committee event.', 'Current execution is unknown; this receipt is not a heartbeat.'];
  if (receipt.round) notes.push(`Observed committee round ${receipt.round}.`);
  if (receipt.contentTruncated) notes.push(`Partial text: ${receipt.content?.length ?? 0} of ${receipt.originalCharacters} characters retained.`);
  if (session.entriesTruncated) notes.push(`Partial history: ${session.droppedEntryCount} timeline entries omitted.`);
  if (session.resumedFromCheckpoint) notes.push('Checkpoint resume observed; saved specialist work was not replayed as new activity.');
  return { state: receipt.errorCode || receipt.kind === 'error' ? 'error' : receipt.kind === 'opening-vote' || receipt.kind === 'final-vote' ? 'voted' : 'observed',
    receiptLabel: formatTeamReceiptTime(receipt.receivedAt), evidence: receiptText(receipt), notes,
    history: session.entries.filter(entry => entry.agentId === receipt.agentId).sort((a, b) => b.sequence - a.sequence)
      .map(entry => ({ text: `${receiptText(entry)}${entry.contentTruncated ? ` (partial: ${entry.originalCharacters} original characters)` : ''}`,
        receiptLabel: formatTeamReceiptTime(entry.receivedAt) })) };
}
function review(session: TeamReadbackSession): WorkspaceReview {
  const specialists: WorkspaceReview['specialists'] = {};
  for (const agent of Object.values(session.agents)) specialists[agent.agentId] = specialistObservation(agent.lastObservation, session);
  const latestAgentError = allReceipts(session).find(entry => entry.agentId && entry.errorCode);
  return { id: session.id, asset: session.asset, marketLabel: ({ stocks: 'Stocks', crypto: 'Crypto', forex: 'Forex' })[session.market],
    stageLabel: `${session.purpose === 'RESEARCH' ? 'Research' : 'Entry review'} · last observed ${stageLabels[session.stage]}`,
    receiptLabel: `Server receipt ${formatTeamReceiptTime(session.lastObservedAt)}`, specialists,
    decisionLabel: session.result?.decision ? `Committee ${session.result.decision} · execution not observed`
      : session.status === 'failed' ? 'Observed session failure; no execution inferred' : 'No committee decision received',
    ...(latestAgentError?.agentId && latestAgentError.errorCode ? { issue: { specialistId: latestAgentError.agentId,
      title: `Observed: ${TEAM_ERROR_LABELS[latestAgentError.errorCode]}`, detail: `Observed ${formatTeamReceiptTime(latestAgentError.receivedAt)}; current availability is unknown.` } } : {}) };
}

/** Whole server coverage replaces previous coverage. Errors expose no cached review content. */
export function projectTeamWorkspaceReadback(input: { tokenPresent: boolean; authEpoch: number; data?: LoadedTeamReadback; error?: unknown;
  isFetching?: boolean; now?: number }): TeamWorkspaceProjection {
  const now = input.now ?? Date.now(), data = input.data?.authEpoch === input.authEpoch && input.tokenPresent ? input.data : undefined;
  const error = input.tokenPresent && input.error ? classifyTeamReadbackError(input.error) : null;
  const age = data ? Math.max(0, now - data.receivedAt) : null;
  const stale = !!data && (age! >= TEAM_READBACK_STALE_MS || !!error);
  const state: TeamWorkspaceReadbackMeta['state'] = !input.tokenPresent ? 'signed-out' : error ? error.code : !data ? 'loading' : stale ? 'stale' : data.snapshot.sessions.length ? 'ready' : 'empty';
  const meta: TeamWorkspaceReadbackMeta = { state, stale, isRefreshing: !!input.isFetching, executionLiveness: 'unknown', connectionKind: 'http-readback',
    asOfLabel: data ? `${error ? 'Previous verified' : 'Server'} readback ${formatTeamReceiptTime(data.snapshot.capturedAt)}` : 'No verified server readback',
    serverCapturedAt: !error && data ? data.snapshot.capturedAt : null, browserReceivedAt: !error && data ? data.receivedAt : null,
    readbackAgeMs: age, coverage: null, sessions: {}, observedFailureReceipts: 0, caveats: TEAM_READBACK_CAVEATS };
  if (error && data) meta.previousReadback = { processId: data.snapshot.process.id, serverCapturedAt: data.snapshot.capturedAt,
    browserReceivedAt: data.receivedAt, retainedSessions: data.snapshot.sessions.length };
  const model: WorkspaceModel = { ...EMPTY_WORKSPACE, reviews: [], connectionLabel: !input.tokenPresent ? 'Sign in to read owner sessions'
    : error ? error.message : data ? `${stale ? 'Older' : 'Verified'} HTTP readback; execution unknown` : 'Waiting for verified server readback',
    connectionState: error ? 'disconnected' : data && !stale ? 'connected' : 'unknown' };
  if (!data || error) return { model, meta, error };
  const snapshot = data.snapshot;
  meta.coverage = { processId: snapshot.process.id, startedAt: snapshot.process.coverageStartedAt, startedLabel: formatTeamReceiptTime(snapshot.process.coverageStartedAt),
    scope: 'current-process-only', durable: false, retainedSessions: snapshot.sessions.length, limits: { ...snapshot.limits }, counters: { ...snapshot.counters },
    partial: snapshot.counters.expiredSessions > 0 || snapshot.counters.evictedSessions > 0 || snapshot.counters.evictedEntries > 0 };
  for (const session of snapshot.sessions) {
    const receipts = allReceipts(session), failures = receipts.filter(entry => entry.errorCode).map(entry => ({ sequence: entry.sequence,
      code: entry.errorCode!, label: TEAM_ERROR_LABELS[entry.errorCode!], agentId: entry.agentId, receivedAt: entry.receivedAt }));
    const elapsed = snapshot.capturedAt - session.lastObservedAt;
    const contentTruncated = receipts.some(entry => entry.contentTruncated) || !!session.result?.synthesisTruncated || !!session.result?.blockReasonTruncated;
    meta.sessions[session.id] = { processId: snapshot.process.id, purpose: session.purpose, status: session.status, executionLiveness: 'unknown',
      lastSequence: session.lastSequence, lastObservedAt: session.lastObservedAt, receiptLabel: formatTeamReceiptTime(session.lastObservedAt),
      observationAgeAtCaptureMs: elapsed < 0 ? null : elapsed, olderObservation: elapsed >= TEAM_READBACK_STALE_MS,
      clockOrderUncertain: elapsed < 0, marketSnapshotAt: session.marketSnapshotAt, exchangeObservedAt: null,
      resumedFromCheckpoint: session.resumedFromCheckpoint, checkpointStage: session.checkpointStage,
      entriesTruncated: session.entriesTruncated, droppedEntryCount: session.droppedEntryCount, observedEventCount: session.observedEventCount,
      contentTruncated, coordinator: session.coordinator ? { name: 'Master Coordinator', lastObservation: { ...session.coordinator.lastObservation } } : undefined,
      result: session.result ? { ...session.result } : undefined, failures };
    meta.observedFailureReceipts += failures.length;
    if (session.entriesTruncated || contentTruncated) meta.coverage.partial = true;
  }
  model.reviews = snapshot.sessions.map(review);
  model.faultSummary = `${meta.observedFailureReceipts} safe failure receipt${meta.observedFailureReceipts === 1 ? '' : 's'} in retained sessions; full system status unverified.`;
  return { model, meta, error: null };
}
