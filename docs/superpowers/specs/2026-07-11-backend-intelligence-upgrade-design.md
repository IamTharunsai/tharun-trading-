# Backend Intelligence Upgrade — Design

Date: 2026-07-11 (revised same day after a second round of scoping)
Status: Approved by user, ready for implementation planning

## Context

User surveyed 6 external GitHub repos (later expanded to 17 when a separate global
skill-install pass also cloned worldmonitor, FinceptTerminal, headroom, remotion,
open-generative-ai locally) wanting to add real "data and thinking power" to the
existing investment-committee debate engine (`debateEngine.ts`, 10 agents, 3 rounds,
Master Coordinator synthesis) — not a superficial integration.

### Per-repo verdict (revised after reading full license texts, not summaries)

| Repo | License | Verdict | Reason |
|---|---|---|---|
| shiyu-coder/Kronos | MIT | **Full code reuse** | Real new capability — pretrained transformer forecasting model, not another LLM wrapper. |
| tauricresearch/tradingagents | Apache-2.0 | **Deep logic/code reuse, ported to TS** | Permissive license explicitly allows literal code reuse, not just pattern-borrowing. Architecturally closest cousin to our own debate engine — mine actual prompt structures and decision logic, not just the concept of "a debate." |
| virattt/dexter | MIT | **Deep logic/code reuse, ported to TS** | MIT + already TypeScript (matches our stack exactly) — can adapt real implementation, not just the idea. |
| HKUDS/AI-Trader | MIT | **Mine specific modules, not the whole platform** | Permissive, but it's a competing hosted platform (ai4trade.ai) largely redundant with what we've built. Real value: broker-sync abstraction patterns and its variant/experiment scoring mechanism — worth extracting as an agent-config A/B-testing capability we don't currently have. |
| koala73/worldmonitor | AGPL-3.0 | **No code copied; study + reimplement in our own code** | Read the actual license text: commercial/internal use is permitted under AGPL, but a *modified* deployment must offer its source to users who interact with it over the network — a real (if smaller) exposure once this is more than single-user, which is the stated direction. Its official SDK clients (npm/Python/Ruby/Go) are deliberately MIT-licensed for embedding — usable if we ever consume a hosted worldmonitor API. Server/dashboard source itself: read for architecture and analysis-logic understanding, reimplement equivalent in our own code, never paste their files. |
| Fincept-Corporation/FinceptTerminal | AGPL-3.0 + Commercial | **No code copied; study + reimplement in our own code** | Its own license text explicitly names "pre-revenue/pre-product startups" as requiring the paid commercial license — this is not a personal-use gray area for a platform whose stated goal is to become "the best platform." Enforcement is unusually aggressive (named $50k-250k liquidated damages, 18% backdated interest, active repo monitoring, criminal-complaint language). Native Qt6 C++ besides, so no code would even run in our Node/TS or web stack regardless of license. Read for dashboard layout, analysis modules, and chart/graph approach; reimplement in our own code. |

**The legal boundary, stated plainly once:** reading any of these repos' source to
understand their analysis logic, chart/graph types, or dashboard architecture is not
a license violation for any of them — copyright protects the literal code text, not
the ideas or algorithms you learn from reading it. The only thing off-limits (for
worldmonitor and FinceptTerminal specifically) is copying their actual source files
into this codebase. Kronos, TradingAgents, dexter, and AI-Trader's permissive
licenses mean literal code/logic reuse from those four is fully fine.

This spec covers only the backend intelligence upgrade. The frontend redesign
(deleting all current screens and rebuilding, drawing visual inspiration from
FinceptTerminal/Bloomberg-terminal dashboard layouts and worldmonitor's data
presentation — never their code) is a separate, later design pass — intentionally
sequenced after this one so the new screens are built around real data these
upgrades produce, not placeholders. (This codebase has a documented history of
dashboard panels showing fictional/hardcoded values — see project memory — so
backend-first is a deliberate ordering, not a stall.)

## Architecture

```
Kronos service (new, Python) ─────────────┐
TradingAgents logic (ported to TS) ───────┤
dexter logic (ported to TS) ──────────────┼──► debateEngine.ts (existing, extended) ──► dashboard
AI-Trader modules (mined, ported) ────────┤
Macro Intelligence (new, own data+logic) ─┘

Day-Trading Pipeline (new, parallel) ──────────► own debate loop + PDT counter ──► dashboard
```

Five components. No files copied from worldmonitor or FinceptTerminal. None touch
Alpaca order placement, `riskManager.ts`, or `topTraderRules.ts` directly — this is
additive signal/process quality plus one new parallel pipeline, not a change to the
existing execution or risk-gating logic itself.

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
  tracking, and any frontend agent-roster list (currently hardcoded to 10).
- Runs once per debate, same cadence as the other 10 agents — no separate polling loop.

## Component 2 — TradingAgents logic, ported (not just patterned)

Since Apache-2.0 permits literal reuse, go beyond architecture-borrowing:

- **Compare actual analyst prompts/logic** — TradingAgents' Fundamentals/Sentiment/
  News/Technical analyst implementations — against our existing 10 agents. Where
  TradingAgents' concrete approach (specific indicator combinations, specific
  sentiment-source weighting) is genuinely stronger, port that logic directly into
  the corresponding existing agent's prompt/reasoning, not just the surrounding
  debate wrapper.
- **Bull/Bear Researcher dynamic** — check for gaps against our existing devil's-
  advocate agent (id 10); adopt any debate dynamic we're missing.
- **Crash-recovery checkpointing**: persist each round's results (round1/round2/round3)
  to the DB as they complete, not only at debate end. On restart mid-debate (e.g. a
  Railway redeploy landing mid-run, the same class of gap behind the missed 9:35 AM
  market-open scan), resume from the last completed round instead of re-running
  (and re-billing) earlier rounds.
- **Regime+symbol-matched lessons**: before round 1, query past debates for the same
  symbol *and* a similar market regime (reuses `regimeDetector.ts`'s existing
  classification), inject a short "last time this setup occurred, here's what
  happened" note into the relevant agents' round-1 prompts. Scoped to matched
  symbol+regime, not a global rolling summary.

## Component 3 — dexter logic, ported (not just patterned)

MIT + already TypeScript, so adapt real implementation, not just the idea:

- **Task decomposition/planning logic** for complex research questions — how dexter
  breaks a financial question into a structured research plan — adapted for our
  deep-research agents' multi-step data gathering.
- **Self-validation loop**, applied only to the deep-research agents backed by
  multi-step data gathering (Fundamental Analyst via `deepAnalysisService.ts`, Macro
  Economist via `intermarketService.ts`) — not all 11 agents. After an agent's
  initial answer, one additional bounded LLM call (max 2-3 iterations) checks it
  against its own cited data for contradictions or staleness before the answer
  enters round 1. Bounded to control token cost — user explicitly chose this scope
  over "every agent, every round."

## Component 4 — AI-Trader modules, mined (not the platform)

MIT, but AI-Trader-the-platform is redundant with what's already built. Extract two
specific internal mechanisms instead of the whole thing:

- **Broker-sync abstraction pattern** — how it structures adding a new broker
  (Binance, Coinbase, Interactive Brokers) — evaluate as a reusable shape for future
  broker additions beyond Alpaca/Polymarket, without adopting its actual platform.
- **Variant/experiment scoring** — its mechanism for tracking performance across
  different strategy variants — adapt into an agent-config A/B-testing capability
  (comparing whether an agent-weighting or prompt change actually improves outcomes
  over time), which the current system doesn't have.

## Component 5 — Macro Intelligence panel (own data + reimplemented logic)

Built entirely on data already available in this codebase — no new API vendor:
- Geopolitical events: existing `geopoliticalDataService.ts` (Finnhub/Polygon news)
- Macro indices: existing `intermarketService.ts` (SPY/QQQ/UUP/GLD/USO/VIXY/TLT via
  Alpaca, BTC via CoinGecko)

New dedicated endpoint/data surface exposing this as its own section, rather than
buried only inside the Macro Economist agent's private prompt context. Study
worldmonitor's and FinceptTerminal's actual dashboard/analysis modules for how they
structure and present this class of data, and reimplement an equivalent (or better)
version in our own code — no files copied from either.

**Explicitly out of scope** (both repos do these, but not realistic on current API
budget): country instability scoring, aviation/military/cyber/infrastructure
tracking — these need specialized paid feeds the project doesn't have. This was a
deliberate scope cut made earlier in this same design session, not silently dropped
— confirm before re-adding if priorities change.

## Component 6 — Day-Trading Pipeline (new, parallel to the existing swing engine)

A separate, previously-deferred piece of scope, now folded in:

- **Separate parallel pipeline**: its own faster-cadence scan loop (e.g. 1-5 minute
  bars, VWAP / opening-range-breakout style logic), its own agent debate instance —
  not a mode-switch on the existing swing/position debate engine. A symbol can run
  in both simultaneously with independent entries/exits. Chosen specifically to
  avoid any risk of destabilizing the existing, already-working swing engine.
- **Own risk rules**, distinct from the existing 2-3% swing stop-loss and ATR-based
  sizing: tighter, timeframe-appropriate stops suited to intraday moves.
- **Pattern Day Trader (PDT) rule compliance built now, not deferred**: a rolling
  5-business-day day-trade counter enforced even while still on paper trading. This
  is a real SEC regulation (>3 day trades in 5 business days requires $25k minimum
  equity on a margin account), not a style choice — building the counter now, before
  any live-money connection, avoids a genuine regulatory violation later. Paper
  trading doesn't require this today, but retrofitting it after the fact (rather
  than before real money connects) is the wrong order.

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
- AI-Trader variant scoring: run two agent-config variants side by side on the same
  symbol/window, confirm the scoring mechanism actually differentiates them.
- Day-trading pipeline: confirm it runs independently of the swing engine (kill one,
  the other keeps running); confirm the PDT counter blocks a 4th day-trade within a
  rolling 5-business-day window in a test scenario.

## Out of scope, noted explicitly (not silently dropped)

- Trimming the 534 globally-installed Claude Code skills (most unrelated to this
  project — ruflo's 269, OmniRoute's 44, etc.) — user's call was to leave all
  installed as-is. Revisit if skill-triggering noise becomes a real problem.
- Literal file-copying from worldmonitor or FinceptTerminal — explicitly declined
  given the license exposure detailed above.
