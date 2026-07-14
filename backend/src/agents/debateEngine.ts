import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { getIO } from '../websocket/server';
import { MarketSnapshot, PortfolioState } from './types';
import { getFundamentalsSummary, fetchAndStoreFundamentals, fetchAndStoreAnnualReports } from '../services/fundamentalsService';
import { getStockMemorySummary, recordDebate } from '../services/stockMemoryService';
import { fetchDeepAnalysis, formatDeepAnalysisForAgents } from '../services/deepAnalysisService';
import { agentActivityMonitor } from '../services/agentActivityMonitor';
import { geopoliticalDataService, classifySectors } from '../services/geopoliticalDataService';
import { getAgentSuspensionWeights, getAgentCalibrationScores } from '../services/selfLearning';
import { RegimeAnalysis } from '../services/regimeDetector';
import { intermarketService } from '../services/intermarketService';
import { optionsFlowService } from '../services/optionsFlowService';
import { getForecast } from '../services/kronosService';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Compact knowledge injected per agent (keeps tokens low)
// Individual agents were defaulting to HOLD as a hedge — not because the data
// genuinely supported no-trade, but because that's the non-committal answer
// an LLM reaches for absent explicit pressure to actually commit. This costs
// nothing to fix at the confidence-threshold level (65% still gates weak
// signal from executing) but was masking real signal behind reflexive caution
// before it ever reached that gate. Only the shared block needs this — it's
// injected into every agent's round-1 prompt.
const COMPACT_KNOWLEDGE = `KEY RULES: Risk 1-2% per trade. R/R must be >2:1. CANSLIM: EPS growth >25%, near 52wk high, vol surge. Minervini: price>50MA>150MA>200MA, 52wk high within 25%, RS high. Kelly sizing. RSI>70=overbought RSI<30=oversold. Golden Cross=bullish. Volume confirmation required. Cut losses fast, let winners run.
DECISIVENESS: HOLD is not the safe default — it's a specific claim that the data is genuinely balanced with no edge either way. If the data leans BUY or SELL, even moderately, vote that direction with a confidence that honestly reflects your conviction (a real but modest edge is a real but modest confidence, not an automatic HOLD). Reserve HOLD for when you've actually looked and found nothing — not as a hedge against being wrong. The system already has a 65% confidence floor and a 2:1 risk/reward requirement downstream — your job is to report your honest read, not to pre-filter for caution the system already enforces.`;

// Running token/cost tally — visible in logs so real spend is observable instead of guessed.
// Haiku ~$1/$5 per M input/output tokens, Sonnet ~$3/$15 per M — cache reads are ~10% of input cost.
const tokenTally = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
function logUsage(model: string, usage: any) {
  if (!usage) return;
  tokenTally.calls++;
  tokenTally.input += usage.input_tokens || 0;
  tokenTally.output += usage.output_tokens || 0;
  tokenTally.cacheRead += usage.cache_read_input_tokens || 0;
  tokenTally.cacheWrite += usage.cache_creation_input_tokens || 0;
  logger.info(`💵 [${model}] in=${usage.input_tokens || 0} out=${usage.output_tokens || 0} cacheRead=${usage.cache_read_input_tokens || 0} cacheWrite=${usage.cache_creation_input_tokens || 0} | session totals: calls=${tokenTally.calls} in=${tokenTally.input} out=${tokenTally.output} cacheRead=${tokenTally.cacheRead}`);
}

// Pulls the first complete {...} object out of a model response, ignoring any
// markdown fences or trailing commentary the model tacks on after the JSON.
function extractJSON(text: string): any {
  const stripped = text.replace(/```json\n?|```\n?/g, '').trim();
  const start = stripped.indexOf('{');
  if (start === -1) return JSON.parse(stripped);
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(stripped.slice(start, i + 1));
    }
  }
  return JSON.parse(stripped.slice(start)); // unterminated — throws with a clear position
}

// Call Anthropic with automatic retry on 429 rate limit
async function callWithRetry(params: Parameters<typeof anthropic.messages.create>[0], maxRetries = 3): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create(params);
      logUsage(params.model, (response as any).usage);
      return response;
    } catch (err: any) {
      if (err?.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(err?.headers?.['retry-after'] || '15') * 1000;
        logger.warn(`Rate limited — waiting ${retryAfter / 1000}s before retry (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, retryAfter + 1000));
      } else {
        throw err;
      }
    }
  }
}

// Run agents one at a time with a gap to avoid rate limits
async function runAgentsSequentially<T>(
  agents: any[],
  fn: (agent: any) => Promise<T>,
  delayMs = 4000
): Promise<T[]> {
  const results: T[] = [];
  for (const agent of agents) {
    results.push(await fn(agent));
    if (agents.indexOf(agent) < agents.length - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE INVESTMENT COMMITTEE DEBATE ENGINE
//
// This is how the world's top hedge funds actually make decisions.
// Not a simple vote — a full structured debate with 3 rounds:
//
// ROUND 1 — Opening Arguments  (all agents state their case independently)
// ROUND 2 — Cross-Examination  (agents challenge each other's weak points)
// ROUND 3 — Final Verdict      (agents update votes after hearing all arguments)
//
// The Master Coordinator synthesizes everything into a final decision.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentArgument {
  agentId: number;
  agentName: string;
  agentIcon: string;
  initialVote: 'BUY' | 'SELL' | 'HOLD';
  finalVote: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  openingArgument: string;
  challenges: string[];
  rebuttals: string[];
  changedMind: boolean;
  changeReason?: string;
  keyFactors: string[];
  riskWarnings: string[];
}

export interface CrossExam { challenger: string; target: string; challenge: string; rebuttal: string }

export interface DebateTranscript {
  id: string;
  asset: string;
  market: string;
  timestamp: number;
  price: number;
  priceChange24h: number;
  marketRegime: string;
  round1: { agentId: number; agentName: string; vote: string; argument: string }[];
  round2: CrossExam[];
  round3: { agentId: number; agentName: string; finalVote: string; confidence: number; reason: string }[];
  masterSynthesis: string;
  finalDecision: 'BUY' | 'SELL' | 'HOLD';
  finalConfidence: number;
  executionApproved: boolean;
  blockReason?: string;
  positionSizePct: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  agentArguments: AgentArgument[];
}

// ── THE 10 SPECIALIST AGENTS WITH FULL EXPERT KNOWLEDGE ──────────────────────

export const AGENT_ROSTER = [
  {
    id: 1, name: 'The Technician', icon: '📊',
    systemPrompt: `You are THE TECHNICIAN — a master technical analyst with 25 years experience at Goldman Sachs and Renaissance Technologies. You have analyzed over 100,000 charts. You are known for your precise, unemotional analysis.

YOUR COMPLETE TECHNICAL KNOWLEDGE:
CANDLESTICK PATTERNS (you know all 50+): Doji signals indecision — only valid at key levels. Hammer at support with high volume = very high probability reversal. Engulfing patterns need volume confirmation. Morning/Evening Star is your highest-conviction reversal signal. Shooting star at resistance = distribution. Marubozu = pure momentum, no indecision.

RSI MASTERY: RSI below 30 = oversold BUT can stay oversold in downtrends for weeks. Always check if RSI is DIVERGING from price — that's more powerful than absolute levels. RSI above 70 in a strong uptrend is normal — wait for a bearish divergence. 40-60 RSI range = trend confirmation zone.

MACD WISDOM: MACD crossovers are lagging signals — use them to CONFIRM, never to initiate. Histogram direction change is the early signal. MACD divergence is your most powerful setup. Zero-line crosses confirm trend changes.

BOLLINGER BAND EXPERT: Squeeze (bands narrowing) = explosive move incoming. Direction unknown until first candle. Band riding (price hugging upper/lower band) = strong trend — mean reversion trades fail here. Band touch alone is NOT a signal — needs RSI + volume confirmation.

EMA SYSTEM: EMA 9/21 cross = short-term momentum. EMA 50 = medium-term trend. EMA 200 = the most important line on any chart. Price above EMA 200 = bull bias. Golden Cross (50 crosses above 200) = major bull signal. Death Cross = major bear signal.

YOUR FAILURE MODES (know your weaknesses): Indicators lag — price moves first. All signals fail in news-driven moves. Choppy markets produce false signals. Crypto volume data is manipulated — use with caution.

DECISION FRAMEWORK: Only vote BUY when 3+ indicators align AND volume confirms. HOLD when signals are mixed or conflicting. SELL when bearish pattern + volume + trend confirmation align.

When responding, always reference SPECIFIC indicator levels and EXACT price levels. Never be vague.`
  },
  {
    id: 2, name: 'The Newshound', icon: '📰',
    systemPrompt: `You are THE NEWSHOUND — an elite news and event-driven trading specialist. You spent 15 years at Bloomberg and Reuters. You understand how news ACTUALLY moves markets vs what retail traders THINK moves markets.

YOUR EXPERT NEWS KNOWLEDGE:
NEWS HIERARCHY (most to least market-moving):
1. Federal Reserve decisions and statements — most powerful market mover
2. Regulatory actions (SEC, CFTC, government bans) — can move crypto 30% instantly
3. Major hacks/exploits — immediate panic selling
4. Earnings reports (for stocks) — gap moves of 10-30% common
5. Partnerships and adoption news — less reliable, often priced in early
6. General market news and analysis — lowest impact

EVENT-DRIVEN TRADING RULES:
- NEVER enter a trade 15 minutes before a major scheduled event
- Best opportunities: mispriced reactions (market overreacts — fade it after 30 minutes)
- News that contradicts the existing trend = highest conviction trade
- "Buy the rumor, sell the news" is real — watch for setup reversals on good news
- Regulatory news in crypto is ALWAYS more impactful than technical signals

SENTIMENT VS REALITY: When everyone is panicking, smart money is buying. When everyone is euphoric, smart money is selling. Your job is to identify if current news is ALREADY priced in or if the market hasn't reacted yet.

YOUR FAILURE MODES: You can be fooled by fake news. You can misread market reaction to real news. News timing matters — same news at different market conditions = different outcomes.`
  },
  {
    id: 3, name: 'The Sentiment Analyst', icon: '🧠',
    systemPrompt: `You are THE SENTIMENT ANALYST — you quantify market psychology. You understand crowd behavior better than anyone. You've studied behavioral finance, market psychology, and social dynamics for 20 years.

FEAR & GREED MASTERY:
- 0-25 = Extreme Fear = historically the BEST time to buy
- 25-45 = Fear = cautious buying opportunities
- 45-55 = Neutral = follow technical signals
- 55-75 = Greed = be more selective, take profits
- 75-100 = Extreme Greed = danger zone, reduce position sizes, look for exit

CONTRARIAN PRINCIPLE: When everyone is doing the same thing, the trade is already crowded. Crowded trades fail violently when they unwind. The best trades are the ones that make retail traders uncomfortable.

SOCIAL SENTIMENT SIGNALS: Reddit mentions spiking = late-stage rally. Twitter/X trending = often top signal. "Going to the moon" narrative = start planning your exit. "It's dead" narrative = consider accumulating.

OPTIONS MARKET TELLS: High put/call ratio = fear (bullish contrarian signal). Very low put/call = complacency (bearish warning). Implied volatility spiking = expect big move (direction unknown). IV crush after event = options selling opportunity.

YOUR FAILURE MODES: Sentiment can stay extreme for longer than expected. Contrarian signals work for swing trades — not scalps. Manipulation is real in low-cap assets.`
  },
  {
    id: 4, name: 'The Fundamental Analyst', icon: '📈',
    systemPrompt: `You are THE FUNDAMENTAL ANALYST — a buy-side analyst who evaluates true intrinsic value. You don't care what the chart says. You care about what an asset is actually WORTH.

CRYPTO FUNDAMENTALS FRAMEWORK:
- Network activity: daily active addresses, transaction volume, developer commits
- Tokenomics: inflation rate, supply schedule, token unlock events (ALWAYS bearish)
- Protocol revenue: is it generating real fees or just hype?
- Competitive moat: can this be copied? What is the switching cost?
- Team credibility: doxxed? Track record? VC backing?

STOCK FUNDAMENTALS FRAMEWORK:
- P/E ratio vs sector average and growth rate (PEG ratio is more meaningful)
- Revenue growth rate and whether it's accelerating or decelerating
- Gross margin trends — are they expanding (good) or compressing (bad)?
- Balance sheet: cash vs debt. Cash-rich companies survive downturns.
- Insider buying = one of the strongest signals in all of finance

VALUATION RULES: If something is "priced for perfection" — any bad news destroys it. High growth, high multiple stocks are FRAGILE. Value stocks with improving fundamentals are RESILIENT.

YOUR FAILURE MODES: Markets can stay irrational longer than you can stay solvent. Fundamentals set the destination — technicals set the timing. Good fundamentals in a bad market still go down short-term.`
  },
  {
    id: 5, name: 'The Risk Manager', icon: '🛡️',
    systemPrompt: `You are THE RISK MANAGER — the guardian of capital. You have absolute VETO power. Your job is NOT to make money — it is to ensure we DO NOT LOSE money. You think in terms of risk first, reward second.

YOUR VETO CRITERIA (vote HOLD and explain why):
1. Portfolio daily loss already exceeds 2% — no new positions
2. Drawdown from peak exceeds 8% — reduce to minimal positions only
3. More than 3 correlated positions already open — no more correlation risk
4. Risk/reward ratio below 2:1 — not worth taking
5. High volatility regime (VIX > 35 equivalent) — cut all sizes by 70%
6. News event within 15 minutes — wait for the dust to settle
7. Cash reserve below 15% — preserve capital
8. Position would exceed 10% of portfolio — concentration risk

KELLY CRITERION APPLICATION:
If win rate = W, average win/loss ratio = R:
Kelly % = W - (1-W)/R
Always use HALF-KELLY in practice. Never more than 2% risk per trade.

POSITION SIZING FORMULA:
Risk amount = Portfolio × 0.01 (1% risk rule)
Position size = Risk amount ÷ Distance to stop loss

CORRELATION RULES: BTC, ETH, SOL all move together 85% of the time. If you hold BTC, opening ETH is NOT diversification — it's doubling your crypto bet.

You speak last in debates but your word is final on risk matters. Never apologize for vetoing. Capital preservation IS the job.`
  },
  {
    id: 6, name: 'The Trend Prophet', icon: '🔮',
    systemPrompt: `You are THE TREND PROPHET — a quantitative forecaster who specializes in predicting future price direction using AI-driven pattern recognition and multi-factor analysis.

TREND ANALYSIS MASTERY:
TREND IDENTIFICATION: Higher highs + higher lows = uptrend (ONLY buy pullbacks). Lower highs + lower lows = downtrend (ONLY sell rallies). Sideways = chop (mean reversion only).

MOMENTUM PRINCIPLES:
- Trends persist longer than expected — don't fight them
- "The trend is your friend until it ends"
- Momentum accelerates before reversals — watch for parabolic moves
- Volume declining on trend continuation = trend exhaustion warning

FUTURE PROJECTION METHODOLOGY:
1. Identify the primary trend (weekly chart)
2. Identify the secondary trend (daily chart)
3. Identify the current position within trend structure
4. Project likely next move using trend + momentum + sentiment alignment
5. Assign probability based on multiple timeframe confirmation

PATTERN COMPLETION THEORY: Cup and handle = targets 100% of the cup depth above breakout. Head and shoulders = targets neckline distance below breakout. Flags and pennants = targets previous pole length.

TIME-SERIES FORECASTING: You use pattern recognition across 1000s of historical similar setups to estimate probability of each outcome. High-confidence setups = 3+ confirming factors across timeframes.

YOUR FAILURE MODES: Predictions fail when news overrides technicals. Black swan events are unpredictable. Probabilities are not certainties — always have a stop.`
  },
  {
    id: 7, name: 'The Volume Detective', icon: '🔍',
    systemPrompt: `You are THE VOLUME DETECTIVE — the market microstructure expert. You understand that VOLUME IS THE FUEL of all price moves. Without volume confirmation, no signal is reliable.

VOLUME ANALYSIS MASTERY:
BASIC RULES:
- Price up + Volume up = CONFIRMED uptrend (strong signal)
- Price up + Volume down = WARNING (weak, likely to fail)
- Price down + Volume up = CONFIRMED downtrend (strong signal)
- Price down + Volume down = Normal pullback (likely temporary)

OBV (ON-BALANCE VOLUME):
OBV rising while price rises = healthy uptrend. OBV falling while price rises = DIVERGENCE — major warning, distribution in progress. OBV breakout before price = early signal, price will follow.

VOLUME SPIKE ANALYSIS:
1.5x average volume = moderate interest
2x average volume = significant interest, pay attention
3x+ average volume = climactic move — often marks reversals or breakouts

SMART MONEY VS RETAIL:
Smart money accumulates QUIETLY over time — look for steady OBV increases on low/moderate volume. Smart money DISTRIBUTES into retail enthusiasm — price rises but OBV flat or falling. Retail buying frenzies = high volume, rapid price — often the top.

ORDER BOOK READING: Large bid walls = potential support (but can be pulled). Large ask walls = potential resistance (but can be pulled). Thin order book = high slippage risk, avoid large positions.

YOUR FAILURE MODES: Volume data on crypto can be wash traded (fake). Off-exchange OTC deals don't show in volume data. During low liquidity hours, volume signals are less reliable.`
  },
  {
    id: 8, name: 'The Whale Watcher', icon: '🐋',
    // Re-scoped from claiming on-chain wallet/CME/Grayscale/CFTC data this
    // system has no access to (US-hosted deployments are geo-blocked from the
    // exchanges that would provide funding-rate/OI data — verified, not
    // assumed) to reasoning honestly from the one real footprint of large-player
    // activity actually in the provided data: volume relative to its average,
    // and OBV (on-balance volume) divergence from price.
    systemPrompt: `You are THE WHALE WATCHER — you infer institutional activity from the one real signature it leaves in the data you're given: volume that doesn't match the price story.

WHAT YOU ACTUALLY HAVE (use only this — no on-chain/CME/dark-pool data is available to you, don't claim otherwise):
- Volume vs 20-period average (a ratio meaningfully above 1.5x with price barely moving = accumulation/distribution happening quietly; a ratio spike WITH a big price move = the crowd chasing, not smart money)
- OBV (On-Balance Volume) trend vs price trend — OBV rising while price is flat or falling = buying pressure building beneath the surface (accumulation); OBV falling while price holds up = distribution into strength
- Price failing to make a new high/low despite a volume spike = potential exhaustion / smart money taking the other side

READ IT LIKE THIS:
ACCUMULATION SIGNAL: Price flat-to-down, OBV trending up, volume above average = quiet buying.
DISTRIBUTION SIGNAL: Price flat-to-up, OBV trending down, or price at highs on below-average volume = weak hands holding it up, smart money not participating.

YOUR FAILURE MODES: Volume/OBV is a proxy, not real order-flow data — it can't distinguish one large buyer from many small ones, and low-liquidity assets produce noisy false signals. Say so when the volume signal is weak or ambiguous rather than inventing conviction.`
  },
  {
    id: 9, name: 'The Macro Economist', icon: '🌍',
    systemPrompt: `You are THE MACRO ECONOMIST — you see the big picture that most traders miss. You understand how global forces of money, policy, and economics create and destroy opportunities.

MACRO FRAMEWORK:
INTEREST RATE IMPACT:
- Rising rates = bad for growth stocks, bad for crypto (risk-off), good for USD
- Falling rates = good for growth stocks, good for crypto (risk-on), bad for USD
- Rate expectations move markets MORE than actual rate changes
- Watch Fed fund futures market for probability of rate changes

DOLLAR (DXY) CORRELATION:
- Strong DXY = everything else weak (crypto, commodities, emerging markets)
- Weak DXY = risk assets rally
- DXY and Bitcoin have approximately -0.7 correlation historically

INFLATION IMPACT:
- High unexpected inflation = Fed must raise rates = bad for risk assets
- Inflation falling faster than expected = Fed can cut = good for risk assets
- Bitcoin is seen as inflation hedge long-term but short-term it trades like risk asset

GLOBAL LIQUIDITY CYCLE:
- Global M2 money supply expanding = all assets rise (more dollars chasing assets)
- Global M2 contracting = assets fall (fewer dollars available)
- China, US, EU, Japan central banks combined = global liquidity

ECONOMIC CALENDAR EVENTS YOU TRACK:
- CPI/PPI inflation data (monthly, massive impact)
- FOMC meetings and statements (8x per year, most important)
- Non-farm payrolls (monthly, high impact)
- GDP data (quarterly)
- Fed chair speeches (unpredictable impact)

YOUR FAILURE MODES: Macro takes time to play out — can be months or years. Short-term price action can completely ignore macro for extended periods. Market can price in macro before the data is released.`
  },
  {
    id: 10, name: "The Devil's Advocate", icon: '😈',
    systemPrompt: `You are THE DEVIL'S ADVOCATE — the professional skeptic. You see ALL other agents' arguments before forming your response. Your ONLY job is to find every flaw in the bullish or bearish thesis.

YOUR SACRED DUTY:
You are the investment committee's internal critic. Every investment thesis, no matter how compelling, has weaknesses. Your job is to find them ALL.

WHAT YOU LOOK FOR:
CONFIRMATION BIAS: Are agents ignoring data that contradicts their view? Are they seeing what they want to see?
CONSENSUS RISK: When all agents agree — THAT is when you must work hardest. Crowded consensus trades fail badly.
TIMING RISK: Is this a good IDEA but bad TIMING? Even the right thesis fails if entered at the wrong point.
UNKNOWN UNKNOWNS: What has NOT been considered? What black swan is lurking?
MANIPULATION: Is this move real or is someone trapping retail traders? Fake breakouts. Stop hunts.

IMPORTANT: You argue against the dominant view. If everyone says BUY, find bear cases. If everyone says SELL, find bull cases. You are not always right — but you ensure we always consider the other side.`
  },
  {
    id: 11, name: 'Elliott Wave', icon: '🌊',
    // The prior version described wave theory in the abstract without ever
    // pointing at the actual Fibonacci levels already computed and provided
    // in every prompt (23.6/38.2/50/61.8%) — it was inventing a wave count
    // from nothing rather than reading the real retracement data available.
    systemPrompt: `You are THE ELLIOTT WAVE ANALYST — you read price structure against the Fibonacci retracement levels and RSI already provided to you. Ground every call in those actual numbers, not a generic wave narrative.

HOW TO USE WHAT YOU'RE GIVEN: Compare current price to the provided Fibonacci levels (23.6/38.2/50/61.8%) and 52-week high/low. Price holding above the 61.8% retracement after a pullback = the correction likely held (bullish continuation setup). Price breaking below 38.2% on a pullback = trend structure weakening. RSI divergence from price (price makes a new high/low, RSI doesn't) = the move is losing momentum, treat as a warning even if price structure looks strong.

WAVE RULES (apply only when the price/Fib/RSI data actually supports a specific wave count — don't force one): Wave 3 is never the shortest of the impulse. Wave 4 shouldn't overlap Wave 1's price territory. A strong trend with RSI still confirming = likely mid-impulse (Wave 3-like), safer for continuation. A strong trend with RSI diverging = likely late-stage (Wave 5-like), higher reversal risk.

YOUR FAILURE MODES: Wave counts are inherently subjective — two analysts can read the same chart differently. If the Fibonacci/RSI data doesn't clearly support one read, say so and vote HOLD rather than forcing conviction.`
  },
  {
    id: 12, name: 'Options Flow', icon: '📉',
    systemPrompt: `You are THE OPTIONS FLOW ANALYST — you read the smart money through options activity.

KEY SIGNALS: Unusual call buying above ask = bullish. Unusual put buying above ask = bearish. High put/call ratio = fear/bearish sentiment. Low put/call ratio = complacency/bullish. Gamma squeeze setup: large OTM call OI + rising price = explosive move. Dark pool prints (large blocks) = institutional positioning.
SKEW: High call skew = institutions hedging upside. High put skew = institutions buying downside protection.
IV RANK: High IV rank = sell premium. Low IV rank = buy premium.
Be decisive — smart money flow is a strong signal. Vote BUY or SELL when flow is clear.`
  },
  {
    id: 13, name: 'Arbitrageur', icon: '⚖️',
    systemPrompt: `You are THE ARBITRAGEUR — you find mispricings and mean reversion opportunities.

SIGNALS: If price is >2 std deviations from its 20-day mean = mean reversion likely. Futures premium/discount vs spot = carry trade signal. ETF vs NAV divergence = arbitrage opportunity. Correlation breakdown between related assets = one is mispriced. Sector rotation: money flowing from one sector to another = buy laggard, sell leader.
PAIRS: When two correlated stocks diverge by >3%, the laggard usually catches up.
If current price is significantly below fair value AND trend supports recovery = strong BUY. Above fair value with weak momentum = SELL.`
  },
  {
    id: 14,
    name: 'Quant Forecaster',
    icon: '🎯',
    systemPrompt: `You are the Quant Forecaster, reading output from a machine-learning price forecasting model (Kronos), not classical technical indicators. Focus your argument on the QUANT FORECAST section of the market context: the model's predicted close, its confidence band width (a wide band = high model uncertainty, argue for caution and lower confidence; a narrow band = high model conviction), and the expected return direction/magnitude. If no QUANT FORECAST section is present, say so explicitly and vote HOLD with low confidence — do not fabricate a forecast opinion from other agents' data.`,
  },
];

// ── MASTER COORDINATOR ────────────────────────────────────────────────────────

const MASTER_COORDINATOR_PROMPT = `You are THE MASTER COORDINATOR — the Chief Investment Officer of Tharun Agentic Trading. You have listened to a full investment committee debate. Now you must synthesize all arguments and make the FINAL decision.

DECISION STANDARDS:
- You need genuine conviction, not just a majority vote
- If the debate was inconclusive — you vote HOLD (uncertainty = no trade)
- If risk/reward is unfavorable — you vote HOLD
- Only vote BUY or SELL when you have GENUINE conviction

Respond with ONLY the JSON object below, nothing before or after it, no markdown fences. Keep synthesis under 50 words, every other text field under 20 words, and each array to at most 2 short items:
{
  "finalDecision": "BUY" | "SELL" | "HOLD",
  "confidence": <0-100>,
  "synthesis": "<explanation of reasoning>",
  "strongestBullArguments": ["<arg1>"],
  "strongestBearArguments": ["<arg1>"],
  "keyRisk": "<biggest risk>",
  "stopLossRationale": "<rationale>",
  "takeProfitRationale": "<rationale>",
  "positionSizeRecommendation": <1-5>,
  "whatCouldGoWrong": "<assessment>",
  "blockReason": null
}`;

// ── MAIN DEBATE FUNCTION ──────────────────────────────────────────────────────

export async function runInvestmentCommitteeDebate(
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  marketRegime: string,
  regimeAnalysis?: RegimeAnalysis
): Promise<DebateTranscript> {

  const io = getIO();
  const debateId = `debate_${Date.now()}`;
  const asset = snapshot.asset;

  logger.info(`\n${'═'.repeat(60)}`);
  logger.info(`🏛️  INVESTMENT COMMITTEE CONVENING — ${asset} @ $${snapshot.price}`);
  logger.info(`📊  Market Regime: ${marketRegime}`);
  logger.info(`${'═'.repeat(60)}\n`);

  io?.emit('debate:start', { debateId, asset, price: snapshot.price, regime: marketRegime });

  const transcript: DebateTranscript = {
    id: debateId,
    asset,
    market: snapshot.market,
    timestamp: Date.now(),
    price: snapshot.price,
    priceChange24h: snapshot.priceChangePct24h,
    marketRegime,
    round1: [],
    round2: [],
    round3: [],
    masterSynthesis: '',
    finalDecision: 'HOLD',
    finalConfidence: 0,
    executionApproved: false,
    positionSizePct: 0,
    stopLossPrice: 0,
    takeProfitPrice: 0,
    riskRewardRatio: 0,
    agentArguments: [],
  };

  // Deep analysis — fetch ALL data before debate starts. optionsFlow was
  // previously a separate `await` after this block (not in the Promise.all),
  // silently turning 4-way parallel fetch into 3-parallel-then-1-sequential
  // and adding the full Alpaca options latency to every stock debate.
  const [deepAnalysis, stockMemory, intermarket, optionsFlow, kronosForecast] = await Promise.all([
    snapshot.market === 'stocks' ? fetchDeepAnalysis(asset).catch(() => null) : Promise.resolve(null),
    getStockMemorySummary(asset),
    intermarketService.getIntermarketAnalysis().catch(() => null),
    snapshot.market === 'stocks' ? optionsFlowService.analyzeOptionsFlow(asset, snapshot.price).catch(() => null) : Promise.resolve(null),
    getForecast(asset, snapshot.candles, 5).catch(() => null),
  ]);

  const fundamentalsSummary = deepAnalysis
    ? formatDeepAnalysisForAgents(deepAnalysis)
    : snapshot.market === 'stocks' ? await getFundamentalsSummary(asset) : '';

  // Real cross-asset macro context — was previously nothing; The Macro Economist
  // agent's prompt describes rate/DXY/yield-curve reasoning it had zero data to
  // actually apply.
  const macroSummary = intermarket
    ? `Phase: ${intermarket.marketPhase} | Health: ${intermarket.marketHealth}/100 | Risk: ${intermarket.riskLevel} | Yield curve: ${intermarket.relationships.yieldCurveSlope} | ` +
      `SPY ${intermarket.assets.sp500 >= 0 ? '+' : ''}${intermarket.assets.sp500.toFixed(2)}% | DXY proxy ${intermarket.assets.dxy >= 0 ? '+' : ''}${intermarket.assets.dxy.toFixed(2)}% | ` +
      `Gold ${intermarket.assets.stocksGold >= 0 ? '+' : ''}${intermarket.assets.stocksGold.toFixed(2)}% | Oil ${intermarket.assets.oilEnergy >= 0 ? '+' : ''}${intermarket.assets.oilEnergy.toFixed(2)}% | ` +
      `10Y yield proxy ${intermarket.assets.treasuryYield10Y >= 0 ? '+' : ''}${intermarket.assets.treasuryYield10Y.toFixed(2)}% | VIX proxy ${intermarket.assets.vix.toFixed(1)}` +
      (intermarket.signals.length > 0 ? ` | Signals: ${intermarket.signals.map(s => `${s.name}(${s.signal})`).join(', ')}` : '')
    : '';

  // optionsFlow (stocks only — Alpaca's options data is US equities) is
  // fetched above, in parallel with the other debate-prep data.
  const optionsSummary = optionsFlow
    ? `Call/Put volume ratio: ${optionsFlow.callPutRatio.toFixed(2)} (${optionsFlow.sentiment}, ${optionsFlow.confidence.toFixed(0)}% confidence) | ` +
      `Call vol: ${optionsFlow.callVolume.toLocaleString()} | Put vol: ${optionsFlow.putVolume.toLocaleString()}` +
      (optionsFlow.unusualActivity.length > 0
        ? ` | Largest block: ${optionsFlow.unusualActivity[0].type} strike $${optionsFlow.unusualActivity[0].strikePrice} — ${optionsFlow.unusualActivity[0].interpretation}`
        : '') +
      ' (volume-based real data; open interest is proxied from volume, no real IV feed available)'
    : '';

  const forecastSummary = kronosForecast && kronosForecast.predictedClose.length > 0
    ? `Predicted close (${kronosForecast.predictedClose.length}-bar): $${kronosForecast.predictedClose[kronosForecast.predictedClose.length - 1].toFixed(2)} ` +
      `(band $${kronosForecast.lowerBand[kronosForecast.lowerBand.length - 1].toFixed(2)}-$${kronosForecast.upperBand[kronosForecast.upperBand.length - 1].toFixed(2)}) | ` +
      `Expected return: ${kronosForecast.meanReturn >= 0 ? '+' : ''}${(kronosForecast.meanReturn * 100).toFixed(2)}%`
    : '';

  await recordDebate(asset, 'PENDING');

  logger.info('📢 ROUND 1: OPENING ARGUMENTS');
  io?.emit('debate:round', { round: 1, debateId, asset });

  const newsSummary = await buildNewsSummary(asset);
  const round1Prompt = buildMarketContext(snapshot, portfolio, marketRegime, fundamentalsSummary, stockMemory, newsSummary, macroSummary, optionsSummary, forecastSummary);
  const round1Results: any[] = [];

  // Devil's Advocate (id 10) intentionally excluded here — it gets a separate
  // contextual call below that sees every other agent's round-1 argument, so
  // including it in this generic loop too was a duplicate paid API call that
  // also produced two conflicting round1 entries for the same agent.
  const round1Roster = AGENT_ROSTER.filter(a => a.id !== 10);
  const round1AgentResults = await runAgentsSequentially(round1Roster, async (agent) => {
    try {
      io?.emit('debate:agent-speaking', { agentId: agent.id, agentName: agent.name, round: 1, debateId });

      // Prompt caching only hits when the content BEFORE a cache_control
      // breakpoint is byte-identical across calls. Previously agent.systemPrompt
      // (unique per agent) sat in front of both cache points, so the cumulative
      // prefix differed for every one of the 9 agents and neither breakpoint
      // ever matched — cacheRead was 0 on every single call, every debate,
      // all night. Moved the shared instructions to `system` (identical across
      // every agent and every debate) and round1Prompt to the front of the
      // user message (identical across the 9 agents within this one debate);
      // each agent's distinct persona now comes after both cache points.
      const response = await callWithRetry({
        model: 'claude-haiku-4-5-20251001',
        temperature: 0.7,
        max_tokens: 1536,
        system: [{
          type: 'text',
          text: `${COMPACT_KNOWLEDGE}\nRespond with ONLY the JSON object below, nothing before or after it, no markdown fences. Keep openingArgument under 40 words and each factor/warning under 12 words: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"openingArgument":"<cite numbers>","keyFactors":["<f1>","<f2>","<f3>"],"riskWarnings":["<w1>","<w2>"],"priceTarget":"<price>","stopLevel":"<price>","riskReward":"<ratio>"}`,
          cache_control: { type: 'ephemeral' }
        }],
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `COMMITTEE — ${asset}\n\n${round1Prompt}`, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: `YOUR ROLE:\n${agent.systemPrompt}\n\nState your position with specific numbers.` }
          ]
        }]
      });

      const content = response.content[0];
      if (content.type !== 'text') throw new Error('Bad response');
      const parsed = extractJSON(content.text);

      const result = {
        agentId: agent.id, agentName: agent.name, agentIcon: agent.icon,
        vote: parsed.vote as 'BUY' | 'SELL' | 'HOLD',
        confidence: Math.min(100, Math.max(0, parsed.confidence)),
        openingArgument: parsed.openingArgument,
        keyFactors: parsed.keyFactors || [],
        riskWarnings: parsed.riskWarnings || [],
        weaknessOfMyOwnView: parsed.weaknessOfMyOwnView || ''
      };
      logger.info(`  ${agent.icon} ${agent.name}: ${result.vote} (${result.confidence}%)`);
      io?.emit('debate:agent-voted', { ...result, round: 1, debateId });
      agentActivityMonitor.logVote(agent.id, agent.name, asset, result.vote, result.openingArgument, result.confidence / 100, 1).catch(() => {});
      return result;
    } catch (err) {
      logger.error(`Agent ${agent.id} Round 1 failed`, { err: (err as Error)?.message || err });
      const fallback = { agentId: agent.id, agentName: agent.name, agentIcon: agent.icon, vote: 'HOLD' as const, confidence: 0, openingArgument: 'Analysis unavailable', keyFactors: [], riskWarnings: [], weaknessOfMyOwnView: '' };
      io?.emit('debate:agent-voted', { ...fallback, round: 1, debateId });
      return fallback;
    }
  }, 4000); // 4 second gap between agents
  transcript.round1 = round1AgentResults.map(r => ({ agentId: r.agentId, agentName: r.agentName, vote: r.vote, argument: r.openingArgument }));
  round1Results.push(...round1AgentResults);

  const devilAgent = AGENT_ROSTER[9];
  await new Promise(r => setTimeout(r, 4000)); // gap after last agent
  io?.emit('debate:agent-speaking', { agentId: 10, agentName: devilAgent.name, round: 1, debateId });
  try {
    const round1Summary = round1AgentResults.map(r => `${r.agentName} (${r.vote} ${r.confidence}%): ${r.openingArgument}`).join('\n\n');
    const devilResponse = await callWithRetry({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1536,
      system: devilAgent.systemPrompt + `\n${COMPACT_KNOWLEDGE}\n\nRespond with ONLY the JSON object below, nothing before or after it, no markdown fences. Keep openingArgument under 40 words and each factor/warning under 12 words:\n{"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"openingArgument":"<challenge>","keyFactors":["<f1>"],"riskWarnings":["<w1>"],"weaknessOfMyOwnView":"<weakness>"}`,
      messages: [{ role: 'user', content: `Other agents:\n\n${round1Summary}\n\nMarket: ${round1Prompt}\n\nWhat is your counter-argument?` }]
    });
    const dc = devilResponse.content[0];
    if (dc.type === 'text') {
      const dp = extractJSON(dc.text);
      const devilResult = {
        agentId: 10, agentName: devilAgent.name, agentIcon: devilAgent.icon,
        vote: dp.vote as 'BUY' | 'SELL' | 'HOLD',
        confidence: Math.min(100, Math.max(0, dp.confidence)),
        openingArgument: dp.openingArgument,
        keyFactors: dp.keyFactors || [],
        riskWarnings: dp.riskWarnings || [],
        weaknessOfMyOwnView: dp.weaknessOfMyOwnView || ''
      };
      round1Results.push(devilResult);
      transcript.round1.push({ agentId: 10, agentName: devilAgent.name, vote: devilResult.vote, argument: devilResult.openingArgument });
      logger.info(`  ${devilAgent.icon} ${devilAgent.name}: ${devilResult.vote} (${devilResult.confidence}%)`);
      io?.emit('debate:agent-voted', { ...devilResult, round: 1, debateId });
    }
  } catch (err) {
    logger.error('Devil\'s Advocate Round 1 failed', { err: (err as Error)?.message || err });
    const fallback = { agentId: 10, agentName: devilAgent.name, agentIcon: devilAgent.icon, vote: 'HOLD' as const, confidence: 0, openingArgument: 'Analysis unavailable', keyFactors: [], riskWarnings: [], weaknessOfMyOwnView: '' };
    round1Results.push(fallback);
    transcript.round1.push({ agentId: 10, agentName: devilAgent.name, vote: 'HOLD', argument: 'Analysis unavailable' });
    io?.emit('debate:agent-voted', { ...fallback, round: 1, debateId });
  }

  logger.info('\n⚔️  ROUND 2: CROSS-EXAMINATION');
  io?.emit('debate:round', { round: 2, debateId, asset });

  const dominantView = getDominantView(round1Results);

  // The strongest dissenting voice directly challenges the dominant view's
  // actual argument, and its lead agent has to respond to that specific
  // challenge — 2 calls, not 13, but real adversarial engagement instead of
  // a no-op (this used to just emit a UI event and populate nothing, so
  // Round 3 below only ever saw a bare vote tally).
  let round2Exchange: CrossExam | null = null;
  const dissenters = round1Results.filter(r => r.vote !== dominantView.direction && r.agentId !== dominantView.leadAgent?.agentId);
  const challenger = dissenters.sort((a, b) => b.confidence - a.confidence)[0];

  if (challenger && dominantView.leadAgent) {
    try {
      const challengeResponse = await callWithRetry({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `You are ${challenger.agentName}. You voted ${challenger.vote} (${challenger.confidence}%) on ${asset}. The committee is leaning ${dominantView.direction}, led by ${dominantView.leadAgent.agentName}'s argument: "${dominantView.leadAgent.openingArgument}"\n\nIssue ONE sharp, specific challenge to that argument, under 30 words. Respond with ONLY {"challenge":"<text>"}`,
        messages: [{ role: 'user', content: 'What is your strongest specific challenge to their argument?' }]
      });
      const cc = challengeResponse.content[0];
      const challengeText = cc.type === 'text' ? extractJSON(cc.text).challenge : null;

      if (challengeText) {
        const rebuttalResponse = await callWithRetry({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: `You are ${dominantView.leadAgent.agentName}. You voted ${dominantView.leadAgent.vote} (${dominantView.leadAgent.confidence}%) on ${asset}, arguing: "${dominantView.leadAgent.openingArgument}"\n\n${challenger.agentName} just challenged you: "${challengeText}"\n\nRespond directly to their specific point, under 30 words. Respond with ONLY {"rebuttal":"<text>"}`,
          messages: [{ role: 'user', content: 'Defend your position against this specific challenge.' }]
        });
        const rc = rebuttalResponse.content[0];
        const rebuttalText = (rc.type === 'text' ? extractJSON(rc.text).rebuttal : null) || 'No response';

        round2Exchange = { challenger: challenger.agentName, target: dominantView.leadAgent.agentName, challenge: challengeText, rebuttal: rebuttalText };
        transcript.round2.push(round2Exchange);
        io?.emit('debate:cross-examination', { ...round2Exchange, debateId });
        logger.info(`  ⚔️ ${challenger.agentName} → ${dominantView.leadAgent.agentName}: "${challengeText}"`);
        logger.info(`  🛡️ ${dominantView.leadAgent.agentName}: "${rebuttalText}"`);
      }
    } catch (err) {
      logger.error('Round 2 cross-examination failed', { err: (err as Error)?.message || err });
    }
  }

  logger.info('\n🗳️  ROUND 3: FINAL VERDICT');
  io?.emit('debate:round', { round: 3, debateId, asset });

  const debateSummary = buildDebateSummary(round1Results, round2Exchange);

  const round3Results = await runAgentsSequentially(AGENT_ROSTER, async (agent) => {
    const originalVote = round1Results.find(r => r.agentId === agent.id);
    try {
      const response = await callWithRetry({
        model: 'claude-haiku-4-5-20251001',
        temperature: 0.3,
        max_tokens: 700,
        system: [{ type: 'text', text: agent.systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `You voted: ${originalVote?.vote || 'HOLD'}\n\nAfter debate:\n${debateSummary}\n\nFinal vote? Respond with ONLY the JSON object below, nothing before or after it, no markdown fences. Keep finalReason under 15 words:\n{"finalVote":"BUY"|"SELL"|"HOLD","confidence":0-100,"changedMind":true|false,"finalReason":"<reason>"}`
        }]
      });
      const content = response.content[0];
      if (content.type !== 'text') throw new Error('Bad response');
      const parsed = extractJSON(content.text);

      const changed = parsed.changedMind && parsed.finalVote !== originalVote?.vote;
      if (changed) logger.info(`  🔄 ${agent.name} CHANGED: ${originalVote?.vote} → ${parsed.finalVote}`);

      io?.emit('debate:final-vote', { agentId: agent.id, agentName: agent.name, agentIcon: agent.icon, finalVote: parsed.finalVote, confidence: parsed.confidence, changedMind: changed, debateId });
      agentActivityMonitor.logVote(agent.id, agent.name, asset, parsed.finalVote, parsed.finalReason || '', parsed.confidence / 100, 3).catch(() => {});

      return {
        agentId: agent.id, agentName: agent.name, agentIcon: agent.icon,
        initialVote: originalVote?.vote || 'HOLD',
        finalVote: parsed.finalVote,
        confidence: Math.min(100, Math.max(0, parsed.confidence)),
        changedMind: changed,
        finalReason: parsed.finalReason,
        openingArgument: originalVote?.openingArgument || '',
        keyFactors: originalVote?.keyFactors || [],
        riskWarnings: originalVote?.riskWarnings || [],
        challenges: [], rebuttals: []
      };
    } catch (err) {
      const fallbackVote = originalVote?.vote || 'HOLD';
      agentActivityMonitor.logVote(agent.id, agent.name, asset, fallbackVote, 'Kept Round 1 vote (Round 3 failed)', (originalVote?.confidence || 0) / 100, 3).catch(() => {});
      return { agentId: agent.id, agentName: agent.name, agentIcon: agent.icon, initialVote: fallbackVote, finalVote: fallbackVote, confidence: originalVote?.confidence || 0, changedMind: false, finalReason: 'Error', openingArgument: '', keyFactors: [], riskWarnings: [], challenges: [], rebuttals: [] };
    }
  }, 3000);
  transcript.round3 = round3Results.map(r => ({ agentId: r.agentId, agentName: r.agentName, finalVote: r.finalVote, confidence: r.confidence, reason: r.finalReason }));
  transcript.agentArguments = round3Results as AgentArgument[];

  logger.info('\n👑 MASTER COORDINATOR: FINAL SYNTHESIS');
  io?.emit('debate:master-thinking', { debateId, asset });

  const finalVotes = round3Results;
  const buyCount = finalVotes.filter(v => v.finalVote === 'BUY').length;
  const sellCount = finalVotes.filter(v => v.finalVote === 'SELL').length;
  const holdCount = finalVotes.filter(v => v.finalVote === 'HOLD').length;

  // Weight each agent's confidence by the current regime's per-agent weighting
  // (e.g. the Risk Manager counts for more in HIGH_VOLATILITY) and by whether
  // self-learning has flagged them as a recent underperformer — previously
  // computed by regimeDetector/selfLearning but never actually applied here.
  const [suspensionWeights, calibrationScores] = await Promise.all([
    getAgentSuspensionWeights().catch(() => ({} as Record<number, number>)),
    getAgentCalibrationScores().catch(() => ({} as Record<number, number>)),
  ]);
  const voteWeight = (agentId: number) =>
    (regimeAnalysis?.agentWeights?.[agentId] ?? 1) * (suspensionWeights[agentId] ?? 1);
  const weightSum = finalVotes.reduce((s, v) => s + voteWeight(v.agentId), 0);
  const avgConfidence = weightSum > 0
    ? Math.round(finalVotes.reduce((s, v) => s + v.confidence * voteWeight(v.agentId), 0) / weightSum)
    : Math.round(finalVotes.reduce((s, v) => s + v.confidence, 0) / finalVotes.length);

  // How calibrated are the agents behind this vote, historically? 75 is the
  // "no evidence either way" baseline (equivalent to a Brier score of 0.25,
  // i.e. no better than always guessing 50%); only below that do we actually
  // have evidence the panel is overconfident, so only then do we shrink
  // sizing — never boost above baseline off a limited sample.
  const votingAgentIds = finalVotes.map(v => v.agentId);
  const relevantCalibration = votingAgentIds.map(id => calibrationScores[id]).filter((s): s is number => s !== undefined);
  const avgCalibration = relevantCalibration.length > 0
    ? relevantCalibration.reduce((s, v) => s + v, 0) / relevantCalibration.length
    : 75;
  const calibrationMultiplier = avgCalibration < 60 ? Math.max(0.5, avgCalibration / 60) : 1.0;

  const riskManagerFinalVote = round3Results.find(r => r.agentId === 5)?.finalVote;
  const devilFinalVote = round3Results.find(r => r.agentId === 10);

  let masterDecision: any;

  const allAgentsFailed = round3Results.every(r => r.finalReason === 'Error' || r.confidence === 0);
  if (allAgentsFailed) {
    masterDecision = {
      finalDecision: 'HOLD', confidence: 0,
      synthesis: 'All agents failed (API error) — no trade.',
      blockReason: 'Agent API errors — retrying next cycle',
      positionSizeRecommendation: 0,
      strongestBullArguments: [], strongestBearArguments: [],
      keyRisk: 'System error', stopLossRationale: 'N/A', takeProfitRationale: 'N/A', whatCouldGoWrong: 'Retry next cycle'
    };
  } else {
    try {
      // The Master Coordinator makes the actual go/no-go call on real capital —
      // it was previously given only Round 1 vote labels (no arguments) and a
      // tally, with Round 2's cross-examination and Round 3's "final verdict"
      // (changed minds, final reasoning) completely discarded before the one
      // synthesis step that matters most saw any of it.
      const round1Lines = round1Results.map(r => {
        const factors = r.keyFactors?.length ? ` | Factors: ${r.keyFactors.join('; ')}` : '';
        const risks = r.riskWarnings?.length ? ` | Risks: ${r.riskWarnings.join('; ')}` : '';
        return `${r.agentName} (${r.vote} ${r.confidence}%): ${r.openingArgument}${factors}${risks}`;
      }).join('\n');
      const round2Lines = round2Exchange
        ? `\n\nROUND 2 — CROSS-EXAMINATION:\n${round2Exchange.challenger} challenged ${round2Exchange.target}: "${round2Exchange.challenge}"\n${round2Exchange.target} responded: "${round2Exchange.rebuttal}"`
        : '';
      const round3Lines = round3Results.map(r =>
        `${r.agentName}: ${r.finalVote} (${r.confidence}%)${r.changedMind ? ` [CHANGED from ${r.initialVote}]` : ''} — ${r.finalReason}`
      ).join('\n');

      const fullDebateContext = `DEBATE FOR ${asset} @ $${snapshot.price}\nRegime: ${marketRegime}\nDaily P&L: ${portfolio.pnlDayPct.toFixed(2)}%\n\nROUND 1 — OPENING ARGUMENTS:\n${round1Lines}${round2Lines}\n\nROUND 3 — FINAL VERDICT:\n${round3Lines}\n\nFinal Vote Tally: BUY ${buyCount}, SELL ${sellCount}, HOLD ${holdCount}`;

      const masterResponse = await callWithRetry({
        model: 'claude-sonnet-5',
        max_tokens: 1800,
        system: [{ type: 'text', text: MASTER_COORDINATOR_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: fullDebateContext }]
      });

      const mc = masterResponse.content[0];
      if (mc.type !== 'text') throw new Error(`Master Coordinator returned non-text content block: ${mc.type}`);
      masterDecision = extractJSON(mc.text);
    } catch (err) {
      logger.error('Master Coordinator failed', { err: (err as Error)?.message || err });
      masterDecision = { finalDecision: 'HOLD', confidence: 0, synthesis: 'Error', blockReason: 'System error', positionSizeRecommendation: 0 };
    }
  }

  const minVotes = parseInt(process.env.MIN_VOTES_TO_EXECUTE || '5');
  const minConfidence = parseInt(process.env.MIN_AGENT_CONFIDENCE || '65');
  const dominantVotes = masterDecision.finalDecision === 'BUY' ? buyCount
    : masterDecision.finalDecision === 'SELL' ? sellCount : 0;

  let approved = masterDecision.finalDecision !== 'HOLD';
  let blockReason = masterDecision.blockReason || null;

  if (approved) {
    if (dominantVotes < minVotes) {
      approved = false; blockReason = `Not enough votes: ${dominantVotes}/${finalVotes.length} (need ${minVotes})`;
    } else if (avgConfidence < minConfidence) {
      approved = false; blockReason = `Low confidence: ${avgConfidence}% (need ${minConfidence}%)`;
    } else if (portfolio.pnlDayPct <= -(parseFloat(process.env.DAILY_LOSS_LIMIT_PCT || '3'))) {
      approved = false; blockReason = `Daily loss: ${portfolio.pnlDayPct.toFixed(2)}%`;
    }
  }

  // Volatility-based risk distance (ATR) instead of a flat percentage — a quiet
  // stock and a wild one shouldn't get the same stop distance. Floors/ceilings
  // guard against degenerate ATR readings (near-zero or spiking); falls back to
  // the floor (tightest stop) if ATR is unavailable (e.g. thin/no candle history)
  // instead of letting a NaN silently become an un-triggerable stop-loss.
  const floorPct = snapshot.market === 'crypto' ? 0.02 : 0.01;
  const ceilingPct = snapshot.market === 'crypto' ? 0.10 : 0.07;
  const rawAtrPct = snapshot.indicators.atr14 / snapshot.price;
  const atrPct = Number.isFinite(rawAtrPct) && rawAtrPct > 0 ? rawAtrPct : floorPct;
  const stopLossPct = Math.min(Math.max(atrPct * 1.5, floorPct), ceilingPct);
  // Take-profit is derived from the already-clamped stop distance with a fixed
  // 2.5x margin, not computed independently — topTraderRules LAW 3 rejects any
  // trade under a 2:1 ratio, and deriving both sides from the same ATR reading
  // with matching clamp multipliers made every trade land exactly on that
  // boundary, where floating-point rounding could tip a valid trade into a
  // false rejection.
  const takeProfitPct = stopLossPct * 2.5;
  const direction = masterDecision.finalDecision;
  const stopLoss = direction === 'BUY' ? snapshot.price * (1 - stopLossPct) : snapshot.price * (1 + stopLossPct);
  const takeProfit = direction === 'BUY' ? snapshot.price * (1 + takeProfitPct) : snapshot.price * (1 - takeProfitPct);
  const riskReward = Math.abs(takeProfit - snapshot.price) / Math.abs(stopLoss - snapshot.price);
  // Regime-adjusted Kelly size — was computed by regimeDetector (e.g. 0.3x in
  // HIGH_VOLATILITY, 1.0x in a clean trend) but previously discarded; only the
  // regime name was passed through, so every regime got the same sizing.
  const regimeSizeMultiplier = regimeAnalysis?.positionSizeMultiplier ?? 1;
  // Kelly sizing treats avgConfidence as a true win probability — but that's
  // only sound if stated confidence actually predicts outcomes. The
  // calibrationScore field existed on AgentPerformanceMetrics but was never
  // computed until tonight; now that it's real, use it to discount Kelly's
  // input when the voting agents have a track record of being overconfident.
  const kellyPct = calculateKellySize(avgConfidence / 100, riskReward) * regimeSizeMultiplier * calibrationMultiplier;

  transcript.masterSynthesis = masterDecision.synthesis || '';
  transcript.finalDecision = masterDecision.finalDecision || 'HOLD';
  transcript.finalConfidence = masterDecision.confidence || avgConfidence;
  transcript.executionApproved = approved;
  transcript.blockReason = blockReason || undefined;
  transcript.positionSizePct = approved ? kellyPct : 0;
  transcript.stopLossPrice = stopLoss;
  transcript.takeProfitPrice = takeProfit;
  transcript.riskRewardRatio = riskReward;

  logger.info(`\n${'═'.repeat(60)}`);
  logger.info(`👑 DECISION: ${transcript.finalDecision} (${transcript.finalConfidence}%)`);
  logger.info(`${'═'.repeat(60)}\n`);

  io?.emit('debate:complete', { debateId, asset, transcript });

  try {
    await prisma.agentDecision.create({
      data: {
        asset,
        signal: transcript.finalDecision,
        finalVote: transcript.finalDecision,
        totalVotes: 10,
        goVotes: Math.max(buyCount, sellCount),
        noGoVotes: holdCount,
        avgConfidence: transcript.finalConfidence,
        executed: false,
        executionReason: blockReason,
        agentVotes: transcript.agentArguments as any,
        marketSnapshot: { asset, price: snapshot.price } as any,
      }
    });
  } catch (dbErr) {
    logger.error('Failed to save debate', { dbErr });
  }

  return transcript;
}

// ── HELPERS ──────────────────────────────────────────────────────────

export function buildMarketContext(
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  regime: string,
  fundamentals = '',
  stockMemory = '',
  newsSummary = '',
  macroSummary = '',
  optionsSummary = '',
  forecastSummary = ''
): string {
  const ind = snapshot.indicators;
  const lines = [
    `ASSET: ${snapshot.asset} | PRICE: $${snapshot.price.toFixed(2)} | 24H: ${snapshot.priceChangePct24h.toFixed(2)}%`,
    `REGIME: ${regime}`,
    `── TECHNICALS ──`,
    `RSI(14): ${ind.rsi14.toFixed(1)} | MACD Histogram: ${ind.macd.histogram > 0 ? '+' : ''}${ind.macd.histogram.toFixed(4)} (${ind.macd.histogram > 0 ? 'BULLISH' : 'BEARISH'})`,
    `Stochastic K/D: ${ind.stochasticK.toFixed(1)}/${ind.stochasticD.toFixed(1)}`,
    `Bollinger: Upper $${ind.bollingerBands.upper.toFixed(2)} | Mid $${ind.bollingerBands.middle.toFixed(2)} | Lower $${ind.bollingerBands.lower.toFixed(2)}`,
    `EMA9: $${ind.ema9.toFixed(2)} | EMA21: $${ind.ema21.toFixed(2)} | EMA200: $${ind.ema200.toFixed(2)}`,
    `SMA50: $${ind.sma50.toFixed(2)} | SMA200: $${ind.sma200.toFixed(2)}`,
    `VWAP: $${ind.vwap.toFixed(2)} | ATR(14): $${ind.atr14.toFixed(2)}`,
    `52W High: $${ind.week52High.toFixed(2)} | 52W Low: $${ind.week52Low.toFixed(2)} | ${ind.distanceFrom52wHigh.toFixed(1)}% from high`,
    `Fibonacci: 23.6%=$${ind.fibonacci.r236.toFixed(2)} | 38.2%=$${ind.fibonacci.r382.toFixed(2)} | 50%=$${ind.fibonacci.r500.toFixed(2)} | 61.8%=$${ind.fibonacci.r618.toFixed(2)}`,
    `Trend: Price ${ind.isAboveSma200 ? 'ABOVE' : 'BELOW'} SMA200 | SMA50 ${ind.isSma50AboveSma200 ? 'ABOVE' : 'BELOW'} SMA200 (${ind.isSma50AboveSma200 ? 'GOLDEN CROSS' : 'DEATH CROSS'})`,
    `Volume: ${(snapshot.volume24h / 1e6).toFixed(1)}M | ${ind.volumeRatio.toFixed(2)}x avg (${ind.volumeRatio > 1.5 ? '⚡HIGH — institutional activity' : ind.volumeRatio < 0.7 ? '🔇LOW — weak conviction' : 'Normal'})`,
    `OBV trend: ${ind.obv > 0 ? 'Accumulation' : 'Distribution'}`,
    `── PORTFOLIO ──`,
    `Value: $${portfolio.totalValue.toFixed(2)} | Cash: $${portfolio.cashBalance.toFixed(2)} | Daily P&L: ${portfolio.pnlDayPct.toFixed(2)}%`,
  ];
  if (fundamentals && fundamentals !== 'No fundamental data available yet.') {
    lines.push(`FUNDAMENTALS: ${fundamentals}`);
  }
  if (stockMemory && !stockMemory.includes('first analysis')) {
    lines.push(`PAST PERFORMANCE: ${stockMemory}`);
  }
  if (newsSummary) {
    lines.push(`── NEWS & MARKET SENTIMENT (real, last 2h) ──`, newsSummary);
  }
  if (macroSummary) {
    lines.push(`── MACRO / INTERMARKET (real, ETF-proxy based) ──`, macroSummary);
  }
  if (optionsSummary) {
    lines.push(`── OPTIONS FLOW (real Alpaca volume data) ──`, optionsSummary);
  }
  if (forecastSummary) {
    lines.push(`── QUANT FORECAST (Kronos ML model) ──`, forecastSummary);
  }
  return lines.join('\n');
}

export const __test__buildMarketContext = buildMarketContext;

async function buildNewsSummary(asset: string): Promise<string> {
  const highImpact = geopoliticalDataService.getHighImpactNews(120);
  // Headlines say "Amazon", not "AMZN" — matching on the raw ticker alone
  // meant asset-specific news almost never matched for stocks (crypto
  // tickers like BTC/ETH are the exception, since headlines do use those).
  // Also match on the company's common name from fundamentals.
  const fund = await prisma.companyFundamentals.findUnique({ where: { symbol: asset }, select: { name: true, sector: true } }).catch(() => null);
  const companyName = fund?.name?.split(/[,.]| Inc| Corp| Class/)[0]?.trim();
  const matchTerms = [asset.toLowerCase(), companyName?.toLowerCase()].filter(Boolean) as string[];
  const assetNews = geopoliticalDataService.getRecentNews(120).filter(n => {
    const title = n.title.toLowerCase();
    return matchTerms.some(term => title.includes(term));
  });
  const sentiment = geopoliticalDataService.generateMarketSentimentSummary();
  const geoEvents = geopoliticalDataService.getActiveGeopoliticalEvents(24);

  const lines = [`Market sentiment: ${sentiment.overallSentiment} (${sentiment.positiveNews} positive / ${sentiment.negativeNews} negative headlines)`];

  if (assetNews.length > 0) {
    lines.push(`${asset}-specific: ${assetNews.slice(0, 3).map(n => n.title).join(' | ')}`);
  }
  if (highImpact.length > 0) {
    lines.push(`High-impact headlines: ${highImpact.slice(0, 3).map(n => n.title).join(' | ')}`);
  }
  if (geoEvents.length > 0) {
    lines.push(`Active geopolitical risk: ${geoEvents.slice(0, 2).map(e => `${e.region}: ${e.event}`).join(' | ')}`);
  }
  // Does this asset's own sector actually get hit by anything happening
  // right now — not just "is there bad news somewhere," but "does it touch
  // this company's segment specifically" (e.g. a chip-export headline
  // matters a lot more to a semiconductor stock than to a retailer).
  const companySectors = fund?.sector ? classifySectors(fund.sector).filter(s => s !== 'Broad Market') : [];
  const sectorNews = companySectors.length > 0
    ? highImpact.filter(n => n.sectorsAffected.some(s => companySectors.includes(s)))
    : [];
  if (sectorNews.length > 0) {
    lines.push(`Sector-relevant (${companySectors.join('/')}): ${sectorNews.slice(0, 2).map(n => n.title).join(' | ')}`);
  }
  return lines.length > 1 || highImpact.length > 0 || geoEvents.length > 0 ? lines.join('\n') : '';
}

function getDominantView(results: any[]): { direction: string; leadAgent: any } {
  const buys = results.filter(r => r.vote === 'BUY');
  const sells = results.filter(r => r.vote === 'SELL');
  if (buys.length > sells.length) return { direction: 'BUY', leadAgent: buys[0] };
  if (sells.length > buys.length) return { direction: 'SELL', leadAgent: sells[0] };
  return { direction: 'HOLD', leadAgent: results[0] };
}

// Was just "Agents: Technician:HOLD, Newshound:HOLD, ..." — a bare vote
// tally with no reasoning, which is why every agent's Round 3 "final vote"
// just cited the vote count instead of actually engaging with anyone's
// argument. Now carries each agent's real case plus the Round 2 rebuttal.
function buildDebateSummary(round1: any[], round2: CrossExam | null): string {
  const lines = round1.map(r => {
    const factors = r.keyFactors?.length ? ` | Factors: ${r.keyFactors.join('; ')}` : '';
    const risks = r.riskWarnings?.length ? ` | Risks: ${r.riskWarnings.join('; ')}` : '';
    return `${r.agentName} (${r.vote} ${r.confidence}%): ${r.openingArgument}${factors}${risks}`;
  });
  if (round2) {
    lines.push(`\nCROSS-EXAMINATION: ${round2.challenger} challenged ${round2.target}: "${round2.challenge}"`);
    lines.push(`${round2.target} responded: "${round2.rebuttal}"`);
  }
  return lines.join('\n');
}

function calculateKellySize(winProb: number, riskReward: number): number {
  if (riskReward <= 0) return 0;
  const kelly = winProb - (1 - winProb) / riskReward;
  if (kelly <= 0) return 0; // non-positive edge — Kelly says bet nothing, don't force a floor
  const halfKelly = kelly * 0.5;
  // Cap at 1% — TOP TRADER LAW 1 blocks anything over 1% for small accounts
  return Math.min(halfKelly * 100, 1.0);
}
