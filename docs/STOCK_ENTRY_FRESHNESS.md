# Stock ENTRY source and pre-submit quote boundary

This change depends on the actual on-demand stock-history/snapshot repair. It addresses a different boundary: an assembled research snapshot is not a newly observed exchange quote and must not authorize orders solely because assembly happened recently. Existing immutable decision/plan identity, risk, account, kill, qualification, claim, fill and recovery guards remain enabled.

## Executable semantics

For stocks, ENTRY committee admission requires finite Alpaca IEX trade and quote source timestamps from the snapshot's evidence metadata, at least200 completed history bars, and a separately recorded receipt time. The same source checks run again at approval and persisted authority validation. Legacy stock decisions without provenance are refused rather than assigned a new observation time. RESEARCH and POSITION_REVIEW may use the existing dated historical evidence; neither acquires ENTRY authority.

The submission path captures the same broker object and complete credential pair selected by the shared mode/Settings resolver. It rereads an exact-symbol quote from the fixed official data endpoint before sizing, and a second time after claim plus decision/account/risk/qualification revalidation. Every read checks binding before and after await. Mode, secret-only rotation, account identity changes, malformed responses, timeouts and missing/stale observations produce a bounded refusal code; credentials/request/response bodies are not logged by this adapter.

The quote uses ask for BUY and bid for SELL. Price movement, spread, timestamp age/future allowance, unchanged stop/target ordering and minimum2:1 reward/risk are checked against the actual protection levels the existing order builder will send (including its rounding). Quantity may only decrease from the original allocation: both observed notional and observed stop-dollar risk must fit the approved original budgets. The persisted plan's entry/stop/target are not rewritten. After claim, further movement or reduced available allocation is refused rather than repricing the intent or changing quantity again.

The final quote is checked after all asynchronous guards. Immediately before the financial call, source/decision age, quote age/geometry/budgets, current binding, kill state, current scoped risk evidence age/identity and live qualification are rechecked without an intervening await before createOrder. Current risk policy is revalidated after the last quote await. Account/risk/qualification reads remain observations, not an atomic transaction with an external broker or a guarantee against all cross-symbol/external account changes.

If a durable claim exists but this worker has provably not called createOrder, refusal conditionally moves only that still-SUBMITTING/no-broker-order claim to TERMINAL_UNFILLED. A concurrently recovered/submitted claim cannot be reset. Once submission begins, ambiguous outcomes retain the existing reconciliation path. Pending intents are never resubmitted, and the unique decision/client identifiers still prevent duplicate submission. Existing restart read-recovery applies actual broker evidence without demanding a new quote for already submitted fills.

## Bounded policy

| Setting | Default | Accepted range |
|---|---:|---:|
| STOCK_ENTRY_SOURCE_MAX_AGE_MS | 300000 | 1000–300000 |
| STOCK_ENTRY_QUOTE_MAX_AGE_MS | 3000 | 1–10000 |
| STOCK_ENTRY_MAX_DEVIATION_BPS | 50 | 0.01–100 |
| STOCK_ENTRY_MAX_SPREAD_BPS | 50 | 0.01–100 |
| STOCK_ENTRY_CLOCK_SKEW_MS | 500 | 0–1000 |

Invalid/nonfinite/out-of-range values refuse ENTRY. No environment values, live flags, settings or schedules are changed by this PR. The2:1 minimum matches existing top-trader LAW3; protections are never widened to fit a quote. Defaults are conservative admission policy, not a profitability guarantee or measured market-specific optimum.

## Provenance and explicit limits

Initial research source provenance is persisted in the decision's marketSnapshot. The final pre-submit quote is validated in memory in this first focused patch; it does not add a durable final-quote audit trail, overwrite the immutable execution plan, or repurpose broker-only state fields. Durable per-attempt pre-submit observations require a separate reviewed additive schema follow-up. Do not claim fully audited pre-submit evidence from this guard alone.

The [official latest stock quote contract](https://docs.alpaca.markets/us/v1.4.2/reference/stocklatestquotesingle-1) defines the exact-symbol endpoint and feed choice. This adapter explicitly requests IEX/USD using the selected broker account's credentials. IEX is venue-scoped; it is not full-market SIP/NBBO, a liquidity/depth guarantee, or a guarantee a market order fills at the observed bid/ask. Observed price checks do not impose a broker-enforced fill-price cap; actual fills, slippage, partials and fees remain broker-evidence accounting. A limit-order policy would be a separate change to execution behavior.

The stock guard intentionally does not assign timestamps to the existing Binance crypto path. Crypto remains outside this source/quote freshness certification and needs actual broker crypto bars/trades/quotes with symbol/currency, location, timestamp and credential/account binding before extending the market-specific adapters. The pure policy and separate transport module allow that extension without pretending stock1Day evidence applies to crypto.

Validation is exact-head strict offline Docker CI with mocked providers/accounts: source/decision authority, real committee historical-research separation and mid-research expiry, current quote timing/malformed/future/clock/rotation cases, price/stop/target/reward-risk and downward-only sizing, post-claim final guard failures, concurrent decision claim, partial/ambiguous recovery and no duplicate orders. No host target imports/tests, actual providers/brokers/accounts or money changes are used. No production historical-loss cause, current trading availability or paper/live qualification is certified by mocks.
