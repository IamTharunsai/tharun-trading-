# THARUN TRADING AGENT — Complete System Architecture
## End-to-End Technical & Operational Documentation

---

## 1. WHAT IS THARUN TRADING AGENT?

Tharun Trading Agent is a fully autonomous AI trading system that operates like a Wall Street investment committee running 24/7 on your behalf. It monitors markets in real-time, convenes a 15-agent AI debate before every trade, manages risk automatically, and executes trades across crypto and stocks — all without you lifting a finger.

**The core philosophy:** No single AI signal. Every trade requires a 3-round debate between 15 specialized AI agents, a risk validation layer, and market regime confirmation before a single dollar moves.

---

## 2. SYSTEM OVERVIEW — 7 OPERATIONAL STAGES

```
STAGE 1: MARKET DATA INGESTION
         ↓
STAGE 2: MARKET SNAPSHOT CONSTRUCTION
         ↓
STAGE 3: 15-AGENT INVESTMENT COMMITTEE DEBATE (3 rounds)
         ↓
STAGE 4: RISK VALIDATION & GUARDRAILS
         ↓
STAGE 5: TRADE EXECUTION (Paper / Alpaca / Binance)
         ↓
STAGE 6: POSITION MONITORING (10-second stop-loss checks)
         ↓
STAGE 7: SELF-LEARNING & JOURNAL GENERATION
```

---

## 3. FRONTEND ARCHITECTURE

**Technology Stack:**
- React 18 + Vite + TypeScript
- Zustand (global state: token, prices, agent council, kill switch)
- @tanstack/react-query (API data fetching with 5–30s refresh intervals)
- Socket.io-client (real-time WebSocket events)
- Recharts (analytics charts), lightweight-charts (TradingView-style candlesticks)
- Tailwind CSS + CSS variables (warm cream/orange theme)
- Google Fonts: Syne (headings) + Space Mono (data)

**Pages & Features:**

| Page | Purpose |
|------|---------|
| Login | JWT auth, TOTP 2FA ready |
| Dashboard | Command center — P&L, portfolio, risk monitor, agent council |
| Portfolio | Pie allocation, 90-day value history, open positions |
| Trades | Full paginated trade history (25/page) |
| Agent Council | Live view of all 10 core agents voting |
| Debate Room | 15-agent live debate — trigger manually or watch auto debates |
| Agent Chat | Chat 1-on-1 with any of the 10 agents about any asset |
| Agent Monitor | Real-time feed of what agents are doing every 5 seconds |
| Charts | TradingView candlestick charts (Binance data, 5 assets) |
| Analytics | Daily P&L bar charts, portfolio area chart, win rate stats |
| Journal | AI-generated daily trading journal entries |
| News | Market news with sentiment scores from agents |
| News & Geopolitics | Geopolitical events that affect trading decisions |
| Investment Plan | Long-term holdings, DCA plan, compounding projections |
| History | Full archived trade history |
| Settings | Live system settings from backend |

**Real-time Events (WebSocket → Frontend):**
- `price:update` → live price ticker in header
- `debate:start`, `debate:agent-voted`, `debate:complete` → Debate Room live feed
- `council:start`, `agent:status`, `council:complete` → Agent Council panel
- `position:closed` → toast notification with P&L
- `guardrail:triggered` → alert banner

---

## 4. BACKEND ARCHITECTURE

**Technology Stack:**
- Node.js + Express + TypeScript
- Prisma ORM → PostgreSQL (Supabase cloud)
- Socket.io (WebSocket server, emits real-time events)
- node-cron (4 scheduled jobs)
- JWT (8hr expiry) + bcrypt + speakeasy TOTP
- Anthropic SDK (Claude claude-sonnet-4-20250514)
- Winston logger

**API Routes:**

| Route | Function |
|-------|---------|
| POST /api/auth/login | Login with email + password + optional TOTP |
| GET  /api/auth/me | Get current user profile |
| GET  /api/portfolio | Portfolio state (value, P&L, positions) |
| GET  /api/portfolio/positions | Open positions with live P&L |
| GET  /api/portfolio/snapshots | Historical value snapshots |
| GET  /api/trades | Paginated trade history |
| GET  /api/trades/stats | Win rate, profit factor, best/worst trade |
| GET  /api/agents/decisions | Council voting history |
| POST /api/agents/trigger-debate | Manually trigger a debate for any asset |
| GET  /api/market/prices | Current prices for all tracked assets |
| GET  /api/market/news | News articles with sentiment analysis |
| GET  /api/chat/:agentId | Chat with a specific AI agent |
| GET  /api/journal | Daily trading journals |
| GET  /api/settings | System configuration |
| POST /api/kill-switch/activate | Emergency halt all trading |
| GET  /api/monitor/activities | Agent activity feed |
| GET  /api/monitor/news | Real-time news feed |
| GET  /api/monitor/geopolitics | Geopolitical event tracker |

**Scheduled Jobs (node-cron):**

| Interval | Job |
|----------|-----|
| Every 90 seconds | Pick a random crypto asset and run the full 15-agent debate |
| Every 10 seconds | Scan all open positions for stop-loss / take-profit breach |
| Every 5 minutes | Save portfolio snapshot to database |
| Every hour | Detect market regime (trending, ranging, volatile) |
| 11:59 PM daily | Generate AI daily journal entry |
| Every Sunday | Generate weekly performance report |

---

## 5. DATABASE SCHEMA (PostgreSQL via Prisma)

**Core Tables:**
- `User` — owner account, JWT secret, TOTP secret
- `Portfolio` — cash balance, total value, P&L (day/total), drawdown, trade count
- `Position` — open positions (asset, quantity, entry price, stop loss, take profit)
- `Trade` — full trade record (entry, exit, P&L, exit reason, agent decision ID)
- `AgentDecision` — every council vote (asset, votes array, final decision, confidence, executed)
- `PortfolioSnapshot` — 5-minute value snapshots for charts
- `NewsArticle` — news with sentiment scores
- `TradingJournal` — daily AI-written journal entries
- `SystemSettings` — trading parameters (risk %, stop loss, vote thresholds)
- `ChatHistory` — conversation history per agent per user

---

## 6. THE 15-AGENT INVESTMENT COMMITTEE

### How Agents Think

Each agent is a specialized Claude claude-sonnet-4-20250514 instance with a 500-800 word expert system prompt encoding:
1. **Core Theory** — the discipline's first principles
2. **Signal Patterns** — 10 specific BUY conditions, 10 SELL conditions
3. **Confidence Modifiers** — what raises/lowers conviction
4. **Failure Modes** — when this agent's analysis is wrong
5. **Decision Framework** — exact if/then logic for votes

### The 15 Agents

| # | Agent | Expertise | Data Sources |
|---|-------|-----------|-------------|
| 1 | The Technician | RSI, MACD, Bollinger Bands, candlestick patterns | Computed indicators |
| 2 | The Newshound | News sentiment, events, earnings | Finnhub API |
| 3 | The Sentiment Analyst | Fear & Greed index, market psychology | Alternative.me |
| 4 | The Fundamental Analyst | Market cap, volume, protocol fundamentals | Internal snapshot |
| 5 | The Risk Manager ⚡ | Drawdown, volatility, position sizing — HAS VETO | Portfolio state |
| 6 | The Trend Prophet | EMA crosses, trend direction, momentum | 200-day EMA |
| 7 | The Volume Detective | Volume patterns, accumulation/distribution | Volume indicators |
| 8 | The Whale Watcher | Large order flows, institutional moves | On-chain data proxy |
| 9 | The Macro Economist | Interest rates, DXY, global macro | Macro context |
| 10 | The Devil's Advocate | Counter-argument, why the trade could fail | All signals |
| 11 | The Elliott Wave Master | Wave counting, Fibonacci retracements | Candle data |
| 12 | The Options Flow Analyst | Put/call ratios, unusual options activity | Market context |
| 13 | The Polymarket Oracle | Prediction market probabilities | Polymarket API |
| 14 | The Arbitrageur | Cross-exchange price gaps, funding rates | Price feeds |
| 15 | The Coordinator 👑 | Synthesizes all votes, makes final decision | All 14 agents |

### The 3-Round Debate Process

**Round 1 — Opening Arguments (15 min budget)**
- All 14 agents simultaneously analyze the market snapshot
- Each submits: BUY/SELL/HOLD vote + confidence 0-100% + reasoning + key factors + risk warnings
- Devil's Advocate argues against the majority

**Round 2 — Cross-Examination**
- Agents with high confidence challenge agents with opposing views
- The Coordinator identifies the key points of disagreement
- Confidence scores may shift up or down based on new arguments

**Round 3 — Final Verdict**
- Each agent reaffirms or changes their vote after hearing all arguments
- Risk Manager can VETO any trade (overrides consensus)
- Coordinator synthesizes a master analysis and final decision
- Execution requires: ≥7/10 go votes + avg confidence ≥65% + no Risk Manager veto

---

## 7. STAGE 2: MARKET SNAPSHOT CONSTRUCTION

Before the debate begins, the system builds a complete MarketSnapshot object:

```
Price Data:
  - Current price, 24h change %, volume, bid/ask spread
  
Technical Indicators (computed from Binance candle data):
  - RSI (14-period)
  - MACD (12/26/9) + histogram
  - Bollinger Bands (20-period, 2 std dev)
  - EMA 9, EMA 21, EMA 200
  - ATR (14-period) for volatility
  - Volume 20-day average
  
Candle History:
  - Last 200 hourly candles (OHLCV)
  - Last 5 candles shown to agents verbatim
  
Market Context:
  - 24h High / Low
  - Market cap (if available)
  - Market regime (trending / ranging / volatile / breakout)
  
Portfolio State:
  - Current cash balance
  - Existing positions
  - Today's P&L
  - Drawdown from peak
```

---

## 8. STAGE 4: RISK VALIDATION GUARDRAILS

Before ANY trade executes, it passes through 7 guardrail checks:

| Check | Rule | Action if Breached |
|-------|------|-------------------|
| Kill Switch | Is emergency stop active? | BLOCK all trades |
| Daily Loss Limit | Is today's loss > 5%? | HALT trading for the day |
| Weekly Drawdown | Is weekly drawdown > 10%? | PAUSE until next week |
| Max Drawdown | Is drawdown from peak > 20%? | ACTIVATE kill switch |
| Max Position Size | Would this trade exceed 10% of portfolio? | REDUCE position size |
| Cash Reserve | Would cash drop below 30%? | REDUCE or BLOCK |
| Max Trades/Day | Already executed 50 trades today? | BLOCK |

After passing guardrails → `validateTradeSignal()` computes:
- **Position size** = (Portfolio Value × Risk%) ÷ (Entry Price − Stop Loss)
- **Stop loss** = Set by agent council (typically 3% crypto, 2% stocks)
- **Take profit** = Set by agent council (typically 6% = 2:1 risk/reward)

---

## 9. STAGE 5: TRADE EXECUTION

**Trading Modes:**

```
PAPER MODE (default, safe):
  - All trades recorded in database only
  - No real money moves
  - Perfect for testing and backtesting
  
ALPACA MODE (stocks + crypto):
  - Real brokerage via Alpaca API
  - Paper trading: paper-api.alpaca.markets
  - Live trading: api.alpaca.markets
  - Supports: AAPL, TSLA, NVDA, MSFT + 200+ stocks
  - Also supports crypto via Alpaca Crypto API
  
BINANCE MODE (crypto only):
  - Direct execution on Binance.US
  - Uses Binance Spot API
  - Supports: BTC, ETH, SOL, BNB, ADA, etc.
```

**Alpaca Integration — How to Activate:**
1. Sign up at alpaca.markets (free)
2. Get paper API keys from the dashboard
3. Set in .env: `ALPACA_API_KEY=PK...` and `ALPACA_SECRET_KEY=...`
4. Set `ALPACA_BASE_URL=https://paper-api.alpaca.markets`
5. Set `TRADING_MODE=paper` (or `live` for real money)
6. Alpaca provides: fractional shares, after-hours trading, no commission

**Polymarket Integration — How It Works:**
- Agent 13 (The Polymarket Oracle) queries Polymarket prediction markets
- APIs: Gamma API (markets), CLOB API (order book), Data API (prices)
- Polymarket shows crowd-sourced probability on events (election odds, Fed decisions, etc.)
- If Polymarket shows >70% probability of an event that affects your asset, agents factor this in
- Example: If Polymarket shows 80% chance of rate cut → increases BUY confidence for growth stocks
- The `POLYMARKET_PRIVATE_KEY` and `POLYMARKET_WALLET_ADDRESS` are for placing trades directly on Polymarket (prediction market trading)

---

## 10. INVESTMENT KNOWLEDGE — HOW TO TRADE LIKE TOP 1%

The system is built on the same principles used by Renaissance Technologies, Bridgewater, and Two Sigma:

### Crypto Strategy (Short-term + Long-term)
**Day Trading (auto):**
- 15-agent debate every 90 seconds on BTC, ETH, SOL, BNB, ADA
- Only trades when ≥7 agents agree + high confidence
- 2:1 minimum risk/reward ratio (6% TP vs 3% SL)
- Never risks more than 1% portfolio per trade

**Long-term Holds (managed manually via Investment page):**
- BTC: Digital gold, store of value, 4-year cycle plays
- ETH: Infrastructure bet, fee revenue, staking yield
- SOL: High-throughput L1, developer activity proxy

### Stock Strategy
**Momentum + Fundamental (Alpaca):**
- NVDA, AAPL, TSLA, MSFT as core holdings
- Agent 4 (Fundamentals) and Agent 6 (Trend) drive stock decisions
- Earnings season awareness from Agent 2 (Newshound)
- Macro rate environment from Agent 9 (Macro Economist)

### Dollar Cost Averaging (DCA)
The Investment page tracks automated DCA schedules:
- Weekly: $50 BTC + $30 ETH
- Monthly: $200 BTC + $100 ETH + $100 NVDA
- Removes emotion — best strategy for 5-10 year horizons

### Compounding Projections (How $10,000 grows)
| Years | 12% APY | 22% APY | 40% APY |
|-------|---------|---------|---------|
| 1 year | $11,200 | $12,200 | $14,000 |
| 3 years | $14,049 | $18,154 | $27,440 |
| 5 years | $17,623 | $27,027 | $53,782 |
| 10 years | $31,058 | $73,046 | $289,254 |

The system targets 22-40% APY through:
1. High-quality trades (≥65% win rate)
2. Strict 2:1 risk/reward
3. Never losing more than 5% in a day
4. DCA into winners
5. Self-learning from every trade

---

## 11. STAGE 7: SELF-LEARNING SYSTEM

After every trade closes, the system runs post-trade analysis:
1. Was the debate outcome correct?
2. Which agents voted correctly vs incorrectly?
3. What indicator best predicted the outcome?
4. Agent accuracy scores are tracked over time

**Daily Journal (11:59 PM):**
Claude generates a human-readable journal entry covering:
- Total trades today and win rate
- Best and worst trade with reasoning
- What the agents got right/wrong
- Lessons learned for tomorrow

**Weekly Report (Sunday midnight):**
- Performance vs benchmark (BTC buy-and-hold)
- Most profitable assets this week
- Agent performance rankings
- Regime analysis (was it trending, ranging, volatile?)

---

## 12. MARKET REGIME DETECTION

Before each debate, the system classifies the current market regime:

| Regime | Conditions | Agent Behavior |
|--------|-----------|----------------|
| TRENDING_BULL | RSI > 55, EMA9 > EMA21 > EMA200, price rising | Trend agents get +15% weight |
| TRENDING_BEAR | RSI < 45, EMA9 < EMA21 < EMA200, price falling | Risk agents get +20% weight |
| RANGING | Bollinger width < 0.05, ADX < 25 | Oscillator agents preferred, small position sizes |
| VOLATILE | ATR > 3%, Bollinger width > 0.15 | Risk Manager gets veto authority, 50% position sizes |
| BREAKOUT | Price breaks Bollinger with volume > 150% | Momentum agents get +20% weight |

---

## 13. DATA SOURCES & EXTERNAL APIs

| Source | Data | Used By |
|--------|------|---------|
| Binance WebSocket | Live crypto prices (BTC, ETH, SOL, BNB, ADA) | All price displays, stop-loss monitor |
| Binance REST | 1h OHLCV candles for indicators | All 15 agents |
| Finnhub | Stock news, earnings calendar | Agent 2 (Newshound) |
| Alternative.me | Fear & Greed Index | Agent 3 (Sentiment) |
| Polygon.io | Stock price data, options flow | Agents 4, 12 |
| Alpha Vantage | Forex rates, economic data | Agent 9 (Macro) |
| NewsAPI | Broad market news | News page |
| Polymarket APIs | Prediction market probabilities | Agent 13 (Polymarket Oracle) |
| Supabase | Database hosting (PostgreSQL) | All data persistence |

---

## 14. GSTACK — HOW TO USE IN THIS PROJECT

**What is GStack?**
GStack is an open-source framework created by Garry Tan (Y Combinator President) that structures Claude Code (Anthropic's AI coding assistant) to work like a 23-person startup team. Each "role" (CEO, engineer, QA, designer, security) has its own set of responsibilities and constraints.

**How GStack helps Tharun Trading Agent:**

### Option A: Development Workflow (Immediate Use)
Install GStack to supercharge how you develop and maintain this codebase:
```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# GStack gives Claude Code a CLAUDE.md that defines:
# - An "Engineer" role for backend changes
# - A "QA" role that runs tests before merging
# - A "Security Reviewer" that checks API key exposure
# - A "Product Manager" that tracks feature progress
```

### Option B: Agent Enhancement (Advanced)
Use GStack's agent orchestration pattern to add more agents to the committee:
- Create a "Research Director" agent that coordinates Agents 1-15
- Add specialized agents for specific sectors (Healthcare, Energy, Commodities)
- Build a "Backtester" agent that validates strategies against 5 years of data

### Option C: Deployment Pipeline
GStack's deployment skills can automate:
- Auto-deploy backend updates to Railway/Render
- Frontend deploys to Vercel on every git push
- Database migrations via Prisma applied automatically

**Recommended immediate step:** Add `CLAUDE.md` to this project's root with GStack structure — it makes every future Claude Code session instantly aware of the codebase architecture.

---

## 15. HOW THE SYSTEM TRADES ON YOUR BEHALF (Top 1% Approach)

**24/7 Autonomous Loop:**

```
00:00 - 23:59:  Every 90 seconds:
  1. Pick asset (BTC, ETH, SOL, BNB, or ADA randomly)
  2. Fetch live price + build technical snapshot
  3. Detect market regime
  4. Convene 15-agent debate (3 rounds, ~8-12 minutes)
  5. Risk Manager reviews the verdict
  6. If approved: calculate position size, set stops, execute
  7. Open position enters 10-second monitoring loop
  8. Stop-loss hit → auto-close with predefined loss
  9. Take-profit hit → auto-close with gains
  10. Post-trade analysis → self-learning update

Every night at 11:59 PM:
  11. Generate daily journal with performance analysis

Every Sunday:
  12. Generate weekly report with agent rankings
```

**What makes this top 1%:**
1. **Multi-perspective analysis** — 15 independent AI experts, not one signal
2. **Pre-mortem thinking** — Devil's Advocate always argues against the trade
3. **Regime awareness** — strategy adjusts based on market conditions
4. **Strict risk rules** — never risks more than 1% per trade, ever
5. **Position sizing via Kelly Criterion proxy** — size = risk / stop distance
6. **No emotional trading** — pure systematic execution
7. **Continuous learning** — system improves with every trade

---

## 16. ALPACA — COMPLETE SETUP GUIDE

**Step 1: Create Account**
- Go to alpaca.markets → Create free account
- Verify email, complete KYC for live trading

**Step 2: Get API Keys**
- Dashboard → Paper Trading → Generate API Key
- Copy `API Key ID` (starts with PK) and `Secret Key`

**Step 3: Update .env**
```env
ALPACA_API_KEY=PKXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ALPACA_SECRET_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ALPACA_BASE_URL=https://paper-api.alpaca.markets
TRADING_MODE=paper
```

**Step 4: Test**
- Start backend → trigger a debate for AAPL
- Check Alpaca dashboard → should see paper order placed

**Step 5: Go Live (when ready)**
```env
ALPACA_BASE_URL=https://api.alpaca.markets
TRADING_MODE=live
```

**Supported assets on Alpaca:**
- 8,000+ US stocks and ETFs
- BTC, ETH, SOL, DOGE, LINK, UNI, AAVE (crypto)
- No commission, fractional shares, 24/7 crypto

---

## 17. POLYMARKET — COMPLETE SETUP GUIDE

**What Polymarket offers:**
Polymarket is the world's largest prediction market. Prices show the crowd's probability estimate of events (0-100%). These are more accurate than polls or analyst forecasts.

**Example predictions affecting trades:**
- "Fed cuts rates in 2025?" → YES at 72% → Bullish for growth stocks
- "Bitcoin above $100k by Dec 2025?" → YES at 45% → Neutral for BTC
- "US enters recession?" → YES at 30% → Bearish for small-caps

**How Agent 13 uses Polymarket:**
```
For every asset being debated:
1. Query relevant open markets on Polymarket
2. Extract probability estimates for macro events
3. Convert to directional bias (>60% YES = bullish, <40% = bearish)
4. Include in vote reasoning
```

**Setup Polymarket trading (prediction market positions):**
```env
POLYMARKET_PRIVATE_KEY=0x...  (Polygon wallet private key)
POLYMARKET_WALLET_ADDRESS=0x... (your Polygon wallet address)
```

**Note:** Polymarket uses Polygon (MATIC) blockchain. You need USDC.e on Polygon to place bets. Not regulated in the US — use with caution.

---

## 18. TRADEVIEW / TRADINGVIEW INTEGRATION (Future)

TradingView webhooks can push signals to this system:
1. Create a TradingView alert on any indicator
2. Set webhook URL to `https://your-backend/api/agents/trigger-debate`
3. When your TradingView alert fires, it triggers the full 15-agent debate
4. Combine human chart analysis with AI committee vote

**Pine Script webhook format:**
```json
{
  "asset": "BTC",
  "market": "crypto",
  "signal": "BUY",
  "source": "tradingview_alert"
}
```

---

## 19. PRODUCTION DEPLOYMENT CHECKLIST

**Backend (Railway / Render / VPS):**
- [ ] Add all .env variables to deployment environment
- [ ] Set `NODE_ENV=production`
- [ ] Set `TRADING_MODE=paper` until tested
- [ ] Ensure PostgreSQL (Supabase) is accessible from deployment
- [ ] Set `ANTHROPIC_API_KEY` with sufficient credits

**Frontend (Vercel / Netlify):**
- [ ] Set `VITE_API_URL` to backend URL
- [ ] Set `VITE_TRADING_MODE=paper`
- [ ] Enable automatic deploys from git main branch

**When going live:**
1. Test with paper trading for at least 30 days
2. Verify risk guardrails by simulating a loss scenario
3. Start with $500–$1000 real capital
4. Add Claude API credits ($20/month handles ~500 debates/day)
5. Set `TRADING_MODE=live` only when confident

---

## 20. TECHNOLOGY STACK SUMMARY

```
Frontend:    React 18 + Vite + TypeScript + Tailwind CSS
Backend:     Node.js + Express + TypeScript
Database:    PostgreSQL + Prisma ORM (hosted on Supabase)
AI Engine:   Anthropic Claude claude-sonnet-4-20250514 (15 agent instances)
Real-time:   Socket.io (WebSocket)
Scheduling:  node-cron (4 jobs)
Charts:      Recharts + lightweight-charts (TradingView engine)
Brokers:     Alpaca (stocks + crypto), Binance.US (crypto)
Markets:     Polymarket (prediction markets)
Data:        Binance WS + Finnhub + Polygon.io + Alpha Vantage + NewsAPI
Auth:        JWT (8hr) + bcrypt + speakeasy TOTP
Hosting:     Local → Railway (backend) + Vercel (frontend) + Supabase (DB)
```

---

*Tharun Trading Agent — Built by Tharun. Powered by Claude AI. Designed to trade like the top 1%.*
