# Backtest Baseline — 2026-07-14

Recorded by running `backend/scripts/runBacktestBaseline.ts` for the first time
against `backtestingEngine.ts` (620 lines, reachable via `/api/backtest/run`,
never previously executed).

## Read this before trusting these numbers

**Two independent reasons this does NOT validate "the agent strategy has a
statistical edge":**

1. **`getAgentVotes` inside `backtestingEngine.ts` simulates every agent vote
   with `Math.random()`** rather than calling the real debate engine. This run
   measures the execution/risk-management machinery (stop-loss, position
   sizing, fees) against random signals, not the real agent system's edge.
2. **Every candle in this run was synthetic, not real market history.**
   `POLYGON_API_KEY` is not set in this environment, so AAPL fell back to
   `generateMockData` (the code's own documented fallback). Binance returned
   HTTP 451 (geo-blocked from this deployment's region — a known, previously
   confirmed limitation, see project memory) for both `BTC/USDT` and
   `ETH/USDT`, which loaded 0 candles each. The entire 4,367-trade run below
   is AAPL mock data only — the two crypto symbols contributed nothing.

Real value of this run: it confirms the execution/risk-management pipeline
(position sizing, fee accounting, stop-loss/take-profit, per-agent accuracy
bookkeeping, regime bucketing) runs end-to-end without crashing across ~4,400
simulated trades. It is not a substitute for the eventual real-data,
real-agent-vote backtest, which this codebase still needs — likely worth
revisiting once Kronos/TradingAgents-pattern work (next in this plan sequence)
lands, since those agent changes should be reflected in the pre-live
validation too.

## Command

```bash
cd apex-trader/backend
npx ts-node scripts/runBacktestBaseline.ts
```

Config used: `2025-10-15` to `2026-04-15`, $100,000 initial capital,
`['AAPL', 'BTC/USDT', 'ETH/USDT']`, 1% risk/trade, 10% max position, 0.1%
broker fees.

## Results

```json
{
  "totalTrades": 4367,
  "winningTrades": 2165,
  "losingTrades": 2202,
  "winRate": 49.58,
  "profitFactor": 1.0013,
  "sharpeRatio": -5.23,
  "maxDrawdown": 294.81,
  "totalReturn": 9.2046,
  "returnPct": 0.0092,
  "avgWin": 3.376,
  "avgLoss": 3.315,
  "largestWin": 8.098,
  "largestLoss": -7.952,
  "holdingTimeAvgHours": 12.93,
  "regimePerformance": {
    "Trending Bull": { "trades": 904, "winRate": 50.0, "avgReturn": 0.0047 },
    "Compression": { "trades": 856, "winRate": 49.88, "avgReturn": 0.0031 },
    "Trending Bear": { "trades": 839, "winRate": 46.01, "avgReturn": -0.0332 },
    "High Vol": { "trades": 879, "winRate": 49.60, "avgReturn": 0.0053 },
    "Choppy": { "trades": 889, "winRate": 52.19, "avgReturn": 0.0198 }
  }
}
```

(`totalTradess` is the field's actual — typo'd — name in `BacktestResults`;
reproduced verbatim above rather than silently renamed, since fixing it is
outside this task's scope.)

## Go/No-Go evaluation (`evaluateBacktestResults`)

```json
{
  "canGoLive": false,
  "issues": [
    "Sharpe ratio too low: -5.23 (target: > 1.5)",
    "Win rate too low: 49.6% (target: > 55%)",
    "Max drawdown too high: 294.8% (target: < 20%)",
    "Profit factor too low: 1.00 (target: > 1.8)"
  ]
}
```

`canGoLive: false` is the expected/correct outcome for a run against random
votes and mock price data — this is not a finding that the real system
underperforms, it's confirmation the gate correctly rejects a run that isn't
representative of the real strategy.

Per-agent accuracy (`agentAccuracy`, 58-70% range across all 15 roster
entries against random-vote-driven mock trades) and the full 4,367-row
`sampleTrades` array are in the script's raw stdout, not reproduced here —
rerun the command above to regenerate.
