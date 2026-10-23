# Beeshma Trading Backend — API Endpoint Inventory

Audited 2026-10-14. Sources read directly: `src/routes/index.ts` (1286 lines), all 17 files in `src/routes/`, and `src/index.ts` (mounts + direct app routes).

## Mount prefixes (`src/index.ts`, lines 65–79)

| Prefix | Router | Router defined in |
|---|---|---|
| `/api/auth` | authRoutes | `routes/index.ts` (stubs: `routes/auth.ts` re-exports it) |
| `/api/trades` | tradesRoutes | `routes/index.ts` |
| `/api/portfolio` | portfolioRoutes | `routes/index.ts` |
| `/api/agents` | agentsRoutes | `routes/index.ts` |
| `/api/market` | marketRoutes | `routes/index.ts` |
| `/api/journal` | journalRoutes | `routes/index.ts` |
| `/api/settings` | settingsRoutes | `routes/index.ts` |
| `/api/kill-switch` | killSwitchRoutes | `routes/index.ts` |
| `/api/chat` | chatRoutes | `routes/chat.ts` |
| `/api/monitor` | agentMonitorRoutes | `routes/agentMonitor.ts` |
| `/api/backtest` | backtestRoutes | `routes/backtest.ts` |
| `/api/intelligence` | intelligenceRoutes | `routes/intelligence.ts` |
| `/api/copy-trading` | copyTradingRoutes | `routes/copyTrading.ts` |
| `/api/system` | systemRoutes | `routes/system.ts` |
| `/api/polymarket/greed` | greedRouter | `routes/index.ts` |

Note: `routes/agents.ts`, `routes/auth.ts`, `routes/journal.ts`, `routes/killSwitch.ts`, `routes/market.ts`, `routes/portfolio.ts`, `routes/settings.ts`, `routes/trades.ts` are each a single-line re-export stub pointing back at the router defined in `routes/index.ts`. `routes/predictionSimulation.ts` exports only handler functions (`recordPredictionSimulation`, `listPredictionSimulations`); they are registered as routes in `routes/index.ts` lines 659–660.

## Endpoints

### /api/auth (routes/index.ts)

| Method | Full path | Source |
|---|---|---|
| POST | /api/auth/login | index.ts:37 |
| POST | /api/auth/logout | index.ts:101 |
| POST | /api/auth/setup-owner | index.ts:116 |
| GET | /api/auth/me | index.ts:171 |

### /api/trades (routes/index.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /api/trades/ | index.ts:187 |
| GET | /api/trades/lifecycle | index.ts:202 |
| GET | /api/trades/lifecycle/:correlationId | index.ts:213 |
| GET | /api/trades/stats | index.ts:220 |
| POST | /api/trades/:id/close | index.ts:246 |

### /api/portfolio (routes/index.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /api/portfolio/ | index.ts:267 |
| GET | /api/portfolio/breakdown | index.ts:277 |
| GET | /api/portfolio/db-health | index.ts:302 |
| GET | /api/portfolio/snapshots | index.ts:307 |
| GET | /api/portfolio/positions | index.ts:318 |
| GET | /api/portfolio/position-research | index.ts:327 |
| GET | /api/portfolio/position-research/:decisionId | index.ts:336 |
| GET | /api/portfolio/live-accounts | index.ts:345 |

### /api/agents (routes/index.ts)

| Method | Full path | Source |
|---|---|---|
| POST | /api/agents/trigger-debate | index.ts:358 |
| POST | /api/agents/force-trade | index.ts:370 |
| POST | /api/agents/run-and-trade | index.ts:431 |
| GET | /api/agents/decisions | index.ts:446 |
| GET | /api/agents/decisions/:id | index.ts:453 |

### /api/market (routes/index.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /api/market/universe/categories | index.ts:481 |
| GET | /api/market/universe/symbols | index.ts:491 |
| GET | /api/market/prices | index.ts:509 |
| GET | /api/market/stock-universe | index.ts:514 |
| GET | /api/market/security-master/status | index.ts:541 |
| POST | /api/market/security-master/sync | index.ts:550 |
| GET | /api/market/chart/:symbol | index.ts:560 |
| GET | /api/market/news | index.ts:572 |
| GET | /api/market/predictions | index.ts:587 |
| POST | /api/market/predictions/scan | index.ts:601 |
| GET | /api/market/polymarket-us/account | index.ts:616 |
| GET | /api/market/polymarket-us/events | index.ts:626 |
| GET | /api/market/polymarket/scorecard | index.ts:639 |
| GET | /api/market/polymarket/edge/predictions | index.ts:649 |
| POST | /api/market/predictions/wager | index.ts:659 (handler: `predictionSimulation.ts`) |
| GET | /api/market/predictions/simulations | index.ts:660 (handler: `predictionSimulation.ts`) |
| POST | /api/market/ai-deep-dive | index.ts:662 |
| GET | /api/market/ipo-calendar | index.ts:724 |
| GET | /api/market/all-stocks | index.ts:739 |
| GET | /api/market/stocks-universe | index.ts:788 |
| GET | /api/market/stock/:symbol | index.ts:917 |
| GET | /api/market/regimes | index.ts:935 |
| GET | /api/market/stock/:symbol/candles | index.ts:950 |
| GET | /api/market/sectors | index.ts:1123 |
| GET | /api/market/treasury/yields | index.ts:1146 |
| GET | /api/market/crypto/top20 | index.ts:1164 |
| GET | /api/market/crypto/overview | index.ts:1181 |
| GET | /api/market/options | index.ts:1201 |
| GET | /api/market/screener | index.ts:1212 |
| GET | /api/market/economic/calendar | index.ts:1232 |
| GET | /api/market/economic/indicators | index.ts:1243 |
| GET | /api/market/economic/central-banks | index.ts:1253 |
| GET | /api/market/economic/earnings | index.ts:1262 |
| GET | /api/market/economic/breadth | index.ts:1273 |

### /api/journal (routes/index.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /api/journal/ | index.ts:967 |
| GET | /api/journal/:date | index.ts:973 |
| POST | /api/journal/generate | index.ts:979 |

### /api/settings (routes/index.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /api/settings/ | index.ts:989 |
| POST | /api/settings/connect-alpaca | index.ts:1017 |
| POST | /api/settings/connect-polymarket | index.ts:1032 |
| POST | /api/settings/disconnect | index.ts:1047 |

### /api/kill-switch (routes/index.ts)

| Method | Full path | Source |
|---|---|---|
| POST | /api/kill-switch/activate | index.ts:1063 |
| POST | /api/kill-switch/deactivate | index.ts:1072 |
| GET | /api/kill-switch/status | index.ts:1077 |

### /api/polymarket/greed (routes/index.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /api/polymarket/greed/status | index.ts:1085 |
| POST | /api/polymarket/greed/ | index.ts:1094 |
| DELETE | /api/polymarket/greed/ | index.ts:1110 |

### /api/chat (routes/chat.ts)

| Method | Full path | Source |
|---|---|---|
| POST | /api/chat/:agentId | chat.ts:30 |
| GET | /api/chat/:agentId/history | chat.ts:120 |

### /api/monitor (routes/agentMonitor.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /api/monitor/activities | agentMonitor.ts:16 |
| GET | /api/monitor/activities/summary | agentMonitor.ts:43 |
| GET | /api/monitor/learning | agentMonitor.ts:57 |
| GET | /api/monitor/news | agentMonitor.ts:71 |
| GET | /api/monitor/news/high-impact | agentMonitor.ts:91 |
| GET | /api/monitor/geopolitics | agentMonitor.ts:109 |
| GET | /api/monitor/sentiment | agentMonitor.ts:132 |
| GET | /api/monitor/context | agentMonitor.ts:146 |
| GET | /api/monitor/recent-decisions | agentMonitor.ts:160 |
| GET | /api/monitor/status | agentMonitor.ts:195 |

### /api/backtest (routes/backtest.ts)

| Method | Full path | Source |
|---|---|---|
| POST | /api/backtest/run | backtest.ts:19 |
| GET | /api/backtest/status | backtest.ts:49 |
| POST | /api/backtest/validate | backtest.ts:61 |
| GET | /api/backtest/requirements | backtest.ts:81 |
| GET | /api/backtest/guide | backtest.ts:114 |

### /api/intelligence (routes/intelligence.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /api/intelligence/activity/feed | intelligence.ts:44 |
| GET | /api/intelligence/activity/agent/:agentId | intelligence.ts:65 |
| GET | /api/intelligence/activity/agent/:agentId/summary | intelligence.ts:97 |
| GET | /api/intelligence/activity/agent/:agentId/export | intelligence.ts:129 |
| GET | /api/intelligence/learning/:asset | intelligence.ts:166 |
| GET | /api/intelligence/risk/assessment | intelligence.ts:244 |
| GET | /api/intelligence/risk/events | intelligence.ts:266 |
| GET | /api/intelligence/risk/macro | intelligence.ts:297 |
| GET | /api/intelligence/dashboard | intelligence.ts:319 |
| POST | /api/intelligence/learning/log-activity | intelligence.ts:371 |
| GET | /api/intelligence/chart-ai/:symbol | intelligence.ts:414 |
| GET | /api/intelligence/alternative-data/:symbol? | intelligence.ts:431 (param optional) |
| GET | /api/intelligence/earnings-iv-crush | intelligence.ts:447 |
| GET | /api/intelligence/ai-arsenal | intelligence.ts:462 |
| GET | /api/intelligence/cross-industry-ripple | intelligence.ts:477 |
| GET | /api/intelligence/cross-industry-ripple/:symbol | intelligence.ts:492 |

### /api/copy-trading (routes/copyTrading.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /api/copy-trading/strategies | copyTrading.ts:15 |
| GET | /api/copy-trading/followers | copyTrading.ts:29 |
| POST | /api/copy-trading/followers | copyTrading.ts:43 |
| PATCH | /api/copy-trading/followers/:id | copyTrading.ts:84 |
| POST | /api/copy-trading/followers/:id/toggle | copyTrading.ts:101 |
| DELETE | /api/copy-trading/followers/:id | copyTrading.ts:118 |
| GET | /api/copy-trading/audit-log | copyTrading.ts:135 |

### /api/system (routes/system.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /api/system/status | system.ts:18 |
| POST | /api/system/intraday/scan | system.ts:79 |
| POST | /api/system/broker-sync | system.ts:83 |
| GET | /api/system/research-services | system.ts:90 |
| POST | /api/system/research-services/:service | system.ts:94 |

### Direct app routes (src/index.ts)

| Method | Full path | Source |
|---|---|---|
| GET | /health | src/index.ts:84 |
| GET | /api/health | src/index.ts:84 |
| ALL | /api/* | src/index.ts:94 (explicit 404 for unhandled API requests) |

## Totals

115 router endpoints + 3 direct app routes (incl. the `/api/*` wildcard 404). Method counts across routers: GET ≈ 94, POST ≈ 25, PATCH 1, DELETE 2 (plus ALL wildcard).

## Inactive / commented-out / TODO routes

**None found.** Grep across all route files and `src/index.ts` for commented-out route registrations (`//` lines calling `.get/.post/.put/.delete/.patch/.all` on a router or `app`) and for TODOs referencing routes/endpoints returned zero hits. Every route definition found is active code.
