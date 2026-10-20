# Bounded Alpaca activity reads

Production diagnostics on 2026-10-20 showed the recent-activity phase timing out,
with no unresolved inventory reported in that scan. This change reduces the
creation-time range sent in each HTTP request. It does not establish that smaller
requests will resolve the provider latency or qualify any trading account.

`AlpacaBroker.listActivitiesVerified` splits its fixed requested interval into
windows of at most 24 hours, with one second of overlap. Alpaca documents `after`
and `until` as activity **creation** filters, and the page token as the last
activity ID. Effective/settlement dates and ID prefixes never select windows or
advance a cursor. Newly created fees with older effective dates remain included.

Every window is completely paginated with page size 100 before moving on. An
exactly full last page still requires another page to prove termination. The
caller `maxPages` argument remains a **total HTTP request budget**, including
empty windows. Broker sync explicitly uses 64 requests for its 30-day overlap:
31 daily requests are necessary even for an empty response. Risk refresh retains
its existing total budget of 100; replacement-chain recovery retains 20.

Each read has hard limits of 32 windows, 10000 unique activities, and 25 seconds
total elapsed time. Individual HTTP calls use at most the existing 10-second
timeout, shortened to the remaining total budget; an abort signal also bounds a
pending transport. There are no automatic retries or concurrent HTTP calls within
one read. A cold risk refresh ordinarily spans about ten days; incremental
refreshes ordinarily span two days. More than 32 windows fails closed. In
particular, a retained risk activity cursor older than approximately 30 days
cannot catch up through this helper. There is currently no automatic recovery
path for that case: it requires a separately reviewed resumable activity backfill
that advances its cursor only after persisting complete windows. Operators must
not reset the cursor to today, shorten the requested history, or clear unknown
risk state to bypass this bound. The old 100-page request policy could cover a
longer sparse interval; this is an explicit availability tradeoff for bounded
query size, not an equivalent historical-coverage promise.

Repeated IDs within one window indicate invalid pagination. Identical IDs in
overlapping windows are deduplicated only when the full returned evidence is
equal (object property order is irrelevant). A changed payload fails the read;
this helper does not choose which correction is authoritative.

Any timeout, bound, malformed page, or conflict rejects the whole operation.
There is no partial successful array. Risk refresh therefore keeps its prior
activity cursor, immutable observations and known NAV, while making adjusted
risk results unavailable. Recorded losses are not replaced with zero. Existing
revision fencing, account/mode scoping and entry/exit guards are unchanged.

Tradeoff: more short requests may improve the observed latency, but increase
request count. Budgets bound each invocation; separate callers/processes still
have independent budgets and existing database revision fencing. No new cache
claims cross-request or cross-process completeness. Production diagnostics must
confirm the outcome before calling the timeout resolved. `INVALID_RISK_HISTORY`
is a separate observed failure and is not repaired by this query change.

Official contract: https://docs.alpaca.markets/us/reference/getaccountactivities-2

Offline coverage exercises the actual Axios adapter with exclusive-boundary
fixtures, page termination, overlap equality/conflict, late fees, total request
and time bounds, and request cancellation. A disposable PostgreSQL fixture
forces a later-window timeout through that adapter and checks cursor, snapshot,
known valuation and immutable-evidence preservation. These fixtures establish
local behavior; they do not establish provider performance.
