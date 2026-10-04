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

import type { AgentVote } from './types';

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
    votes.push({
      agentId: 'tier1-rsi',
      agentName: 'RSI Agent (T1)',
      signal: oversold ? 'BUY' : overbought ? 'SELL' : 'HOLD',
      confidence: Math.abs(50 - rsi) * 2, // 0–100 scale
      reasoning: `RSI=${rsi.toFixed(1)}: ${oversold ? 'Oversold → BUY' : overbought ? 'Overbought → SELL' : 'Neutral → HOLD'}`,
      tier: 1,
    });
  }

  // 2. MACD Agent
  const macd = marketData.macd;
  if (macd) {
    const bullish = macd.macd > macd.signal && macd.histogram > 0;
    const bearish = macd.macd < macd.signal && macd.histogram < 0;
    votes.push({
      agentId: 'tier1-macd',
      agentName: 'MACD Agent (T1)',
      signal: bullish ? 'BUY' : bearish ? 'SELL' : 'HOLD',
      confidence: Math.min(Math.abs(macd.histogram) * 100, 80),
      reasoning: `MACD=${macd.macd.toFixed(4)}, Signal=${macd.signal.toFixed(4)}, Hist=${macd.histogram.toFixed(4)}`,
      tier: 1,
    });
  }

  // 3. Volume Agent
  const volumeRatio = marketData.volume / (marketData.avgVolume20d || marketData.volume);
  const highVolume = volumeRatio > 1.5;
  votes.push({
    agentId: 'tier1-volume',
    agentName: 'Volume Agent (T1)',
    signal: highVolume ? (marketData.priceChangePct > 0 ? 'BUY' : 'SELL') : 'HOLD',
    confidence: highVolume ? Math.min(volumeRatio * 30, 70) : 40,
    reasoning: `Volume=${volumeRatio.toFixed(2)}x avg. ${highVolume ? `High vol + ${marketData.priceChangePct > 0 ? 'up' : 'down'} move → conviction signal` : 'Normal volume → HOLD'}`,
    tier: 1,
  });

  // 4. Moving Average Agent
  const { close, sma20, sma50 } = marketData;
  if (sma20 && sma50) {
    const goldenCross = close > sma20 && sma20 > sma50;
    const deathCross = close < sma20 && sma20 < sma50;
    votes.push({
      agentId: 'tier1-ma',
      agentName: 'MA Agent (T1)',
      signal: goldenCross ? 'BUY' : deathCross ? 'SELL' : 'HOLD',
      confidence: goldenCross || deathCross ? 65 : 45,
      reasoning: `Price=$${close} vs SMA20=$${sma20.toFixed(2)} vs SMA50=$${sma50.toFixed(2)}. ${goldenCross ? 'Golden cross → BUY' : deathCross ? 'Death cross → SELL' : 'No MA alignment → HOLD'}`,
      tier: 1,
    });
  }

  // 5. Momentum Agent (5-day rate of change)
  const roc5 = marketData.roc5;
  if (roc5 !== undefined) {
    votes.push({
      agentId: 'tier1-momentum',
      agentName: 'Momentum Agent (T1)',
      signal: roc5 > 2 ? 'BUY' : roc5 < -2 ? 'SELL' : 'HOLD',
      confidence: Math.min(Math.abs(roc5) * 15, 75),
      reasoning: `5-day ROC=${roc5.toFixed(2)}%: ${roc5 > 2 ? 'Strong upward momentum' : roc5 < -2 ? 'Strong downward momentum' : 'Sideways'}`,
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
