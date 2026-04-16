/**
 * AGENT RESOURCE LEARNING SERVICE
 * Agents learn from external resources before making decisions
 * Combines fundamental knowledge with real-time market intelligence
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { redis } from '../utils/redis';
import { prisma } from '../utils/prisma';

export interface LearningResource {
  type: 'news' | 'earnings' | 'macro' | 'onchain' | 'whitepaper' | 'research' | 'filing';
  asset: string;
  title: string;
  content: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  source: string;
  timestamp: Date;
  relevanceScore: number;
}

export interface AgentLearningState {
  agentId: number;
  assetId: string;
  recentLearnings: LearningResource[];
  fundamentalScore: number; // 0-100: how strong fundamentals are
  technicalScore: number;   // 0-100: how strong technicals are
  sentimentScore: number;   // 0-100: positive sentiment
  riskScore: number;        // 0-100: risk level detected
  confidenceAdjustment: number; // -50 to +50: boost/reduce confidence
  overallScore: number;     // 0-100: weighted combination of all scores
}

const RESOURCE_CACHE_TTL = 3600; // 1 hour

/**
 * Learn from financial news about an asset
 */
export async function learnFromNews(asset: string): Promise<LearningResource[]> {
  try {
    const cacheKey = `news:${asset}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const response = await axios.get('https://api.example.com/news', {
      params: { q: asset, limit: 5 },
      timeout: 5000
    }).catch(() => null);

    if (!response) return [];

    const learnings: LearningResource[] = response.data.articles?.map((article: any) => ({
      type: 'news',
      asset,
      title: article.title,
      content: article.description,
      sentiment: analyzeSentiment(article.description),
      confidence: 0.7,
      source: article.source?.name || 'Unknown',
      timestamp: new Date(article.publishedAt),
      relevanceScore: 0.8
    })) || [];

    await redis.setex(cacheKey, RESOURCE_CACHE_TTL, JSON.stringify(learnings)).catch(() => {});
    return learnings;
  } catch (err) {
    logger.error('News learning failed', { asset, err });
    return [];
  }
}

/**
 * Learn from earnings and fundamental data
 */
export async function learnFromFundamentals(asset: string): Promise<LearningResource | null> {
  try {
    // For stocks - get earnings, P/E, revenue
    if (asset.match(/^[A-Z]{1,5}$/)) {
      const response = await axios.get(`https://api.polygon.io/v2/reference/tickers/${asset}`, {
        params: { apiKey: process.env.POLYGON_API_KEY },
        timeout: 5000
      }).catch(() => null);

      if (!response?.data?.results) return null;

      const ticker = response.data.results;
      const sentiment = ticker.lastQuote?.bid > ticker.prevClose ? 'bullish' : 'bearish';

      return {
        type: 'earnings',
        asset,
        title: `${asset} Fundamentals`,
        content: `P/E: ${ticker.pe || 'N/A'}, Revenue: ${ticker.market_cap || 'N/A'}`,
        sentiment,
        confidence: 0.85,
        source: 'Polygon',
        timestamp: new Date(),
        relevanceScore: 0.9
      };
    }

    // For crypto - get tokenomics, market cap trend
    const cryptoResponse = await axios.get(`https://api.coingecko.com/api/v3/coins/${asset.toLowerCase()}`, {
      timeout: 5000
    }).catch(() => null);

    if (!cryptoResponse?.data) return null;

    const coin = cryptoResponse.data;
    const sentiment = coin.market_data?.price_change_percentage_24h > 0 ? 'bullish' : 'bearish';

    return {
      type: 'earnings',
      asset,
      title: `${asset} Tokenomics`,
      content: `Market Cap: $${coin.market_data?.market_cap?.usd || 'N/A'}, 24h Volume: $${coin.market_data?.total_volume?.usd || 'N/A'}`,
      sentiment,
      confidence: 0.80,
      source: 'CoinGecko',
      timestamp: new Date(),
      relevanceScore: 0.85
    };
  } catch (err) {
    logger.error('Fundamentals learning failed', { asset, err });
    return null;
  }
}

/**
 * Learn from macro events (Fed, inflation, employment)
 */
export async function learnFromMacro(): Promise<LearningResource[]> {
  try {
    const cacheKey = 'macro:events';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    // Get economic calendar
    const calendarResponse = await axios.get('https://api.example.com/economic-calendar', {
      timeout: 5000
    }).catch(() => null);

    if (!calendarResponse?.data) return [];

    const events: LearningResource[] = calendarResponse.data.events
      ?.filter((e: any) => new Date(e.date) > new Date(Date.now() - 24 * 3600 * 1000))
      .map((event: any) => ({
        type: 'macro',
        asset: 'MACRO',
        title: event.name,
        content: `${event.name}: Expected ${event.forecast}, Previous ${event.previous}`,
        sentiment: event.impact === 'high' ? 'bearish' : 'neutral',
        confidence: 0.75,
        source: 'Economic Calendar',
        timestamp: new Date(event.date),
        relevanceScore: event.impact === 'high' ? 0.95 : 0.60
      })) || [];

    await redis.setex(cacheKey, RESOURCE_CACHE_TTL, JSON.stringify(events)).catch(() => {});
    return events;
  } catch (err) {
    logger.error('Macro learning failed', { err });
    return [];
  }
}

/**
 * Learn from on-chain data (whale movements, exchange flows)
 */
export async function learnFromOnChain(asset: string): Promise<LearningResource | null> {
  try {
    const assetGlassnode = asset === 'BTC' ? 'BTC' : asset === 'ETH' ? 'ETH' : null;
    if (!assetGlassnode) return null;

    // Get exchange inflows
    const response = await axios.get(
      `https://api.glassnode.com/v1/metrics/exchanges/net_flows_all`,
      {
        params: {
          a: assetGlassnode.toLowerCase(),
          api_key: process.env.GLASSNODE_API_KEY || 'demo'
        },
        timeout: 5000
      }
    ).catch(() => null);

    if (!response?.data) return null;

    const latestFlow = response.data.data?.[response.data.data.length - 1];
    const sentiment = latestFlow?.v < 0 ? 'bullish' : latestFlow?.v > 0 ? 'bearish' : 'neutral';

    return {
      type: 'onchain',
      asset,
      title: `${asset} On-Chain Flows`,
      content: `Exchange net flows: ${latestFlow?.v || 0} ${asset}. ${sentiment === 'bullish' ? 'Whales withdrawing (accumulating)' : 'Whales depositing (distributing)'}`,
      sentiment,
      confidence: 0.8,
      source: 'Glassnode',
      timestamp: new Date(),
      relevanceScore: 0.85
    };
  } catch (err) {
    logger.error('On-chain learning failed', { asset, err });
    return null;
  }
}

/**
 * Build comprehensive learning state for an agent
 */
export async function buildAgentLearningState(
  agentId: number,
  asset: string
): Promise<AgentLearningState> {
  try {
    // Gather all learning resources
    const newsLearnings = await learnFromNews(asset);
    const fundamentals = await learnFromFundamentals(asset);
    const macroLearnings = await learnFromMacro();
    const onchainLearning = await learnFromOnChain(asset);

    const allLearnings: LearningResource[] = [
      ...newsLearnings,
      ...(fundamentals ? [fundamentals] : []),
      ...macroLearnings,
      ...(onchainLearning ? [onchainLearning] : [])
    ];

    // Calculate scores based on learnings
    const fundamentalScore = calculateFundamentalScore(fundamentals);
    const sentimentScore = calculateSentimentScore(allLearnings);
    const riskScore = calculateRiskScore(allLearnings, macroLearnings);

    // Technical score would be calculated separately by the agent
    const technicalScore = 50; // Set by agent's own analysis
    const confidenceAdjustment = calculateConfidenceAdjustment(fundamentalScore, sentimentScore, riskScore);
    
    // Calculate overall score: weighted combination
    const overallScore = Math.round(
      (fundamentalScore * 0.25) +
      (technicalScore * 0.25) +
      (sentimentScore * 0.25) +
      ((100 - riskScore) * 0.25) // Inverse risk score
    );

    const state: AgentLearningState = {
      agentId,
      assetId: asset,
      recentLearnings: allLearnings.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10),
      fundamentalScore,
      technicalScore,
      sentimentScore,
      riskScore,
      confidenceAdjustment,
      overallScore
    };

    // Store learning state for agent to reference
    await prisma.systemLog.create({
      data: {
        level: 'INFO',
        service: `agent-learning-${agentId}`,
        message: 'Learning state built',
        metadata: state as any
      }
    }).catch(() => {});

    return state;
  } catch (err) {
    logger.error('Failed to build learning state', { agentId, asset, err });
    return {
      agentId,
      assetId: asset,
      recentLearnings: [],
      fundamentalScore: 50,
      technicalScore: 50,
      sentimentScore: 50,
      riskScore: 50,
      confidenceAdjustment: 0,
      overallScore: 50
    };
  }
}

/**
 * Helper: Analyze sentiment of text
 */
function analyzeSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const bullishWords = ['surge', 'surge', 'positive', 'beat', 'outperform', 'rally', 'strong', 'upgrade'];
  const bearishWords = ['crash', 'decline', 'miss', 'underperform', 'selloff', 'weak', 'downgrade'];

  const textLower = text?.toLowerCase() || '';
  const bullishCount = bullishWords.filter(w => textLower.includes(w)).length;
  const bearishCount = bearishWords.filter(w => textLower.includes(w)).length;

  if (bullishCount > bearishCount) return 'bullish';
  if (bearishCount > bullishCount) return 'bearish';
  return 'neutral';
}

/**
 * Helper: Calculate fundamental score (0-100)
 */
function calculateFundamentalScore(fundamentals: LearningResource | null): number {
  if (!fundamentals) return 50;
  if (fundamentals.sentiment === 'bullish') return 70 + Math.random() * 20;
  if (fundamentals.sentiment === 'bearish') return 30 + Math.random() * 10;
  return 50;
}

/**
 * Helper: Calculate sentiment score from all learnings
 */
function calculateSentimentScore(learnings: LearningResource[]): number {
  if (learnings.length === 0) return 50;

  const weightedSum = learnings.reduce((sum, l) => {
    const sentiment = l.sentiment === 'bullish' ? 100 : l.sentiment === 'bearish' ? 0 : 50;
    return sum + sentiment * l.relevanceScore;
  }, 0);

  const totalWeight = learnings.reduce((sum, l) => sum + l.relevanceScore, 0);
  return Math.round(weightedSum / totalWeight);
}

/**
 * Helper: Calculate risk score based on macro and news
 */
function calculateRiskScore(allLearnings: LearningResource[], macroLearnings: LearningResource[]): number {
  let risk = 50;

  // Macro events increase risk
  const highImpactMacroEvents = macroLearnings.filter(l => l.relevanceScore > 0.8).length;
  risk += highImpactMacroEvents * 5;

  // Bearish news increases risk
  const bearishNews = allLearnings.filter(l => l.type === 'news' && l.sentiment === 'bearish').length;
  risk += bearishNews * 3;

  return Math.min(risk, 100);
}

/**
 * Helper: Calculate confidence adjustment based on learning
 */
function calculateConfidenceAdjustment(
  fundamentalScore: number,
  sentimentScore: number,
  riskScore: number
): number {
  // If fundamentals are strong (>70) and sentiment is bullish (>60), boost confidence
  if (fundamentalScore > 70 && sentimentScore > 60 && riskScore < 50) {
    return 15; // +15% confidence
  }

  // If risk is high (>70), reduce confidence
  if (riskScore > 70) {
    return -20; // -20% confidence
  }

  // Default: neutral adjustment
  return 0;
}

export default {
  learnFromNews,
  learnFromFundamentals,
  learnFromMacro,
  learnFromOnChain,
  buildAgentLearningState
};
