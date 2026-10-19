# Scheduler runtime evidence

## Questions this evidence answers

1. Did this process reach scheduler initialization, and did registration finish?
2. Is a callback from the same cron engine being observed recently?
3. Which business callbacks started, remain active, returned, threw, caught a dependency failure, or explicitly skipped work?
4. Does the lack of trades have recorded scheduling/work evidence, or is provider/risk/execution evidence still needed?

`GET /api/system/status` remains owner-only and `no-store`. `schedulerRuntime` contains current-process evidence and the legacy `scheduler` string derives from that snapshot. It never probes providers, places orders, changes flags or invokes jobs. HTTP health alone does not establish scheduler initialization. Startup prerequisite failures and partial registration failures remain offline, even if HTTP remains available.

## Meaning of the fields

- `evidenceScope=CURRENT_PROCESS`, `bootId`, `processStartedAt`: state resets on restart and does not certify earlier deploys or another replica. Structured lifecycle/job events provide an incident trail in the existing logging sink; this change adds no durable database history or cross-replica aggregation.
- `lifecycle`: not_started, initializing, registered, failed or stopped. Registration is not evidence that any business callback ran. Initialization failure reports an allowlisted code, never the exception body.
- `observer`: a separate ten-second cron callback from the same node-cron engine. It becomes stale after thirty seconds (three missed ticks). Recent means only that this observer ticked; it is not proof each business job ran, external providers worked or trades were authorized. Status evaluation is local and cannot be fetched while a process is completely unresponsive.
- `jobs`: at most 32 fixed registrations (24 business jobs for US prediction mode, 21 for international mode). Each has the actual cron expression and explicit timezone or SYSTEM_DEFAULT, counters, last start and last finish, active callbacks, overlaps, duration and correlated last outcome. Business schedules/timezones and kill/risk/execution guards are unchanged. The independent observer adds no financial action.
- `callback_returned`: the awaited callback returned without a scheduler-visible failure or skip. This deliberately does not mean successful provider coverage or fills. Some services catch errors internally without an observable result; that remains outside this wrapper's evidence.
- `caught_failure`: a scheduler catch/fanout branch or an explicit returned evidence failure marked the callback incomplete, even though existing catch-and-continue semantics were preserved. Failure takes precedence over skip. Detailed errors are not copied into the status response or new structured events.
- `threw`: callback rejected or threw; the original error is rethrown unchanged to node-cron. `skipped`: a known guard or unavailable/stale scan result was observed. A batch with some skip marks remains conservatively skipped, not a count of all symbols passing/failing. Existing deeper policy/risk rejections are not reclassified as provider failures.
- `active`: unresolved callbacks are retained as active, with their start evidence. Observation never cancels/retries/suppresses an active financial callback or guesses a timeout outcome. Overlaps count actual starts while another callback is active.
- `lastOutcome` and `lastRunId` are the most recently **finished** callback. `lastStartedAt` may refer to a later overlapping callback that is still active. Historical failed counters remain after recovery; `failedJobs` uses the latest finished outcome, not the all-time count.
- `online`: registered plus a recent observer and no latest observed failed business outcome. `starting`: initialization/first tick not yet observed. `degraded`: stale observer or latest callback failure. `offline`: not initialized, initialization failed, or shutdown observed. Never label these values as automatic trading operational/readiness. Never-observed calendar jobs remain explicit; this implementation does not guess missed market sessions from wall-clock gaps.

No raw exception messages, account IDs, symbols, prompts, keys, URLs or provider payloads are accepted by new telemetry fields. Stable event names are scheduler_initializing, scheduler_registered, scheduler_initialization_failed, scheduler_stopped, scheduler_job_started and scheduler_job_finished. Events carry bootId, entryPoint=scheduler and runId for callback events. Observer ticks stay in bounded memory rather than emitting a log every ten seconds. Existing business logs are preserved; this is not a whole-application log-redaction change.

## First incident checks

Inspect the owner status's lifecycle/initializationFailure and process identity first. Then check observer freshness and the affected job's expression/timezone, started/finished/outcome/active counters. A recent prediction scan is not proof the crypto daily or equity intraday callback ran. On weekends, equity entry jobs have weekday calendars; crypto daily uses 08:00 America/New_York, not an all-day entry loop. Never force trades by clearing risk or kill guards.

If a callback remains active, use its runId and bootId to follow the existing sink. A returned callback still requires the service's own market/risk/execution evidence: known skips, current capitalRisk.reason/as-of, prediction scan evidence, committee eligibility, broker acknowledgement/fill status and qualification where applicable. Root/operations owns private production inspection. This instrumentation does not diagnose historical missing trades by itself.

## Sources and verification limits

A skip mark means at least one guarded operation in the callback was skipped. A mini-batch may also have processed other assets; this is not a claim that the whole callback did no work. Caught failures take precedence over skip marks. Frontend labels require recent current-process evidence and explicitly describe a heartbeat, never operational trading.

The pinned [node-cron v3 task implementation](https://github.com/node-cron/node-cron/blob/v3.0.3/src/task.js) awaits returned Promises and distinguishes failure events; returning after an internal catch alone cannot indicate dependency success. [ScheduledTask v3](https://github.com/node-cron/node-cron/blob/v3.0.3/src/scheduled-task.js) starts scheduling by default and does not await business completion before later matching ticks. [Node AsyncLocalStorage](https://nodejs.org/docs/latest-v22.x/api/async_context.html#asynclocalstoragerunstore-callback-args) scopes caught-failure marks through awaited Promise/fanout work without assigning manual runs to the scheduler. The wrapper does not change callback error/return semantics or business expressions.

Verification belongs to the exact-head offline Docker CI: typed production/test imports, fake cron registration of all expressions/options, mocked callback execution/failure/guard cases, concurrent callback isolation, owner/private middleware routing and the prior execution-outcome regression. No local target imports, tests, providers, accounts or broker orders are used. CI mocks are not production provider or broker proof.
