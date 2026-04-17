# THARUN TRADING PLATFORM - COMPLETE END-TO-END ARCHITECTURE
## Technical System Design & Infrastructure

---

## 📐 SYSTEM OVERVIEW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND LAYER                              │
│                      (React + TailwindCSS)                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Dashboard | Analysis | Positions | Intelligence | Settings  │  │
│  │ Components powered by Real-time WebSocket updates           │  │
│  │ UI Theme: Warm White bg, Orange primary, Green/Red accents │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
              ↑                                           ↓
        WebSocket                                  REST API + WebSocket
    Real-time updates                              (Secure, JWT Auth)
         ↑                                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    API GATEWAY LAYER                                │
│            (Express.js on Node.js - Port 3000)                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Authentication Middleware (JWT tokens + httpOnly cookies)   │  │
│  │ Rate Limiting (500 req/15 min)                              │  │
│  │ CORS + Security Headers                                     │  │
│  │ Request Validation & Error Handling                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
              ↑                                           ↓
         Routes                                    Business Logic
         ↑                                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      BACKEND LOGIC LAYER                            │
│              (TypeScript microservices architecture)                │
│                                                                     │
│  AGENT LAYER (25 Specialist Agents)                                │
│  ├─ Technical Agents (7): Chart Master, Indicator King, etc.     │
│  ├─ Fundamental Agents (3): Analyst, Earnings Expert, etc.       │
│  ├─ Macro Agents (2): Strategist, Intermarket Analyst            │
│  ├─ Risk Agents (2): Risk Commander, Volatility Expert           │
│  ├─ Intelligence Agents (5): Sentiment Oracle, Options Flow, etc. │
│  ├─ Strategy Agents (4): Sector Rotation, Volume Whisperer, etc. │
│  └─ Meta Agents (2): Devil's Advocate, Master Coordinator        │
│                                                                     │
│  ANALYSIS PIPELINE (12-Stage Engine)                               │
│  ├─ Stage 1-4: Macro Gate + Fundamental Screening               │
│  ├─ Stage 5-8: Technical Analysis Deep Dive                     │
│  ├─ Stage 9-10: Intelligence Layer Confirmation                 │
│  └─ Stage 11-12: Risk & Investment Committee                    │
│                                                                     │
│  CORE SERVICES                                                     │
│  ├─ Agent Service (Orchestrate agent calls to Claude API)        │
│  ├─ Analysis Service (Manage 12-stage pipeline)                  │
│  ├─ Intelligence Service (Real-time market data processing)      │
│  ├─ Position Service (Track open trades)                         │
│  ├─ Risk Service (Calculate position sizing, guardrails)         │
│  ├─ Chart Service (Market data + technical levels)               │
│  └─ Broker Integration Service (Paper trade → Real broker later) │
│                                                                     │
│  KNOWLEDGE SYSTEMS                                                 │
│  ├─ Master Knowledge Base (20+ trading books internalized)        │
│  ├─ Strategy Library (All proven trading patterns)               │
│  ├─ Risk Rules Engine (Van Tharp position sizing, Kelly, etc.)  │
│  └─ Market Regime Database (Historical regime patterns)          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
              ↑                                           ↓
       Internal APIs                              Market Data Feeds
         ↑                                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL INTEGRATIONS                            │
│                                                                     │
│  AI ENGINE                                                          │
│  └─ Anthropic Claude API (claude-3-sonnet for all agent calls)    │
│                                                                     │
│  MARKET DATA FEEDS (Real-time + Historical)                        │
│  ├─ IEX Cloud (stock quotes, company data, news)                  │
│  ├─ Alpha Vantage (technical indicators, intraday data)           │
│  ├─ Finnhub (earnings calendar, economic calendar, sentiment)    │
│  ├─ Polygon.io (options data, volume profile)                     │
│  ├─ CoinGecko API (crypto prices + on-chain metrics)             │
│  └─ NewsAPI (global news + NLP sentiment scoring)                │
│                                                                     │
│  BROKER INTEGRATION (Paper Trading → Live Broker)                  │
│  ├─ Alpaca API (paper trading + live brokerage)                   │
│  ├─ TradeStation API (futures + options)                          │
│  └─ Crypto: Coinbase Pro / Kraken APIs                            │
│                                                                     │
│  NLP & SENTIMENT ENGINES                                           │
│  ├─ Natural Language Processing: transformers library             │
│  ├─ Sentiment Scoring: finBERT (financial sentiment)             │
│  ├─ Social Media Analysis: Twitter API + Reddit API               │
│  └─ Time Decay: Recency weighting on sentiment scores            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
              ↑                                           ↓
         Queries                                  Data Persistence
         ↑                                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    DATA PERSISTENCE LAYER                           │
│                    (PostgreSQL + Redis)                             │
│                                                                     │
│  PRIMARY DATABASE (PostgreSQL on Supabase)                         │
│  ├─ Users (credentials, preferences, API keys)                    │
│  ├─ Positions (active trades, historical)                         │
│  ├─ Analyses (all 12-stage analysis results)                      │
│  ├─ AgentLearning (learning snapshots per agent/asset)           │
│  ├─ MacroIndicators (economic data snapshots)                     │
│  ├─ GeopoliticalEvents (global events tracking)                   │
│  ├─ SystemLogs (all agent activity + decisions)                   │
│  └─ TransactionHistory (all trades executed)                      │
│                                                                     │
│  CACHE LAYER (Redis)                                               │
│  ├─ Current market prices (30-sec TTL)                            │
│  ├─ Technical indicators (1-min TTL)                              │
│  ├─ Correlation matrix (5-min TTL)                                │
│  ├─ User sessions (24-hour TTL)                                   │
│  └─ Agent knowledge states (real-time)                            │
│                                                                     │
│  FILE STORAGE (AWS S3)                                             │
│  ├─ User-generated reports & exports                              │
│  ├─ Historical chart images                                        │
│  ├─ Backtest results archives                                      │
│  └─ Model snapshots for agent training                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
              ↑                                           ↓
         Write Queries                           External APIs
         ↑                                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      INFRASTRUCTURE                                 │
│                                                                     │
│  DEPLOYMENT                                                         │
│  ├─ Frontend: Vercel (auto-deploy from git)                       │
│  ├─ Backend: Railway or Render (auto-deploy, serverless ready)   │
│  └─ Database: Supabase (managed PostgreSQL)                        │
│                                                                     │
│  MONITORING & LOGGING                                              │
│  ├─ Sentry (error tracking + performance monitoring)              │
│  ├─ DataDog (infrastructure monitoring)                           │
│  ├─ ELK Stack (centralized logging)                               │
│  └─ Custom dashboards (agent activity tracking)                   │
│                                                                     │
│  SECURITY                                                           │
│  ├─ SSL/TLS encryption (all traffic)                              │
│  ├─ JWT authentication (secure token exchange)                    │
│  ├─ Rate limiting (prevent abuse)                                 │
│  ├─ Input validation (prevent injection)                          │
│  ├─ Audit logging (all sensitive operations tracked)              │
│  └─ 2FA support (multi-factor authentication)                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ DIRECTORY STRUCTURE

```
tharun-trading/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard/
│   │   │   │   ├── PortfolioSummary.tsx
│   │   │   │   ├── IntelligenceFeed.tsx
│   │   │   │   ├── AgentHeatmap.tsx
│   │   │   │   └── AlertsPanel.tsx
│   │   │   │
│   │   │   ├── Analysis/
│   │   │   │   ├── AnalysisInitiator.tsx (start new analysis)
│   │   │   │   ├── StagePipeline.tsx (show 12-stage progress)
│   │   │   │   ├── StageCard.tsx (individual stage display)
│   │   │   │   ├── ChartViewer.tsx (TradingView integration)
│   │   │   │   └── DecisionPanel.tsx (final buy/sell/hold)
│   │   │   │
│   │   │   ├── Positions/
│   │   │   │   ├── PositionsList.tsx (active positions)
│   │   │   │   ├── PositionDetail.tsx (single position)
│   │   │   │   ├── RealTimeMonitor.tsx (P/L updates)
│   │   │   │   └── ExitPanel.tsx (close position UI)
│   │   │   │
│   │   │   ├── Intelligence/
│   │   │   │   ├── AgentActivityFeed.tsx
│   │   │   │   ├── CorrelationMatrix.tsx
│   │   │   │   ├── SentimentDashboard.tsx
│   │   │   │   ├── OptionsFlowAnalysis.tsx
│   │   │   │   ├── MacroEnvironment.tsx
│   │   │   │   └── NewsCalendar.tsx
│   │   │   │
│   │   │   ├── Common/
│   │   │   │   ├── Header.tsx
│   │   │   │   ├── Navigation.tsx
│   │   │   │   ├── ThemeToggle.tsx
│   │   │   │   ├── LoadingSpinner.tsx
│   │   │   │   └── AlertNotification.tsx
│   │   │   │
│   │   │   └── Auth/
│   │   │       ├── LoginPage.tsx
│   │   │       ├── RegisterPage.tsx
│   │   │       └── ProtectedRoute.tsx
│   │   │
│   │   ├── pages/
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── AnalysisPage.tsx
│   │   │   ├── PositionsPage.tsx
│   │   │   ├── IntelligencePage.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   └── LoginPage.tsx
│   │   │
│   │   ├── services/
│   │   │   ├── api.ts (Axios instance with JWT)
│   │   │   ├── analysisService.ts (call backend analysis)
│   │   │   ├── positionService.ts (manage positions)
│   │   │   ├── intelligenceService.ts (fetch intel data)
│   │   │   ├── authService.ts (login/logout/register)
│   │   │   └── websocketService.ts (real-time updates)
│   │   │
│   │   ├── store/
│   │   │   ├── authStore.ts (user auth state)
│   │   │   ├── positionStore.ts (positions state)
│   │   │   ├── analysisStore.ts (current analysis state)
│   │   │   └── uiStore.ts (UI preferences, theme)
│   │   │
│   │   ├── styles/
│   │   │   ├── index.css (base styles)
│   │   │   ├── theme.css (orange/white/green/red theme)
│   │   │   └── animations.css (smooth transitions)
│   │   │
│   │   ├── App.tsx (main app component)
│   │   ├── main.tsx (entry point)
│   │   └── vite-env.d.ts (vite types)
│   │
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js (orange primary)
│   ├── tsconfig.json
│   └── .env.example
│
├── backend/
│   ├── src/
│   │   ├── agents/
│   │   │   ├── agents25.ts (all 25 agents with prompts)
│   │   │   ├── analysisPipeline.ts (12-stage orchestration)
│   │   │   ├── debateEngine.ts (3-round voting system)
│   │   │   ├── votingEngine.ts (calculate consensus)
│   │   │   ├── expertPrompts.ts (all system prompts)
│   │   │   ├── orchestrator.ts (coordinate agent calls)
│   │   │   └── types.ts (agent interfaces + types)
│   │   │
│   │   ├── knowledge/
│   │   │   ├── masterKnowledge.ts (20+ books content)
│   │   │   ├── strategies.ts (all trading patterns)
│   │   │   ├── riskRules.ts (Kelly, Van Tharp, etc.)
│   │   │   └── regimeLibrary.ts (market regimes)
│   │   │
│   │   ├── services/
│   │   │   ├── agentActivityLogger.ts (log all agent decisions)
│   │   │   ├── analysisService.ts (orchestrate 12-stage)
│   │   │   ├── positionService.ts (manage open trades)
│   │   │   ├── riskService.ts (sizing + guardrails)
│   │   │   ├── chartService.ts (fetch + process chart data)
│   │   │   ├── intelligenceService.ts (macro/sentiment/options)
│   │   │   ├── marketDataService.ts (real-time prices)
│   │   │   ├── sentimentService.ts (NLP scoring)
│   │   │   ├── optionsFlowService.ts (options intelligence)
│   │   │   ├── correlationService.ts (real-time correlation matrix)
│   │   │   ├── liquidityService.ts (liquidity assessment)
│   │   │   ├── earningsService.ts (earnings calendar blocking)
│   │   │   ├── sectorRotationService.ts (sector tracking)
│   │   │   ├── intermarketService.ts (DXY vs crypto analysis)
│   │   │   ├── socialMediaService.ts (volume anomalies)
│   │   │   ├── premarketService.ts (pre-market analysis)
│   │   │   ├── regimeTransitionService.ts (regime scoring)
│   │   │   ├── authService.ts (JWT + login/register)
│   │   │   ├── brokerService.ts (Alpaca integration)
│   │   │   └── notificationService.ts (alerts + emails)
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.ts (login, register, verify)
│   │   │   ├── analysis.ts (new analysis, history)
│   │   │   ├── positions.ts (open/closed trades)
│   │   │   ├── intelligence.ts (all intelligence endpoints)
│   │   │   ├── chart.ts (chart data + levels)
│   │   │   ├── agentMonitor.ts (agent activity tracking)
│   │   │   ├── dashboard.ts (unified dashboard data)
│   │   │   ├── backtest.ts (strategy backtesting)
│   │   │   ├── settings.ts (user preferences)
│   │   │   └── index.ts (route registration)
│   │   │
│   │   ├── middleware/
│   │   │   ├── auth.ts (JWT verification + role checks)
│   │   │   ├── errorHandler.ts (centralized error handling)
│   │   │   ├── rateLimit.ts (500 req/15min)
│   │   │   ├── validation.ts (input validation)
│   │   │   └── logging.ts (request/response logging)
│   │   │
│   │   ├── websocket/
│   │   │   ├── server.ts (Socket.io setup)
│   │   │   ├── handlers/
│   │   │   │   ├── position.ts (position P/L updates)
│   │   │   │   ├── agent.ts (agent activity broadcasts)
│   │   │   │   ├── market.ts (price updates)
│   │   │   │   └── alerts.ts (trade alert notifications)
│   │   │   └── events.ts (event type definitions)
│   │   │
│   │   ├── jobs/
│   │   │   ├── scheduler.ts (Bull queue for background jobs)
│   │   │   ├── dailyPreMarketAnalysis.ts (run before market open)
│   │   │   ├── correlationMatrixUpdate.ts (update every 5 min)
│   │   │   ├── earningsAlerts.ts (check earnings calendar)
│   │   │   ├── sentimentUpdate.ts (refresh NLP scores)
│   │   │   ├── regimeTransitionCheck.ts (check regime changes)
│   │   │   └── portfolioHealthCheck.ts (monitor positions)
│   │   │
│   │   ├── prisma/
│   │   │   ├── schema.prisma (database schema)
│   │   │   └── seed.ts (initial data)
│   │   │
│   │   ├── utils/
│   │   │   ├── prisma.ts (DB client)
│   │   │   ├── logger.ts (structured logging)
│   │   │   ├── errors.ts (custom error classes)
│   │   │   ├── validators.ts (input validation rules)
│   │   │   ├── cache.ts (Redis cache helpers)
│   │   │   ├── env.ts (environment variables)
│   │   │   └── constants.ts (app constants)
│   │   │
│   │   ├── types/
│   │   │   ├── agent.ts (Agent interface)
│   │   │   ├── analysis.ts (AnalysisResult interface)
│   │   │   ├── position.ts (Position interface)
│   │   │   ├── market.ts (MarketData interface)
│   │   │   ├── intelligence.ts (Intelligence interface)
│   │   │   └── api.ts (API request/response types)
│   │   │
│   │   ├── index.ts (Express app initialization)
│   │   └── server.ts (start server)
│   │
│   ├── tests/
│   │   ├── agents.test.ts
│   │   ├── analysisEngine.test.ts
│   │   ├── riskManagement.test.ts
│   │   └── debateEngine.test.ts
│   │
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   │
│   ├── logs/ (generated at runtime)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── docker-compose.yml (PostgreSQL + Redis)
│
├── docker-compose.yml (full stack)
├── README.md
├── .gitignore
└── package.json (monorepo root)
```

---

## 🔄 DATA FLOW EXAMPLES

### Flow 1: New Analysis Request

```
USER ACTION: Click "Analyze AAPL"
     ↓
FRONTEND: POST /api/analysis/new
  { asset: "AAPL", market: "stocks" }
     ↓
BACKEND AUTH MIDDLEWARE: Verify JWT token
     ↓
BACKEND ANALYSIS ROUTE:
  1. Call analysisService.startAnalysis()
  2. Queue job: "analysis-aapl-timestamp"
     ↓
ANALYSIS SERVICE (12 Stages):
  ├─ Stage 1-4: Call agents 13,16 (macro) → agents 14,15 (news)
  │ → agents 10,12 (sector) → agents 8,9,11 (fundamentals)
  │
  ├─ If any stage fails: RETURN STOP with reason
  │
  ├─ Stage 5-8: Call agent 5 (multi-TF) → agent 6 (S/R)
  │ → agent 1 (patterns) → agent 2 (indicators)
  │
  ├─ Stage 9-10: Call agent 7 (volume) → agent 17 (sentiment)
  │ → agent 18 (options flow)
  │
  └─ Stage 11-12: Call agent 19 (risk) → ALL agents (debate)
       → agent 25 (devil's advocate) → agent 24 (coordinator)
     ↓
FOR EACH AGENT CALL:
  1. Build system prompt (includes MASTER_TRADING_KNOWLEDGE)
  2. Add current market data context
  3. Call Claude API (Anthropic)
  4. Parse response (JSON structured output)
  5. Log to database via agentActivityLogger
  6. Cache result in Redis
     ↓
COLLECT ALL RESULTS:
  - All 12 stage results
  - Chart annotations (what to draw)
  - Final decision + confidence
  - Entry/stop/target prices
     ↓
RETURN TO FRONTEND:
  {
    analysisId: uuid,
    stages: [stage1Result, stage2Result, ...],
    finalDecision: "BUY",
    confidence: 86,
    entry: 172.45,
    stopLoss: 167.50,
    targets: [180, 190, 195],
    chartAnnotations: [...],
    timestamp: Date
  }
     ↓
FRONTEND: Display 12-stage pipeline with all results
  - Show each stage result in real-time (as they complete)
  - Draw chart with all levels marked in ORANGE
  - Show risk/reward calculations
  - Ask user to CONFIRM or REJECT
```

### Flow 2: Position Execution

```
USER ACTION: Click [✅ CONFIRM BUY]
     ↓
FRONTEND: POST /api/positions/execute
  {
    analysisId: uuid,
    action: "BUY",
    entryPrice: 172.45,
    scaledEntry: true
  }
     ↓
BACKEND POSITION SERVICE:
  1. Verify position size against guardrails (2% = $2,000)
  2. Verify stop loss is set (hard stop at $167.50)
  3. Verify targets are set (3 exit levels)
  4. Create Position record in database
     ↓
BROKER INTEGRATION SERVICE (Alpaca):
  1. Send market order for 1/3 (19 shares)
  2. Send 2 limit orders (1/3 each at $171, $170)
  3. Set profit targets (sell orders at $180, $190, $195)
  4. Set stop loss (sell all at $167.50)
     ↓
IF EXECUTION SUCCESSFUL:
  1. Position record: status = "OPEN"
  2. Emit WebSocket: "position:opened"
  3. Subscribe to real-time price feed
  4. Subscribe to limit order fills
     ↓
SUBSCRIBE TO REAL-TIME UPDATES:
  - Market price updates every 1 second
  - P/L calculated and cached in Redis
  - Stop loss distance monitored
  - Target distance monitored
     ↓
FRONTEND REAL-TIME DISPLAY:
  - Shows "Entry: $172.45 | Current: $173.20 | Profit: +$55"
  - Updates every second via WebSocket
  - Shows distance to stop ($4.95 away)
  - Shows distance to targets ($7.55 to first)
```

### Flow 3: Real-Time WebSocket Updates

```
MARKET PRICE UPDATE (every second):
  ↓
MARKET DATA SERVICE (polling external APIs):
  - Get current price from IEX Cloud
  - Get volume data from Alpha Vantage
  - Cache in Redis for 30 seconds
     ↓
EMIT WEBSOCKET EVENT:
  {
    type: "price:update",
    asset: "AAPL",
    price: 173.20,
    change: +0.75,
    changePercent: +0.43,
    volume: 54320000,
    timestamp: Date
  }
     ↓
ALL CONNECTED CLIENTS RECEIVE UPDATE
     ↓
FRONTEND:
  1. Update position P/L calculation
  2. Update chart real-time
  3. Update distance to stop/targets
  4. Trigger alert if target or stop is hit
```

---

## 📊 DATABASE SCHEMA (Simplified)

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  api_key_alpaca VARCHAR, -- for paper trading
  preferences JSONB, -- UI theme, analysis settings
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Positions (Active & Historical Trades)
CREATE TABLE positions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  asset VARCHAR NOT NULL, -- AAPL, TSLA, BTC, etc.
  market VARCHAR NOT NULL, -- stocks, crypto, futures
  action VARCHAR NOT NULL, -- BUY, SELL, SHORT
  entry_price NUMERIC NOT NULL,
  entry_time TIMESTAMP NOT NULL,
  quantity NUMERIC NOT NULL,
  stop_loss_price NUMERIC NOT NULL,
  target_prices NUMERIC[] NOT NULL, -- [180, 190, 195]
  current_price NUMERIC,
  exit_price NUMERIC,
  exit_time TIMESTAMP,
  status VARCHAR NOT NULL, -- OPEN, CLOSED, STOPPED_OUT
  profit_loss NUMERIC, -- calculated
  profit_loss_percent NUMERIC,
  analysis_id UUID REFERENCES analyses(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Analyses (All 12-Stage Results)
CREATE TABLE analyses (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  asset VARCHAR NOT NULL,
  market VARCHAR NOT NULL,
  stage_results JSONB NOT NULL, -- all 12 stages
  final_decision VARCHAR NOT NULL, -- BUY, SELL, HOLD
  confidence NUMERIC NOT NULL,
  entry_price NUMERIC,
  stop_loss NUMERIC,
  targets NUMERIC[],
  chart_annotations JSONB, -- what to draw
  duration_ms INTEGER, -- how long analysis took
  created_at TIMESTAMP
);

-- Agent Activity (Intelligence Logging)
CREATE TABLE system_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  agent_id INTEGER NOT NULL, -- 1-25
  agent_name VARCHAR NOT NULL,
  activity_type VARCHAR NOT NULL, -- analysis, vote, debate, etc.
  asset VARCHAR,
  trace_query TEXT, -- what agent was asked
  summary TEXT, -- AI-generated summary
  output JSONB, -- structured response
  timestamp TIMESTAMP
);

-- Learning State
CREATE TABLE agent_learning_states (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  asset VARCHAR NOT NULL,
  agent_id INTEGER NOT NULL,
  learning_snapshot JSONB, -- what agent knows about this asset
  win_rate NUMERIC,
  trades_analyzed INTEGER,
  last_updated TIMESTAMP
);

-- Macro Indicators
CREATE TABLE macro_indicators (
  id UUID PRIMARY KEY,
  indicator_type VARCHAR NOT NULL, -- dxy, bond_yields, vix, etc.
  value NUMERIC NOT NULL,
  timestamp TIMESTAMP,
  previous_value NUMERIC,
  change NUMERIC
);

-- Geopolitical Events
CREATE TABLE geopolitical_events (
  id UUID PRIMARY KEY,
  event_name VARCHAR NOT NULL,
  severity VARCHAR NOT NULL, -- low, medium, high, critical
  affected_regions VARCHAR[],
  likely_impact VARCHAR,
  timestamp TIMESTAMP,
  resolution_date TIMESTAMP
);

-- Earnings Calendar
CREATE TABLE earnings_calendar (
  id UUID PRIMARY KEY,
  asset VARCHAR NOT NULL,
  earnings_date DATE NOT NULL,
  earnings_time VARCHAR, -- pre-market, after-hours, TBD
  eps_estimate NUMERIC,
  revenue_estimate NUMERIC,
  market_cap NUMERIC
);

-- Indexes for Performance
CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_analyses_user_id ON analyses(user_id);
CREATE INDEX idx_system_logs_agent_id ON system_logs(agent_id);
CREATE INDEX idx_macro_indicators_timestamp ON macro_indicators(timestamp);
CREATE INDEX idx_earnings_calendar_date ON earnings_calendar(earnings_date);
```

---

## 🎛️ API ENDPOINTS (RESTful)

### Authentication
```
POST /api/auth/register
  Request: { email, password }
  Response: { user, jwt_token }

POST /api/auth/login
  Request: { email, password }
  Response: { user, jwt_token }

POST /api/auth/logout
  Response: { message: "Logged out" }

GET /api/auth/verify
  Response: { user, valid: true }
```

### Analysis
```
POST /api/analysis/new
  Request: { asset, market }
  Response: { analysisId, stages: [...], finalDecision }
  Real-time: WebSocket updates as stages complete

GET /api/analysis/:id
  Response: { full analysis result with all stages }

GET /api/analysis/history
  Response: [ { analysisId, asset, decision, date }, ... ]
```

### Positions
```
POST /api/positions/execute
  Request: { analysisId, action, entryPrice, scaledEntry }
  Response: { positionId, status, orders: [...] }

GET /api/positions/open
  Response: [ { id, asset, entry, current, pnl }, ... ]

GET /api/positions/closed
  Response: [ { id, asset, entry, exit, pnl }, ... ]

GET /api/positions/:id
  Response: { full position detail + order history }

POST /api/positions/:id/close
  Request: { action: "TAKE_PROFIT" | "STOP_LOSS" | "MANUAL" }
  Response: { closedPosition, exitPrice }
```

### Intelligence
```
GET /api/intelligence/dashboard
  Response: {
    portfolio: { ... },
    macro: { dxy, vix, yields, ... },
    sentiment: { fear_greed, put_call_ratio, ... },
    alerts: [ { ... }, ... ]
  }

GET /api/intelligence/macro
  Response: { dxy, bonds, vix, economic_calendar, ... }

GET /api/intelligence/sentiment/:asset
  Response: {
    fear_greed_index: 62,
    nlp_score: +0.73,
    social_mentions: 73000,
    short_interest: 3.2%
  }

GET /api/intelligence/options/:asset
  Response: {
    call_put_ratio: 2.88,
    unusual_activity: [ { ... }, ... ],
    iv_skew: "bullish"
  }

GET /api/intelligence/correlation-matrix
  Response: {
    correlations: {
      stocks_bonds: -0.52,
      dxy_tech: -0.61,
      ...
    }
  }

GET /api/intelligence/earnings-calendar
  Response: [ { asset, date, eps_estimate, status }, ... ]

GET /api/intelligence/sector-rotation
  Response: [ { sector, performance, trend, ... }, ... ]

GET /api/intelligence/activity-feed
  Response: [ { agent, activity, timestamp, ... }, ... ]
```

### Agent Monitoring
```
GET /api/agents/activity
  Response: [ { agentId, name, activities: [...], ... }, ... ]

GET /api/agents/:id/trace/:traceId
  Response: { query, response, reasoning, timestamp }

GET /api/agents/:id/summary
  Response: { agentName, decisionsToday, accuracy, confidence }
```

### Dashboard
```
GET /api/dashboard
  Response: {
    portfolio: { balance, openPositions, dailyPnL, winRate },
    macro: { ... },
    intelligence: { ... },
    agentActivity: { ... },
    recentAlerts: [ ... ]
  }
```

---

## 🔐 SECURITY ARCHITECTURE

```
AUTHENTICATION FLOW:
┌─────────────────┐
│   User Login    │
└────────┬────────┘
         ↓
    Verify email + password
    (bcrypt comparison)
         ↓
    Generate JWT token
    - Header: { alg: HS256, typ: JWT }
    - Payload: { userId, email, exp: 24h }
    - Signature: HMAC-SHA256(secret)
         ↓
    Return JWT in response
    + Set httpOnly cookie
         ↓
    Client stores JWT locally
    (auto-included in all requests)
         ↓
    Backend middleware verifies
    on every protected endpoint
```

**Security Measures:**
- JWT tokens expire after 24 hours
- Refresh tokens (stored securely)
- Passwords hashed with bcrypt (cost: 12)
- Rate limiting (500 req/15 min)
- Input validation on all endpoints
- CORS restricted to domain
- SSL/TLS for all traffic
- CSRF tokens for state-changing operations
- Audit logging for all sensitive operations

---

## ⚡ PERFORMANCE OPTIMIZATION

```
CACHING STRATEGY:

1. FRONTEND (Browser):
   - JWT token: localStorage
   - User preferences: localStorage
   - Analysis results: sessionStorage (current session only)
   - Charts: IndexedDB (historical)

2. APPLICATION (Redis):
   - Current market prices: 30-sec TTL
   - Technical indicators: 1-min TTL
   - User sessions: 24-hour TTL
   - Correlation matrix: 5-min TTL
   - Agent knowledge states: Real-time
   - Analysis results: Permanent (archive)

3. DATABASE (PostgreSQL):
   - Connection pooling (20 connections max)
   - Query optimization with indexes
   - Partitioning by date (positions table)
   - Archive old analyses

4. API RESPONSES:
   - Gzip compression
   - JSON minification
   - Pagination (50 items default)
   - Lazy loading (charts load on demand)

LOAD OPTIMIZATION:
- Frontend code splitting (lazy routes)
- Tree-shaking (unused code removal)
- CDN for static assets
- Image optimization
- Minified CSS/JS
```

---

## 🚀 DEPLOYMENT & SCALING

```
DEVELOPMENT ENVIRONMENT:
├─ Frontend: Vite dev server (localhost:5173)
├─ Backend: Node.js dev server (localhost:3000)
├─ Database: Docker PostgreSQL (localhost:5432)
└─ Redis: Docker Redis (localhost:6379)

PRODUCTION ENVIRONMENT:
├─ Frontend: Vercel (auto-deploy on git push)
│  └─ CDN: Vercel global CDN
│
├─ Backend: Railway/Render
│  ├─ Auto-scaling (based on CPU/memory)
│  ├─ Health checks every 10 seconds
│  ├─ Auto-restart on failure
│  └─ 3 instances running (load balanced)
│
├─ Database: Supabase (managed PostgreSQL)
│  ├─ Automated backups (daily)
│  ├─ Replication (hot standby)
│  ├─ Read replicas for scale
│  └─ SSL encryption
│
└─ Redis: Upstash (managed Redis)
   ├─ Auto-scaling
   ├─ Persistence
   └─ High availability
```

---

## 📋 NEW FEATURES ADDED (From User Request)

The following NEW services have been integrated into the architecture:

| Feature | Service | Location | Purpose |
|---------|---------|----------|---------|
| Liquidity Assessment | `liquidityService.ts` | services/ | Check if stock has enough volume to trade safely |
| Real-time Correlation Matrix | `correlationService.ts` | services/ | Update correlations every 5 minutes |
| Earnings Calendar Blocking | `earningsService.ts` | services/ | Prevent trades within 5 days of earnings |
| Options Flow Intelligence | `optionsFlowService.ts` | services/ | Analyze call/put ratios, unusual activity |
| Sector Rotation Tracker | `sectorRotationService.ts` | services/ | Track which sectors are in favor |
| Intermarket Analysis | `intermarketService.ts` | services/ | Track DXY vs crypto, bonds vs stocks |
| NLP Sentiment Scoring | `sentimentService.ts` | services/ | Score news/social sentiment with time decay |
| Social Media Anomalies | `socialMediaService.ts` | services/ | Detect volume spikes in social mentions |
| Pre-market Analysis | `premarketService.ts` | jobs/ | Run daily before market open |
| Regime Transition Scoring | `regimeTransitionService.ts` | services/ | Probability of market regime change |

---

## 🎯 KEY ARCHITECTURAL PRINCIPLES

1. **Microservices Architecture**
   - Each major feature is its own service
   - Services are loosely coupled, highly cohesive
   - Can be deployed independently

2. **Agent-Centric Design**
   - 25 specialized agents handle analysis
   - Each agent has specific expertise
   - Agents communicate via voting/debate

3. **Real-Time First**
   - WebSocket for instant updates
   - Redis cache for sub-second queries
   - Streaming data feeds from multiple sources

4. **Type Safety**
   - TypeScript for all code
   - Strict mode enabled
   - Full type definitions

5. **Fault Tolerance**
   - Circuit breakers for external APIs
   - Fallback strategies
   - Dead letter queues for failed jobs
   - Automatic retries with exponential backoff

6. **Scalability**
   - Horizontal scaling of backend
   - Database read replicas
   - CDN for static content
   - Caching at every layer

7. **Security by Default**
   - Authentication on all endpoints
   - Input validation
   - Rate limiting
   - Audit logging

---

**This architecture is production-ready and designed to scale to thousands of concurrent users.**
