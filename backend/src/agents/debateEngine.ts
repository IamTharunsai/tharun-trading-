import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { getIO } from '../websocket/server';
import { MarketSnapshot, PortfolioState } from './types';
import { getFundamentalsSummary, fetchAndStoreFundamentals, fetchAndStoreAnnualReports } from '../services/fundamentalsService';
import { getStockMemorySummary, recordDebate } from '../services/stockMemoryService';
import { fetchDeepAnalysis, formatDeepAnalysisForAgents } from '../services/deepAnalysisService';
import { agentActivityMonitor } from '../services/agentActivityMonitor';
import MASTER_BOOK_KNOWLEDGE from './masterKnowledge';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Compact knowledge injected per agent (keeps tokens low)
const COMPACT_KNOWLEDGE = `KEY RULES: Risk 1-2% per trade. R/R must be >2:1. CANSLIM: EPS growth >25%, near 52wk high, vol surge. Minervini: price>50MA>150MA>200MA, 52wk high within 25%, RS high. Kelly sizing. RSI>70=overbought RSI<30=oversold. Golden Cross=bullish. Volume confirmation required. Cut losses fast, let winners run.`;

// Call Anthropic with automatic retry on 429 rate limit
async function callWithRetry(params: Parameters<typeof anthropic.messages.create>[0], maxRetries = 3): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
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

export interface DebateTranscript {
  id: string;
  asset: string;
  market: string;
  timestamp: number;
  price: number;
  priceChange24h: number;
  marketRegime: string;
  round1: { agentId: number; agentName: string; vote: string; argument: string }[];
  round2: { challenger: string; target: string; challenge: string; rebuttal: string }[];
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

const AGENT_ROSTER = [
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
    systemPrompt: `You are THE WHALE WATCHER — you track the money that actually moves markets. Institutions, hedge funds, and wealthy individuals move billions. When they move, price follows.

WHALE BEHAVIOR PATTERNS:
ACCUMULATION SIGNS:
- Large addresses slowly increasing holdings over weeks
- Price holding up despite bad news = quiet buying
- Exchange outflows increasing = coins leaving exchanges to cold storage = bullish
- Funding rates low or negative despite rising price = institutional buying not retail

DISTRIBUTION SIGNS:
- Large addresses slowly decreasing holdings
- Price failing to make new highs despite good news = selling into strength
- Exchange inflows increasing = coins moving to exchanges = selling pressure coming
- Funding rates very high = overleveraged longs = ripe for squeeze

ON-CHAIN INTELLIGENCE:
- Exchange reserves declining = bullish (coins being withdrawn = holding)
- Exchange reserves increasing = bearish (coins being deposited = selling)
- Miner outflows to exchanges = bearish (miners selling rewards)
- Large wallet clustering (many small wallets feeding one large = consolidation)

INSTITUTIONAL SIGNALS:
- CME futures open interest = institutional positioning
- Grayscale premium/discount = institutional demand/supply
- CFTC commitment of traders report = what commercial hedgers are doing

DARK POOL ACTIVITY (stocks): Large block trades away from exchange = institutional repositioning. Usually directional — follow the smart money.

YOUR FAILURE MODES: On-chain data has delays. Wallets can be split to hide activity. Not all large holders are smart money.`
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

CONSENSUS RISK: When all agents agree — THAT is when you must work hardest. Crowded consensus trades fail badly. If 9 agents all say BUY — you find 9 reasons why it might not work.

TIMING RISK: Is this a good IDEA but bad TIMING? Even the right thesis fails if entered at the wrong point.

UNKNOWN UNKNOWNS: What has NOT been considered? What black swan is lurking? What assumption is everyone making that might be wrong?

REGIME MISMATCH: Are agents using strategies designed for one market type in the wrong market? Momentum strategies fail in chop. Mean reversion fails in strong trends.

MANIPULATION: Is this move real or is someone trapping retail traders? Fake breakouts. Stop hunts. Whale manipulation.

YOUR BLOCKING CRITERIA: If you believe the trade is genuinely dangerous and not just imperfect — vote HOLD with 85%+ confidence to trigger a soft block that requires the Master Coordinator to override.

IMPORTANT: You argue against the dominant view. If everyone says BUY, you find bear cases. If everyone says SELL, you find bull cases. You are not always right — but you ensure we always consider the other side.`
  }
];

// ── MASTER COORDINATOR ────────────────────────────────────────────────────────

const MASTER_COORDINATOR_PROMPT = `You are THE MASTER COORDINATOR — the Chief Investment Officer of Tharun Agentic Trading. You have listened to a full investment committee debate. Now you must synthesize all arguments and make the FINAL decision.

DECISION STANDARDS:
- You need genuine conviction, not just a majority vote
- If the debate was inconclusive — you vote HOLD (uncertainty = no trade)
- If risk/reward is unfavorable — you vote HOLD
- Only vote BUY or SELL when you have GENUINE conviction

OUTPUT FORMAT — always respond in valid JSON:
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
  marketRegime: string
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

  // Deep analysis — fetch ALL data before debate starts
  const [deepAnalysis, stockMemory] = await Promise.all([
    snapshot.market === 'stocks' ? fetchDeepAnalysis(asset).catch(() => null) : Promise.resolve(null),
    getStockMemorySummary(asset),
  ]);

  const fundamentalsSummary = deepAnalysis
    ? formatDeepAnalysisForAgents(deepAnalysis)
    : snapshot.market === 'stocks' ? await getFundamentalsSummary(asset) : '';

  await recordDebate(asset, 'PENDING');

  logger.info('📢 ROUND 1: OPENING ARGUMENTS');
  io?.emit('debate:round', { round: 1, debateId, asset });

  const round1Prompt = buildMarketContext(snapshot, portfolio, marketRegime, fundamentalsSummary, stockMemory);
  const round1Results: any[] = [];

  const round1AgentResults = await runAgentsSequentially(AGENT_ROSTER.slice(0, 9), async (agent) => {
    try {
      io?.emit('debate:agent-speaking', { agentId: agent.id, agentName: agent.name, round: 1, debateId });

      const response = await callWithRetry({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: `${agent.systemPrompt}\n${COMPACT_KNOWLEDGE}\nRespond ONLY in valid JSON: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"openingArgument":"<cite numbers>","keyFactors":["<f1>","<f2>","<f3>"],"riskWarnings":["<w1>","<w2>"],"priceTarget":"<price>","stopLevel":"<price>","riskReward":"<ratio>"}`,
        messages: [{ role: 'user', content: `COMMITTEE — ${asset}\n\n${round1Prompt}\n\nState your position with specific numbers.` }]
      });

      const content = response.content[0];
      if (content.type !== 'text') throw new Error('Bad response');
      const parsed = JSON.parse(content.text.replace(/```json\n?|\n?```/g, '').trim());

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
      logger.error(`Agent ${agent.id} Round 1 failed`, { err });
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: devilAgent.systemPrompt + `\n${COMPACT_KNOWLEDGE}\n\nRespond ONLY in valid JSON:\n{"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"openingArgument":"<challenge>","keyFactors":["<f1>"],"riskWarnings":["<w1>"],"weaknessOfMyOwnView":"<weakness>"}`,
      messages: [{ role: 'user', content: `Other agents:\n\n${round1Summary}\n\nMarket: ${round1Prompt}\n\nWhat is your counter-argument?` }]
    });
    const dc = devilResponse.content[0];
    if (dc.type === 'text') {
      const dp = JSON.parse(dc.text.replace(/```json\n?|\n?```/g, '').trim());
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
    logger.error('Devil\'s Advocate Round 1 failed', { err });
    const fallback = { agentId: 10, agentName: devilAgent.name, agentIcon: devilAgent.icon, vote: 'HOLD' as const, confidence: 0, openingArgument: 'Analysis unavailable', keyFactors: [], riskWarnings: [], weaknessOfMyOwnView: '' };
    round1Results.push(fallback);
    transcript.round1.push({ agentId: 10, agentName: devilAgent.name, vote: 'HOLD', argument: 'Analysis unavailable' });
    io?.emit('debate:agent-voted', { ...fallback, round: 1, debateId });
  }

  logger.info('\n⚔️  ROUND 2: CROSS-EXAMINATION');
  io?.emit('debate:round', { round: 2, debateId, asset });

  const dominantView = getDominantView(round1Results);
  const round2Results: any[] = [];

  logger.info('\n🗳️  ROUND 3: FINAL VERDICT');
  io?.emit('debate:round', { round: 3, debateId, asset });

  const debateSummary = buildDebateSummary(round1Results, round2Results);

  const round3Results = await runAgentsSequentially(AGENT_ROSTER, async (agent) => {
    const originalVote = round1Results.find(r => r.agentId === agent.id);
    try {
      const response = await callWithRetry({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: agent.systemPrompt,
        messages: [{
          role: 'user',
          content: `You voted: ${originalVote?.vote || 'HOLD'}\n\nAfter debate:\n${debateSummary}\n\nFinal vote?\n\nJSON: {"finalVote":"BUY"|"SELL"|"HOLD","confidence":0-100,"changedMind":true|false,"finalReason":"<reason>"}`
        }]
      });
      const content = response.content[0];
      if (content.type !== 'text') throw new Error('Bad response');
      const parsed = JSON.parse(content.text.replace(/```json\n?|\n?```/g, '').trim());

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
      return { agentId: agent.id, agentName: agent.name, agentIcon: agent.icon, initialVote: originalVote?.vote || 'HOLD', finalVote: originalVote?.vote || 'HOLD', confidence: originalVote?.confidence || 0, changedMind: false, finalReason: 'Error', openingArgument: '', keyFactors: [], riskWarnings: [], challenges: [], rebuttals: [] };
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
  const avgConfidence = Math.round(finalVotes.reduce((s, v) => s + v.confidence, 0) / finalVotes.length);

  const riskManagerFinalVote = round3Results.find(r => r.agentId === 5)?.finalVote;
  const devilFinalVote = round3Results.find(r => r.agentId === 10);

  let masterDecision: any;

  const allAgentsFailed = round3Results.every(r => r.finalReason === 'Error' || r.confidence === 0);
  if (riskManagerFinalVote === 'HOLD') {
    masterDecision = {
      finalDecision: 'HOLD',
      confidence: 100,
      synthesis: allAgentsFailed ? 'All agents failed (API error) — no trade.' : 'Risk Manager vetoed.',
      blockReason: allAgentsFailed ? 'Agent API errors — retrying next cycle' : 'Risk Manager VETO',
      positionSizeRecommendation: 0,
      strongestBullArguments: [], strongestBearArguments: [],
      keyRisk: 'Risk flagged', stopLossRationale: 'N/A', takeProfitRationale: 'N/A', whatCouldGoWrong: 'Risk Manager decision'
    };
  } else {
    try {
      const fullDebateContext = `DEBATE FOR ${asset} @ $${snapshot.price}\nRegime: ${marketRegime}\nDaily P&L: ${portfolio.pnlDayPct.toFixed(2)}%\n\nRound 1:\n${round1Results.map(r => `${r.agentName}: ${r.vote}`).join('\n')}\n\nVote Tally: BUY ${buyCount}, SELL ${sellCount}, HOLD ${holdCount}`;

      const masterResponse = await callWithRetry({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: MASTER_COORDINATOR_PROMPT,
        messages: [{ role: 'user', content: fullDebateContext }]
      });

      const mc = masterResponse.content[0];
      if (mc.type === 'text') {
        masterDecision = JSON.parse(mc.text.replace(/```json\n?|\n?```/g, '').trim());
      }
    } catch (err) {
      logger.error('Master Coordinator failed', { err });
      masterDecision = { finalDecision: 'HOLD', confidence: 0, synthesis: 'Error', blockReason: 'System error', positionSizeRecommendation: 0 };
    }
  }

  const minVotes = parseInt(process.env.MIN_VOTES_TO_EXECUTE || '6');
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

  const stopLossPct = snapshot.market === 'crypto' ? 0.03 : 0.02;
  const takeProfitPct = 0.06;
  const direction = masterDecision.finalDecision;
  const stopLoss = direction === 'BUY' ? snapshot.price * (1 - stopLossPct) : snapshot.price * (1 + stopLossPct);
  const takeProfit = direction === 'BUY' ? snapshot.price * (1 + takeProfitPct) : snapshot.price * (1 - takeProfitPct);
  const riskReward = Math.abs(takeProfit - snapshot.price) / Math.abs(stopLoss - snapshot.price);
  const kellyPct = calculateKellySize(avgConfidence / 100, riskReward);

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

function buildMarketContext(
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  regime: string,
  fundamentals = '',
  stockMemory = ''
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
  return lines.join('\n');
}

function getDominantView(results: any[]): { direction: string; leadAgent: any } {
  const buys = results.filter(r => r.vote === 'BUY');
  const sells = results.filter(r => r.vote === 'SELL');
  if (buys.length > sells.length) return { direction: 'BUY', leadAgent: buys[0] };
  if (sells.length > buys.length) return { direction: 'SELL', leadAgent: sells[0] };
  return { direction: 'HOLD', leadAgent: results[0] };
}

function buildDebateSummary(round1: any[], round2: any[]): string {
  return `Agents: ${round1.map(r => `${r.agentName}:${r.vote}`).join(', ')}`;
}

function calculateKellySize(winProb: number, riskReward: number): number {
  if (riskReward <= 0) return 0;
  const kelly = winProb - (1 - winProb) / riskReward;
  const halfKelly = kelly * 0.5;
  const maxPositionPct = parseFloat(process.env.MAX_POSITION_SIZE_PCT || '10');
  return Math.min(Math.max(halfKelly * 100, 0.5), maxPositionPct);
}
