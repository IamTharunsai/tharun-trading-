# THARUN TRADING AGENT — Complete System Architecture
## End-to-End Technical, API, Deployment & Trading Documentation

---

## 1. WHAT IS THARUN TRADING AGENT?

Tharun Trading Agent is a fully autonomous AI trading platform that runs 24/7 on your behalf. Before every single trade, 25 specialized AI agents debate in 12 mandatory stages. The system trades on Alpaca (stocks, zero commission) and Polymarket (prediction markets, zero fees) — both in paper mode first. Starting capital: $100. Every cent is tracked, compounded, and protected by 25 hard-coded safety laws.

**Core philosophy:** A trade must pass 25 laws, a viability check, 12 analysis stages, and 25-agent consensus — or it never happens.

---

## 2. COMPLETE TECH STACK

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FRONTEND                                                               │
│  React 18 + Vite + TypeScript                                           │
│  Zustand (global state) + TanStack Query (data fetching)                │
│  Socket.io-client (real-time WebSocket)                                 │
│  Recharts + lightweight-charts (TradingView-style candlesticks)         │
│  Tailwind CSS (cream/orange warm theme)                                 │
│  Google Fonts: Syne (headings) + Space Mono (data)                      │
├─────────────────────────────────────────────────────────────────────────┤
│  BACKEND                                                                │
│  Node.js 20 + Express + TypeScript                                      │
│  Prisma ORM (PostgreSQL on Supabase)                                    │
│  Socket.io (WebSocket server)                                           │
│  node-cron (scheduled jobs)                                             │
│  JWT + bcrypt + speakeasy TOTP (auth)                                   │
│  Winston (structured logging)                                           │
│  ethers.js v6 (Polygon wallet for Polymarket)                           │
├─────────────────────────────────────────────────────────────────────────┤
│  AI ENGINE                                                              │
│  Anthropic SDK → Claude claude-sonnet-4-20250514                             │
│  25 specialist agents with MASTER_TRADING_KNOWLEDGE                    │
│  12-stage analysis pipeline                                             │
│  TopTrader 25 laws validation                                           │
│  Kelly Criterion position sizing                                        │
├─────────────────────────────────────────────────────────────────────────┤
│  BROKERS / MARKETS                                                      │
│  Alpaca (stocks + crypto, zero commission, paper + live)                │
│  Polymarket CLOB (prediction markets, zero fees, Polygon chain)         │
│  Binance.US (crypto, 0.1% fee — secondary)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  DATA SOURCES                                                           │
│  Binance WebSocket + REST (crypto prices + candles)                     │
│  Polygon.io (stock prices, options flow)                                │
│  Finnhub (stock news, earnings calendar)                                │
│  Alpha Vantage (forex rates, economic data)                             │
│  NewsAPI (broad market news)                                            │
│  Alternative.me (Fear & Greed index)                                    │
│  Polymarket Gamma API (prediction market probabilities)                 │
├─────────────────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE                                                         │
│  Frontend → Vercel (auto-deploys from GitHub)                           │
│  Backend  → Railway or Render (Node.js, persistent WebSocket)           │
│  Database → Supabase (PostgreSQL, managed)                              │
│  Auth     → Supabase Auth + custom JWT                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. SYSTEM FLOW — 12-STAGE PIPELINE

```
Every 90 seconds, for each monitored asset:

STAGE  1 ── Macro Environment Check  (Agents 13, 16 — Macro + Intermarket)
STAGE  2 ── News & Catalyst Screen   (Agents 14, 15 — News + Geopolitical)
STAGE  3 ── Institutional Flow       (Agents 10, 12 — Sector Rotation + Inst.)
STAGE  4 ── Fundamental Gate         (Agents 8, 9, 11 — Fundamentals)
STAGE  5 ── Multi-Timeframe Trend    (Agent 5  — mandatory gate)
STAGE  6 ── Key Level Identification (Agent 6  — mandatory gate, draws chart)
STAGE  7 ── Pattern Recognition      (Agents 1, 7 — Chart Master + Elliott)
STAGE  8 ── Indicator Confirmation   (Agents 2, 3 — mandatory gate)
STAGE  9 ── Volume & Smart Money     (Agents 4, 22 — mandatory gate)
STAGE 10 ── Sentiment & Psychology   (Agents 21, 23)
STAGE 11 ── Risk Validation          (Agents 17-20 — Risk Commander VETO)
STAGE 12 ── Investment Committee     (Agents 24, 25 — Master + Devil's Advocate)
         ↓
25 TOP TRADER LAWS CHECK             (topTraderRules.ts — hard veto)
         ↓
TRADE VIABILITY CHECK                (microAccountEngine.ts — fee/profit check)
         ↓
MICRO POSITION SIZING                (Kelly fraction × confidence × portfolio)
         ↓
EXECUTION                            (Alpaca paper / Polymarket paper)
         ↓
POSITION MONITOR                     (10-second stop-loss scan)
         ↓
POST-TRADE LEARNING                  (self-learning agents update accuracy)
```

---

## 4. THE 25 SPECIALIST AGENTS

| # | Name | Category | Specialty | Has Veto? |
|---|------|----------|-----------|-----------|
| 1 | The Chart Master | TECHNICAL | Price action, chart patterns (H&S, Cup) | No |
| 2 | The Indicator King | TECHNICAL | RSI, MACD, Bollinger, EMA confluence | No |
| 3 | The Candlestick Oracle | TECHNICAL | 50+ candlestick patterns + win rates | No |
| 4 | The Volume Whisperer | TECHNICAL | Wyckoff phases, OBV, accumulation | No |
| 5 | The Multi-Timeframe Analyst | TECHNICAL | Elder Triple Screen (monthly→hourly) | No |
| 6 | The S/R Expert | TECHNICAL | Supply/demand zones, polarity principle | No |
| 7 | The Elliott Wave Master | TECHNICAL | Wave counts, Fibonacci targets | No |
| 8 | The Fundamental Analyst | FUNDAMENTAL | DCF, FCF, quality scoring (8+ = buy) | No |
| 9 | The Earnings Specialist | FUNDAMENTAL | PEAD drift, conference call analysis | No |
| 10 | The Sector Rotation Expert | FUNDAMENTAL | Economic cycle → sector money flows | No |
| 11 | The Crypto Native | FUNDAMENTAL | MVRV Z-score, on-chain, halving cycles | No |
| 12 | The Institutional Tracker | FUNDAMENTAL | 13F filings, COT, dark pool prints | No |
| 13 | The Macro Strategist | MACRO | Dalio debt cycles, Fed policy, DXY | No |
| 14 | The News Catalyst Expert | MACRO | Tier 1-3 news impact, rumor/news trade | No |
| 15 | The Geopolitical Analyst | MACRO | War/election/regulation risk playbook | No |
| 16 | The Intermarket Analyst | MACRO | Bond/dollar/gold/copper correlations | No |
| 17 | The Risk Commander | RISK | Capital preservation, 7 absolute rules | **YES** |
| 18 | The Execution Specialist | RISK | Order types, slippage, time-of-day | No |
| 19 | The Stop Loss Architect | RISK | ATR stops, trailing stops, TP structure | No |
| 20 | The Portfolio Optimizer | RISK | Kelly, correlation, Sharpe ratio | No |
| 21 | The Sentiment Oracle | INTELLIGENCE | Fear/Greed, put/call, short squeeze | No |
| 22 | The Whale Intelligence Agent | INTELLIGENCE | Funding rates, exchange flows, dark pool | No |
| 23 | The Pattern Recognition AI | INTELLIGENCE | Historical base rates, anomaly detection | No |
| 24 | The Master Coordinator | STRATEGY | CIO — synthesizes all 24, final decision | No |
| 25 | The Devil's Advocate | STRATEGY | Destroys every thesis — speaks last | No |

**Every agent has read 20 trading books encoded in MASTER_TRADING_KNOWLEDGE:**
Murphy's Technical Analysis, Van Tharp's Position Sizing, Taleb's Black Swan, Ray Dalio's Principles, Mark Douglas's Trading in the Zone, and 15 more.

---

## 5. THE 25 TOP TRADER LAWS (Hard-coded, Cannot Be Overridden)

| Law | Rule |
|-----|------|
| 1 | Never risk more than 1% of portfolio on any single trade |
| 2 | Trading fees must be less than 20% of expected profit |
| 3 | Minimum 2:1 risk/reward ratio (target 3:1+) |
| 4 | No new trades during 2-7 AM UTC (low liquidity hours) |
| 5 | DEFEND mode = no new trades until portfolio recovers |
| 6 | Minimum trade liquidity required |
| 7 | No chasing — entry within 0.5% of ideal price |
| 8 | Every trade MUST have a stop loss. No exceptions. Ever. |
| 9 | Minimum 70% agent consensus required |
| 10 | Minimum 65% average confidence required |
| 11 | No holding stocks into earnings without deliberate intent |
| 12 | Daily loss limit: -3% → halt all trading |
| 13 | Max drawdown from peak: 15% → emergency stop |
| 14 | Cash reserve must stay above 15% at all times |
| 15 | Max 3 correlated positions (all crypto = 1 bucket) |
| 16 | Cooling-off period after 3 consecutive losses |
| 17 | Every trade must have reasoning recorded in DB |
| 18 | Marginal confidence (65-75%) = 50% normal size |
| 19 | High VIX = smaller positions |
| 20 | Trail stops aggressively when profitable |
| 21 | Take profit must be defined BEFORE entering the trade |
| 22 | Stock market must be open for stock trades (9:30-4:00 PM ET) |
| 23 | Account under $500 → prefer Polymarket + Alpaca (zero fees) |
| 24 | NEVER average down a losing position |
| 25 | Meta-law: 3+ warnings with no violations = SKIP anyway |

---

## 6. MARKET APIS — COMPLETE LIST & HOW TO TEST EACH

### 6.1 APIs You Need (Priority Order for Paper Trading)

| Priority | API | Purpose | Cost | Sign Up |
|----------|-----|---------|------|---------|
| 🔴 MUST | Anthropic (Claude) | Powers all 25 agents | $0.003/1K tokens | console.anthropic.com |
| 🔴 MUST | Supabase | Database | Free tier (500MB) | supabase.com |
| 🔴 MUST | Alpaca Paper | Stock trading (zero commission) | Free | alpaca.markets |
| 🟡 HIGH | Polygon.io | Stock price data | Free tier (5 calls/min) | polygon.io |
| 🟡 HIGH | Finnhub | Stock news + earnings | Free tier (60 calls/min) | finnhub.io |
| 🟡 HIGH | Polymarket Gamma | Prediction market data | Free (public) | No key needed |
| 🟢 MED | Binance WebSocket | Crypto prices (real-time) | Free (public) | No key needed |
| 🟢 MED | Alpha Vantage | Forex + economic data | Free tier (5 calls/min) | alphavantage.co |
| 🟢 MED | NewsAPI | Market news | Free tier (100 calls/day) | newsapi.org |
| 🔵 LOW | Alternative.me | Fear & Greed index | Free (public) | No key needed |

---

### 6.2 HOW TO TEST EACH API (curl commands)

**Test 1 — Anthropic (Claude API)**
```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: YOUR_ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [{"role":"user","content":"Say OK if you can hear me"}]
  }'
# Expected: {"content":[{"text":"OK"}]...}
```

**Test 2 — Alpaca Paper Trading (account info)**
```bash
curl https://paper-api.alpaca.markets/v2/account \
  -H "APCA-API-KEY-ID: YOUR_ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: YOUR_ALPACA_SECRET"
# Expected: {"buying_power":"...","portfolio_value":"100000",...}
```

**Test 3 — Alpaca Paper: Place a paper order**
```bash
curl -X POST https://paper-api.alpaca.markets/v2/orders \
  -H "APCA-API-KEY-ID: YOUR_ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: YOUR_ALPACA_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "qty": "1",
    "side": "buy",
    "type": "market",
    "time_in_force": "day"
  }'
# Expected: {"id":"...","status":"accepted","symbol":"AAPL",...}
```

**Test 4 — Alpaca: Get latest stock price**
```bash
curl "https://data.alpaca.markets/v2/stocks/AAPL/bars/latest" \
  -H "APCA-API-KEY-ID: YOUR_ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: YOUR_ALPACA_SECRET"
# Expected: {"bar":{"c":195.5,"h":196,"l":194,"o":195,"v":5000000,...}}
```

**Test 5 — Polymarket (no key needed)**
```bash
# Get active prediction markets
curl "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=5"
# Expected: array of markets with yesPrice, noPrice, question fields

# Get specific market data
curl "https://clob.polymarket.com/markets?next_cursor=&limit=3"
# Expected: markets with orderbook data
```

**Test 6 — Polygon.io (stock data)**
```bash
curl "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/2024-01-01/2024-01-10?apiKey=YOUR_POLYGON_KEY"
# Expected: {"results":[{"c":185,"h":186,"l":184,"o":185,"v":60000000,...}]}
```

**Test 7 — Finnhub (news + earnings)**
```bash
# Stock news
curl "https://finnhub.io/api/v1/company-news?symbol=AAPL&from=2024-01-01&to=2024-01-10&token=YOUR_FINNHUB_KEY"
# Expected: [{"headline":"Apple reports...","sentiment":0.8,...}]

# Earnings calendar
curl "https://finnhub.io/api/v1/calendar/earnings?from=2024-01-01&to=2024-01-31&token=YOUR_FINNHUB_KEY"
```

**Test 8 — Binance (crypto prices, no key needed)**
```bash
# Latest BTC price
curl "https://api.binance.us/api/v3/ticker/price?symbol=BTCUSDT"
# Expected: {"symbol":"BTCUSDT","price":"67432.50"}

# 1h candles for BTC
curl "https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=10"
# Expected: [[timestamp,open,high,low,close,volume,...],...]
```

**Test 9 — Alpha Vantage (forex + macro)**
```bash
curl "https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=USD&to_symbol=EUR&apikey=YOUR_AV_KEY"
# Expected: {"Time Series FX (Daily)":{"2024-01-10":{"4. close":"0.91",...}}}
```

**Test 10 — NewsAPI**
```bash
curl "https://newsapi.org/v2/everything?q=bitcoin+stock+market&sortBy=publishedAt&pageSize=3&apiKey=YOUR_NEWSAPI_KEY"
# Expected: {"articles":[{"title":"...","description":"...","publishedAt":"..."}]}
```

**Test 11 — Alternative.me (Fear & Greed, no key)**
```bash
curl "https://api.alternative.me/fng/?limit=1"
# Expected: {"data":[{"value":"45","value_classification":"Fear","timestamp":"..."}]}
```

**Test 12 — Supabase (database connection)**
```bash
# Test via your backend's health endpoint after setup:
curl http://localhost:4000/api/auth/me
# Expected: 401 (means server is running and DB connected)
```

---

### 6.3 API KEY SETUP — EXACT STEPS

**STEP 1 — Anthropic (Claude)**
1. Go to console.anthropic.com → API Keys → Create Key
2. Copy the key (starts with `sk-ant-api03-`)
3. Add to `.env`: `ANTHROPIC_API_KEY=sk-ant-api03-...`
4. Budget: $20/month handles ~2,000 full debates (25 agents × 8 rounds each)

**STEP 2 — Alpaca Paper Trading**
1. Go to alpaca.markets → Sign Up (free, no KYC for paper)
2. Dashboard → Paper Trading section
3. Click "View" under API Keys → Generate new key
4. Copy API Key ID (starts with `PK`) and Secret Key
5. Add to `.env`:
   ```
   ALPACA_API_KEY=PKXXXXXXXXXXXXXXXXXX
   ALPACA_SECRET_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ALPACA_BASE_URL=https://paper-api.alpaca.markets
   TRADING_MODE=paper
   ```
6. Paper account starts with $100,000 virtual cash (you can reset anytime)

**STEP 3 — Polygon.io**
1. Go to polygon.io → Sign Up → Free plan
2. Dashboard → API Keys → Copy your key
3. Add to `.env`: `POLYGON_API_KEY=your_key_here`
4. Free tier: 5 calls/min, delayed data (15 min), 2 years history

**STEP 4 — Finnhub**
1. Go to finnhub.io → Sign Up → Free plan
2. Dashboard → API Key → Copy
3. Add to `.env`: `FINNHUB_API_KEY=your_key_here`
4. Free tier: 60 calls/min, real-time stock data + news

**STEP 5 — Alpha Vantage**
1. Go to alphavantage.co → Get Free API Key (just email needed)
2. Add to `.env`: `ALPHA_VANTAGE_API_KEY=your_key_here`
3. Free tier: 5 calls/min, 500 calls/day

**STEP 6 — NewsAPI**
1. Go to newsapi.org → Get API Key (free)
2. Add to `.env`: `NEWSAPI_KEY=your_key_here`
3. Free tier: 100 calls/day, 1 month history

**STEP 7 — Polymarket (no key needed for reading)**
- Reading market data is completely public — no registration
- The `POLYMARKET_GAMMA_API`, `POLYMARKET_CLOB_API` in `.env` are just URLs, not keys
- For paper trading: the system uses `isPaper=true` mode (no real transactions)
- For live Polymarket trading later: you need a Polygon wallet + USDC.e

---

## 7. PAPER TRADING SETUP — ALPACA (COMPLETE GUIDE)

### What Alpaca Paper Trading gives you:
- $100,000 virtual paper money to test with
- Same API as live trading — identical behavior
- Real stock prices from real market data
- Zero commission on all trades
- Fractional shares (buy $5 of AAPL instead of full $195 share)
- Crypto: BTC, ETH, SOL, DOGE, LINK (24/7)

### Complete Setup:
```env
# In apex-trader/backend/.env
ALPACA_API_KEY=PKXXXXXXXXXXXXXXXXXX        ← from alpaca.markets dashboard
ALPACA_SECRET_KEY=XXXXXXXXXXXXXXX          ← secret from same page
ALPACA_BASE_URL=https://paper-api.alpaca.markets   ← paper, NOT live
TRADING_MODE=paper                          ← THIS controls everything
STARTING_CAPITAL=100                        ← our real target
```

### What happens when Alpaca is configured:
1. Every debate that returns BUY/SELL → execution engine runs
2. TopTrader 25 laws validate the trade (blocks bad ones)
3. Viability check confirms fees < 20% of profit
4. Micro position sizing: $100 × 0.5% risk = $0.50 max loss per trade
5. Alpaca paper order placed → confirmed in DB
6. 10-second monitor watches for stop/profit breach
7. Trade closes → post-trade AI analysis runs

### Testing Alpaca is working:
```bash
# 1. Start backend
cd apex-trader/backend && npm run dev

# 2. Trigger a debate manually
curl -X POST http://localhost:4000/api/agents/trigger-debate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"asset":"AAPL","market":"stocks"}'

# 3. Check Alpaca paper dashboard
# Go to → alpaca.markets → Paper Trading → Orders
# You should see the order appear there
```

---

## 8. PAPER TRADING SETUP — POLYMARKET (COMPLETE GUIDE)

### What Polymarket Paper Trading gives you:
- Zero fees (no maker/taker fees at all)
- Binary outcomes (YES/NO on events) — easy to understand
- $1 minimum bet
- Our system scans 20+ markets every 30 minutes
- Kelly criterion calculates optimal bet size
- All bets saved to DB with `isPaper=true`
- No real money, no Polygon wallet needed for paper mode

### How our Polymarket engine works:
```
Every 30 minutes:
1. Fetch top 20 active markets from Polymarket Gamma API
2. For each market, ask Claude to estimate TRUE probability
3. Compare to market's implied probability (the price)
4. If our estimate differs by >8 cents = EDGE found
5. Calculate Kelly fraction = optimal bet size
6. Half-Kelly × portfolio value = actual bet size
7. Skip if: edge < 8%, confidence < 60%, bet < $1
8. Save paper bet to database
9. Track position until market resolves
```

### Example opportunity detected:
```
Market: "Will Fed cut rates in March 2025?"
Market price: YES at 42 cents (42% implied probability)
Our estimate: 55% probability of YES
Edge: +13 cents
Half-Kelly bet: $3.50 on YES
Expected profit: $3.50 × (1/0.42 - 1) × 0.55 = $2.80
```

### Polymarket env (paper mode — no wallet needed):
```env
POLYMARKET_GAMMA_API=https://gamma-api.polymarket.com
POLYMARKET_CLOB_API=https://clob.polymarket.com
POLYMARKET_DATA_API=https://data-api.polymarket.com
# Paper mode: leave these blank for now
POLYMARKET_PRIVATE_KEY=
POLYMARKET_WALLET_ADDRESS=
```

### Testing Polymarket scanner:
```bash
# The scanner runs automatically every 30 minutes
# To test immediately, call the scan endpoint:
curl -X POST http://localhost:4000/api/agents/polymarket-scan \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Or watch the logs when scheduler runs:
# You'll see: "🔍 SCANNING POLYMARKET FOR OPPORTUNITIES..."
# Then: "✅ Found X actionable Polymarket opportunities"
# Then: "📄 PAPER BET: YES $3.50 on Will Fed cut..."
```

### When to go LIVE on Polymarket (later, not now):
1. Paper trade for 60+ days with positive results
2. Create a Polygon wallet (MetaMask → switch to Polygon network)
3. Buy USDC on Polygon (via bridge from Ethereum or direct purchase)
4. Add to `.env`:
   ```env
   POLYMARKET_PRIVATE_KEY=0xYOUR_WALLET_PRIVATE_KEY
   POLYMARKET_WALLET_ADDRESS=0xYOUR_WALLET_ADDRESS
   ```
5. Start with $20-30 in USDC, not full capital

---

## 9. LONG-TERM POSITION STRATEGY

### $100 Capital Allocation Plan:
```
POLYMARKET (40% = $40)     ← Zero fees, pure probability edge
  Bet $1-5 per event
  Focus: Fed decisions, election outcomes, macro events
  Hold: days to months until resolution
  Target: 15-25% monthly return on allocated capital

CRYPTO SWINGS (35% = $35)  ← Low fees via Bybit ($1 min order)
  Position size: $0.50 max risk per trade
  Hold: 2-7 days (swing trades, not scalping)
  Target: 3:1 risk/reward, 2% gain per trade

LONG-TERM HOLDS (15% = $15) ← Buy and hold quality assets
  BTC: digital gold, 4-year cycle
  ETH: staking yield + DeFi
  Hold: 6-24 months
  Never sell on dips — only adds on strength

EMERGENCY RESERVE (10% = $10) ← Never trade this
  Cash buffer for costs, fees, unexpected events
```

### Compounding Milestones ($100 → $1,000):
```
$100 → $200   (2x): Target 60-90 days
$200 → $500   (2.5x): Target 90-150 days
$500 → $1,000 (2x): Target 60-90 days

At $200: extract $40 to separate safe account (locked profits)
At $500: extract $100 to safe account
At $1,000: extract $200 — compound the rest
```

---

## 10. VERCEL DEPLOYMENT GUIDE (FRONTEND)

### Step 1: Connect GitHub to Vercel
1. Go to vercel.com → Sign up with GitHub
2. Click **"Add New Project"**
3. Click **"Import Git Repository"**
4. Select your `tharun-trading-` repository

### Step 2: Configure the Project on Vercel
When Vercel asks for project settings, fill in EXACTLY:

```
┌─────────────────────────────────────────────────────┐
│  PROJECT CONFIGURATION ON VERCEL                    │
├─────────────────────────────────────────────────────┤
│  Framework Preset:     Vite                         │
│  Root Directory:       apex-trader/frontend         │
│  Build Command:        npm run build                │
│  Output Directory:     dist                         │
│  Install Command:      npm install                  │
│  Node.js Version:      20.x                         │
└─────────────────────────────────────────────────────┘
```

> **Why Root Directory = `apex-trader/frontend`?**
> Your GitHub repo has both backend and frontend. Vercel only needs the frontend. You must tell it where to look.

### Step 3: Add Environment Variables in Vercel
In Vercel → Project Settings → Environment Variables, add:

```
VITE_API_URL          =  https://your-backend-url.railway.app
VITE_WS_URL           =  wss://your-backend-url.railway.app
VITE_TRADING_MODE     =  paper
```

> **Note:** All frontend env vars MUST start with `VITE_` to be visible in the browser.
> You get the backend URL after deploying backend on Railway (Section 11).

### Step 4: Deploy
- Click **Deploy** → Vercel builds and deploys automatically
- Every future git push to `main` branch → auto-redeploys frontend
- Deployment takes ~2 minutes

### Step 5: Update VITE_API_URL
After backend is deployed (Section 11):
1. Go to Vercel → Project → Settings → Environment Variables
2. Update `VITE_API_URL` with actual Railway/Render backend URL
3. Redeploy: Vercel → Deployments → Redeploy

---

## 11. BACKEND DEPLOYMENT (RAILWAY — RECOMMENDED)

> Vercel cannot host the backend because Socket.io requires **persistent WebSocket connections**. Vercel serverless functions timeout after 10 seconds. Use Railway or Render instead.

### Railway (Easiest — $5/month)

**Step 1:** Go to railway.app → Connect GitHub
**Step 2:** New Project → Deploy from GitHub → Select repo
**Step 3:** Set Root Directory to `apex-trader/backend`
**Step 4:** Railway auto-detects Node.js

**Step 5: Add ALL environment variables in Railway:**
```env
PORT=4000
NODE_ENV=production
TRADING_MODE=paper
DATABASE_URL=postgresql://...supabase...
JWT_SECRET=your_secure_random_string_32chars
ENCRYPTION_KEY=your_secure_random_string_32chars
ANTHROPIC_API_KEY=sk-ant-api03-...
ALPACA_API_KEY=PKXXXXXXXXXX
ALPACA_SECRET_KEY=XXXXXXXXXX
ALPACA_BASE_URL=https://paper-api.alpaca.markets
POLYGON_API_KEY=...
FINNHUB_API_KEY=...
ALPHA_VANTAGE_API_KEY=...
NEWSAPI_KEY=...
STARTING_CAPITAL=100
MAX_RISK_PER_TRADE_PCT=0.5
MAX_POSITION_SIZE_PCT=10
POLYMARKET_GAMMA_API=https://gamma-api.polymarket.com
POLYMARKET_CLOB_API=https://clob.polymarket.com
POLYMARKET_PRIVATE_KEY=
POLYMARKET_WALLET_ADDRESS=
```

**Step 6:** Railway gives you a URL like `https://tharun-trading.up.railway.app`
**Step 7:** Copy this URL → paste into Vercel `VITE_API_URL` env variable

### Alternative: Render (Free tier — slower cold starts)
- Same process as Railway
- Free tier: service sleeps after 15min of inactivity
- Railway recommended for trading (must stay awake 24/7)

---

## 12. FRONTEND env FILE (Local Development)

Create `apex-trader/frontend/.env.local`:
```env
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000
VITE_TRADING_MODE=paper
```

This file is git-ignored. Never commit it.

---

## 13. BACKEND .env FILE (Local Development)

Located at `apex-trader/backend/.env`:
```env
# Server
PORT=4000
NODE_ENV=development
TRADING_MODE=paper

# Database
DATABASE_URL=postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres

# Auth
JWT_SECRET=change_this_to_random_32_char_string
ENCRYPTION_KEY=change_this_to_random_32_char_string

# AI
ANTHROPIC_API_KEY=sk-ant-api03-YOUR_KEY

# Trading — Paper First
ALPACA_API_KEY=PKXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ALPACA_SECRET_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ALPACA_BASE_URL=https://paper-api.alpaca.markets

# Market Data
POLYGON_API_KEY=mVVNKbjo9fZF523sen8wPITwz7esJXFm
ALPHA_VANTAGE_API_KEY=8WSVRCCM2WJW14PN
NEWSAPI_KEY=289b7f5a-52d6-48da-a554-1a4af03595db
FINNHUB_API_KEY=d7e4rupr01qkuebivk00d7e4rupr01qkuebivk0g

# Capital (Paper Trading)
STARTING_CAPITAL=100
MAX_RISK_PER_TRADE_PCT=0.5
MAX_POSITION_SIZE_PCT=10

# Polymarket (paper — no wallet needed yet)
POLYMARKET_GAMMA_API=https://gamma-api.polymarket.com
POLYMARKET_DATA_API=https://data-api.polymarket.com
POLYMARKET_CLOB_API=https://clob.polymarket.com
POLYMARKET_PRIVATE_KEY=
POLYMARKET_WALLET_ADDRESS=

# Supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key
```

---

## 14. HOW TO RUN LOCALLY (Step by Step)

```bash
# Terminal 1 — Backend
cd "apex-trader/backend"
npm install
npx prisma db push        # creates all DB tables
npm run dev               # starts on port 4000

# Terminal 2 — Frontend
cd "apex-trader/frontend"
npm install
npm run dev               # starts on port 5173

# Open browser: http://localhost:5173
# Login: nandigam2081@gmail.com / Tharunsai@2081
```

**Expected backend log on start:**
```
✅ Tharun Trading Scheduler initialized:
   ⏱️ Investment Committee debates every 90 seconds
   🛑 Stop-loss monitor every 10 seconds
   📸 Portfolio snapshots every 5 minutes
   🌍 Market regime detection every hour
   🎯 Polymarket opportunity scan every 30 minutes
   📓 Daily journal at 11:59 PM
   📊 Weekly report every Sunday 8 AM
   🎓 Post-trade learning every 2 minutes
```

---

## 15. API TESTING CHECKLIST (Run These Before Deploying)

Run each test in order. All must pass before deploying to production.

```bash
# ✅ Test 1: Backend is running
curl http://localhost:4000/api/settings
# Expected: 200 OK with settings JSON

# ✅ Test 2: Authentication works
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nandigam2081@gmail.com","password":"Tharunsai@2081"}'
# Expected: {"token":"eyJ...","user":{...}}

# ✅ Test 3: Market prices loading
curl http://localhost:4000/api/market/prices \
  -H "Authorization: Bearer TOKEN_FROM_ABOVE"
# Expected: [{"asset":"BTC","price":67432,"change24h":2.1},...]

# ✅ Test 4: Portfolio loads
curl http://localhost:4000/api/portfolio \
  -H "Authorization: Bearer TOKEN"
# Expected: {"totalValue":100,"cashBalance":100,"positions":[]}

# ✅ Test 5: Polymarket data accessible
curl "https://gamma-api.polymarket.com/markets?active=true&limit=3"
# Expected: Array of 3 prediction markets

# ✅ Test 6: Trigger a test debate
curl -X POST http://localhost:4000/api/agents/trigger-debate \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"asset":"BTC","market":"crypto"}'
# Expected: Debate starts, watch logs for 25 agents analyzing

# ✅ Test 7: Alpaca paper account
curl https://paper-api.alpaca.markets/v2/account \
  -H "APCA-API-KEY-ID: YOUR_ALPACA_KEY" \
  -H "APCA-API-SECRET-KEY: YOUR_ALPACA_SECRET"
# Expected: account JSON with buying_power

# ✅ Test 8: Kill switch works
curl -X POST http://localhost:4000/api/kill-switch/activate \
  -H "Authorization: Bearer TOKEN"
# Expected: All trading halts immediately
```

---

## 16. SCHEDULED JOBS — WHAT RUNS WHEN

| Schedule | Job | File |
|----------|-----|------|
| Every 90 seconds | 25-agent debate on random crypto asset | scheduler.ts |
| Every 10 seconds | Stop-loss and take-profit monitor | riskManager.ts |
| Every 5 minutes | Portfolio snapshot saved to DB | scheduler.ts |
| Every 30 minutes | Polymarket opportunity scan | polymarket.ts |
| Every hour | Market regime detection for all assets | regimeDetector.ts |
| Every 2 minutes | Post-trade learning for closed trades | selfLearning.ts |
| 11:59 PM daily | AI daily journal generation | journalGenerator.ts |
| Every Sunday 8 AM | Weekly performance report | selfLearning.ts |

---

## 17. ACCOUNT PROTECTION MODES

The system automatically switches between 4 modes based on portfolio performance:

| Mode | Triggers When | Risk Multiplier | Rules |
|------|--------------|-----------------|-------|
| **NORMAL** | Default, healthy state | 100% (0.5% per trade) | Full operation |
| **CAUTION** | Down 6-12% from peak OR -1.5% today | 60% (0.3% per trade) | Swing trades only, no scalping |
| **RECOVERY** | Down 12-20% from peak OR -3% today | 40% (0.2% per trade) | 80%+ confidence needed, 1 trade at a time |
| **DEFEND** | Down 20%+ from peak OR -5% today | 20% (0.1% per trade) | Polymarket only, no crypto/stocks |

---

## 18. GOING LIVE — CHECKLIST (AFTER PAPER TRADING WORKS)

### Before switching `TRADING_MODE=live`:

**Alpaca Live Trading:**
- [ ] Paper traded for 30+ days with positive overall P&L
- [ ] Win rate consistently above 55%
- [ ] No single trade lost more than 1.5% of portfolio
- [ ] Kill switch tested and confirmed working
- [ ] Daily loss limit tested (auto-stops at -3%)
- [ ] Funded Alpaca live account with real money ($100+)
- [ ] Updated `.env`: `ALPACA_BASE_URL=https://api.alpaca.markets`
- [ ] Updated `.env`: `TRADING_MODE=live`

**Polymarket Live Trading:**
- [ ] Paper bet system showing positive expected value over 60 days
- [ ] Created MetaMask wallet
- [ ] Switched MetaMask to Polygon network
- [ ] Purchased USDC.e on Polygon (start with $20-40)
- [ ] Added wallet private key to `.env`
- [ ] Tested with $1 bet first before larger bets
- [ ] Confirmed: `isPaper=false` in bet placement call

---

## 19. WEBSOCKET EVENTS (Frontend ↔ Backend)

| Event | Direction | Data | Used In |
|-------|-----------|------|---------|
| `price:update` | Server→Client | `{asset, price, change24h}` | Live Ticker |
| `debate:start` | Server→Client | `{asset, totalAgents:25}` | Debate Room |
| `debate:stage-complete` | Server→Client | `{stage, result}` | Pipeline view |
| `agent:voted` | Server→Client | `{agentId, vote, confidence}` | Agent Council |
| `debate:complete` | Server→Client | `{decision, confidence}` | Dashboard |
| `trade:executed` | Server→Client | `{trade, mode}` | Trades page |
| `position:closed` | Server→Client | `{asset, pnl, reason}` | Toast alert |
| `polymarket:scanning` | Server→Client | `{portfolioValue}` | Dashboard |
| `polymarket:scan-complete` | Server→Client | `{opportunities[]}` | Dashboard |
| `guardrail:triggered` | Server→Client | `{law, reason}` | Alert banner |
| `analysis:stage-start` | Server→Client | `{stage, name}` | Pipeline |

---

## 20. DATABASE SCHEMA (Key Tables)

```
User          — email, passwordHash, jwtSecret
Portfolio     — totalValue, cashBalance, pnlDay, pnlTotal, drawdownFromPeak
Position      — asset, market, quantity, entryPrice, stopLoss, takeProfit
Trade         — asset, type, entryPrice, exitPrice, pnlUSD, status, agentDecisionId
AgentDecision — asset, signal, agentVotes[], avgConfidence, executed
PortfolioSnapshot — totalValue (every 5 min for charts)
Prediction    — Polymarket paper bets (asset=POLYMARKET, direction, confidence)
SystemLog     — tax events, errors, important events
NewsArticle   — title, sentiment, source, timestamp
TradingJournal — date, content (AI-written daily diary)
```

---

## 21. TECHNOLOGY STACK SUMMARY (Quick Reference)

```
Layer          Technology                    Version
─────────────────────────────────────────────────────
Frontend       React                         18.x
               Vite                          5.x
               TypeScript                    5.x
               Tailwind CSS                  3.x
               Zustand                       4.x
               TanStack Query                5.x
               Socket.io-client              4.x
               Recharts                      2.x
               lightweight-charts            4.x
               lucide-react                  (icons)

Backend        Node.js                       20.x
               Express                       4.x
               TypeScript                    5.x
               Prisma                        5.x
               Socket.io                     4.x
               node-cron                     3.x
               ethers                        6.x
               axios                         1.x
               jsonwebtoken                  9.x
               bcryptjs                      2.x
               speakeasy                     2.x (TOTP)
               winston                       3.x

Database       PostgreSQL (via Supabase)      15.x
               Prisma ORM                    5.x

AI             @anthropic-ai/sdk             0.30+
               Model: claude-sonnet-4-20250514
               Agents: 25 specialists
               Pipeline: 12 mandatory stages

Brokers        @alpacahq/alpaca-trade-api    3.x
               ethers.js                     (Polymarket)
               @binance/connector            (crypto)

Hosting        Frontend → Vercel
               Backend  → Railway ($5/mo) or Render (free)
               Database → Supabase (free 500MB)
               Total cost: ~$5-15/month
```

---

## 22. PAPER TRADING → LIVE TRADING TRANSITION

```
PHASE 1 (NOW) — Paper Everything:
  Trading mode: paper
  Alpaca: paper-api.alpaca.markets ($100,000 virtual)
  Polymarket: isPaper=true (saved to DB only)
  Goal: Prove the system works, tune the 25 laws

PHASE 2 (30 days later) — Alpaca Live + Polymarket Paper:
  Alpaca: api.alpaca.markets (real $100)
  Polymarket: still isPaper=true
  Goal: Verify execution, slippage, real order behavior

PHASE 3 (60 days later) — Full Live:
  Alpaca: live ($100 growing toward $1,000)
  Polymarket: real USDC bets ($1-5 per event)
  Goal: Let the compound engine run
```

---

*Tharun Trading Agent — Built for $100. Protected by 25 laws. Powered by 25 AI agents. Paper first, profit second.*
