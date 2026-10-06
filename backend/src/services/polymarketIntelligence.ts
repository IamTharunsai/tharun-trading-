/**
 * INTEGRATION: TradingAgents → APEX
 * Read-only Polymarket topic intelligence feed (no API key required)
 *
 * Source: tradingagents/tradingagents/dataflows/vendors/polymarket.py
 * Endpoint: https://gamma-api.polymarket.com/public-search (public, no auth)
 *
 * This provides AI agents with real-time prediction market probabilities
 * as a market signal input — WITHOUT placing trades or requiring balance.
 * It is wired into the agent debate pipeline as an intelligence context enrichment.
 */

import axios from 'axios';
import { logger } from '../utils/logger';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

export interface PredictionMarketSignal {
  question: string;
  yesProb: number;
  noProb: number;
  volume: number;
  resolveDate: string;
  weeklyPriceChange: number; // percentage points shift in last 7 days
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNCERTAIN';
  signalStrength: number; // 0–100; based on volume + volatility
}

export interface TopicIntelligence {
  topic: string;
  assetSymbol: string;
  markets: PredictionMarketSignal[];
  summary: string;
  overallSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNCERTAIN';
  fetchedAt: string;
}

const TOPIC_MAP: Record<string, string[]> = {
  // Map asset symbols to search topics
  BTC: ['Bitcoin price', 'crypto market', 'Bitcoin ETF'],
  ETH: ['Ethereum price', 'crypto market'],
  SPY: ['S&P 500', 'stock market crash', 'Fed rate cut'],
  QQQ: ['NASDAQ', 'tech stocks', 'rate cut'],
  AAPL: ['Apple earnings', 'iPhone sales'],
  NVDA: ['NVIDIA earnings', 'AI chips', 'semiconductor'],
  TSLA: ['Tesla earnings', 'EV market'],
  MSFT: ['Microsoft earnings', 'AI cloud'],
  GOOGL: ['Google earnings', 'AI search', 'antitrust'],
  META: ['Meta earnings', 'social media'],
  AMZN: ['Amazon earnings', 'AWS cloud'],
  JPM: ['bank earnings', 'interest rates'],
  GOLD: ['gold price', 'inflation hedge'],
  OIL: ['oil price', 'OPEC'],
  USD: ['dollar index', 'Fed rate cut'],
};

/** Fetch prediction markets for a topic using TradingAgents' approach (no auth) */
async function fetchPredictionMarkets(
  topic: string,
  limit = 20,
): Promise<PredictionMarketSignal[]> {
  try {
    const resp = await axios.get(`${GAMMA_BASE}/public-search`, {
      params: { q: topic, limit_per_type: Math.min(limit, 30) },
      timeout: 8000,
      headers: { 'User-Agent': 'APEX-Trading-Platform/1.0' },
    });

    const data = resp.data as any;
    const markets: PredictionMarketSignal[] = [];
    const now = new Date();

    const events = Array.isArray(data) ? data : (data.events ?? []);

    for (const event of events) {
      const eventMarkets = event.markets ?? [];
      for (const m of eventMarkets) {
        if (m.closed) continue;
        if (!m.outcomePrices || !m.outcomes) continue;

        // Skip already resolved markets
        if (m.endDate && new Date(m.endDate) < now) continue;

        let outcomePrices: number[];
        let outcomes: string[];
        try {
          outcomePrices = JSON.parse(m.outcomePrices).map(Number);
          outcomes = JSON.parse(m.outcomes);
        } catch {
          continue;
        }

        if (outcomePrices.length < 2 || outcomes.length < 2) continue;

        const yesIdx = outcomes.findIndex((o: string) => o.toLowerCase() === 'yes');
        const yesProb = yesIdx >= 0 ? outcomePrices[yesIdx] : outcomePrices[0];
        const noProb = 1 - yesProb;
        const weeklyChange = m.oneWeekPriceChange ?? 0;
        const volume = m.volumeNum ?? 0;

        // Signal strength: high volume + big weekly move = strong signal
        const signalStrength = Math.min(100, Math.log10(volume + 1) * 15 + Math.abs(weeklyChange) * 2);

        // Sentiment from probability + momentum
        let sentiment: PredictionMarketSignal['sentiment'];
        if (yesProb > 0.65 && weeklyChange > 2) sentiment = 'BULLISH';
        else if (yesProb < 0.35 && weeklyChange < -2) sentiment = 'BEARISH';
        else if (Math.abs(weeklyChange) < 1) sentiment = 'NEUTRAL';
        else sentiment = 'UNCERTAIN';

        markets.push({
          question: m.question,
          yesProb,
          noProb,
          volume,
          resolveDate: m.endDate ?? 'unknown',
          weeklyPriceChange: weeklyChange,
          sentiment,
          signalStrength,
        });
      }
    }

    // Sort by signal strength (most informative first)
    markets.sort((a, b) => b.signalStrength - a.signalStrength);
    return markets.slice(0, limit);
  } catch (err) {
    logger.warn(`[PolymarketIntelligence] Failed to fetch markets for topic "${topic}": ${(err as Error).message}`);
    return [];
  }
}

/** Get prediction market intelligence for a specific asset symbol */
export async function getTopicIntelligence(assetSymbol: string): Promise<TopicIntelligence | null> {
  const topics = TOPIC_MAP[assetSymbol.toUpperCase()] ?? [assetSymbol];
  const allMarkets: PredictionMarketSignal[] = [];

  for (const topic of topics.slice(0, 2)) {
    const markets = await fetchPredictionMarkets(topic, 10);
    allMarkets.push(...markets);
  }

  // Deduplicate by question
  const seen = new Set<string>();
  const markets = allMarkets.filter(m => {
    const key = m.question.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);

  if (markets.length === 0) return null;

  // Aggregate sentiment
  const sentimentCounts = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0, UNCERTAIN: 0 };
  let totalWeight = 0;
  for (const m of markets) {
    const w = m.signalStrength + 1;
    sentimentCounts[m.sentiment] += w;
    totalWeight += w;
  }
  const overallSentiment = (Object.keys(sentimentCounts) as Array<keyof typeof sentimentCounts>)
    .reduce((a, b) => sentimentCounts[a] > sentimentCounts[b] ? a : b);

  // Build summary text for agents
  const topMarkets = markets.slice(0, 3);
  const summary = `Polymarket Intelligence (${assetSymbol}): ${markets.length} active prediction markets. ` +
    topMarkets.map(m =>
      `"${m.question.slice(0, 60)}" — YES ${(m.yesProb * 100).toFixed(0)}% ($${(m.volume / 1000).toFixed(0)}K vol, ${m.weeklyPriceChange > 0 ? '+' : ''}${m.weeklyPriceChange.toFixed(1)}pp WoW)`
    ).join('; ') + `. Overall crowd sentiment: ${overallSentiment}.`;

  logger.info(`[PolymarketIntelligence] ${assetSymbol}: ${markets.length} markets, sentiment=${overallSentiment}`);

  return {
    topic: topics[0],
    assetSymbol,
    markets,
    summary,
    overallSentiment,
    fetchedAt: new Date().toISOString(),
  };
}

/** Batch fetch intelligence for multiple assets (used in debate pipeline enrichment) */
export async function enrichDebateContext(
  assets: string[],
): Promise<Record<string, TopicIntelligence>> {
  const results: Record<string, TopicIntelligence> = {};
  // Fetch sequentially with small delay to avoid hammering public API
  for (const asset of assets) {
    const intel = await getTopicIntelligence(asset);
    if (intel) results[asset] = intel;
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

/** Format intelligence as a prompt snippet for LLM agents */
export function formatIntelligenceForPrompt(intel: TopicIntelligence): string {
  if (!intel || intel.markets.length === 0) return '';

  const lines = [
    `\n## Prediction Market Intelligence (${intel.assetSymbol})`,
    `Crowd Sentiment: **${intel.overallSentiment}** across ${intel.markets.length} active markets`,
    '',
    ...intel.markets.slice(0, 5).map(m =>
      `- ${m.question.slice(0, 80)}: YES=${(m.yesProb * 100).toFixed(0)}% | Vol=$${(m.volume / 1000).toFixed(0)}K | 7d=${m.weeklyPriceChange > 0 ? '+' : ''}${m.weeklyPriceChange.toFixed(1)}pp | ${m.sentiment}`
    ),
    '',
    `Signal: Use this as a crowd-wisdom cross-reference. High-volume markets (>$100K) are most reliable.`,
  ];

  return lines.join('\n');
}
