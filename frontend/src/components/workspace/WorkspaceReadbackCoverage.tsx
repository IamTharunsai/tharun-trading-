import { TeamReadbackError, TeamWorkspaceReadbackMeta, formatTeamReceiptTime } from '../../utils/teamWorkspaceAdapter';

export const readbackStateLabel: Record<TeamWorkspaceReadbackMeta['state'], string> = {
  'signed-out': 'Sign in required', loading: 'Reading observations', ready: 'Observations received', empty: 'No retained sessions',
  stale: 'Older readback', forbidden: 'Owner access required', unauthorized: 'Sign in required',
  'invalid-response': 'Unverified response', unavailable: 'Readback unavailable',
};
export interface ResearchNotice { phase: 'pending' | 'acknowledged' | 'unconfirmed' | 'error'; message: string }

/** Evidence and coverage describe only the latest verified process snapshot. */
export default function WorkspaceReadbackCoverage({ meta, error, reviewId, onRefresh, research }: {
  meta: TeamWorkspaceReadbackMeta; error?: TeamReadbackError | null; reviewId?: string;
  onRefresh?: () => void; research?: ResearchNotice;
}) {
  const coverage = meta.coverage, session = reviewId ? meta.sessions[reviewId] : undefined;
  const coordinator = session?.coordinator?.lastObservation, result = session?.result;
  return <section id="workspace-coverage" aria-labelledby="workspace-coverage-heading" className="rainlight-coverage mx-auto max-w-6xl space-y-5 p-6">
    <h2 id="workspace-coverage-heading" className="rainlight-coverage-heading text-xl font-semibold">Observed session coverage</h2>
    <div className="rainlight-coverage-status" role="status" aria-live="polite" data-readback-state={meta.state}>
      <p>{readbackStateLabel[meta.state]}{meta.isRefreshing ? ' · Refreshing' : ''}. Current execution is unknown.</p>
      <p>{meta.asOfLabel}</p>
      {meta.browserReceivedAt !== null && <p>Browser received {formatTeamReceiptTime(meta.browserReceivedAt)}.</p>}
      {meta.state === 'empty' && <p>No sessions are retained in this process. This does not establish inactivity or an empty trading history.</p>}
      {meta.stale && <p>Older observations; do not treat these receipts as current activity.</p>}
    </div>
    {error && <div className="rainlight-coverage-error" role="alert"><p>{error.message}</p><p>Prior session content is hidden until a verified readback succeeds.</p></div>}
    {meta.previousReadback && <p>Previous readback: {formatTeamReceiptTime(meta.previousReadback.serverCapturedAt)}. Its content is no longer displayed.</p>}
    {onRefresh && <button className="underline" onClick={onRefresh} disabled={meta.isRefreshing || meta.state === 'signed-out'}>Retry session readback</button>}
    {research && <p role="status" data-research-state={research.phase}>{research.message}</p>}
    {coverage && <div className="rainlight-coverage-grid grid gap-4 md:grid-cols-2">
      <div><h3 className="font-semibold">Process coverage</h3><p>Current process only; not durable history. Started {coverage.startedLabel}.</p>
        <p>Process {coverage.processId}. {coverage.retainedSessions} retained sessions.</p>
        <p>Retention: {coverage.limits.retentionMs / 60_000} minutes; up to {coverage.limits.maxSessions} sessions, {coverage.limits.maxEntriesPerSession} entries per session and {coverage.limits.maxTextChars} characters per text.</p>
        <p>{coverage.partial ? 'Partial coverage: observations or text have been omitted.' : 'No omissions reported within these bounds.'}</p>
        <p>Expired sessions: {coverage.counters.expiredSessions}; evicted sessions: {coverage.counters.evictedSessions}; evicted entries: {coverage.counters.evictedEntries}.</p></div>
      {session && <div><h3 className="font-semibold">Selected session observations</h3><p>Session {reviewId}. Purpose {session.purpose}; last observed outcome {session.status}.</p>
        <p>Last server receipt {session.receiptLabel}; sequence {session.lastSequence}. {session.observedEventCount} events observed.</p>
        <p>{session.olderObservation ? 'Older session observation; execution unknown.' : 'Execution unknown; a recent receipt is not a heartbeat.'}</p>
        {session.clockOrderUncertain && <p>Server clock ordering is uncertain.</p>}
        <p>Market context timestamp {formatTeamReceiptTime(session.marketSnapshotAt)}; no verified exchange quote timestamp.</p>
        {session.resumedFromCheckpoint && <p>Checkpoint resume observed; saved work is not new specialist activity.</p>}
        {session.entriesTruncated && <p>Partial history: {session.droppedEntryCount} entries omitted.</p>}
        {session.contentTruncated && <p>Partial text: the retention limit truncated content.</p>}
      </div>}
    </div>}
    {session && <div className="rainlight-coverage-details space-y-3">
      <h3 className="font-semibold">Master Coordinator</h3>
      {coordinator ? <><p>Server receipt {formatTeamReceiptTime(coordinator.receivedAt)}; sequence {coordinator.sequence}. Source: {coordinator.source}.</p>
        <p>{coordinator.sourceEventAt === null ? 'Source event time not supplied.' : `Source event time ${formatTeamReceiptTime(coordinator.sourceEventAt)}.`}</p>
        <p>{coordinator.content || 'No coordinator text supplied.'}</p>
        {coordinator.contentTruncated && <p>Partial coordinator text: {coordinator.content?.length} of {coordinator.originalCharacters} characters retained.</p>}
      </> : <p>No coordinator receipt observed.</p>}
      <h3 className="font-semibold">Committee result</h3>
      {result ? <><p>{result.decision ? `Observed decision ${result.decision}.` : 'No decision supplied.'} {result.confidence === undefined ? '' : `${result.confidence}% reported confidence.`} Committee approval {result.committeeApproved ? 'observed' : 'not observed'}; trade execution not observed.</p>
        <p>{result.synthesis || 'No synthesis text supplied.'}</p>
        {result.synthesisTruncated && <p>Partial synthesis: {result.synthesis.length} of {result.synthesisOriginalCharacters} characters retained.</p>}
        {result.blockReason && <p>Recorded block reason: {result.blockReason}</p>}
        {result.blockReasonTruncated && <p>Partial block reason: {result.blockReason.length} of {result.blockReasonOriginalCharacters} characters retained.</p>}
        {result.decisionId && <p>Recorded decision ID: {result.decisionId}. <a className="underline" href="/agents/debate-room">Open review history</a></p>}
      </> : <p>No committee result observed. Missing completion does not establish current execution.</p>}
      {session.failures.map(failure => <p key={failure.sequence}>Observed issue: {failure.label} ({failure.code}), server receipt {formatTeamReceiptTime(failure.receivedAt)}. Current availability is unknown.</p>)}
    </div>}
    <details className="rainlight-coverage-details"><summary>Readback limits and source</summary><ul className="list-disc space-y-2 pl-5">{meta.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}</ul></details>
  </section>;
}
