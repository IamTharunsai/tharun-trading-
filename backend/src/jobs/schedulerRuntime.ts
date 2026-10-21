import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger';

// Evidence of THIS process only. Callback return is not provider completeness,
// an approved trade, a broker acknowledgement, or an executed fill.
export type JobOutcome = 'callback_returned' | 'caught_failure' | 'threw' | 'skipped';
export type SchedulerReason = 'CALLBACK_THROWN' | 'CAUGHT_DEPENDENCY_FAILURE' | 'NO_MARKET_SNAPSHOT'
  | 'KILL_SWITCH_ACTIVE' | 'ALREADY_RUNNING' | 'POSITION_ALREADY_OPEN' | 'PRE_DEBATE_GATE'
  | 'NO_CANDIDATES' | 'POSITION_CAP' | 'BROKER_EVIDENCE_UNAVAILABLE' | 'BROKER_RECONCILIATION_INCOMPLETE'
  | 'RISK_EVIDENCE_INCOMPLETE' | 'LEDGER_INVALID' | 'INIT_FAILED' | 'BOOT_PREREQUISITE_FAILED'
  | 'INTRADAY_NOT_RUN' | 'INTRADAY_FAILED' | 'PREDICTION_SCAN_INCOMPLETE'
  | 'CRYPTO_SCAN_CONFIG_INVALID' | 'CRYPTO_SCAN_NOT_DUE' | 'ACCOUNT_SCOPE_CHANGED';
type Run = { runId: string; failure: SchedulerReason | null; skip: SchedulerReason | null; settled: boolean };
type Job = {
  id: string; expression: string; timezone: string; registeredAt: string;
  started: number; returned: number; failed: number; skipped: number; active: number; overlaps: number;
  lastStartedAt: string | null; lastFinishedAt: string | null; lastDurationMs: number | null;
  lastRunId: string | null; lastOutcome: JobOutcome | null; lastReason: SchedulerReason | null;
};
type Log = (event: string, fields: Record<string, unknown>) => void;

export class SchedulerRuntime {
  private readonly context = new AsyncLocalStorage<Run>();
  private readonly jobs = new Map<string, Job>();
  private lifecycle: 'not_started' | 'initializing' | 'registered' | 'failed' | 'stopped' = 'not_started';
  private initReason: SchedulerReason | null = null;
  private initializedAt: string | null = null;
  private heartbeatAt: number | null = null;
  readonly bootId = randomUUID();
  readonly processStartedAt: string;

  constructor(private readonly now: () => number = () => Date.now(), private readonly log: Log = (event, fields) => logger.info(event, fields)) {
    this.processStartedAt = new Date(now()).toISOString();
  }

  private emit(event: string, fields: Record<string, unknown> = {}) {
    // Telemetry must not change a job's return/throw behavior if its sink fails.
    try { this.log(event, { bootId: this.bootId, entryPoint: 'scheduler', ...fields }); } catch { /* observation only */ }
  }

  begin(): boolean {
    if (this.lifecycle !== 'not_started') return false;
    this.lifecycle = 'initializing'; this.emit('scheduler_initializing'); return true;
  }
  ready() { this.lifecycle = 'registered'; this.initializedAt = new Date(this.now()).toISOString(); this.emit('scheduler_registered', { jobs: this.jobs.size }); }
  fail(reason: 'INIT_FAILED' | 'BOOT_PREREQUISITE_FAILED') { this.lifecycle = 'failed'; this.initReason = reason; this.emit('scheduler_initialization_failed', { reason, registeredJobs: this.jobs.size }); }
  stop() { this.lifecycle = 'stopped'; this.emit('scheduler_stopped'); }
  heartbeat() { this.heartbeatAt = this.now(); }

  failure(reason: SchedulerReason = 'CAUGHT_DEPENDENCY_FAILURE') {
    const run = this.context.getStore(); if (run && !run.settled) run.failure ??= reason;
  }
  skip(reason: SchedulerReason) {
    const run = this.context.getStore(); if (run && !run.settled) run.skip ??= reason;
  }

  register<T>(id: string, expression: string, timezone: string, callback: () => T | Promise<T>): () => Promise<T> {
    if (this.jobs.size >= 32 || this.jobs.has(id)) throw new Error('SCHEDULER_REGISTRY_BOUND_OR_DUPLICATE');
    const job: Job = { id, expression, timezone, registeredAt: new Date(this.now()).toISOString(),
      started: 0, returned: 0, failed: 0, skipped: 0, active: 0, overlaps: 0,
      lastStartedAt: null, lastFinishedAt: null, lastDurationMs: null, lastRunId: null, lastOutcome: null, lastReason: null };
    this.jobs.set(id, job);
    return async () => {
      const start = this.now(); const run: Run = { runId: randomUUID(), failure: null, skip: null, settled: false };
      if (job.active) job.overlaps++;
      job.active++; job.started++; job.lastStartedAt = new Date(start).toISOString();
      this.emit('scheduler_job_started', { jobId: id, runId: run.runId, active: job.active });
      let threw = false;
      try { return await this.context.run(run, callback); }
      catch (error) { threw = true; throw error; }
      finally {
        run.settled = true;
        const outcome: JobOutcome = threw ? 'threw' : run.failure ? 'caught_failure' : run.skip ? 'skipped' : 'callback_returned';
        const reason = threw ? 'CALLBACK_THROWN' : run.failure ?? run.skip;
        if (threw || run.failure) job.failed++; else if (run.skip) job.skipped++; else job.returned++;
        job.active--; job.lastFinishedAt = new Date(this.now()).toISOString();
        job.lastDurationMs = Math.max(0, this.now() - start); job.lastRunId = run.runId;
        job.lastOutcome = outcome; job.lastReason = reason;
        this.emit('scheduler_job_finished', { jobId: id, runId: run.runId, outcome, reason, durationMs: job.lastDurationMs, active: job.active });
      }
    };
  }

  snapshot() {
    const now = this.now(); const heartbeatAgeMs = this.heartbeatAt === null ? null : Math.max(0, now - this.heartbeatAt);
    const observer = heartbeatAgeMs === null ? 'not_observed' : heartbeatAgeMs > 30_000 ? 'stale' : 'recent';
    const jobs = Array.from(this.jobs.values(), job => ({ ...job }));
    const failedJobs = jobs.filter(job => job.lastOutcome === 'caught_failure' || job.lastOutcome === 'threw').map(job => job.id);
    const status = this.lifecycle === 'not_started' || this.lifecycle === 'failed' || this.lifecycle === 'stopped' ? 'offline'
      : this.lifecycle === 'initializing' || observer === 'not_observed' ? 'starting'
        : observer === 'stale' || failedJobs.length ? 'degraded' : 'online';
    return { status, lifecycle: this.lifecycle, evidenceScope: 'CURRENT_PROCESS' as const, bootId: this.bootId,
      processStartedAt: this.processStartedAt, initializedAt: this.initializedAt, initializationFailure: this.initReason,
      observedAt: new Date(now).toISOString(), observer: { status: observer, lastTickAt: this.heartbeatAt === null ? null : new Date(this.heartbeatAt).toISOString(), ageMs: heartbeatAgeMs, staleAfterMs: 30_000 },
      jobHealth: { failedJobs, neverObservedJobs: jobs.filter(job => job.started === 0).map(job => job.id), activeCallbacks: jobs.reduce((sum, job) => sum + job.active, 0) },
      interpretation: 'Observer liveness and callback evidence only; provider completeness and trading readiness are not certified.', jobs };
  }
}

export const schedulerRuntime = new SchedulerRuntime();
export const markSchedulerFailure = (reason?: SchedulerReason) => schedulerRuntime.failure(reason);
export const markSchedulerSkip = (reason: SchedulerReason) => schedulerRuntime.skip(reason);
