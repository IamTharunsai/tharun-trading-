# Linked live reductions: implementation boundary

Source base: `3e1259538ff8b67c915446e98c833a7ba4b14dbe`. This slice does not enable scanner dispatch, add a route, create qualification, or change live flags.

## Contracts and invariants

Official contracts checked 2026-10-20: [create order](https://docs.polymarket.us/api-reference/orders/create-order) supports SELL_LONG/SELL_SHORT, limit IOC and decimal contract quantity; [get order](https://docs.polymarket.us/api-reference/orders/get-order) supplies cumulative quantity, average YES price and collected commission. The all-position close endpoint is deliberately not used.

The [official order overview price rules](https://docs.polymarket.us/api-reference/orders/overview#understanding-price-with-order-intent) explicitly show SELL_SHORT at economic NO .83 using YES `price.value` .17. The NO reduction fixture uses .20 YES average as .80 economic NO proceeds; it checks both that conversion and an economic NO minimum-price violation. Quantity is aligned to market minimum precision before any POST, as required in the overview's quantity/tick section. Existing opening evidence parsing is unchanged.

1. A holding freezes one terminal opening execution's quantity, notional, collected fees, owner, grant and qualification ID. Its remaining quantity/basis is derived from linked cumulative reduction observations; the opening Trade remains immutable basis evidence.
2. A reduction is authorized only against exact current broker quantity equal to the bot's remaining holding. Manual additions, removals, open orders, pending opening submissions, unknown commission, credential/owner changes, and stale snapshots prevent submission. Current grant/owner locks and generation fencing serialize claims and final submission. Entry halt or expired opening qualification does not prohibit a proven reduction.
3. Each durable claim can consume PREPARING once. A POST without a saved valid ACK is uncertain and never retried. Known IDs recover through strict order reads independently of entry flags.
4. SELL_LONG realizes YES proceeds at avgPx; SELL_SHORT realizes NO proceeds at 1-avgPx. Sale proceeds must meet the outcome price floor, including every incremental cumulative fill. No ACK or cancellation intent books a fill.
5. Quantity and proceeds may be observed while commission is unknown, but realized P&L remains null and the claim remains unresolved. Opening fees/basis are allocated proportionally exactly once; cumulative replay cannot double count quantity, fees or loss.
6. This slice records local linked order accounting, not complete account realized P&L. New entry after a reduction remains blocked until settlement/activity/loss coverage is independently established. No reduction result creates or renews qualification.
7. Public resolution, a missing position, or guessed activity correspondence never closes a holding. Settlement, correction/rebate semantics and account-wide historical coverage remain explicit next work.

## Validation required

Network-disabled unit fixtures cover fractional YES/NO sales, identity/action mismatch, price floors, replay, regression, missing/late commission and basis conservation. Disposable PostgreSQL fixtures cover actual transactions, retained storage, linked recovery, competing claims and loss/qualification custody. Tests must execute in the existing isolated CI sandbox; defining them is not passing evidence. No target code is executed on the host.
