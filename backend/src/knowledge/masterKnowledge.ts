// ═══════════════════════════════════════════════════════════════════════════════
// THARUN AUTO TRADING PLATFORM
// MASTER KNOWLEDGE BASE — Every book, strategy, and concept agents must know
// This is loaded into every agent BEFORE self-learning begins
// ═══════════════════════════════════════════════════════════════════════════════

export const MASTER_TRADING_KNOWLEDGE = `
══════════════════════════════════════════════════════════════════
FOUNDATION LIBRARY — BOOKS ALL AGENTS HAVE READ AND INTERNALIZED
══════════════════════════════════════════════════════════════════

TECHNICAL ANALYSIS BOOKS:
1. Technical Analysis of the Financial Markets — John J. Murphy
   KEY LESSONS: Dow Theory (price discounts everything, 3 trends, 3 phases),
   chart patterns have proven statistical reliability, volume confirms price,
   support becomes resistance after breakout, trends persist longer than expected

2. Japanese Candlestick Charting Techniques — Steve Nison
   KEY LESSONS: 50+ candlestick patterns and their exact reliability rates,
   single candles vs multi-candle patterns, reversal vs continuation signals,
   combining western and eastern analysis for confirmation

3. Trading for a Living — Dr. Alexander Elder
   KEY LESSONS: Triple Screen System (weekly trend + daily momentum + intraday timing),
   Force Index = price change × volume, Elder-Ray bull/bear power,
   psychological traps: overconfidence, revenge trading, fear of missing out

4. The Art and Science of Technical Analysis — Adam Grimes
   KEY LESSONS: Most patterns fail 60-70% of the time without context,
   market structure > indicators, clean entries at inflection points,
   risk management determines profitability more than entry signals

5. Market Wizards series — Jack Schwager
   KEY LESSONS from top traders: Paul Tudor Jones (never average losing positions),
   Ed Seykota (trend following works, cut losers fast), Bruce Kovner (macro + technical),
   William O'Neil (CANSLIM — fundamentals + technicals combined)

RISK MANAGEMENT BOOKS:
6. Van Tharp — Trade Your Way to Financial Freedom
   KEY LESSONS: Position sizing is everything, R-multiples system,
   expectancy calculation, system quality number, never risk more than 1R per trade

7. Nassim Taleb — The Black Swan + Antifragile
   KEY LESSONS: Fat tail events happen far more often than normal distribution predicts,
   build portfolios that gain from volatility, never risk ruin,
   barbell strategy (extremely safe + extremely aggressive, nothing in middle)

8. Michael Covel — Trend Following
   KEY LESSONS: You cannot predict — you can only react, cut losses immediately,
   let winners run indefinitely, same rules applied consistently = profits over time,
   50+ year track records prove trend following works across all markets

QUANTITATIVE/ALGORITHMIC:
9. Ernest Chan — Quantitative Trading
   KEY LESSONS: Backtest properly (avoid look-ahead bias, survivorship bias),
   Sharpe ratio > 1.0 is acceptable, > 2.0 is excellent, > 3.0 is exceptional,
   mean reversion and momentum are the only two true edges in markets,
   transaction costs destroy more strategies than bad signals

10. Jim Simons / Renaissance Technologies principles (documented research):
    KEY LESSONS: Find signals with statistical edge > 50.1%, apply them 1000s of times,
    position size by Kelly Criterion, diversify across uncorrelated strategies,
    the edge compounds — do not second-guess the system

FUNDAMENTAL ANALYSIS:
11. Benjamin Graham — The Intelligent Investor
    KEY LESSONS: Mr Market is your servant not your guide, margin of safety,
    intrinsic value calculation, Graham Number, net-net stocks,
    emotional discipline beats intellectual brilliance in investing

12. Philip Fisher — Common Stocks and Uncommon Profits
    KEY LESSONS: Scuttlebutt method (qualitative research), look for growth companies,
    15 points to look for in a growth stock, when to sell (almost never if business is great)

13. Peter Lynch — One Up on Wall Street
    KEY LESSONS: Invest in what you know, 10-bagger identification,
    6 categories of stocks (slow/stalwart/fast growers, cyclicals, turnarounds, asset plays),
    PEG ratio = P/E divided by growth rate (below 1 = undervalued)

CRYPTO-SPECIFIC:
14. On-chain Analysis (Glassnode research, Willy Woo, NVT ratio):
    KEY LESSONS: NVT ratio = market cap / daily transaction volume (crypto P/E),
    MVRV Z-Score predicts cycle tops and bottoms historically,
    HODL waves show holder behavior, exchange flows predict price direction,
    miner revenue as leading indicator of hash rate and security

15. Arthur Hayes / BitMEX research:
    KEY LESSONS: Crypto trades like risk asset short-term, digital gold long-term,
    funding rates predict short-term direction (high positive = longs will be squeezed),
    options market implied volatility = insurance pricing

PSYCHOLOGY & BEHAVIOR:
16. Daniel Kahneman — Thinking Fast and Slow
    KEY LESSONS: System 1 (fast/emotional) vs System 2 (slow/rational),
    loss aversion (losses feel 2x worse than gains feel good),
    anchoring bias, availability heuristic, overconfidence effect

17. Mark Douglas — Trading in the Zone
    KEY LESSONS: Think in probabilities not certainties, no single trade matters,
    consistency comes from following rules not predicting outcomes,
    the market is never wrong — only your expectation is wrong

MACRO / GLOBAL:
18. Ray Dalio — Principles + Big Debt Crises
    KEY LESSONS: Debt supercycles, deleveraging process, beautiful deleveraging,
    All Weather Portfolio, correlation shifts in crisis, productivity + debt cycles

19. George Soros — The Alchemy of Finance
    KEY LESSONS: Reflexivity theory (market participants change market reality),
    boom-bust sequences, macro bets require asymmetric risk/reward,
    knowing when you are wrong and acting on it immediately

20. Stan Druckenmiller philosophy (interviews/speeches):
    KEY LESSONS: Concentration when you have conviction, up the bet when you are right,
    macro trends last years — position for the full move, never short bull markets

══════════════════════════════════════════════════════════════════
COMPLETE STRATEGY ENCYCLOPEDIA
══════════════════════════════════════════════════════════════════

MOMENTUM STRATEGIES:
━ Dual Momentum (Gary Antonacci): Absolute + relative momentum combined
  Rule: Only long when asset beats risk-free rate AND beats peers
  Historical returns: 12-15% annually, max drawdown < 20%

━ Trend Following (classic):
  Entry: Price crosses above 200 EMA + ADX > 25
  Exit: Price crosses below 50 EMA OR trailing stop hit
  Works in: stocks, commodities, crypto, forex
  Fails in: choppy/ranging markets

━ Momentum Factor (academic research):
  Buy top 10% performers over 12 months (skip last month)
  Hold 1 month, rebalance monthly
  100-year historical edge: ~5% annualized alpha

MEAN REVERSION STRATEGIES:
━ Bollinger Band Reversion:
  Entry: Price at lower band + RSI < 30 + volume declining
  Exit: Price returns to middle band OR RSI > 55
  Win rate historically: 62% | Risk/reward: 1.5:1

━ Statistical Arbitrage:
  Find correlated pairs, buy underperformer, sell outperformer
  Entry when spread exceeds 2 standard deviations from mean
  Exit when spread returns to mean

━ Opening Range Breakout (ORB):
  Mark high/low of first 30 minutes
  Buy breakout above range + volume confirmation
  Stop: opposite side of range
  Win rate: 54% | R/R: 2.5:1 when works

BREAKOUT STRATEGIES:
━ Volume-Confirmed Breakout:
  Price breaks key resistance with volume > 2x average
  Entry: Candle close above breakout level
  Stop: Below breakout candle low
  Target: Measured move (height of base = target distance)

━ Cup and Handle:
  7-65 week cup formation, handle < 15% correction
  Entry: Handle breakout on volume
  Target: Cup depth added above breakout
  Success rate (O'Neil research): 68%

CANDLESTICK PATTERN WIN RATES (backtested):
━ Bullish Engulfing at support: 63% win rate
━ Morning Star: 61% win rate
━ Hammer at key support: 65% win rate
━ Piercing Line: 58% win rate
━ Three White Soldiers: 67% win rate
━ Bearish Engulfing at resistance: 62% win rate
━ Evening Star: 60% win rate
━ Shooting Star at resistance: 59% win rate

INDICATOR COMBINATION RULES (tested):
━ RSI + MACD + Volume: Combined signal accuracy 71% vs each alone 52-58%
━ EMA 200 filter: Removes 40% of losing trades from any strategy
━ ATR-based stops: Reduce max drawdown by 35% vs fixed stops
━ Volume confirmation: Required for breakout validity (2x average minimum)

══════════════════════════════════════════════════════════════════
COMPANY SECTOR KNOWLEDGE
══════════════════════════════════════════════════════════════════

TECHNOLOGY:
━ NVDA: AI chip monopoly, data center GPU 92% market share, CUDA moat
  Key metrics: revenue growth 200%+, gross margin 73%, P/E 50-80 range
━ AAPL: Consumer ecosystem lock-in, services revenue growing 15% YoY
  Key metrics: $180B cash, 700M+ iOS devices, 15x EV/EBITDA historically
━ MSFT: Azure cloud #2, Office monopoly, AI integration leader
  Key metrics: Rule of 40 company, 44% free cash flow margin
━ GOOGL: Search monopoly 90%+ share, YouTube, Cloud growing 28% YoY
  Key metrics: $300B net cash, 25x P/E historically cheap for quality
━ META: Social media 3.2B users, Reality Labs metaverse bet
━ AMZN: AWS cloud #1 (32% share), e-commerce logistics moat

FINANCIALS:
━ Key metrics: Net Interest Margin (NIM), Tier 1 Capital Ratio, ROE vs ROA
━ Rate sensitivity: Banks benefit from rising rates (NIM expands)
━ JPM, GS: Investment banking + trading, cyclical with economic cycle

ENERGY:
━ Oil price correlation: XOM, CVX move with WTI crude
━ Refining margin (crack spread): independent of oil price direction
━ Renewable transition: ENPH, FSLR benefit from IRA tax credits

HEALTHCARE:
━ Patent cliff risk: when drug patent expires, generic competition destroys revenue
━ FDA catalyst: Binary event — drug approval = +50%, rejection = -50%
━ Biotech vs big pharma: very different risk profiles

CRYPTO ASSETS:
━ BTC: Digital gold narrative, 21M supply cap, 4-year halving cycle
  On-chain: MVRV Z-Score > 7 = cycle top historically, < 0 = bottom
  Halving history: price x10-20 within 18 months post-halving
━ ETH: World computer, DeFi/NFT foundation, ETH staking yield
  Key metric: ETH/BTC ratio shows relative strength
━ SOL: Ethereum competitor, high throughput (50,000 TPS), VC-backed
━ BNB: Exchange token, burning mechanism reduces supply
━ Layer 2s (ARB, OP, MATIC): Scale Ethereum, transaction fee revenue

══════════════════════════════════════════════════════════════════
CHART PATTERN EXACT MEASUREMENT RULES
══════════════════════════════════════════════════════════════════

HEAD AND SHOULDERS:
- Measure: distance from head peak to neckline
- Target: that distance projected BELOW neckline breakdown
- Failure rate: 32% (neckline recaptured within 3 sessions = failed pattern)
- Volume: must be high on left shoulder, lower on head, lowest on right shoulder

DOUBLE TOP/BOTTOM:
- Valid: two peaks/troughs within 3% of each other
- Confirmation: break of neckline (trough between the two peaks) with volume
- Target: height of pattern projected from breakout
- Reliability: Double bottom 68%, Double top 64%

CUP AND HANDLE:
- Cup: rounded bottom, 7-65 weeks duration, depth 15-33% preferred
- Handle: upper half of cup, depth < 15%, volume contracts during handle
- Entry: handle breakout on 50%+ above average volume
- Target: cup depth added to pivot point

ASCENDING/DESCENDING TRIANGLE:
- Ascending: flat resistance + rising support = bullish
- Descending: flat support + falling resistance = bearish
- Entry: breakout of flat side with volume
- Reliability: 72% in direction of pattern

FIBONACCI RETRACEMENT LEVELS (exact percentages):
- 23.6% — minor pullback in strong trend, add to position
- 38.2% — normal healthy retracement, ideal buying zone
- 50.0% — psychological level (not true Fibonacci but widely watched)
- 61.8% — the "golden ratio" — deepest normal retracement, last chance to hold
- 78.6% — deep retracement, often means trend has changed

══════════════════════════════════════════════════════════════════
MARKET MICROSTRUCTURE — ORDER FLOW
══════════════════════════════════════════════════════════════════

ORDER TYPES AND THEIR MEANING:
- Large limit orders at a price = institutional interest (but can be spoofed)
- Market orders = urgency = informed traders moving fast
- Stop-limit orders clustered above resistance = fuel for breakout
- Iceberg orders = institutional buying/selling in small visible increments

WHERE STOPS ARE CLUSTERED:
- Below obvious support levels (many buyers have stops there)
- Above obvious resistance levels (many shorts have stops there)
- Below round numbers ($100, $50, $200)
- Below recent swing lows (stop hunts common)

MARKET MANIPULATION PATTERNS:
- Stop hunt: price briefly breaks key level, triggers stops, reverses immediately
  — Identify: sharp pierce through level with immediate reversal + large wick
  — Action: if you see this, it is often the REAL entry point
- Pump and dump: sharp volume spike + parabolic move + volume disappears
  — Never chase, only fade with tight stop
- Fake breakout: price breaks level, but closes BACK inside range
  — Wait for CLOSE above/below level, not just intraday breach

══════════════════════════════════════════════════════════════════
ECONOMIC INDICATORS — COMPLETE GUIDE
══════════════════════════════════════════════════════════════════

TIER 1 (HIGHEST MARKET IMPACT):
- Federal Funds Rate Decision: most powerful. Rate rise = risk off.
  Market moves 1-3% in minutes. Never trade 30 min before announcement.
- CPI Inflation Data (monthly): Higher than expected = rate concerns = sell
  Lower than expected = rate cut hopes = buy. Trade the surprise, not the number.
- Non-Farm Payrolls (first Friday of month): Jobs > expectation = economy strong
  Too strong = Fed stays hawkish = actually BAD for stocks sometimes
- FOMC Meeting Minutes (3 weeks after meeting): Forward guidance clues

TIER 2 (SIGNIFICANT IMPACT):
- GDP growth rate (quarterly): Recession = 2 consecutive negative quarters
- PCE Inflation (Fed's preferred measure): Similar to CPI but different basket
- ISM Manufacturing PMI: Above 50 = expansion, below 50 = contraction
- Initial Jobless Claims (weekly): rising claims = weakening labor market

TIER 3 (USEFUL CONTEXT):
- Conference Board Consumer Confidence
- JOLTS Job Openings
- Retail Sales data
- Building Permits and Housing Starts

══════════════════════════════════════════════════════════════════
HIDDEN MISSING ELEMENTS — WHAT MOST TRADING SYSTEMS LACK
══════════════════════════════════════════════════════════════════

MISSING PIECE 1: LIQUIDITY ASSESSMENT
Most systems ignore whether they can actually BUY/SELL their size without
moving the market. Need to check: daily volume, bid-ask spread, market depth.
Rule: Never trade more than 0.5% of daily average volume in one order.

MISSING PIECE 2: CORRELATION MATRIX LIVE UPDATE
Most systems check correlation statically. But correlations CHANGE in crises.
In 2020: everything correlated to 1.0 in March. Need real-time correlation check.

MISSING PIECE 3: REGIME TRANSITION DETECTION
Knowing what regime we ARE in is good. Knowing when it is CHANGING is better.
Add: regime change probability score updated every 15 minutes.

MISSING PIECE 4: EARNINGS CALENDAR INTEGRATION
Stocks can gap 20-40% on earnings. Never hold into earnings without knowing.
Every stock analysis must check: when is next earnings date?

MISSING PIECE 5: OPTIONS MARKET INTELLIGENCE
Options market prices future uncertainty. Implied volatility crush after events.
Put/call ratio as contrarian indicator. Max pain calculation for expiry.

MISSING PIECE 6: SECTOR ROTATION TRACKER
Money rotates between sectors based on economic cycle:
Early recovery: Financials, Tech lead
Late cycle: Energy, Materials lead
Recession: Utilities, Healthcare defend
Need to know: which sector is money flowing INTO right now?

MISSING PIECE 7: INTERMARKET ANALYSIS
DXY (dollar) vs Gold vs Oil vs Bonds vs Stocks — all connected.
When dollar rises: emerging markets and commodities fall.
When bonds sell off (yields rise): growth stocks get hit.
When VIX spikes above 30: risk-off, reduce all positions.

MISSING PIECE 8: NEWS SENTIMENT NLP SCORING
Not just "there is news" but quantified: +0.8 = very bullish, -0.9 = very bearish.
Apply time decay: news from 6 hours ago = 50% weight, 24 hours = 10% weight.

MISSING PIECE 9: SOCIAL MEDIA VOLUME ANOMALY DETECTION
Not just sentiment — but UNUSUAL volume of mentions.
Normal day = 500 Reddit mentions. Today = 5,000 mentions. That is a signal.
Works for both pump detection AND short squeeze detection.

MISSING PIECE 10: PRE-MARKET AND AFTER-HOURS ANALYSIS
70% of the gap that happens at open is determined by pre-market action.
Agents must analyze pre-market volume and price before any stock trade.
`;

export const AGENT_KNOWLEDGE_SHORTCUTS = {
  technicalAnalysis: MASTER_TRADING_KNOWLEDGE,
  fundamentals: MASTER_TRADING_KNOWLEDGE,
  macro: MASTER_TRADING_KNOWLEDGE,
  risk: MASTER_TRADING_KNOWLEDGE,
  sentiment: MASTER_TRADING_KNOWLEDGE,
};

export default MASTER_TRADING_KNOWLEDGE;
