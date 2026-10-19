/** A configured scheduler is not evidence that trading works. */
export interface SchedulerEvidence {
  evidenceScope: 'CURRENT_PROCESS';
  status: 'offline' | 'starting' | 'degraded' | 'online';
  lifecycle: 'not_started' | 'initializing' | 'registered' | 'failed' | 'stopped';
  observedAt: string;
  observer: { status: 'not_observed' | 'stale' | 'recent'; lastTickAt: string | null; ageMs: number | null; staleAfterMs: number };
  jobHealth: { failedJobs: string[]; neverObservedJobs: string[]; activeCallbacks: number };
}
export function schedulerPresentation(runtime?: SchedulerEvidence, now = Date.now()) {
  const unknown = { label: 'SCHEDULER UNVERIFIED', tone: 'unknown' as const,
    detail: 'No recent verified scheduler observation is available. Trading readiness is separate.' };
  if (!runtime || runtime.evidenceScope !== 'CURRENT_PROCESS') return unknown;
  if (!Number.isFinite(runtime.observer?.staleAfterMs) || runtime.observer.staleAfterMs < 1
    || runtime.observer.staleAfterMs > 60_000) return unknown;
  const observedAt = Date.parse(runtime.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > now || now - observedAt > 60_000) return unknown;
  if (runtime.lifecycle === 'failed' || runtime.lifecycle === 'stopped' || runtime.status === 'offline') {
    return { label: 'SCHEDULER OFFLINE', tone: 'bad' as const, detail: 'Scheduler initialization failed, stopped, or has not completed.' };
  }
  if (runtime.status === 'starting' || runtime.observer.status === 'not_observed') {
    return { label: 'SCHEDULER STARTING', tone: 'warn' as const, detail: 'Registration or the first scheduler heartbeat is still pending.' };
  }
  if (runtime.status === 'degraded' || runtime.observer.status !== 'recent' || runtime.jobHealth.failedJobs.length > 0) {
    return { label: 'SCHEDULER NEEDS ATTENTION', tone: 'warn' as const, detail: 'A heartbeat is overdue or a job recorded a failure. Other jobs may still run.' };
  }
  const tickAt = runtime.observer.lastTickAt === null ? NaN : Date.parse(runtime.observer.lastTickAt);
  if (runtime.status !== 'online' || runtime.lifecycle !== 'registered' || !Number.isFinite(tickAt)
    || tickAt > now || now - tickAt > runtime.observer.staleAfterMs) return unknown;
  return { label: 'SCHEDULER HEARTBEAT OBSERVED', tone: 'ok' as const,
    detail: 'The current scheduler process has a recent heartbeat. This does not establish provider health, an approved order or a broker fill.' };
}
