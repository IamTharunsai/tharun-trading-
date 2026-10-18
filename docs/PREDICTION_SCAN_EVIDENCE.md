# Polymarket US scan evidence

The owner-only, no-store system status already reads `getPolymarketRuntimeStatus`.
Its `scanEvidence` now reports the latest actual US edge scan in this process:

- `scope: process-local`, a random process instance ID and module start time.
- `previousProcessHistoryAvailable: false`: restart removes these observations;
  this is neither a durable scan history nor a cross-replica aggregate.
- `latestRun`: null until a scan starts, then running, completed or failed with
  its own run ID, start time, end time and bounded counts. Counts are finalized
  on completion/failure; running counts describe the initial state only.
- `lastCompleted`: the previous completed scan, preserved separately when a new
  scan is running or fails. A completed scan does not establish provider health,
  an accepted order, a fill, trading success or live readiness.

Questions this evidence answers: did this process attempt a scan; did that scan
return or throw; how many markets reached each counted stage; and which fixed
categories explain skipped or blocked paper entries? It cannot diagnose earlier
processes, prove freshness indefinitely, or prove another replica ran a scan.
Read the timestamps and process ID alongside the scheduler's own evidence.

The stable log events are `polymarket_scan_completed` and
`polymarket_scan_failed`. Their metadata is the same normalized run record:
numeric counts, fixed category counts, and a fixed failure code only. No market
question/slug, prompt, forecast text, raw provider error, account balance,
credential or financial result is added. Unknown reasons aggregate as `other`.
Counts cap at one million; normalization visits at most 128 reason keys and
marks `truncated` if a bound or invalid count is encountered. These are stage
counts, not a mutually exclusive partition (e.g. reused candidates can skip).

The scanner's existing exceptions still propagate to its scheduler caller;
diagnostic failure recording does not turn failure into success. Concurrent
scan refusal does not replace the active run. Unknown or late completion IDs
cannot replace another run. Live readiness remains `runtime-not-connected`,
and all current scheduled entries remain simulated.

`prediction-scan-evidence.yml` typechecks source and regression fixtures, then
runs the actual scan/runtime tests with mocked providers in a read-only,
unprivileged, network-disabled container. Dependency preparation occurs outside
that container; target source/tests only execute inside it. No live account or
broker credentials are supplied. This diagnostic change does not authorize
changing trading flags or deploying execution routing.
