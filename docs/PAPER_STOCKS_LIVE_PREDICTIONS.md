# Paper stocks alongside live predictions

Alpaca stock/crypto routing can be explicitly restricted to paper with
`ALPACA_TRADING_MODE=paper`. This remains paper even if the shared live mode is
confirmed and stock live credentials are subsequently configured. Account
bootstrap and the trading broker both consult the same gate.

The override is an additional restriction. Setting it to `live` still requires
all existing global mode, exact confirmation and Alpaca live credential checks.
An explicitly empty or invalid override stays paper; it cannot fall back to
global live. Leaving the override absent preserves previous behavior.

The intended personal configuration is paper Alpaca stocks/crypto and separately
qualified live Polymarket. Polymarket's confirmation, kill switch, API grant,
strategy qualification, risk, execution and reconciliation checks remain
unchanged. A mode setting alone does not connect its currently simulated scan
to real orders or establish complete lifecycle readiness.

This change does not set production variables, create qualifications, submit
orders, or certify profitability. Release and operating verification are still
required before activation. Gate-matrix and actual broker-factory fixtures run
in the existing strict, network-isolated stock-entry CI job.
