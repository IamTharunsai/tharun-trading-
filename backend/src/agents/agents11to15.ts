import Anthropic from '@anthropic-ai/sdk';
import { AgentVote, MarketSnapshot } from './types';
import { logger } from '../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── AGENT 11: THE ELLIOTT WAVE MASTER ─────────────────────────────────────────
const ELLIOTT_WAVE_PROMPT = `You are Agent 11: THE ELLIOTT WAVE MASTER — an expert in Elliott Wave Theory and Fibonacci analysis. You are part of a 15-agent AI trading council.

Your SOLE job is to identify Elliott Wave patterns and predict major turning points using Fibonacci ratios.

Your expertise:
- Elliott Wave pattern counting (impulsive and corrective waves)
- Fibonacci retracements (0.236, 0.382, 0.5, 0.618, 0.786)
- Fibonacci extensions for price targets
- Wave confluence with other technical patterns
- Support/resistance from Fibonacci levels
- Trend continuation vs reversal signals

CRITICAL RULES:
1. Only vote BUY/SELL when wave count is clear and Fibonacci confirms
2. A HOLD vote is safer than a forced wave count
3. Wave patterns work best on 4h and 1D timeframes
4. Consider multiple wave counts and take the most probable one
5. Always check if price is at Fibonacci confluence level

Respond with valid JSON:
{
  "vote": "BUY" | "SELL" | "HOLD",
  "confidence": <0-100>,
  "reasoning": "<wave count and Fibonacci analysis>",
  "waveCount": "<your current wave count > (e.g. 'Wave 3 impulse' or 'ABC correction')>
  "fibonacciLevels": ["<key fib level 1>", "<key fib level 2>"],
  "keyFactors": ["<factor 1>", "<factor 2>"],
  "riskWarnings": ["<warning 1>", "<warning 2>"]
}`;

export async function runAgentElliotWaveMaster(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    const userPrompt = `
Analyze Elliott Wave structure for ${snapshot.asset}.

CURRENT PRICE: $${snapshot.price}
LAST 5 CANDLES (1h):
${snapshot.candles.slice(-5).map((c, i) => 
  `  [${i+1}] O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} ${c.close > c.open ? '🟢' : '🔴'}`
).join('\n')}

Recent price data for wave counting:
- 52w High: $${snapshot.high24h * 1.1}
- 52w Low: $${snapshot.low24h * 0.9}
- Recent Swing High: $${snapshot.high24h}
- Recent Swing Low: $${snapshot.low24h}

Identify the Elliott Wave pattern and Fibonacci confluence levels. Vote now.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: ELLIOTT_WAVE_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    const parsed = JSON.parse(content.text);

    return {
      agentId: 11,
      agentName: 'The Elliott Wave Master',
      vote: parsed.vote,
      confidence: Math.min(100, Math.max(0, parsed.confidence)),
      reasoning: parsed.reasoning,
      waveCount: parsed.waveCount,
      keyFactors: parsed.keyFactors || [],
      riskWarnings: parsed.riskWarnings || [],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error('Agent 11 (Elliott Wave Master) failed', { error, asset: snapshot.asset });
    return {
      agentId: 11,
      agentName: 'The Elliott Wave Master',
      vote: 'HOLD',
      confidence: 0,
      reasoning: 'Elliott Wave analysis unavailable — defaulting to HOLD',
      keyFactors: ['Agent timeout/error'],
      riskWarnings: ['Wave analysis unavailable'],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  }
}

// ── AGENT 12: THE OPTIONS FLOW AGENT ──────────────────────────────────────────
const OPTIONS_FLOW_PROMPT = `You are Agent 12: THE OPTIONS FLOW AGENT — an expert in options market activity and sentiment. You are part of a 15-agent AI trading council.

Your SOLE job is to analyze unusual options activity and predict price moves 1-2 days ahead.

Your expertise:
- Put/call ratio signals
- Unusual options volume and open interest
- Implied volatility (IV) spikes and crushes
- Options flow predicting spot price moves
- Strike prices with heavy concentration
- Smart money positioning before earnings/events
- Options expiration effects

CRITICAL RULES:
1. Only vote when you see significant options anomaly
2. Big put volume often precedes big down moves
3. IV spikes can signal upcoming volatility or reversals
4. Pay attention to max pain levels
5. A HOLD vote is better than guessing options activity

Respond with valid JSON:
{
  "vote": "BUY" | "SELL" | "HOLD",
  "confidence": <0-100>,
  "reasoning": "<options flow analysis>",
  "putCallRatio": <number>,
  "ivLevel": "<low|normal|high|extreme>",
  "keyFactors": ["<factor 1>", "<factor 2>"],
  "riskWarnings": ["<warning 1>", "<warning 2>"]
}`;

export async function runAgentOptionsFlow(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    const userPrompt = `
Analyze options flow for ${snapshot.asset}.

CURRENT PRICE: $${snapshot.price}
24h Volume: ${snapshot.volume24h.toLocaleString()}
Recent ATR: ${snapshot.indicators.atr14.toFixed(4)}

Market conditions:
- Last candle: ${snapshot.candles[snapshot.candles.length - 1]?.close > snapshot.candles[snapshot.candles.length - 1]?.open ? 'Green' : 'Red'}
- 5-candle avg Vol: ${(snapshot.indicators.volumeAvg20 / snapshot.volume24h * 100).toFixed(0)}% of current
- Volatility: ${snapshot.indicators.atr14 > 0.05 ? 'HIGH' : 'NORMAL'}

Looking for signs of smart money positioning through unusual options activity.
What does the options flow suggest?`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: OPTIONS_FLOW_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    const parsed = JSON.parse(content.text);

    return {
      agentId: 12,
      agentName: 'The Options Flow Agent',
      vote: parsed.vote,
      confidence: Math.min(100, Math.max(0, parsed.confidence)),
      reasoning: parsed.reasoning,
      putCallRatio: parsed.putCallRatio,
      ivLevel: parsed.ivLevel,
      keyFactors: parsed.keyFactors || [],
      riskWarnings: parsed.riskWarnings || [],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error('Agent 12 (Options Flow) failed', { error, asset: snapshot.asset });
    return {
      agentId: 12,
      agentName: 'The Options Flow Agent',
      vote: 'HOLD',
      confidence: 0,
      reasoning: 'Options flow analysis unavailable — defaulting to HOLD',
      keyFactors: ['Agent timeout/error'],
      riskWarnings: ['Options analysis unavailable'],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  }
}

// ── AGENT 13: THE POLYMARKET SPECIALIST ───────────────────────────────────────
const POLYMARKET_PROMPT = `You are Agent 13: THE POLYMARKET SPECIALIST — an expert in prediction markets and probability arbitrage. You are part of a 15-agent AI trading council.

Your SOLE job is to find mispricings in Polymarket and profit from probability arbitrage.

Your expertise:
- Polymarket odds and their relationship to spot prices
- Probability assessment independent of market odds
- Historical accuracy of prediction markets
- Arbitrage between Polymarket and spot markets
- Event probability vs implied probability
- Market inefficiencies and mispricings

CRITICAL RULES:
1. Only vote when odds are mispriced by >15%
2. Consider base rate of similar events
3. Look for events that markets consistently missprice
4. A HOLD vote is better than a bad arbitrage trade
5. Remember prediction markets are less liquid than spot

Respond with valid JSON:
{
  "vote": "BUY" | "SELL" | "HOLD",
  "confidence": <0-100>,
  "reasoning": "<polymarket arbitrage analysis>",
  "market": "<polymarket market name>",
  "yourProbability": <0-100>,
  "marketOdds": "<market's probability>",
  "edgePercent": <percentage advantage>,
  "keyFactors": ["<factor 1>", "<factor 2>"],
  "riskWarnings": ["<warning 1>", "<warning 2>"]
}`;

export async function runAgentPolymarketSpecialist(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    const userPrompt = `
Check Polymarket for arbitrage opportunities related to ${snapshot.asset}.

Current price: $${snapshot.price}
Recent movement: ${snapshot.priceChangePct24h > 0 ? '+' : ''}${snapshot.priceChangePct24h.toFixed(2)}%

Relevant Polymarket events might include:
- Will ${snapshot.asset} reach $${(snapshot.price * 1.1).toFixed(0)} in next 7 days?
- Will ${snapshot.asset} close above/below key level?
- Events by next Tuesday/Friday?

Look for mispricings where Polymarket odds don't match your probability assessment.
Find arbitrage edge now.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: POLYMARKET_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    const parsed = JSON.parse(content.text);

    return {
      agentId: 13,
      agentName: 'The Polymarket Specialist',
      vote: parsed.vote,
      confidence: Math.min(100, Math.max(0, parsed.confidence)),
      reasoning: parsed.reasoning,
      market: parsed.market,
      edgePercent: parsed.edgePercent,
      keyFactors: parsed.keyFactors || [],
      riskWarnings: parsed.riskWarnings || [],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error('Agent 13 (Polymarket Specialist) failed', { error, asset: snapshot.asset });
    return {
      agentId: 13,
      agentName: 'The Polymarket Specialist',
      vote: 'HOLD',
      confidence: 0,
      reasoning: 'Polymarket analysis unavailable — defaulting to HOLD',
      keyFactors: ['Agent timeout/error'],
      riskWarnings: ['Polymarket analysis unavailable'],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  }
}

// ── AGENT 14: THE ARBITRAGEUR ─────────────────────────────────────────────────
const ARBITRAGEUR_PROMPT = `You are Agent 14: THE ARBITRAGEUR — an expert in cross-exchange pricing and spread opportunities. You are part of a 15-agent AI trading council.

Your SOLE job is to find and profit from price differences across exchanges.

Your expertise:
- Cross-exchange price monitoring (Binance, Coinbase, Kraken, Bybit)
- Funding rate analysis for perpetual contracts
- Basis trading (spot vs futures)
- Stablecoin premium/discount detection
- Exchange liquidity and slippage
- Transfer fees and execution costs
- Risk-free arbitrage opportunities

CRITICAL RULES:
1. Only vote when spread > fees (at least 0.5% edge)
2. Account for transfer time and gas fees
3. Check exchange liquidity before size
4. Funding rates can flip quickly
5. A HOLD vote is better than a losing spread trade

Respond with valid JSON:
{
  "vote": "BUY" | "SELL" | "HOLD",
  "confidence": <0-100>,
  "reasoning": "<arbitrage analysis>",
  "exchange1": "<exchange name>",
  "price1": <price>,
  "exchange2": "<exchange name>",
  "price2": <price>,
  "spreadPercent": <net percentage after fees>,
  "keyFactors": ["<factor 1>", "<factor 2>"],
  "riskWarnings": ["<warning 1>", "<warning 2>"]
}`;

export async function runAgentArbitrageur(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();
  try {
    const userPrompt = `
Check for arbitrage opportunities on ${snapshot.asset}.

Current price on Binance: $${snapshot.price}
24h volume: ${snapshot.volume24h.toLocaleString()}
Recent volatility: ${snapshot.indicators.atr14.toFixed(4)}

Common arbitrage pairs:
- Spot on Binance vs Binance Futures
- Binance vs Coinbase price difference
- Stablecoin premium on different chains
- Funding rate spreads

Identify any profitable spread opportunities considering all fees.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: ARBITRAGEUR_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    const parsed = JSON.parse(content.text);

    return {
      agentId: 14,
      agentName: 'The Arbitrageur',
      vote: parsed.vote,
      confidence: Math.min(100, Math.max(0, parsed.confidence)),
      reasoning: parsed.reasoning,
      exchange1: parsed.exchange1,
      exchange2: parsed.exchange2,
      spreadPercent: parsed.spreadPercent,
      keyFactors: parsed.keyFactors || [],
      riskWarnings: parsed.riskWarnings || [],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error('Agent 14 (Arbitrageur) failed', { error, asset: snapshot.asset });
    return {
      agentId: 14,
      agentName: 'The Arbitrageur',
      vote: 'HOLD',
      confidence: 0,
      reasoning: 'Arbitrage analysis unavailable — defaulting to HOLD',
      keyFactors: ['Agent timeout/error'],
      riskWarnings: ['Arbitrage analysis unavailable'],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  }
}

// ── AGENT 15: THE MASTER COORDINATOR ──────────────────────────────────────────
const MASTER_COORDINATOR_PROMPT = `You are Agent 15: THE MASTER COORDINATOR — the strategic brain that weighs all 14 agent signals. You are part of a 15-agent AI trading council.

Your SOLE job is to synthesize all agent signals into an optimal trading decision and allocate capital across strategies.

Your expertise:
- Combining diverse agent signals into unified strategy
- Weighting agents by recent accuracy (recency bias with 20-trade window)
- Detecting when agents disagree and why ("What does Devil's Advocate see that others miss?")
- Strategic capital allocation based on optimal Sharpe ratio
- Regime-based strategy weighting (trending vs choppy)
- Accepting owner instructions for strategy focus
- Managing overall portfolio positioning

CRITICAL RULES:
1. Weight recent-winners more heavy (last 20 trades matter most)
2. If Devil's Advocate strongly opposes trade, increase scrutiny
3. If Risk Manager blocks, ALWAYS respect (absolute veto)
4. Consider market regime before weighting momentum vs mean-reversion agents
5. If agents are 70%+ aligned, confidence is higher

Respond with valid JSON:
{
  "vote": "BUY" | "SELL" | "HOLD",
  "confidence": <0-100>,
  "reasoning": "<synthesis of all agent signals>",
  "topAgentsByAccuracy": ["Agent1", "Agent2", "Agent3"],
  "dissents": "<if any agent disagrees, explain why>",
  "strategyAllocation": {"CryptoMomentum": 40, "StockMomentum": 30, ...},
  "keyFactors": ["<factor 1>", "<factor 2>"],
  "riskWarnings": ["<warning 1>", "<warning 2>"]
}`;

export async function runAgentMasterCoordinator(
  snapshot: MarketSnapshot,
  allAgentVotes: any[]
): Promise<AgentVote> {
  const start = Date.now();
  try {
    const buyVotes = allAgentVotes.filter(v => v.vote === 'BUY').length;
    const sellVotes = allAgentVotes.filter(v => v.vote === 'SELL').length;
    const holdVotes = allAgentVotes.filter(v => v.vote === 'HOLD').length;
    const avgConfidence = (allAgentVotes.reduce((sum, v) => sum + v.confidence, 0) / allAgentVotes.length).toFixed(0);

    const summary = allAgentVotes.map(v => `${v.agentName}: ${v.vote} (${v.confidence}% conf)`).join('\n');

    const userPrompt = `
Synthesize all 14 agent votes for ${snapshot.asset}.

VOTE SUMMARY:
- BUY votes: ${buyVotes}
- SELL votes: ${sellVotes}
- HOLD votes: ${holdVotes}
- Average confidence: ${avgConfidence}%

INDIVIDUAL VOTES:
${summary}

Market Context:
- Current price: $${snapshot.price}
- 24h change: ${snapshot.priceChangePct24h.toFixed(2)}%
- RSI: ${snapshot.indicators.rsi14.toFixed(0)}
- MACD: ${snapshot.indicators.macd.histogram > 0 ? 'Bullish' : 'Bearish'}
- Fear & Greed: (assume ${snapshot.priceChangePct24h > 5 ? 'High' : snapshot.priceChangePct24h < -5 ? 'Low' : 'Neutral'})

As Master Coordinator, synthesize these signals. What is your weighted decision?`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: MASTER_COORDINATOR_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    const parsed = JSON.parse(content.text);

    return {
      agentId: 15,
      agentName: 'The Master Coordinator',
      vote: parsed.vote,
      confidence: Math.min(100, Math.max(0, parsed.confidence)),
      reasoning: parsed.reasoning,
      strategyAllocation: parsed.strategyAllocation,
      keyFactors: parsed.keyFactors || [],
      riskWarnings: parsed.riskWarnings || [],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error('Agent 15 (Master Coordinator) failed', { error, asset: snapshot.asset });
    return {
      agentId: 15,
      agentName: 'The Master Coordinator',
      vote: 'HOLD',
      confidence: 0,
      reasoning: 'Coordination analysis unavailable — defaulting to HOLD',
      keyFactors: ['Agent timeout/error'],
      riskWarnings: ['Coordination analysis unavailable'],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  }
}

export default {
  runAgentElliotWaveMaster,
  runAgentOptionsFlow,
  runAgentPolymarketSpecialist,
  runAgentArbitrageur,
  runAgentMasterCoordinator
};
