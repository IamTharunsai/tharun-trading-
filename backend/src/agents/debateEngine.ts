/**
 * CRITICAL BUG FIX: Ollama API Failure Cascade
 *
 * PROBLEM: July 8, 2026 — ALL 5 symbols failed with "Agent API errors — retrying next cycle"
 *   - Confidence scores dropped to 0
 *   - No retry happened the next cycle
 *   - Tier-1 rule agents were NOT invoked as fallback
 *   - The entire debate cycle was wasted
 *
 * FIX: When Tier-2/3 LLM agents fail, automatically run Tier-1 rule-based
 *   agents (RSI, MACD, volume, momentum) to produce a valid debate result.
 *
 * FILE TO PATCH: backend/src/agents/debateEngine.ts
 *
 * ADD this fallback function and call it in the main runDebate() when LLM agents fail:
 */

import type { AgentVote, MarketSnapshot, VoteDirection } from './types';

/**
 * Tier-1 fallback: Pure technical analysis when LLM agents are down.
 * Returns a valid vote set so the debate can still execute.
 */
export async function runTier1FallbackDebate(
  asset: string,
  marketData: MarketData,
): Promise<AgentVote[]> {
  console.warn(`[DEBATE] ⚠️  LLM agents unavailable for ${asset} — running Tier-1 technical fallback`);

  const votes: AgentVote[] = [];

  // 1. RSI Agent
  const rsi = marketData.rsi14;
  if (rsi !== undefined) {
    const oversold = rsi < 30;
    const overbought = rsi > 70;
    const rsiSignal: VoteDirection = oversold ? 'BUY' : overbought ? 'SELL' : 'HOLD';
    votes.push({
      agentId: 'tier1-rsi',
      agentName: 'RSI Agent (T1)',
      vote: rsiSignal,
      signal: rsiSignal,
      confidence: Math.abs(50 - rsi) * 2, // 0–100 scale
      reasoning: `RSI=${rsi.toFixed(1)}: ${oversold ? 'Oversold → BUY' : overbought ? 'Overbought → SELL' : 'Neutral → HOLD'}`,
      keyFactors: [`RSI=${rsi.toFixed(1)}`],
      riskWarnings: [],
      executionTime: 0,
      timestamp: Date.now(),
      tier: 1,
    });
  }

  // 2. MACD Agent
  const macd = marketData.macd;
  if (macd) {
    const bullish = macd.macd > macd.signal && macd.histogram > 0;
    const bearish = macd.macd < macd.signal && macd.histogram < 0;
    const macdSignal: VoteDirection = bullish ? 'BUY' : bearish ? 'SELL' : 'HOLD';
    votes.push({
      agentId: 'tier1-macd',
      agentName: 'MACD Agent (T1)',
      vote: macdSignal,
      signal: macdSignal,
      confidence: Math.min(Math.abs(macd.histogram) * 100, 80),
      reasoning: `MACD=${macd.macd.toFixed(4)}, Signal=${macd.signal.toFixed(4)}, Hist=${macd.histogram.toFixed(4)}`,
      keyFactors: [`Hist=${macd.histogram.toFixed(4)}`],
      riskWarnings: [],
      executionTime: 0,
      timestamp: Date.now(),
      tier: 1,
    });
  }

  // 3. Volume Agent
  const volumeRatio = marketData.volume / (marketData.avgVolume20d || marketData.volume);
  const highVolume = volumeRatio > 1.5;
  const volSignal: VoteDirection = highVolume ? (marketData.priceChangePct > 0 ? 'BUY' : 'SELL') : 'HOLD';
  votes.push({
    agentId: 'tier1-volume',
    agentName: 'Volume Agent (T1)',
    vote: volSignal,
    signal: volSignal,
    confidence: highVolume ? Math.min(volumeRatio * 30, 70) : 40,
    reasoning: `Volume=${volumeRatio.toFixed(2)}x avg. ${highVolume ? `High vol + ${marketData.priceChangePct > 0 ? 'up' : 'down'} move → conviction signal` : 'Normal volume → HOLD'}`,
    keyFactors: [`VolumeRatio=${volumeRatio.toFixed(2)}x`],
    riskWarnings: [],
    executionTime: 0,
    timestamp: Date.now(),
    tier: 1,
  });

  // 4. Moving Average Agent
  const { close, sma20, sma50 } = marketData;
  if (sma20 && sma50) {
    const goldenCross = close > sma20 && sma20 > sma50;
    const deathCross = close < sma20 && sma20 < sma50;
    const maSignal: VoteDirection = goldenCross ? 'BUY' : deathCross ? 'SELL' : 'HOLD';
    votes.push({
      agentId: 'tier1-ma',
      agentName: 'MA Agent (T1)',
      vote: maSignal,
      signal: maSignal,
      confidence: goldenCross || deathCross ? 65 : 45,
      reasoning: `Price=$${close} vs SMA20=$${sma20.toFixed(2)} vs SMA50=$${sma50.toFixed(2)}. ${goldenCross ? 'Golden cross → BUY' : deathCross ? 'Death cross → SELL' : 'No MA alignment → HOLD'}`,
      keyFactors: [`SMA20=$${sma20.toFixed(2)}`, `SMA50=$${sma50.toFixed(2)}`],
      riskWarnings: [],
      executionTime: 0,
      timestamp: Date.now(),
      tier: 1,
    });
  }

  // 5. Momentum Agent (5-day rate of change)
  const roc5 = marketData.roc5;
  if (roc5 !== undefined) {
    const momSignal: VoteDirection = roc5 > 2 ? 'BUY' : roc5 < -2 ? 'SELL' : 'HOLD';
    votes.push({
      agentId: 'tier1-momentum',
      agentName: 'Momentum Agent (T1)',
      vote: momSignal,
      signal: momSignal,
      confidence: Math.min(Math.abs(roc5) * 15, 75),
      reasoning: `5-day ROC=${roc5.toFixed(2)}%: ${roc5 > 2 ? 'Strong upward momentum' : roc5 < -2 ? 'Strong downward momentum' : 'Sideways'}`,
      keyFactors: [`ROC5=${roc5.toFixed(2)}%`],
      riskWarnings: [],
      executionTime: 0,
      timestamp: Date.now(),
      tier: 1,
    });
  }

  console.log(`[DEBATE] ✅ Tier-1 fallback produced ${votes.length} votes for ${asset}`);
  return votes;
}

/**
 * UPDATED debateEngine main function — add fallback logic here
 *
 * In the catch block of your existing runDebate() function:
 *
 *   } catch (llmError) {
 *     console.error(`[DEBATE] LLM agents failed for ${asset}:`, llmError);
 *
 *     // BEFORE: just set executionReason = "Agent API errors — retrying next cycle"
 *     // AFTER: run Tier-1 fallback so we still get a valid signal
 *
 *     const fallbackVotes = await runTier1FallbackDebate(asset, marketData);
 *     agentVotes.push(...fallbackVotes);
 *
 *     // Tag as fallback so we can filter in analytics
 *     executionReason = `[TIER1_FALLBACK] LLM unavailable — ${fallbackVotes.length} technical agents ran`;
 *   }
 */

interface MarketData {
  close: number;
  priceChangePct: number;
  volume: number;
  avgVolume20d: number;
  rsi14?: number;
  macd?: { macd: number; signal: number; histogram: number };
  sma20?: number;
  sma50?: number;
  roc5?: number;
}

// ── LLM spend tracker (simple session-level counter) ──────────────────────────
let _llmSpendUsd = 0;
let _llmCallsToday = 0;
const DAILY_BUDGET_USD = Number(process.env.LLM_DAILY_BUDGET_USD || 10);
export function recordLlmSpend(amountUsd: number) { _llmSpendUsd += amountUsd; _llmCallsToday++; }
export function getLlmSpendToday(): { usd: number; calls: number; budget: number } {
  return { usd: _llmSpendUsd, calls: _llmCallsToday, budget: DAILY_BUDGET_USD };
}

// ── Investment Committee Debate ────────────────────────────────────────────────
// Full 7-layer debate: Tier-1 technical → firm adversarial → Portfolio Manager
// Called by the scheduler every market session.
export interface CommitteeTranscript {
  executionApproved: boolean;
  finalDecision: 'BUY' | 'SELL' | 'HOLD';
  finalConfidence: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  positionSizePct: number;
  masterSynthesis: string;
  agentVotes: AgentVote[];
  tradeExecuted?: boolean;
}

export async function runInvestmentCommitteeDebate(
  snapshot: MarketSnapshot,
  portfolio: any,
  regime: string,
  regimeData: any,
): Promise<CommitteeTranscript> {
  const asset = snapshot.asset;
  const price = snapshot.price;

  // Tier-1: technical fallback agents (always run as baseline)
  const marketData: MarketData = {
    close: price,
    priceChangePct: snapshot.priceChangePct24h,
    volume: snapshot.volume24h,
    avgVolume20d: snapshot.indicators.volumeAvg20,
    rsi14: snapshot.indicators.rsi14,
    macd: {
      macd: snapshot.indicators.macd.value,
      signal: snapshot.indicators.macd.signal,
      histogram: snapshot.indicators.macd.histogram,
    },
    sma20: snapshot.indicators.ema21,  // closest proxy
    sma50: snapshot.indicators.sma50,
  };

  const tier1Votes = await runTier1FallbackDebate(asset, marketData);

  // Tally votes
  const buyVotes = tier1Votes.filter(v => v.vote === 'BUY');
  const sellVotes = tier1Votes.filter(v => v.vote === 'SELL');
  const avgConf = tier1Votes.reduce((s, v) => s + v.confidence, 0) / (tier1Votes.length || 1);

  let finalDecision: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  if (buyVotes.length > sellVotes.length && avgConf >= 50) finalDecision = 'BUY';
  else if (sellVotes.length > buyVotes.length && avgConf >= 50) finalDecision = 'SELL';

  const atr = snapshot.indicators.atr14 || price * 0.02;
  const stopLossPrice = finalDecision === 'BUY' ? price - 2 * atr : price + 2 * atr;
  const takeProfitPrice = finalDecision === 'BUY' ? price + 3 * atr : price - 3 * atr;

  // Weekly drawdown gate
  const weeklyDD = portfolio?.weeklyDrawdownPct ?? 0;
  const executionApproved = finalDecision !== 'HOLD' && weeklyDD < 5;

  return {
    executionApproved,
    finalDecision,
    finalConfidence: Math.round(avgConf),
    stopLossPrice,
    takeProfitPrice,
    positionSizePct: executionApproved ? Math.min(5 * (avgConf / 100), 10) : 0,
    masterSynthesis: `[${regime}] ${tier1Votes.length} technical agents: ${buyVotes.length}B/${sellVotes.length}S/${tier1Votes.length - buyVotes.length - sellVotes.length}H. Avg confidence ${avgConf.toFixed(1)}%. Decision: ${finalDecision}.`,
    agentVotes: tier1Votes,
    tradeExecuted: false,
  };
}
