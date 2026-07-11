# Backend Intelligence Upgrade — Design

Date: 2026-07-11
Status: Approved by user, ready for implementation planning

## Context

User surveyed 6 external GitHub repos wanting to add "data and thinking power" to the
existing investment-committee debate engine (`debateEngine.ts`, 10 agents, 3 rounds,
Master Coordinator synthesis). Evaluated each on real merit rather than reflexively
integrating all six:

| Repo | Verdict | Reason |
|---|---|---|
| shiyu-coder/Kronos | **Integrate** | Real new capability — pretrained transformer forecasting model, not another LLM wrapper. MIT. |
| tauricresearch/tradingagents | **Port patterns** | Architecturally closest cousin to our own debate engine. Apache-2.0, permissive. Python/LangGraph — port ideas, not code. |
| virattt/dexter | **Port pattern** | TypeScript (matches our stack). Self-validation/iterate-until-confident loop is the reusable idea; its data sources (Financial Datasets API, Exa) are new paid deps we don't need. |
| koala73/worldmonitor | **Idea only, not code** | AGPL-3.0 — embedding its code risks forcing our entire backend open-source, unacceptable for a system modeled to go live with real money. Build the *capability* (geopolitical/macro panel) from our own already-available data instead. |
| HKUDS/AI-Trader | **Skip** | Competing hosted platform (ai4trade.ai), not an embeddable library. Redundant with what we already built. |
| Fincept-Corporation/FinceptTerminal | **Skip (backend); visual reference only (frontend)** | Native Qt6 C++ desktop binary — zero code/asset reuse possible in a Node/TS backend or web frontend. Its Bloomberg-style multi-panel layout is a legitimate look-reference for the separate frontend redesign project, not this one. |

This spec covers only the backend intelligence upgrade. The frontend redesign
(deleting all 14 current screens and rebuilding, drawing visual inspiration from
FinceptTerminal/Bloomberg-terminal aesthetics) is a separate, later design pass —
intentionally sequenced after this one so the new screens are built around real
data these upgrades produce, not placeholders. (This codebase has a documented
history of dashboard panels showing fictional/hardcoded values — see project
memory — so backend-first is a deliberate ordering, not a stall.)

## Architecture

```
Kronos service (new, Python) ──┐
TradingAgents patterns (ported)──┼──► debateEngine.ts (existing, extended) ──► dashboard
dexter validation loop (ported)──┤
Macro Intelligence (new, own data)┘
```

Four independent additions. None fork any of the four source repos' code. None
touch Alpaca order placement, `riskManager.ts`, or `topTraderRules.ts` — this is
additive signal/process quality, not a change to execution or risk gating.

## Component 1 — Kronos Quant Forecaster

- New Railway service (separate from the existing Node backend), Python 3.11 + PyTorch.
- Runs the smallest Kronos variant (Kronos-mini/small from Hugging Face) on CPU —
  no GPU procurement, stays on current infra budget.
- Exposes one internal endpoint, e.g. `POST /forecast { symbol, ohlcv_window }`,
  called from Node the same way other external services are already called
  (axios + the existing `callWithRetry` retry pattern in `debateEngine.ts`).
- Uses Kronos's full predictor pipeline (its own tokenizer, probabilistic sampling,
  batch multi-asset forecasting) — output is a predicted price path + confidence
  band per symbol, not a single collapsed number.
- Becomes **Agent #11 — "Quant Forecaster"** in `AGENT_ROSTER` (`debateEngine.ts:155`):
  own vote/confidence, weighted and calibration-tracked identically to the other
  10 agents via `selfLearning.ts`. Known touch points: `AGENT_ROSTER`, the
  `round1Roster` filter (currently `AGENT_ROSTER.filter(a => a.id !== 10)`,
  written when id 10 = devil's-advocate special case — needs adjusting so
  agent #11 isn't accidentally caught by a filter meant for a different agent),
  round3 result mapping, master-synthesis vote tally, `selfLearning.ts` per-agent
  tracking, and any frontend agent-roster list (currently hardcoded to 10 —
  becomes real data once the frontend redesign lands, but flagged now since
  the roster count changes here first).
- Runs once per debate, same cadence as the other 10 agents — no separate polling loop.

## Component 2 — TradingAgents-pattern upgrades (ported, no new service)

**Crash-recovery checkpointing**: persist each round's results (round1/round2/round3)
to the DB as they complete, not only at debate end. On restart mid-debate (e.g. a
Railway redeploy landing mid-run, the same class of gap behind the missed 9:35 AM
market-open scan), resume from the last completed round instead of re-running
(and re-billing) earlier rounds.

**Regime+symbol-matched lessons**: before round 1, query past debates for the same
symbol *and* a similar market regime (reuses `regimeDetector.ts`'s existing
classification), inject a short "last time this setup occurred, here's what
happened" note into the relevant agents' round-1 prompts. Scoped to matched
symbol+regime, not a global rolling summary — more relevant, and this is what the
user picked when offered the global alternative.

## Component 3 — dexter-pattern self-validation loop

Applies only to the deep-research agents backed by multi-step data gathering
(Fundamental Analyst via `deepAnalysisService.ts`, Macro Economist via
`intermarketService.ts`) — not all 11 agents. After an agent's initial answer, one
additional bounded LLM call (max 2-3 iterations) checks it against its own cited
data for contradictions or staleness before the answer enters round 1. Bounded to
control token cost; user explicitly chose this scope over "every agent, every round."

## Component 4 — Macro Intelligence panel (own data, worldmonitor-inspired only)

Built entirely on data already available in this codebase — no new API vendor:
- Geopolitical events: existing `geopoliticalDataService.ts` (Finnhub/Polygon news)
- Macro indices: existing `intermarketService.ts` (SPY/QQQ/UUP/GLD/USO/VIXY/TLT via
  Alpaca, BTC via CoinGecko)

New dedicated endpoint/data surface exposing this as its own section, rather than
buried only inside the Macro Economist agent's private prompt context. This is
scope the frontend redesign will build a real screen around.

**Explicitly out of scope** (worldmonitor does these, but not realistic on current
API budget): country instability scoring, aviation/military/cyber/infrastructure
tracking — these need specialized paid feeds the project doesn't have. Named
explicitly so this is a deliberate cut, not a silent drop.

## Testing / verification

- Kronos service: standalone health check + a manual forecast call against a known
  symbol, verifying output shape (price path + confidence band) before wiring into
  the debate.
- Agent #11 wiring: run one live debate end-to-end (mirrors how every other agent
  addition in this project has been verified — see project memory's pattern of
  live-dogfooding over unit tests for this system) and confirm Quant Forecaster
  appears with a real vote, not a fallback/error placeholder.
- Checkpoint/resume: force-kill the backend mid-debate in a non-prod test run,
  confirm resume picks up from the last persisted round rather than restarting
  round 1.
- Lessons injection: confirm a debate on a symbol with prior history actually
  includes the past-outcome note in the prompt sent to the model (log the
  assembled prompt once to verify, not just that the DB query returns rows).
- Macro panel: confirm the new endpoint returns real (non-hardcoded) data by
  cross-checking one value against the existing `intermarketService.ts` output.
