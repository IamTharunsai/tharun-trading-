# Paper trading rebuild — evidence and remaining requirements

Updated 2026-09-23. Goal remains active. This is not a production-readiness claim.

## Authoritative scope

User requested a complete remodel using both references and subsequently specified **paper trading only**.

- [APEX-3 master document](https://claude.ai/artifact/GYktaUjZmF56QX9cY9Mdxy): fully read through the browser on 2026-09-23.
- [APEX-Infinity architecture](https://claude.ai/artifact/QR8KvDBXJdUYkD4Y9Y4DPZ): fully read through the browser on 2026-09-23.
- Main repository: `apex-trader`, an existing Git repository. Sibling folders contain partial upgrades, not the runnable application.
- Earlier completion reports and root PROGRESS.md were contradicted by inspection; do not rely on them as verification.

The references contain conflicting capital thresholds, consensus rules, cost assumptions and aspirational performance figures. APEX-3 specifies 25 agents (15 code, 8 Ollama, 2 cloud); Infinity specifies 27 research roles including three adversarial reviewers. Existing survivalEngine uses an Infinity-inspired $100 CRITICAL / $300 CAUTION / $500 NORMAL policy, not APEX-3's $100 NORMAL thresholds. This conflict still requires a documented final product policy. Return targets and claimed model accuracy are hypotheses, not achieved performance.

## Verified changes this pass

- Fixed backend Windows build command (local Prisma and TypeScript executables).
- Added paper-only configuration validation at startup, execution and broker construction. Explicit live mode or non-paper Alpaca URL fails closed.
- Fixed stock exits: actual opposite-side paper order, confirmed fill price/quantity, stable client order ID for retry/restart recovery, concurrent local close coalescing, atomic local trade/position completion.
- No longer accepts client-supplied close prices or substitutes entry price for a missing simulation quote.
- Capped submitted quantity by committee allocation, cash reserve, configured concentration and survival risk. Fractional longs are no longer rounded up to a whole share; fractional short openings are rounded down.
- Reject malformed broker fill prices/quantities.
- Force-trade endpoint no longer reports success when execution returns false.
- Corrected neutral-indicator treatment, short stop/target direction, weekday/DST-aware 09:45–15:45 ET entry window. Exchange holidays/early closes still need broker-calendar validation.
- Redis connection moved out of import side effects into server startup.
- Isolated the existing learner unit test from the deployed model file. Restored the exact pre-test model content after discovering the previous test saved synthetic outcomes into it. Existing model provenance is still unverified.

## Runtime evidence

### September 24 update

- Isolated API now runs on loopback port 4100 (`npm run start:paper-local`), with background jobs explicitly disabled. Smoke checks exercise HTTP health, authentication rejection, real login and pending/confirmed entry separation; temporary test user/trade rows are cleaned up. Current API session: 69982; database session: 11503.
- Dashboard now queries backend runtime status instead of assuming trading is active from a client default, and includes a pending paper-entry panel. Both builds pass; rendered visual verification and remaining screen redesign are still pending. API smoke script: `node scripts/verifyLocalApi.mjs` with local API running.

- Backend and frontend builds pass; 29 suites / 140 tests pass.
- Durable pending entries now reserve capital before submission, use stable client IDs, recover ambiguous submissions and atomically confirm fills. Broker clock/asset checks cover holidays, early closes and short/fractional eligibility. UI distinguishes pending from filled entries.
- Added isolated, loopback-only PostgreSQL 18 for local validation (`npm run db:paper-local` in backend); cloud `.env` is unchanged. Local credentials/data are ignored by Git.
- `npm run test:paper-local` rebuilds and exercises real PostgreSQL: eight competing fill observations produce one position; replay cannot resurrect a closed position; conflicting position updates roll back the trade confirmation; six concurrent transactions serialize through the reservation advisory lock. All passed; test-owned rows removed afterward.
- Local database remains running in session 11503. No application server, scheduler or broker test orders started. Full broker-backed end-to-end verification remains pending.
- Remaining lifecycle gaps: indefinite reservations when submission never happened or broker lookup stays unresolved, legacy orphan fills, pending exits, and account-wide position reconciliation. Partial entry fills request cancellation and become positions only after terminal broker confirmation.
- The matrix below remains a full-completion checklist; its earlier entry-timeout and database-unavailable descriptions are superseded by this update, not evidence that those rows are complete.

- Backend and frontend builds passed. Frontend has bundle-size and configuration warnings.
- Initial suite: 22 suites / 73 tests passed, but Redis emitted errors after tests finished.
- Expanded suite: **26 suites / 110 tests passed**. Covers paper-mode configuration, stock exit retries/rejections/concurrency, fill validation, allocation limits, signal direction and session boundaries. No post-test Redis logging errors.
- Read-only Alpaca **paper** account request returned HTTP 200, ACTIVE, trading_blocked=false.
- Configured PostgreSQL connection failed with Prisma P1001 (server unreachable). Credentials are present; do not ask user to paste keys into chat.
- Docker is installed, but the Linux engine was unavailable. `docker desktop start` was launched (session 52908); it was still running without output at last check. Re-poll that handle or inspect Docker/process state before assuming failure or restarting.
- No application server, scheduler, live mode, or paper test order was started in this pass. All new execution tests use broker mocks. Broker-backed end-to-end verification is still required.

## Full completion matrix

| Requirement | Current evidence / next work | Completion |
|---|---|---|
| Complete runnable system, one-command startup | Node/React builds work; database unavailable; existing Compose only starts PostgreSQL/Redis | Incomplete |
| Python/FastAPI, TimescaleDB, Redis/Celery stack in APEX-3 | Current app is Express/Prisma/PostgreSQL; Kronos Python service exists. Migration or documented architecture reconciliation remains | Unverified |
| Fifteen genuine rule agents | tier1Agents.ts has 15 entries, but several copy the technical vote or defer analysis; correlation/news/Kelly/regime must supply real evidence | Incomplete |
| Eight local LLM agents | Ollama client exists; current debate's skipLlm logic is based on cloud availability and does not demonstrate the full eight-agent tier | Incomplete |
| Two cloud agents and spend control | Existing debate has eleven cloud-style roles, budget estimates and memory fallback; atomic budget reservation and per-call coverage not verified | Incomplete |
| 12-stage signal→debate→risk→execute→exit→learn→journal flow | Modules exist; no complete runtime trace yet | Incomplete |
| Paper stock order lifecycle | Exit faults fixed in unit tests; entry polling timeout still marks uncertain orders FAILED; durable entry reconciliation/idempotency remains | Incomplete |
| Position and portfolio accounting | Existing local/broker calculations mix sources; reconcile holdings, pending orders, prediction collateral, fees, cash and P&L | Incomplete |
| Risk controls | Basic checks exist; persistent kill switch, correlated exposure, calendar, stale-price gates, slippage, partial fills, pending orders and concurrent entry limits require verification | Incomplete |
| Capital survival modes | Existing policy conflicts with APEX-3 thresholds; recovery behavior and zero-risk reporting need reconciliation; stress tests required | Incomplete |
| Polymarket paper trading | Probability/scanner/resolution modules exist; audit data-backed base rates, fees, bid/ask depths, resolution criteria, duplicates and persistence failures | Incomplete |
| 50-feature online learner plus LightGBM | TS SGD stand-in exists; no verified sklearn/LightGBM ensemble; synthetic test contamination fixed, production provenance and outcome replay still need audit | Incomplete |
| Agent weights, calibrated probabilities and promotion gates | Helper modules exist; needs measured per-agent accuracy, sample counts, out-of-sample evaluation and enforcement | Incomplete |
| SEC 8-K, 10-K risk delta, Form 4, 13D/G, MD&A | Research tick fetches counts; prove parsed evidence reaches decision context with timestamps and provenance | Incomplete |
| Earnings Whisper + FinBERT pipeline | Text phrase scoring exists; no verified live transcription/model pipeline | Incomplete |
| Pattern CNN | File explicitly named patternCnnHeuristic; not proof of trained CNN. Requires dataset, trained model, held-out metrics and inference wiring | Incomplete |
| Multi-timeframe, volume, options/dark-pool signals | Helpers exist; prove real 1h/4h/daily inputs and source access; unavailable feeds must be marked unavailable | Incomplete |
| Alternative data: hiring, trends, apps, GitHub, Reddit, supply chain, traffic, patents | Partial helper functions; historical baselines, source access and agent integration unverified | Incomplete |
| Bayesian synthesis, EV, Kelly, three devils, final master | Helper modules exist; validate units, dependence assumptions, calibration and hard execution gates | Incomplete |
| Full dashboard remodel | Existing React screens build. Reference KPI tiles, equity/drawdown, agent tiers, capital mode, spend, accuracy, Polymarket feed, sector heatmap and socket consistency need full audit and implementation | Incomplete |
| Backtesting, load/stress testing | Existing baseline doc is not proof of the remodeled system. Replay full pipeline on historical data, test 100 concurrent signals, stress CRASH/REBIRTH and publish metrics | Incomplete |
| Prometheus/Grafana and operational alerts | Not verified; notification delivery requires explicit user authorization | Incomplete |
| Two-week paper observation / 50 paper trades and calibration history | Not achieved by mocked tests; cannot claim longitudinal results without actual observed data | Incomplete |
| Live money, wallet funding, live activation | Explicitly excluded by user clarification | Out of scope |

## Next execution order

1. Revalidate Docker start and database reachability; create isolated local test database without overwriting cloud configuration or trading history.
2. Finish durable entry/order reconciliation and broker-calendar checks. Exercise actual paper entry→fill→exit→P&L against the active paper account with local test persistence.
3. Audit and implement the full 15/8/2 pipeline and 27-role research evidence layer, with explicit missing-data behavior and per-call budget gates.
4. Replace fabricated features/probabilities and untrained-model claims with genuine data/model implementations, training provenance and measured calibration.
5. Remodel dashboard around truthful API data and complete runtime observability/backtests/stress tests.
6. Audit every row against runtime evidence; keep goal active until the requested system is fully implemented and verified.

Broker implementation research: [Alpaca fractional orders](https://docs.alpaca.markets/us/docs/fractional-trading), [order lifecycle](https://docs.alpaca.markets/us/docs/orders-at-alpaca). Paper fills demonstrate integration, not live execution quality or profitability.
