# APEX THARUN AUTONOMOUS TRADING PLATFORM
## Comprehensive System Architecture, Multi-Agent Engine & Self-Survival Manual

---

### EXECUTIVE SUMMARY
The **Tharun Autonomous Trading Platform** is an institutional-grade, zero-human-intervention quantitative trading and market intelligence system. It combines **15 specialized multi-agent neural council members**, a **3-round adversarial debate engine**, **SEC EDGAR & Alpaca security master directory (10,412+ assets)**, **cross-industry ripple intelligence**, **high-frequency execution via Alpaca and Polymarket CLOB**, and a **Darwinian $100 Micro-Account Self-Survival Engine**.

---

### TABLE OF CONTENTS
1. [Core Architectural Blueprint (Backend & Frontend)](#1-core-architectural-blueprint)
2. [The 15 Autonomous Agents: In-Depth Roles & Mathematical Models](#2-the-15-autonomous-agents)
3. [End-to-End Order Lifecycle: Step-by-Step Backend Process](#3-end-to-end-order-lifecycle)
4. [Dual-Horizon Trading: Intraday Scalping vs. Long-Term Wealth Accumulation](#4-dual-horizon-trading)
5. [Polymarket Binary Probability & Arbitrage Engine](#5-polymarket-binary-probability-engine)
6. [The Darwinian $100 Micro-Fund Self-Survival Algorithm](#6-the-darwinian-100-micro-fund-self-survival-algorithm)
7. [Open Stock Market Data APIs & Zero-Cost Architecture](#7-open-stock-market-data-apis)
8. [Risk Management Invariants & Circuit Breakers](#8-risk-management-invariants)

---

### 1. CORE ARCHITECTURAL BLUEPRINT

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Vite + React 18 + TS)                      │
│   • Institutional Light Theme (Inter & JetBrains Mono, #0F172A text, slate UI) │
│   • TanStack React Query (Automatic caching, 5s-60s invalidation polling)      │
│   • Zustand Global Store (Live prices, agent state, kill switch, recent orders)│
│   • Lightweight Charts v4 (Candlesticks, EMA 9/21/200, VWAP, TP/SL brackets)   │
│   • Socket.io Client (Instant tape ticks, agent voting streams, execution logs)│
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ HTTPS / WSS
┌──────────────────────────────────────▼─────────────────────────────────────────┐
│                           BACKEND (Node.js + Express + TS)                     │
│  ├── /api/portfolio    -> Balance, positions, P&L attribution, risk metrics    │
│  ├── /api/agents       -> 3-Round deliberation triggers, decision history      │
│  ├── /api/market       -> Live quotes, Polymarket CLOB scan, news sentiment    │
│  ├── /api/copy-trading -> Sub-account mirroring, independent risk boundaries   │
│  └── /api/stocks       -> 10,412+ SEC EDGAR universe, GICS ripple intelligence │
├────────────────────────────────────────────────────────────────────────────────┤
│                     CORE EXECUTION & DELIBERATION SERVICES                     │
│  ├── Multi-Agent Council Orchestrator (15 specialized cognitive heuristics)   │
│  ├── Micro-Account Compounding Engine ($100 survival, fee friction check)      │
│  ├── Risk Management Commander (Daily loss, max drawdown, cash reserve gates)  │
│  ├── Cross-Industry Ripple Radar (Second-order alternative industry spillover) │
│  └── Lifecycle State Machine (PENDING -> SUBMITTED -> OPEN -> TRAILING -> EXIT)│
├────────────────────────────────────────────────────────────────────────────────┤
│                           PERSISTENCE LAYER (Prisma ORM)                       │
│  ├── SQLite / PostgreSQL -> Positions, Trades, Snapshots, Decisions, Memory    │
│  └── In-Memory Tick Buffer -> Real-time orderbook depth & volatility tracking  │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. THE 15 AUTONOMOUS AGENTS

Before any capital is risked, a committee of 15 specialized agents convenes. Each agent evaluates the security through a unique mathematical lens:

| Agent # | Identity | Mathematical & Cognitive Heuristic | Input Feeds & Models | Veto Power |
|:---:|:---|:---|:---|:---:|
| **1** | **The Technician** | Wyckoff accumulation/distribution, RSI divergences, EMA 9/21/200 crosses, ATR expansion | Real-time OHLCV candles, TradingView indicators | No |
| **2** | **The Newshound** | NLP sentiment scoring (-1.0 to +1.0), breaking wire classification, geopolitical event tags | Finnhub news, SEC 8-K filings, global wire | No |
| **3** | **Sentiment Analyst** | Options put/call volume ratios, Fear & Greed index, retail vs. institutional flow imbalance | CBOE options skew, Polymarket crowd sentiment | No |
| **4** | **Fundamental Analyst** | Discounted Cash Flow (DCF), EV/EBITDA, P/E multiples, quarterly revenue acceleration | SEC EDGAR 10-K/10-Q balance sheets, income statements | No |
| **5** | **Risk Manager** | Kelly Criterion fractional sizing, Value at Risk (VaR), correlation matrix penalty | Live portfolio equity, drawdown metrics, portfolio beta | **YES (Absolute Veto)** |
| **6** | **Trend Prophet** | Higher-timeframe momentum persistence, ADX trend strength, breakout confirmation | Multi-timeframe trend ribbons (15m, 1h, 1D) | No |
| **7** | **Volume Detective** | On-Balance Volume (OBV), Volume Weighted Average Price (VWAP), liquidity shelf gaps | Level 2 volume histogram, tick microstructure | No |
| **8** | **Whale Watcher** | Block trade detection, dark pool prints, Form 13F institutional accumulation | Dark pool volume estimates, institutional holdings | No |
| **9** | **Macro Economist** | 10Y/2Y Yield Curve inversion, Federal Reserve policy expectations, CPI/unemployment | FRED API, Treasury yield spreads, macro rates | No |
| **10** | **Devil's Advocate** | Pure counter-thesis stress testing; systematically identifies reasons the trade will fail | Inverse thesis generation, worst-case downside analysis | No |
| **11** | **Elliott Wave** | 5-wave motive and 3-wave corrective Fibonacci retracement and extension levels | Wave cycle mapping, 0.618 / 1.618 golden ratios | No |
| **12** | **Options Flow** | Unusual option activity (UOA), sweep orders, implied volatility rank and IV crush | Options contracts, delta/gamma exposure | No |
| **13** | **Arbitrageur** | Cross-exchange price discrepancies, Polymarket prediction mispricings vs fair odds | Polymarket CLOB vs. live equity pricing | No |
| **14** | **Quant Forecaster** | Autoregressive ML price forecasting, mean-reversion boundary bands | Mathematical standard deviation Bollinger bands | No |
| **15** | **Cross-Industry Ripple** | Second-order and third-order macroeconomic ripple effects across 11 GICS sectors | SEC SIC classification, supply chain graphs | No |

---

### 3. END-TO-END ORDER LIFECYCLE (STEP-BY-STEP)

When an asset is scrutinized or a market anomaly is detected, the system executes an autonomous 8-step pipeline with **zero human intervention**:

```
[1. Market Pulse] ──> [2. Council Convened] ──> [3. Cross-Exam Rebuttal]
       │                                                    │
       ▼                                                    ▼
[6. Execution Route] <── [5. Risk Gatekeeper] <── [4. Consensus Formation]
       │
       ▼
[7. Dynamic Trailing Bracket] ──> [8. Post-Trade Agent Weight Calibration]
```

1. **Step 1: Signal Ingestion & Anomaly Trigger**
   * Triggered by price breakout, high volume shelf anomaly, SEC filing drop, Polymarket EV gap > 3%, or autonomous scheduled scanner.
2. **Step 2: Round 1 — Opening Arguments**
   * Each of the 15 agents independently evaluates the asset without seeing other agents' votes.
   * Outputs: `Vote` (BUY/SELL/HOLD), `Confidence` (0-100%), and mathematical `Reasoning`.
3. **Step 3: Round 2 — Adversarial Cross-Examination & Rebuttal**
   * Agent votes are compiled. The **Devil's Advocate** (Agent 10) aggressively attacks the majority consensus.
   * If BUY is favored, the Devil's Advocate highlights hidden tail risks, liquidity traps, and macroeconomic headwinds.
   * Agents are required to defend their thesis or adjust their confidence scores.
4. **Step 4: Round 3 — Final Vote & Neural Consensus Formation**
   * Final votes are aggregated using dynamic Bayesian weights (agents with higher historical win rates carry higher voting weight).
   * Consensus Rule: Requires at least **7 out of 10 voting agents** and an average confidence score of **>= 65%**.
5. **Step 5: The Risk Manager Invariant Gate (Agent 5 Veto Check)**
   * Even with 14 BUY votes, Agent 5 evaluates:
     * Does this trade violate the maximum daily loss limit (3-5%)?
     * Is the portfolio cash reserve >= 30%?
     * Does the risk-to-reward ratio satisfy `>= 2:1`?
     * If any invariant fails, Agent 5 triggers an **IMMEDIATE VETO**, halting execution.
6. **Step 6: Smart Order Routing (Alpaca Broker & Polymarket CLOB)**
   * Checks exchange fee viability via `checkTradeViability()`.
   * For US Equities: Routes fractional market or limit bracket orders directly to Alpaca.
   * For Predictions: Routes USDC orders to the Polymarket Polygon CLOB contract.
7. **Step 7: Lifecycle State Machine & Dynamic Trailing Bracket**
   * State transitions: `PENDING` -> `SUBMITTED` -> `OPEN` -> `TRAILING`.
   * Calculates dynamic ATR (Average True Range) stop-loss and dual take-profit targets:
     * Take-Profit 1 (TP1): 2.0x risk distance (secures 50% of position and moves stop-loss to breakeven).
     * Take-Profit 2 (TP2): 3.5x risk distance (trails the remaining 50% using trailing stop).
8. **Step 8: Post-Trade Feedback & Agent Darwinian Calibration**
   * Once closed, the P&L outcome is attributed back to every agent who voted.
   * Winning agents gain confidence calibration points; losing agents have their voting weights downweighted in subsequent debates.

---

### 4. DUAL-HORIZON TRADING: INTRADAY VS. LONG-TERM

The engine operates two distinct, non-conflicting time-horizon sub-engines:

#### A. Intraday Momentum & Scalping Engine (1m, 5m, 15m)
* **Goal**: Capture intraday volatility with zero overnight gap risk.
* **Core Indicators**: VWAP band touches, EMA 9/21 cross, 1-minute order flow volume delta.
* **Execution Rules**:
  * All open intraday day-trades are closed before market close (3:55 PM EST).
  * Strict max hold time: 5 minutes to 4 hours.
  * Fast dynamic stop-losses (0.8% to 1.5%).

#### B. Long-Term Compounder & Ripple Engine (Daily, Weekly, Monthly)
* **Goal**: Exploit structural secular trends, SEC balance sheet transformations, and industry spillovers.
* **Core Indicators**: DCF intrinsic value discounts > 25%, CANSLIM EPS growth > 25%, Cross-industry supply chain shifts.
* **Execution Rules**:
  * Fractional accumulation during consolidation regimes.
  * Hold time: Weeks to months.
  * Wider volatility bands (5% to 12% trailing stops).

---

### 5. POLYMARKET BINARY PROBABILITY ENGINE

Unlike traditional financial markets where odds are opaque, prediction markets present mathematically quantifiable positive expected value (+EV):

* **Bayesian Fair Value Equation**:
  $$\text{Expected Value (EV)} = (P_{\text{AI}} \times \text{Payout}) - \text{Cost}$$
* **Kelly Criterion Fraction ($f^*$)**:
  $$f^* = \frac{b \cdot p - q}{b}$$
  * $b$ = odds received ($(\text{Payout} - \text{Cost}) / \text{Cost}$)
  * $p$ = Bayesian AI probability of YES
  * $q = 1 - p$ (probability of NO)
* **Zero Fee Advantage**:
  * Polymarket transactions incur $0 broker commission and negligible Polygon network gas ($0.001 MATIC), making micro-bets starting at $1.00 mathematically viable.

---

### 6. THE DARWINIAN $100 MICRO-FUND SELF-SURVIVAL ALGORITHM

When starting an autonomous system with a micro-balance of **$100.00**, standard institutional strategies fail due to fixed fee erosion and volatility ruin. The **Micro-Account Survival Engine** (`microAccountEngine.ts`) implements strict survival mechanics:

#### The 5 Inviolable Survival Laws:
1. **The 0.5% - 1.0% Risk Law ($1.00 Max Risk per Trade)**:
   * On a $100 portfolio, the system NEVER risks more than $1.00 on a single idea.
   * If a stock is trading at $200 (e.g., AAPL) and the stop-loss is 1% ($2.00/share), the system buys exactly **0.5 shares ($10.00 position)** so the total downside is limited to exactly $1.00.
2. **Fee Friction Gate (`checkTradeViability`)**:
   * If transaction fees exceed 20% of projected net profit, the trade is rejected.
   * Prefers **zero-fee commission venues** (Alpaca commission-free equities and Polymarket 0% fee contracts).
3. **Four-Tier Recovery State Machine**:
   * **NORMAL (Equity > $95)**: Standard 0.5% risk per trade, full multi-asset operation.
   * **CAUTION ($88 - $94)**: Risk slashed to 0.3%, minimum agent confidence raised to 70%.
   * **RECOVERY ($80 - $87)**: Risk reduced to 0.2%, only swing trades on zero-fee platforms, max 1 open position.
   * **DEFEND (Equity < $80)**: Risk reduced to 0.1% ($0.08), equity trading paused, only 90%+ confidence Polymarket arbitrage allowed until base is rebuilt.
4. **Asymmetric Payout Requirement (>= 3:1)**:
   * To survive and compound from $100, the system requires an asymmetric reward profile: risking $1.00 to make $3.00 to $5.00. Even with a 40% win rate, the portfolio mathematically grows:
   $$\text{Expectancy} = (0.40 \times \$3.50) - (0.60 \times \$1.00) = +\$0.80 \text{ per trade}$$
5. **Milestone Profit Locking & Compounding**:
   * At **$200** (2x return): System moves $40 to liquid cash reserve, compounding remaining $160.
   * At **$500** (5x return): System moves $100 to reserve, compounding remaining $400.
   * At **$1,000** (10x return): The micro-fund graduates to institutional standard sizing.

---

### 7. OPEN STOCK MARKET DATA APIS (8 VERIFIED SOURCES)

The platform operates without requiring expensive Bloomberg ($24,000/yr) terminals by synthesizing 8 zero-cost and open-access data feeds:

1. **SEC EDGAR Public Directory**: 10,412+ registered US public securities, CIK numbers, 10-K, 10-Q & 8-K filings (`https://data.sec.gov`).
2. **Alpaca Markets Paper Trading**: Commission-free stock execution, fractional share engine, and live streaming IEX websocket feed (`https://alpaca.markets`).
3. **Finnhub Stock & Market News API**: Free tier (60 calls/min) for real-time stock quotes, analyst targets, company financials, and news sentiment (`https://finnhub.io`).
4. **Polygon.io Market Data**: Free tier for daily OHLCV bar candles, ticker details, and company financial statements (`https://polygon.io`).
5. **Alpha Vantage Global Financials**: Free tier (25 calls/day) for technical indicators (RSI, MACD, SMA), GDP, CPI inflation, and macro data (`https://www.alphavantage.co`).
6. **Polymarket CLOB & Gamma Markets**: 100% free open public REST and WebSocket endpoints for prediction contract orderbooks and outcome odds (`https://clob.polymarket.com`).
7. **FRED (Federal Reserve Economic Data)**: Free public API key covering 800,000+ US macroeconomic series, Fed rates, and Treasury spreads (`https://fred.stlouisfed.org`).
8. **Yahoo Finance Public Data Stream**: Zero-cost public chart and quote endpoints used for historical candlestick charts and deep backtesting.

---

### 8. RISK MANAGEMENT INVARIANTS & CIRCUIT BREAKERS

The platform enforces rigid mathematical circuit breakers that cannot be overridden by any agent:

* **Daily Loss Limit**: If portfolio value drops by 3% in a single trading day, algo execution halts automatically for 24 hours.
* **Maximum Drawdown Circuit Breaker**: If total portfolio drawdown from peak reaches 10%, all open positions are systematically reduced by 50% and trading switches to DEFEND mode.
* **Emergency Hardware Kill Switch**: Accessible instantly via the UI or `/api/risk/kill-switch`, immediately closing all active positions and canceling all pending orders.
* **Overnight Manipulation Shield**: Low liquidity hours (02:00 - 07:00 UTC) automatically widen existing stop-losses by 50% and disallow opening new positions to survive thin-market stop hunts.

---

*Authored by the Autonomous Trading Architecture Committee · THARUN TRADING BOT v1.0.0*
