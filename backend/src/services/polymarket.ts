import axios from 'axios';
import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { getIO } from '../websocket/server';

// ═══════════════════════════════════════════════════════════════════════════
// THARUN AUTO TRADING PLATFORM
// POLYMARKET INTEGRATION
// Prediction market probability arbitrage — ZERO FEES, $1 minimum
// Perfect for $100 starting capital
// ═══════════════════════════════════════════════════════════════════════════

const POLYMARKET_CLOB_API = 'https://clob.polymarket.com';
const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com';
const POLYGON_RPC = 'https://polygon-rpc.com';

// ── POLYMARKET CLIENT ─────────────────────────────────────────────────────────

let provider: ethers.JsonRpcProvider | null = null;
let wallet: ethers.Wallet | null = null;

export function initPolymarketWallet(): boolean {
  try {
    if (!process.env.POLYMARKET_PRIVATE_KEY) {
      logger.warn('POLYMARKET_PRIVATE_KEY not set — Polymarket trading disabled');
      return false;
    }
    provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    wallet = new ethers.Wallet(process.env.POLYMARKET_PRIVATE_KEY, provider);
    logger.info(`✅ Polymarket wallet initialized: ${wallet.address}`);
    return true;
  } catch (err) {
    logger.error('Polymarket wallet init failed', { err });
    return false;
  }
}

// ── EVENT FETCHER ─────────────────────────────────────────────────────────────

export interface PolymarketEvent {
  id: string;
  title: string;
  description: string;
  resolutionDate: string;
  markets: PolymarketMarket[];
  category: string;
  volume24h: number;
  liquidity: number;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  conditionId: string;
  yesPrice: number;     // 0.0 to 1.0 (= 0 to 100 cents)
  noPrice: number;      // 0.0 to 1.0
  volume: number;
  liquidity: number;
  endDate: string;
  // Our calculated fields
  trueYesProbability?: number;  // Our estimate of true probability
  edge?: number;                 // Our edge vs market price
  recommendedBet?: 'YES' | 'NO' | 'SKIP';
  expectedValue?: number;
  kellyFraction?: number;
}

export async function fetchActiveEvents(
  category?: string,
  minLiquidity: number = 1000,
  minVolume: number = 500
): Promise<PolymarketEvent[]> {
  try {
    const response = await axios.get(`${POLYMARKET_GAMMA_API}/markets`, {
      params: {
        active: true,
        closed: false,
        order: 'volume24hr',
        ascending: false,
        limit: 50,
        category: category || undefined,
        liquidity_num_min: minLiquidity,
      },
      timeout: 10000
    });

    const markets = response.data || [];

    // Filter for viable trading opportunities
    return markets
      .filter((m: any) => m.volume24hr > minVolume && m.liquidity > minLiquidity)
      .map((m: any) => ({
        id: m.id,
        title: m.question || m.title,
        description: m.description || '',
        resolutionDate: m.end_date_iso,
        volume24h: m.volume24hr || 0,
        liquidity: m.liquidity || 0,
        category: m.category || 'general',
        markets: [{
          id: m.id,
          question: m.question,
          conditionId: m.condition_id,
          yesPrice: parseFloat(m.best_ask || m.last_trade_price || '0.5'),
          noPrice: 1 - parseFloat(m.best_ask || m.last_trade_price || '0.5'),
          volume: m.volume24hr || 0,
          liquidity: m.liquidity || 0,
          endDate: m.end_date_iso,
        }]
      }));

  } catch (error) {
    logger.error('Failed to fetch Polymarket events', { error });
    return [];
  }
}

// ── PROBABILITY ENGINE — Core of the Polymarket Edge ─────────────────────────
//
// This is where we make money on Polymarket.
// The market prices an event at X%. We calculate the TRUE probability.
// If our estimate is significantly different = edge = bet.

export interface ProbabilityAnalysis {
  question: string;
  marketImpliedProbability: number;  // What market says
  ourEstimatedProbability: number;   // What we calculate
  edge: number;                      // Difference (our edge)
  confidence: number;                // How confident we are in our estimate
  recommendedSide: 'YES' | 'NO' | 'SKIP';
  betSizeUSD: number;                // Kelly-optimal bet size
  expectedProfitUSD: number;
  reasoning: string;
  riskFactors: string[];
  resolutionDate: string;
  daysToResolution: number;
}

import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function analyzePolymarketEvent(
  market: PolymarketMarket,
  portfolioValue: number
): Promise<ProbabilityAnalysis> {

  const marketImpliedProbability = market.yesPrice; // e.g. 0.42 = 42% chance YES
  const daysToResolution = Math.max(1, Math.ceil((new Date(market.endDate).getTime() - Date.now()) / 86400000));

  // Ask our specialized probability agent to estimate the TRUE probability
  const prompt = `You are a world-class prediction market analyst. A Polymarket event needs probability assessment.

EVENT: "${market.question}"
RESOLUTION DATE: ${market.endDate} (${daysToResolution} days from now)
MARKET PRICE: YES trading at ${(marketImpliedProbability * 100).toFixed(1)} cents = market says ${(marketImpliedProbability * 100).toFixed(1)}% chance of YES
VOLUME: $${market.volume.toFixed(0)} | LIQUIDITY: $${market.liquidity.toFixed(0)}

YOUR TASK:
1. What is the TRUE probability of YES based on all available information?
2. Is the market mispriced? If so, by how much?
3. What is the recommended bet (YES/NO/SKIP)?

RULES FOR A GOOD BET:
- Edge must be > 8 cents (we think 55% but market says 42% = 13 cent edge)
- Days to resolution: shorter is better (less time for things to go wrong)
- High volume = efficient market = harder to find edge
- Low volume = inefficient = more mispricing possible
- Never bet on events where you cannot calculate the probability (pure luck)

Respond ONLY in valid JSON:
{
  "ourProbabilityYes": <0.0 to 1.0>,
  "confidence": <0 to 100, how confident you are in your estimate>,
  "edge": <our probability minus market implied, can be negative>,
  "recommendedSide": "YES" | "NO" | "SKIP",
  "reasoning": "<2-3 sentences explaining your probability estimate>",
  "riskFactors": ["<risk1>", "<risk2>"],
  "kellyFraction": <0 to 0.1, fraction of bankroll to bet based on Kelly>
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Bad response');

    const parsed = JSON.parse(content.text.replace(/```json\n?|\n?```/g, '').trim());

    const edge = parsed.ourProbabilityYes - marketImpliedProbability;
    const absEdge = Math.abs(edge);

    // Kelly criterion for Polymarket
    // f = (bp - q) / b where b = payout odds, p = our probability, q = 1-p
    const payout = parsed.recommendedSide === 'YES'
      ? (1 / marketImpliedProbability) - 1   // If YES at 42 cents → wins 137% on top
      : (1 / (1 - marketImpliedProbability)) - 1;

    const ourP = parsed.recommendedSide === 'YES' ? parsed.ourProbabilityYes : 1 - parsed.ourProbabilityYes;
    const kelly = Math.max(0, (payout * ourP - (1 - ourP)) / payout);
    const halfKelly = kelly * 0.5; // Always use half-Kelly

    // Scale bet size by portfolio value — max 5% on any single event
    const maxBetPct = 0.05;
    const betSizeUSD = Math.min(portfolioValue * halfKelly, portfolioValue * maxBetPct);
    const expectedProfitUSD = betSizeUSD * payout * ourP - betSizeUSD * (1 - ourP);

    // Skip if edge too small, confidence too low, or bet size below minimum
    let recommendation: 'YES' | 'NO' | 'SKIP' = parsed.recommendedSide;
    if (absEdge < 0.08 || parsed.confidence < 60 || betSizeUSD < 1) {
      recommendation = 'SKIP';
    }

    const analysis: ProbabilityAnalysis = {
      question: market.question,
      marketImpliedProbability,
      ourEstimatedProbability: parsed.ourProbabilityYes,
      edge: parsed.edge || edge,
      confidence: parsed.confidence,
      recommendedSide: recommendation,
      betSizeUSD: Math.max(1, Math.round(betSizeUSD * 100) / 100),
      expectedProfitUSD,
      reasoning: parsed.reasoning,
      riskFactors: parsed.riskFactors || [],
      resolutionDate: market.endDate,
      daysToResolution
    };

    logger.info(`\n🎯 POLYMARKET ANALYSIS: ${market.question.slice(0, 60)}...`);
    logger.info(`   Market says: ${(marketImpliedProbability * 100).toFixed(1)}% YES`);
    logger.info(`   We estimate: ${(parsed.ourProbabilityYes * 100).toFixed(1)}% YES`);
    logger.info(`   Edge: ${(absEdge * 100).toFixed(1)} cents | Confidence: ${parsed.confidence}%`);
    logger.info(`   Recommendation: ${recommendation} $${analysis.betSizeUSD}`);

    return analysis;

  } catch (err) {
    logger.error('Probability analysis failed', { err });
    return {
      question: market.question,
      marketImpliedProbability,
      ourEstimatedProbability: marketImpliedProbability,
      edge: 0,
      confidence: 0,
      recommendedSide: 'SKIP',
      betSizeUSD: 0,
      expectedProfitUSD: 0,
      reasoning: 'Analysis failed — defaulting to skip',
      riskFactors: ['Analysis error'],
      resolutionDate: market.endDate,
      daysToResolution
    };
  }
}

// ── SCAN ALL EVENTS FOR BEST OPPORTUNITIES ────────────────────────────────────

export async function scanPolymarketOpportunities(
  portfolioValue: number
): Promise<ProbabilityAnalysis[]> {

  logger.info('\n🔍 SCANNING POLYMARKET FOR OPPORTUNITIES...');
  getIO()?.emit('polymarket:scanning', { portfolioValue });

  const events = await fetchActiveEvents(undefined, 500, 200);
  logger.info(`   Found ${events.length} active markets`);

  const analyses: ProbabilityAnalysis[] = [];

  // Analyze top 20 events (rate limited to avoid API costs)
  const toAnalyze = events.slice(0, 20);
  for (const event of toAnalyze) {
    for (const market of event.markets) {
      const analysis = await analyzePolymarketEvent(market, portfolioValue);
      if (analysis.recommendedSide !== 'SKIP' && analysis.betSizeUSD >= 1) {
        analyses.push(analysis);
      }
      await new Promise(r => setTimeout(r, 500)); // Rate limit
    }
  }

  // Sort by expected profit
  analyses.sort((a, b) => b.expectedProfitUSD - a.expectedProfitUSD);

  logger.info(`\n✅ Found ${analyses.length} actionable Polymarket opportunities`);
  analyses.slice(0, 3).forEach(a => {
    logger.info(`   ${a.recommendedSide} "${a.question.slice(0, 50)}..." — $${a.betSizeUSD} bet, EV: $${a.expectedProfitUSD.toFixed(2)}`);
  });

  getIO()?.emit('polymarket:scan-complete', { opportunities: analyses });

  // Save to DB
  for (const analysis of analyses) {
    await prisma.prediction.create({
      data: {
        asset: 'POLYMARKET',
        direction: analysis.recommendedSide === 'YES' ? 'UP' : 'DOWN',
        confidence: analysis.confidence,
        targetPrice: analysis.ourEstimatedProbability * 100,
        currentPrice: analysis.marketImpliedProbability * 100,
        timeHorizon: `${analysis.daysToResolution}D`,
        keyRisks: analysis.riskFactors
      }
    }).catch(() => {});
  }

  return analyses;
}

// ── PLACE POLYMARKET BET ──────────────────────────────────────────────────────

export async function placePolymarketBet(
  analysis: ProbabilityAnalysis,
  marketConditionId: string,
  isPaper: boolean = true
): Promise<{ success: boolean; txHash?: string; message: string }> {

  if (isPaper) {
    logger.info(`📄 PAPER BET: ${analysis.recommendedSide} $${analysis.betSizeUSD} on "${analysis.question.slice(0, 50)}..."`);
    await prisma.trade.create({
      data: {
        asset: 'POLYMARKET',
        market: 'prediction',
        type: analysis.recommendedSide === 'YES' ? 'BUY' : 'SELL',
        entryPrice: analysis.marketImpliedProbability,
        quantity: analysis.betSizeUSD,
        status: 'OPEN',
        stopLossPrice: 0.01, // 1 cent = minimum
        takeProfitPrice: analysis.recommendedSide === 'YES' ? 0.99 : 0.01,
      }
    }).catch(() => {});
    return { success: true, message: `Paper bet placed: ${analysis.recommendedSide} $${analysis.betSizeUSD}` };
  }

  // Live betting would require actual Polygon transaction signing
  // This is the framework — requires Polymarket CLOB API authentication
  if (!wallet) {
    return { success: false, message: 'Wallet not initialized — add POLYMARKET_PRIVATE_KEY to .env' };
  }

  try {
    // NOTE: Full CLOB order placement requires Polymarket API authentication
    // and EIP-712 signature. Framework is here — full implementation requires
    // Polymarket API key from polymarket.com/profile
    logger.warn('Live Polymarket betting requires additional API key setup at polymarket.com');
    return { success: false, message: 'Polymarket live trading requires API key setup — see README' };
  } catch (err: any) {
    logger.error('Polymarket bet failed', { err });
    return { success: false, message: `Bet failed: ${err.message}` };
  }
}

// ── LONG-TERM POSITION TRACKER ────────────────────────────────────────────────
// Different logic for Polymarket events that resolve in weeks/months

export interface LongTermPosition {
  id: string;
  platform: 'polymarket' | 'crypto_spot' | 'stocks';
  asset: string;
  direction: 'LONG' | 'SHORT';
  entryDate: string;
  targetExitDate: string;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  costBasisUSD: number;
  currentValueUSD: number;
  unrealizedPnlUSD: number;
  unrealizedPnlPct: number;
  thesis: string;  // Why we entered
  exitConditions: string[];  // What would make us exit early
  daysHeld: number;
}

export async function getLongTermPositions(): Promise<LongTermPosition[]> {
  // Get positions held for more than 1 day
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const positions = await prisma.position.findMany({
    where: {
      status: 'OPEN',
      openedAt: { lte: yesterday }
    }
  });

  return positions.map(p => ({
    id: p.id,
    platform: p.market as any,
    asset: p.asset,
    direction: 'LONG' as const,
    entryDate: p.openedAt.toISOString(),
    targetExitDate: new Date(p.openedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    entryPrice: p.entryPrice,
    currentPrice: p.currentPrice,
    quantity: p.quantity,
    costBasisUSD: p.entryPrice * p.quantity,
    currentValueUSD: p.currentPrice * p.quantity,
    unrealizedPnlUSD: p.unrealizedPnl || 0,
    unrealizedPnlPct: p.unrealizedPnlPct || 0,
    thesis: 'Long-term position',
    exitConditions: ['Stop loss hit', 'Take profit hit', 'Thesis invalidated'],
    daysHeld: Math.floor((Date.now() - p.openedAt.getTime()) / 86400000)
  }));
}
