# Continuous eligible crypto scanning

The former `crypto_daily` callback ran only at 08:00 New York time and selected
the first ten static crypto symbols. `crypto_scan` now receives a cron tick every
minute, including nights and weekends. It admits a scan on the first tick and
then at the configured elapsed cadence. There is no provider I/O at scheduler
registration or an immediate boot-time order attempt.

Configuration is bounded and does not change account mode or authorize trading:

| Setting | Default | Accepted integers |
| --- | --- | --- |
| `CRYPTO_SCAN_EVERY_MIN` | 15 | 5–60 minutes |
| `CRYPTO_DEBATES_PER_SCAN` | 2 | 1–5 candidates |

Malformed values make this callback fail closed before reads. A minute heartbeat
supports arbitrary accepted intervals such as seven minutes; it avoids cron
step expressions that restart unevenly at the hour. Failed reads still consume
the admitted cadence, rather than retrying on every minute tick. A long-running
scan retains its lock until it actually settles; subsequent ticks skip instead
of creating another candidate pipeline. There is no timeout that abandons an
in-flight decision and allows it to execute after its lock is released.

Each admitted tick verifies the current account/mode/broker, then reads the
authenticated broker's `/v2/assets?status=active&asset_class=crypto`. It selects
only active, `tradable:true`, canonical `BASE/USD` crypto instruments. It also
intersects the existing `CRYPTO_ASSETS` data/monitoring universe: the current
price streams and execution fallback classifier still use that list. This is
an explicit supported-path restriction, not a claim that every asset offered by
Alpaca already has a complete data and monitoring integration. Empty, malformed
or unavailable instrument evidence never falls back to a static trading list.

Within this eligible set, alphabetical successor rotation advances after every
attempt, including HOLD, unavailable snapshot, candidate error and an executed
trade. It wraps after the final symbol and moves past a removed symbol by its
successor. A successful shared-path execution stops the current tick. The next
tick continues with the next asset rather than repeatedly selecting the first
ten. Before every candidate the account, mode and broker object are reverified;
a change aborts the old tick and resets rotation for the next current scope.
The scanner also passes that expected scope into the shared debate function.
Broker/mode binding is checked before its reads, and the returned account/mode
is checked after both the initial and pre-committee portfolio awaits. A newly
selected account cannot inherit the old broker's instrument eligibility during
that handoff. Other debate callers retain their existing behavior.
Only one scope/cursor is retained in process memory. Restart resets cadence and
rotation; there is no cross-process scan lease.

Candidates run sequentially through `runDebateForAsset(asset,'crypto')` without
gate bypasses. Existing snapshot availability, pre-debate screening, provider
admission/budgets, persisted decision authority, unknown-risk rejection, kill
switch, broker mode/account, cash, pending-intent and execution checks remain
authoritative. Existing durable execution claims continue to guard duplicate
submissions across processes. US stock schedules/session policy are unchanged.

The existing crypto snapshot adapter uses Binance.US `ASSETUSDT` candles/ticker;
it is not a fresh executable Alpaca `ASSET/USD` quote. This patch does not add
stock-style broker quote binding, broker-specific quantity-increment sizing, or
new live strategy qualification. The existing live qualification gate can still
block execution. Crypto spot orders and their application-monitored protection
remain subject to existing broker/fill/reconciliation behavior. Instrument
listing is not proof that this account or jurisdiction can submit every pair.
Continuous scanning therefore does not certify live crypto readiness, promise
an order/fill every interval, or establish profitable behavior.

`crypto_scan_observed` emits bounded numeric eligible/attempted/failed/executed
counts without account identifiers, symbols, credentials or provider errors.
Scheduler callback evidence distinguishes cadence, overlap, kill, scope change,
configuration and caught failure. Callback completion is not broker execution.

Offline fixtures invoke the actual registered callback with mocked I/O, exercise
rotation beyond ten assets, candidate errors, sequential admission, overlapping
ticks, arbitrary cadence, kill/config/scope barriers and the real unknown-risk
validator. The actual Axios instrument adapter is tested against disabled,
inactive, malformed and non-USD fixtures. No provider/account request or order is
needed to run these tests in network-isolated CI.

Official asset/pair/order reference:
https://docs.alpaca.markets/us/docs/crypto-trading
