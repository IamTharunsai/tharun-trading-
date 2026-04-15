import Anthropic from '@anthropic-ai/sdk';
import { AgentVote, MarketSnapshot } from './types';
import { logger } from '../utils/logger';
import axios from 'axios';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function safeVote(agentId: number, agentName: string, error: unknown, start: number): AgentVote {
  logger.error(`Agent ${agentId} (${agentName}) failed`, { error });
  return {
    agentId, agentName, vote: 'HOLD', confidence: 0,
    reasoning: `Agent failed — defaulting to HOLD for safety`,
    keyFactors: ['Agent timeout/error'], riskWarnings: ['Analysis unavailable'],
    executionTime: Date.now() - start, timestamp: Date.now()
  };
}

async function callClaude(system: string, user: string): Promise<any> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system,
    messages: [{ role: 'user', content: user }]
  });
  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response');
  return JSON.parse(content.text);
}

// ── AGENT 2: THE NEWSHOUND ────────────────────────────────────────────────────
export async function runAgent2Newshound(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    let newsContext = 'No recent news fetched.';
    try {
      const res = await axios.get(`https://finnhub.io/api/v1/company-news`, {
        params: { symbol: snapshot.asset, from: new Date(Date.now() - 86400000).toISOString().split('T')[0], to: new Date().toISOString().split('T')[0], token: process.env.FINNHUB_API_KEY },
        timeout: 5000
      });
      if (res.data && res.data.length > 0) {
        newsContext = res.data.slice(0, 5).map((n: any) => `- ${n.headline} (${n.source})`).join('\n');
      }
    } catch (_) { /* use default */ }

    const system = `You are Agent 2: THE NEWSHOUND — an elite news analyst at a top hedge fund. Analyze only news and events. Respond ONLY in JSON: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"reasoning":"...","keyFactors":["..."],"riskWarnings":["..."]}`;
    const user = `Asset: ${snapshot.asset} | Price: $${snapshot.price} | 24h Change: ${snapshot.priceChangePct24h.toFixed(2)}%\n\nRecent News Headlines:\n${newsContext}\n\nAnalyze news sentiment. Should we BUY, SELL, or HOLD?`;

    const parsed = await callClaude(system, user);
    return { agentId: 2, agentName: 'The Newshound', vote: parsed.vote, confidence: Math.min(100, Math.max(0, parsed.confidence)), reasoning: parsed.reasoning, keyFactors: parsed.keyFactors || [], riskWarnings: parsed.riskWarnings || [], executionTime: Date.now() - start, timestamp: Date.now() };
  } catch (error) { return safeVote(2, 'The Newshound', error, start); }
}

// ── AGENT 3: THE SENTIMENT ANALYST ───────────────────────────────────────────
export async function runAgent3Sentiment(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    let fearGreed = 50;
    try {
      const res = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 });
      fearGreed = parseInt(res.data?.data?.[0]?.value || '50');
    } catch (_) {}

    const system = `You are Agent 3: THE SENTIMENT ANALYST. You analyze market sentiment, social mood, and psychological factors. Respond ONLY in JSON: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"reasoning":"...","keyFactors":["..."],"riskWarnings":["..."]}`;
    const user = `Asset: ${snapshot.asset} | Price: $${snapshot.price} | 24h Change: ${snapshot.priceChangePct24h.toFixed(2)}%\n\nFear & Greed Index: ${fearGreed}/100 (${fearGreed < 25 ? 'EXTREME FEAR' : fearGreed < 45 ? 'FEAR' : fearGreed < 55 ? 'NEUTRAL' : fearGreed < 75 ? 'GREED' : 'EXTREME GREED'})\n24h Volume change: ${((snapshot.volumeChange || 0) * 100).toFixed(1)}%\nSpread: ${((snapshot.spread / snapshot.price) * 100).toFixed(3)}%\n\nVOTE: BUY, SELL, or HOLD based on market sentiment?`;

    const parsed = await callClaude(system, user);
    return { agentId: 3, agentName: 'The Sentiment Analyst', vote: parsed.vote, confidence: Math.min(100, Math.max(0, parsed.confidence)), reasoning: parsed.reasoning, keyFactors: parsed.keyFactors || [], riskWarnings: parsed.riskWarnings || [], executionTime: Date.now() - start, timestamp: Date.now() };
  } catch (error) { return safeVote(3, 'The Sentiment Analyst', error, start); }
}

// ── AGENT 4: THE FUNDAMENTAL ANALYST ─────────────────────────────────────────
export async function runAgent4Fundamental(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    const system = `You are Agent 4: THE FUNDAMENTAL ANALYST. You evaluate the intrinsic value and growth prospects of assets. For crypto: tokenomics, adoption, network activity. For stocks: P/E, revenue, margins, competitive moat. Respond ONLY in JSON: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"reasoning":"...","keyFactors":["..."],"riskWarnings":["..."]}`;
    const user = `Asset: ${snapshot.asset} (${snapshot.market}) | Price: $${snapshot.price} | Market Cap: ${snapshot.marketCap ? '$' + (snapshot.marketCap / 1e9).toFixed(2) + 'B' : 'N/A'}\n24h Change: ${snapshot.priceChangePct24h.toFixed(2)}% | Volume: ${snapshot.volume24h.toLocaleString()}\n\nBased on your knowledge of ${snapshot.asset}'s fundamentals, provide your fundamental analysis vote.`;

    const parsed = await callClaude(system, user);
    return { agentId: 4, agentName: 'The Fundamental Analyst', vote: parsed.vote, confidence: Math.min(100, Math.max(0, parsed.confidence)), reasoning: parsed.reasoning, keyFactors: parsed.keyFactors || [], riskWarnings: parsed.riskWarnings || [], executionTime: Date.now() - start, timestamp: Date.now() };
  } catch (error) { return safeVote(4, 'The Fundamental Analyst', error, start); }
}

// ── AGENT 5: THE RISK MANAGER (VETO POWER) ───────────────────────────────────
export async function runAgent5RiskManager(snapshot: MarketSnapshot, portfolioState: any): Promise<AgentVote> {
  const start = Date.now();
  try {
    const system = `You are Agent 5: THE RISK MANAGER — you have ABSOLUTE VETO POWER. Your ONLY job is capital preservation. If you vote HOLD, NO TRADE EXECUTES regardless of other agents. You are the last line of defense.\n\nCritical: Vote HOLD if:\n- Portfolio daily loss is near the 5% limit\n- Drawdown is approaching limits\n- Position would exceed 10% portfolio concentration\n- Market conditions are extreme/unstable\n- Risk/reward is unfavorable\n\nRespond ONLY in JSON: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"reasoning":"...","keyFactors":["..."],"riskWarnings":["..."]}`;
    const user = `Asset: ${snapshot.asset} | Price: $${snapshot.price}\n\nPORTFOLIO STATE:\n- Total Value: $${portfolioState.totalValue?.toFixed(2)}\n- Daily Loss Today: ${portfolioState.pnlDayPct?.toFixed(2)}%\n- Drawdown from Peak: ${portfolioState.drawdownFromPeak?.toFixed(2)}%\n- Trades Today: ${portfolioState.tradesExecutedToday}\n- Cash Available: $${portfolioState.cashBalance?.toFixed(2)}\n- Current Positions: ${portfolioState.positions?.length || 0}\n\nGUARDRAIL LIMITS:\n- Daily Loss Limit: ${process.env.DAILY_LOSS_LIMIT_PCT || 5}%\n- Max Drawdown: ${process.env.MAX_DRAWDOWN_ALL_TIME_PCT || 20}%\n- Max Trades/Day: ${process.env.MAX_TRADES_PER_DAY || 50}\n\nIs it SAFE to trade ${snapshot.asset} right now? Use your veto if needed.`;

    const parsed = await callClaude(system, user);
    return { agentId: 5, agentName: 'The Risk Manager', vote: parsed.vote, confidence: Math.min(100, Math.max(0, parsed.confidence)), reasoning: parsed.reasoning, keyFactors: parsed.keyFactors || [], riskWarnings: parsed.riskWarnings || [], executionTime: Date.now() - start, timestamp: Date.now() };
  } catch (error) { return safeVote(5, 'The Risk Manager', error, start); }
}

// ── AGENT 6: THE TREND PROPHET (FUTURE PREDICTION) ───────────────────────────
export async function runAgent6TrendProphet(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    const priceHistory = snapshot.candles.slice(-20).map(c => c.close);
    const trend = priceHistory.length > 1 ? ((priceHistory[priceHistory.length-1] - priceHistory[0]) / priceHistory[0] * 100).toFixed(2) : '0';

    const system = `You are Agent 6: THE TREND PROPHET — a quantitative forecaster combining AI pattern recognition, time-series analysis, and macro trend modeling. Your job is to predict FUTURE price direction.\n\nAnalyze: momentum, trend persistence, mean-reversion probability, macro calendar events, seasonal patterns.\n\nAlso output a prediction object.\nRespond ONLY in JSON: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"reasoning":"...","keyFactors":["..."],"riskWarnings":["..."],"prediction":{"direction":"UP"|"DOWN"|"SIDEWAYS","targetPrice":<number>,"timeHorizon":"4h","probabilityPct":<number>}}`;
    const user = `Asset: ${snapshot.asset} | Current Price: $${snapshot.price}\n20-candle trend: ${trend}%\nRSI: ${snapshot.indicators.rsi14.toFixed(1)} | MACD: ${snapshot.indicators.macd.histogram > 0 ? 'BULLISH' : 'BEARISH'}\n\nPredict the next 4-hour price direction and vote.`;

    const parsed = await callClaude(system, user);
    return { agentId: 6, agentName: 'The Trend Prophet', vote: parsed.vote, confidence: Math.min(100, Math.max(0, parsed.confidence)), reasoning: parsed.reasoning, keyFactors: parsed.keyFactors || [], riskWarnings: parsed.riskWarnings || [], executionTime: Date.now() - start, timestamp: Date.now() };
  } catch (error) { return safeVote(6, 'The Trend Prophet', error, start); }
}

// ── AGENT 7: THE VOLUME DETECTIVE ────────────────────────────────────────────
export async function runAgent7VolumeDetective(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    const volRatio = snapshot.volume24h / (snapshot.indicators.volumeAvg20 || snapshot.volume24h);
    const isVolumeSpike = volRatio > 2;

    const system = `You are Agent 7: THE VOLUME DETECTIVE. Volume is the fuel of all price moves. You analyze OBV, volume spikes, accumulation/distribution, and confirm or deny price moves with volume. No volume confirmation = no trade.\n\nRespond ONLY in JSON: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"reasoning":"...","keyFactors":["..."],"riskWarnings":["..."]}`;
    const user = `Asset: ${snapshot.asset} | Price: $${snapshot.price} | Change: ${snapshot.priceChangePct24h.toFixed(2)}%\n\nVOLUME DATA:\n- 24h Volume: ${snapshot.volume24h.toLocaleString()}\n- 20-day avg volume: ${snapshot.indicators.volumeAvg20.toLocaleString()}\n- Volume ratio: ${volRatio.toFixed(2)}x ${isVolumeSpike ? '⚠️ SPIKE DETECTED' : ''}\n- OBV: ${snapshot.indicators.obv > 0 ? 'POSITIVE (accumulation)' : 'NEGATIVE (distribution)'}\n- Bid/Ask spread: ${((snapshot.spread / snapshot.price) * 100).toFixed(3)}%\n\nDoes volume CONFIRM a trade here?`;

    const parsed = await callClaude(system, user);
    return { agentId: 7, agentName: 'The Volume Detective', vote: parsed.vote, confidence: Math.min(100, Math.max(0, parsed.confidence)), reasoning: parsed.reasoning, keyFactors: parsed.keyFactors || [], riskWarnings: parsed.riskWarnings || [], executionTime: Date.now() - start, timestamp: Date.now() };
  } catch (error) { return safeVote(7, 'The Volume Detective', error, start); }
}

// ── AGENT 8: THE WHALE WATCHER ────────────────────────────────────────────────
export async function runAgent8WhaleWatcher(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    const system = `You are Agent 8: THE WHALE WATCHER. You track large institutional money flows, on-chain whale movements (for crypto), dark pool activity, and smart money positioning. Where whales go, price follows.\n\nRespond ONLY in JSON: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"reasoning":"...","keyFactors":["..."],"riskWarnings":["..."]}`;
    const user = `Asset: ${snapshot.asset} (${snapshot.market}) | Price: $${snapshot.price}\nMarket Cap: ${snapshot.marketCap ? '$' + (snapshot.marketCap / 1e9).toFixed(1) + 'B' : 'N/A'}\nVolume vs avg: ${((snapshot.volume24h / (snapshot.indicators.volumeAvg20 || snapshot.volume24h)) * 100).toFixed(0)}%\n\nBased on your knowledge of institutional and whale behavior patterns for ${snapshot.asset}, and the current volume/price action, assess if whales are accumulating or distributing. Vote accordingly.`;

    const parsed = await callClaude(system, user);
    return { agentId: 8, agentName: 'The Whale Watcher', vote: parsed.vote, confidence: Math.min(100, Math.max(0, parsed.confidence)), reasoning: parsed.reasoning, keyFactors: parsed.keyFactors || [], riskWarnings: parsed.riskWarnings || [], executionTime: Date.now() - start, timestamp: Date.now() };
  } catch (error) { return safeVote(8, 'The Whale Watcher', error, start); }
}

// ── AGENT 9: THE MACRO ECONOMIST ──────────────────────────────────────────────
export async function runAgent9MacroEconomist(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    const system = `You are Agent 9: THE MACRO ECONOMIST. You assess macroeconomic conditions: Fed policy, interest rates, inflation, DXY, global risk-on/risk-off sentiment, geopolitical risks, and cross-asset correlations.\n\nRespond ONLY in JSON: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"reasoning":"...","keyFactors":["..."],"riskWarnings":["..."]}`;
    const user = `Asset: ${snapshot.asset} (${snapshot.market}) | Price: $${snapshot.price} | 24h: ${snapshot.priceChangePct24h.toFixed(2)}%\n\nBased on current macro environment (Fed policy, rates, inflation, global risk sentiment), and ${snapshot.asset}'s historical correlation to macro factors, provide your macroeconomic vote for this potential trade.`;

    const parsed = await callClaude(system, user);
    return { agentId: 9, agentName: 'The Macro Economist', vote: parsed.vote, confidence: Math.min(100, Math.max(0, parsed.confidence)), reasoning: parsed.reasoning, keyFactors: parsed.keyFactors || [], riskWarnings: parsed.riskWarnings || [], executionTime: Date.now() - start, timestamp: Date.now() };
  } catch (error) { return safeVote(9, 'The Macro Economist', error, start); }
}

// ── AGENT 10: THE DEVIL'S ADVOCATE ───────────────────────────────────────────
export async function runAgent10DevilsAdvocate(snapshot: MarketSnapshot, otherVotes: AgentVote[]): Promise<AgentVote> {
  const start = Date.now();
  try {
    const voteSummary = otherVotes.map(v => `- Agent ${v.agentId} (${v.agentName}): ${v.vote} (${v.confidence}% confidence) — ${v.reasoning}`).join('\n');
    const goVotes = otherVotes.filter(v => v.vote !== 'HOLD').length;

    const system = `You are Agent 10: THE DEVIL'S ADVOCATE. Your SOLE PURPOSE is to argue AGAINST the trade. You look for every reason why the other agents are WRONG. You are a professional skeptic.\n\nIf the other 9 agents all say BUY — you argue SELL or HOLD.\nIf they say SELL — you argue BUY or HOLD.\nYour job: expose blind spots, hidden risks, and false assumptions.\n\nYou have a "blocking threshold": if you genuinely believe the trade is catastrophically bad, vote HOLD with 90+ confidence.\n\nRespond ONLY in JSON: {"vote":"BUY"|"SELL"|"HOLD","confidence":0-100,"reasoning":"...","keyFactors":["..."],"riskWarnings":["..."]}`;
    const user = `Asset: ${snapshot.asset} | Price: $${snapshot.price}\n\nThe other 9 agents have voted:\n${voteSummary}\n\nTotal GO votes: ${goVotes}/9\n\nNow argue AGAINST this trade. Find every weakness, risk, and reason they could all be wrong. What are they all missing?`;

    const parsed = await callClaude(system, user);
    return { agentId: 10, agentName: "The Devil's Advocate", vote: parsed.vote, confidence: Math.min(100, Math.max(0, parsed.confidence)), reasoning: parsed.reasoning, keyFactors: parsed.keyFactors || [], riskWarnings: parsed.riskWarnings || [], executionTime: Date.now() - start, timestamp: Date.now() };
  } catch (error) { return safeVote(10, "The Devil's Advocate", error, start); }
}
