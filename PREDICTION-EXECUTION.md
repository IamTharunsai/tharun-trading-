# Polymarket US execution foundation

This change provides a callable live execution foundation. The existing scheduled US scanner still simulates orders. No route or scheduler invokes this foundation yet. Live flags, credentials and financial orders are not changed by this PR. Runtime integrations and exit/settlement reconciliation remain follow-up work; see [the complete reference map](REFERENCE-INTEGRATIONS.md).

The separately implemented legacy greed engine also remains in the repository. Retiring its alternate order transport and replacing activation/status wiring are prerequisites for a live rollout. This foundation does not certify every historical order path as consolidated.

The writer requires a persisted US prediction, an owner, a current strategy/version qualification bound to the configured API grant, fresh account/position/open-order evidence, a fresh executable book, exchange-provided fees/tick/minimum, stored risk limits and the shared live gate. Missing evidence refuses execution.

A unique prediction claim is committed before submission. Account generations change with claims and confirmed ledger mutations; a snapshot collected before another mutation cannot authorize a new claim. Confirmed local holdings must be reflected in broker positions. The final writer refreshes all account sections, validates the admission under the account lock, consumes the claim and sends one IOC create request. Acknowledgement is not a fill. Reconciliation checks order identity, outcome, size, cumulative quantity, average price and collected commission before creating/updating an OPEN live Trade.

An uncertain create retains its reservation and blocks further entries. The documented public create contract has no client-order identifier, so automatically repeating an unknown POST is unsafe. Acknowledged order identifiers are logged before the database acknowledgement write for operator recovery. Recovery still requires owner-authorized evidence and no guessed matching. Canceled partial fills retain only their verified filled quantity; repeated cumulative evidence does not apply a second fill.

Sizing uses available cash as a conservative denominator, not entry cost presented as marked account equity. Outstanding binary contracts reserve a conservative $1 each. Fee-inclusive reservations round upward to cents. With $10 cash and a 3% risk budget, a $0.50 minimum contract cannot be purchased within the $0.30 budget. A forecast alone cannot override this arithmetic or prove an edge. Risk settings are not relaxed automatically.

Submission admission and the external provider do not share a transaction. Qualification/time/gate/credential checks occur synchronously after database admission commits and immediately before POST. Database revocation cannot be atomic with the broker; external/manual writers and other API grants also cannot be serialized by this local grant lock. Operational exclusivity, cancel/recovery handling and provider-origin contract tests remain requirements before enabling scheduled live execution. The grant digest is not asserted to be the broker's account identifier.

The additive migration enables RLS on the two new tables. Railway currently uses guarded `db push`, which creates the models but does not apply checked-in RLS SQL. Policy rollout and least-privilege database verification remain deployment work. Historical trades and positions are not reset or assigned fabricated account scope.

Primary provider contracts used:

- [US order and YES/NO conventions](https://docs.polymarket.us/concepts/orders).
- [US authentication](https://docs.polymarket.us/api-reference/authentication): timestamp + method + pathname signed with Ed25519; response transport has one request, rejects redirects and bounds body/time.
- [US fees](https://docs.polymarket.us/fees): standard coefficient formula, per-market differences and cumulative commission rounding. This adapter currently assumes standard binary markets; combo contracts require separate qualification and fee support.
- [US portfolio pagination](https://docs.polymarket.us/api-reference/portfolio/get-user-positions).

Mocked provider and database tests establish local behavior only. CI additionally exercises actual PostgreSQL locks, durable claims and schema compatibility using a disposable database. These checks do not certify live write permissions, a complete exchange fill/commission contract, forecast calibration, returns, or live readiness. No valid production Polymarket qualification has been established.
