# ⚡ APEX TRADER — Autonomous Multi-Agent AI Trading Platform

> **Built for one owner. Powered by 10 AI agents. Protected by military-grade guardrails.**

---

## 🚀 QUICK START (Step by Step)

### Step 1: Prerequisites
```bash
# Install required tools
node --version    # Need v20+
docker --version  # Need Docker Desktop running
```

### Step 2: Clone & Setup
```bash
git clone https://github.com/YOUR_USERNAME/apex-trader.git
cd apex-trader
```

### Step 3: Configure Environment
```bash
cd backend
cp .env.example .env
# Edit .env and fill in ALL API keys (see Section 3 of PRD)
```

### Step 4: Start Database
```bash
# From project root
docker-compose up -d
# Wait 10 seconds for postgres to start
```

### Step 5: Setup Database
```bash
cd backend
npm install
cp src/prisma/schema.prisma prisma/schema.prisma
npx prisma generate
npx prisma migrate dev --name init
```

### Step 6: Create Your Owner Account
```bash
# Start backend temporarily
npm run dev

# In another terminal, create your account:
curl -X POST http://localhost:4000/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"YourSecurePassword123!","setupKey":"YOUR_ENCRYPTION_KEY_FROM_ENV"}'

# Save the totpSecret shown — scan QR with Google Authenticator
```

### Step 7: Start Frontend
```bash
cd ../frontend
npm install
npm run dev
# Open http://localhost:3000
```

### Step 8: Login
- Open http://localhost:3000
- Enter your email + password
- Enter your 6-digit TOTP code from Google Authenticator

---

## 🏗️ Project Structure

```
apex-trader/
├── backend/              # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── agents/      # All 10 AI agents + orchestrator + voting engine
│   │   ├── trading/     # Execution engine, risk manager, stop-loss
│   │   ├── services/    # Market data, portfolio, journal generator
│   │   ├── jobs/        # Bull queue scheduler (analysis every 60s)
│   │   ├── websocket/   # Socket.io real-time server
│   │   ├── routes/      # REST API endpoints
│   │   └── utils/       # Logger, Redis, Prisma singletons
│   └── .env             # ALL YOUR API KEYS (never commit this)
│
├── frontend/             # React 18 + TypeScript + Tailwind
│   └── src/
│       ├── pages/       # Dashboard, Portfolio, Trades, Agents, Charts...
│       ├── components/  # AgentCouncilPanel, Charts, Positions, RiskMonitor
│       ├── store/       # Zustand global state
│       └── services/    # API calls + Socket.io client
│
└── docker-compose.yml    # PostgreSQL + Redis for local dev
```

---

## 🤖 The 10-Agent Council

| # | Agent | Role | Veto? |
|---|-------|------|-------|
| 1 | The Technician | RSI, MACD, Bollinger, EMA, candlestick patterns | No |
| 2 | The Newshound | Breaking news, earnings, regulatory events | No |
| 3 | The Sentiment Analyst | Fear & Greed, social mood, options sentiment | No |
| 4 | The Fundamental Analyst | P/E, revenue, market cap, tokenomics | No |
| 5 | **The Risk Manager** | Capital preservation, portfolio risk | **YES — VETO** |
| 6 | The Trend Prophet | AI future price prediction, trend analysis | No |
| 7 | The Volume Detective | OBV, volume spikes, accumulation/distribution | No |
| 8 | The Whale Watcher | Institutional flows, on-chain activity | No |
| 9 | The Macro Economist | Fed policy, rates, global risk sentiment | No |
| 10 | The Devil's Advocate | Argues AGAINST every trade — finds flaws | Soft block |

**7/10 votes required to execute. Risk Manager has absolute veto.**

---

## 🛡️ Guardrails

| Rule | Default | Action |
|------|---------|--------|
| Daily Loss Limit | 5% | Halt trading for the day |
| Weekly Drawdown | 10% | Pause — require manual override |
| Max Drawdown | 20% | EMERGENCY STOP + kill switch |
| Cash Reserve | 30% | Never deploy more than 70% |
| Max Risk/Trade | 1% | Hard position size cap |
| Max Trades/Day | 50 | Prevents runaway loops |
| Stop Loss (Crypto) | 3% | Auto-placed on every trade |
| Stop Loss (Stocks) | 2% | Auto-placed on every trade |

---

## 🌐 Deployment

### Backend → Railway.app
```bash
npm install -g @railway/cli
railway login
railway up --service apex-backend
# Set all .env variables in Railway dashboard
```

### Frontend → Vercel
```bash
npm install -g vercel
cd frontend
vercel --prod
```

---

## ⚠️ PAPER TRADING FIRST

**NEVER go live until:**
- [ ] Paper traded for 2+ weeks with positive P&L
- [ ] All guardrails tested and confirmed working
- [ ] Kill switch tested — halts within 1 second
- [ ] Daily loss limit tested — halts trading when hit
- [ ] 2FA working on your account
- [ ] Broker API: trade-only, NO withdrawal permissions

To switch to live mode:
```env
TRADING_MODE=live
ALPACA_BASE_URL=https://api.alpaca.markets
```

---

## 📊 API Endpoints

```
POST /api/auth/login         - Login (email + password + TOTP)
POST /api/auth/setup         - One-time owner account creation
GET  /api/portfolio          - Current portfolio state
GET  /api/portfolio/positions - Open positions
GET  /api/portfolio/snapshots - Historical value data
GET  /api/trades             - Trade history (paginated)
GET  /api/trades/stats       - Win rate, P&L stats
GET  /api/agents/decisions   - Council voting history
GET  /api/market/prices      - Current live prices
GET  /api/market/news        - Analyzed news feed
GET  /api/journal            - Daily AI journal entries
GET  /api/settings           - Current guardrail settings
POST /api/kill-switch/activate   - Emergency halt
POST /api/kill-switch/deactivate - Resume trading
GET  /api/kill-switch/status     - Kill switch state
GET  /health                 - System health check
```

---

## 📱 Dashboard Pages

| Page | Path | Content |
|------|------|---------|
| Dashboard | / | Real-time P&L, agent council, positions, risk monitor |
| Portfolio | /portfolio | Holdings, allocation chart, value history |
| Trades | /trades | Full trade table with stats |
| Agent Council | /agents | Live 10-agent panel + decision history |
| Charts | /charts | TradingView candlestick charts (real Binance data) |
| Analytics | /analytics | Win rate, P&L charts, performance metrics |
| Journal | /journal | AI-generated daily entries |
| News | /news | Analyzed market news with sentiment |
| History | /history | Complete trade archive |
| Settings | /settings | Guardrail configuration |

---

*APEX TRADER — The most powerful autonomous trading system for a single owner.*
*Built with Claude AI • 10-Agent Council • Zero Human Interference*
