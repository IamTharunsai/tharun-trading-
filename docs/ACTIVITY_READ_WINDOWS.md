# Bounded Alpaca activity reads

Production diagnostics on 2026-10-20 showed the recent-activity phase timing out,
with no unresolved inventory reported in that scan. This change reduces the
creation-time range sent in each HTTP request. It does not establish that smaller
requests will resolve the provider latency or qualify any trading account.

`AlpacaBroker.listActivitiesVerified` splits unfiltered creation-time reads into
windows targeting 24 hours, with one second of overlap. Alpaca documents `after`
and `until` as activity **creation** filters, and the page token as the last
activity ID. Effective/settlement dates and ID prefixes never select windows or
advance a cursor. Newly created fees with older effective dates remain included.

Every window is completely paginated with page size 100 before moving on. An
exactly full last page still requires another page to prove termination. The
caller `maxPages` argument remains a **total HTTP request budget**, including
empty windows. Broker sync explicitly uses 64 requests for its 30-day overlap:
31 daily requests are necessary even for an empty response. Risk refresh retains
its existing total budget of 100. Order-filtered replacement-chain recovery
preserves its original single interval, `order_id` on every page and total budget
of 20; sparse old orders are not forced through daily windows.

Each read has hard limits of 32 windows, 10000 unique activities, and 25 seconds
total elapsed time. Unfiltered reads use `N=min(32,maxPages)` and
`width=max(24h,ceil((span+(N-1)*1s)/N))`, so at most N overlapping windows cover
the entire original interval. Current 30-day sync reads remain daily; older
90/365-day sparse ranges use wider windows, without an unconditional date cutoff.
Additional pages consume the same total request budget and can still exhaust it.
Individual HTTP calls use at most the existing 10-second
timeout, shortened to the remaining total budget; an abort signal also bounds a
pending transport. There are no automatic retries or concurrent HTTP calls within
one read. A cold risk refresh ordinarily spans about ten days; incremental
refreshes ordinarily span two days. Wider historical windows may still time out;
that remains unknown evidence and may require a separately reviewed resumable
backfill. Operators must not reset a cursor to today, shorten requested history,
or clear unknown risk state to bypass a timeout or budget failure.

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
