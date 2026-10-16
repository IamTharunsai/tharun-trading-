# Broker execution evidence and inventory reconciliation

This change separates a broker holding observation from the application's execution-derived inventory. It repairs the path where a broker protection leg partly closes a position, sync overwrites Position.quantity but not its Trade lots, and a subsequent close executes before discovering that the two disagree.

## Accounting contract

- Trade entry price and original quantity remain execution/opening-balance evidence. Broker observed quantity/basis have distinct fields. Sync never overwrites existing known execution inventory with a holding snapshot.
- A scoped broker-order identity has one cumulative quantity/notional application cursor and per-lot allocations. Actual protective fills are recovered while a holding still exists. Replayed observations allocate no second execution. All application happens under the same account/symbol PostgreSQL advisory lock as entry/exit claims.
- Replacement orders are followed by documented identity links. Their independent FILL activities establish the actual executions for each ID, rather than adding potentially carried cumulative counters. Original snapshots and activity evidence are retained. Missing or inconsistent evidence remains pending.
- A holding's disappearance or reduced quantity supplies no execution price or realized P&L. Unknown exits remain visible with accountingStatus RECONCILIATION_REQUIRED. Portfolio totals are nullable when inventory/exit/known-fee attribution is incomplete, while knownRealizedPnl and knownUnrealizedPnl preserve recorded evidence, including known losses.
- Order-read transport errors propagate. A 404 is distinct from an unavailable response. Parent reads request nested legs explicitly. `stopped` and `pending_replace` never authorize a new closing attempt; replacement successors must be resolved.
- Before canceling working protection, reconcile actual partial executions and verify inventory. After cancellation, reconcile fills that raced cancellation and verify again. The durable POST claim checks lots, verified broker quantity, evidence version, lifecycle, pending entries and competing exits. An ambiguous POST is recovered by its existing client/order identity, never reposted.

## Fees and provenance

Broker activities are deduplicated by verified account, mode and broker activity ID. Creation-time scans overlap thirty days and page to a fixed bound. This is recent evidence retrieval, **not** historical completeness or fee finality. Unavailable/bounded scans are identified in sync status.

FILL activities corroborate ordinary cumulative order application and provide distinct replacement executions; they are not separately applied a second time. USD fee application requires an explicit broker order identity and USD currency. A directly linked crypto buy fee requires executed fee evidence, a matching USD pair, negative fee quantity and a positive actual fee valuation. Quantity fees consume inventory at its original basis; original entry fills remain unchanged. Fee disposal at basis plus the expense is recorded as the corresponding net result, with actual reported fee valuation retained separately.

An account-level fee with no order identity is preserved as UNATTRIBUTED even if there is only one current local lot. The incomplete local database cannot establish historical fee ownership. Missing currency, late fees that cannot be allocated to remaining inventory, missing allocations, changed activity evidence, unsupported currencies and ambiguous historical intervals retain unknown attribution. No fee rate is guessed. `feeDataComplete` remains false; this PR does not certify all historical net fees.

## Additive rollout

The migration adds separate observation/status fields, zero-default fee counters and new evidence/activity/allocation tables. It changes no existing entry price, original quantity, account identity, realized P&L or legacy scope. New accounting fields default to UNVERIFIED, not reconciled. Railway's existing compatibility preparation plus db push remains supported; isolated CI applies the previous schema, seeds a legacy partial loss, pushes the new schema twice and verifies preservation. No data reset or invented legacy ownership is used.

Fresh imported holdings are explicitly opening balances with historyAvailable false and brokerConfirmed false. Their broker-reported open cost basis is not reconstructed execution history, and they start without a realized P&L value. When a holding appears after a local cycle is closed, sync archives that row's active scope key and creates a distinct OPEN opening-balance position under the account/symbol lock. The original closed Position and its Trade relations, entry evidence and realized results remain intact. The observed exposure therefore participates in portfolio, position limits, research and exit monitoring. A later snapshot never becomes an invented entry execution or reopens the old historical row. Imported history keeps historyDataComplete/accountingComplete false while known recorded results remain available.

Legacy partial-exit proof is consulted only when bootstrapping a missing durable order cursor. Later polls use that cursor even after the wrapper stores a broker-order chain array on PositionExit. The PostgreSQL regression follows the real wrapper through an initial 4-share partial, repeated unchanged polls, a restart at 6 shares and final fill; it does not substitute direct helper calls for the wrapper lifecycle.

## Validation and remaining work

Typed mock regressions cover the $100 partial-protection loss, cumulative averages, replay, excess-fill rollback, replacement counters, actual fee provenance, pre-POST changes, ambiguous responses, stopped orders, broker sync observation separation and unknown portfolio totals. Real PostgreSQL regressions exercise concurrent duplicate application and competing allocations. CI runs application tests inside bounded, nonroot, read-only Docker containers with an empty allowlisted environment and no external network; PostgreSQL shares only a disposable isolated loopback namespace. Local application execution is not part of this change's verification.

Cash-flow-adjusted daily/weekly loss and drawdown controls are a **separate necessary repair**. Current raw equity changes can still classify transfers as trading results. This PR does not claim to repair that finding, the separately identified unscoped history endpoints or reporting-period journal calculations.

No broker account/order/provider calls are made by development checks. Mocks are not live broker proof. Missing historical executions, exact intraday ordering of date-only activities, unsupported corrections/corporate actions, unknown fee linkage and external clients trading between GET and POST remain explicit evidence limits. No local lock can make broker GET+POST atomic against an independent client. Actual historical losses, deployment state and profitability are not established.

Primary broker contracts: [order by ID](https://docs.alpaca.markets/us/reference/getorderbyorderid-1), [order lifecycle/brackets](https://docs.alpaca.markets/us/docs/orders-at-alpaca), [account activities](https://docs.alpaca.markets/us/docs/account-activities), [activity paging/filtering](https://docs.alpaca.markets/us/reference/getaccountactivities-2), [crypto fee handling](https://docs.alpaca.markets/us/docs/crypto-fees).
