import { persistPredictionResearch } from './predictionResearchStore';
import axios from 'axios';
import { parsePredictionAssessment } from './predictionAssessment';
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
const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';
const POLYGON_RPC = 'https://polygon-rpc.com';

export interface PolymarketAccountPosition {
  asset: string;            // ERC1155 token ID
  conditionId: string;
  title: string;
  outcome: 'YES' | 'NO';
  size: number;             // Shares held
  avgPrice: number;         // Average entry price (0.00 - 1.00)
  currentPrice: number;     // Current market price
  curValue: number;         // Current market value in USD
  initialValue: number;     // Cost basis
  cashPnl: number;          // Realized/unrealized P&L in USD
  percentPnl: number;       // P&L %
  redeemed: boolean;        // Settlement & redemption status
}

export interface PolymarketOrderBook {
  tokenId: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  spread: number;
  bestBid: number;
  bestAsk: number;
  tickSize: number;
  minSize: number;
  timestamp: number;
}

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
  tokenIdYes?: string;  // CLOB token ID for the YES outcome (Gamma clobTokenIds[0])
  tokenIdNo?: string;   // CLOB token ID for the NO outcome (Gamma clobTokenIds[1])

  // Our calculated fields
  trueYesProbability?: number;  // Our estimate of true probability
  edge?: number;                 // Our edge vs market price
  recommendedBet?: 'YES' | 'NO' | 'SKIP';
  expectedValue?: number;
  kellyFraction?: number;
}

export async function fetchActiveEvents(
  category?: string,
  minLiquidity: number = 100,
  minVolume: number = 50
): Promise<PolymarketEvent[]> {
  try {
    const response = await axios.get(`${POLYMARKET_GAMMA_API}/markets`, {
      params: {
        active: true,
        closed: false,
        order: 'volume24hr',
        ascending: false,
        limit: 200,
        category: category || undefined,
        liquidity_num_min: minLiquidity,
      },
      timeout: 10000
    });

    const markets = response.data || [];

    // Filter for viable trading opportunities
    return markets
      .filter((m: any) => Number(m.volume24hr) >= minVolume && Number(m.liquidity) >= minLiquidity)

      .map((m: any) => ({
        id: m.id,
        title: m.question || m.title,
        description: m.description || '',
        resolutionDate: m.end_date_iso,
        volume24h: Number(m.volume24hr) || 0,
        liquidity: Number(m.liquidity) || 0,
        category: m.category || 'general',
        markets: [{
          id: m.id,
          question: m.question,
          conditionId: m.condition_id,
          yesPrice: parseFloat(m.best_ask || m.last_trade_price || '0.5'),
          noPrice: 1 - parseFloat(m.best_ask || m.last_trade_price || '0.5'),
          volume: Number(m.volume24hr) || 0,
          liquidity: Number(m.liquidity) || 0,
          endDate: m.end_date_iso,
          tokenIdYes: parseClobTokenIds(m.clobTokenIds)[0],
          tokenIdNo: parseClobTokenIds(m.clobTokenIds)[1],

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
  conditionId: string;
  marketImpliedProbability: number;  // What market says
  ourEstimatedProbability: number | null;   // What we calculate
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

interface AnalysisResponse {
  ourProbabilityYes: number;
  confidence: number;
  edge?: number;
  recommendedSide: 'YES' | 'NO' | 'SKIP';
  reasoning: string;
  riskFactors?: string[];
  kellyFraction?: number;
}

// Missing research is unavailable; keyword offsets cannot manufacture an edge.
function unavailablePredictionAnalysis(market: PolymarketMarket, daysToResolution: number): ProbabilityAnalysis {
  return {
    question: market.question, conditionId: market.conditionId,
    marketImpliedProbability: market.yesPrice, ourEstimatedProbability: null,
    edge: 0, confidence: 0, recommendedSide: 'SKIP', betSizeUSD: 0,
    expectedProfitUSD: 0, reasoning: 'Independent probability assessment unavailable. Market price alone is not a forecast.',
    riskFactors: ['Event evidence and calibrated probability are unavailable'],
    resolutionDate: market.endDate, daysToResolution,
  };
}
let llmCooldownUntil = 0;

export async function analyzePolymarketEvent(
  market: PolymarketMarket,
  portfolioValue: number
): Promise<ProbabilityAnalysis> {
  if (!market || !Number.isFinite(market.yesPrice) || market.yesPrice <= 0 || market.yesPrice >= 1 || !Number.isFinite(portfolioValue) || portfolioValue <= 0 || !Number.isFinite(market.volume) || market.volume < 0 || !Number.isFinite(market.liquidity) || market.liquidity < 0 || !Number.isFinite(new Date(market.endDate).getTime())) {
    throw new Error('Invalid prediction market inputs');
  }

  const marketImpliedProbability = market.yesPrice;
  const daysToResolution = Math.max(1, Math.ceil((new Date(market.endDate).getTime() - Date.now()) / 86400000));

  const prompt = `You are a world-class prediction market analyst. A Polymarket event needs probability assessment.

EVENT: "${market.question}"
RESOLUTION DATE: ${market.endDate} (${daysToResolution} days from now)
MARKET PRICE: YES trading at ${(marketImpliedProbability * 100).toFixed(1)} cents = market says ${(marketImpliedProbability * 100).toFixed(1)}% chance of YES
VOLUME: $${market.volume.toFixed(0)} | LIQUIDITY: $${market.liquidity.toFixed(0)}

Respond ONLY in valid JSON:
{
  "ourProbabilityYes": <0.0 to 1.0>,
  "confidence": <0 to 100>,
  "edge": <our probability minus market implied>,
  "recommendedSide": "YES" | "NO" | "SKIP",
  "reasoning": "<2-3 sentences explaining your estimate>",
  "riskFactors": ["<risk1>", "<risk2>"],
  "kellyFraction": <0 to 0.1>
}`;

  let parsed: AnalysisResponse | null = null;

  // Check circuit breaker — if external LLM failed recently, report independent research unavailable
  const canAttemptLlm = Date.now() > llmCooldownUntil;

  // 1. Try Gemini API first if available and not on cooldown
  if (canAttemptLlm && process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('dummy')) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const geminiPromise = ai.models.generateContent({
        model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000));
      const response = await Promise.race([geminiPromise, timeoutPromise]) as any;
      if (response?.text) {
        parsed = parsePredictionAssessment(JSON.parse(response.text.trim()));
      }
    } catch {
      // Cooldown external LLM for 3 minutes to avoid latency on spike errors
      llmCooldownUntil = Date.now() + 180000;
    }
  }

  // 2. Routed LLM (NVIDIA NIM / Anthropic / Ollama per env, with provider failover)
  if (!parsed) {
    try {
      const { llmText, parseJsonLoose } = await import('../utils/llmRouter');
      const text = await Promise.race([
        llmText({ tier: 'smart', prompt, maxTokens: 700, temperature: 0.2 }),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 45000)),
      ]);
      parsed = parsePredictionAssessment(parseJsonLoose<unknown>(text));
    } catch {
      // Missing research is reported as unavailable.
    }
  }

  // 3. If LLM analysis produced a valid result, compute Kelly sizing and return
  if (parsed && typeof parsed.ourProbabilityYes === 'number') {
    const edge = parsed.ourProbabilityYes - marketImpliedProbability;
    const absEdge = Math.abs(edge);

    const payout = parsed.recommendedSide === 'YES'
      ? (1 / marketImpliedProbability) - 1
      : (1 / (1 - marketImpliedProbability)) - 1;

    const ourP = parsed.recommendedSide === 'YES' ? parsed.ourProbabilityYes : 1 - parsed.ourProbabilityYes;
    const kelly = Math.max(0, (payout * ourP - (1 - ourP)) / (payout || 1));
    const halfKelly = kelly * 0.5;

    const maxBetPct = 0.05;
    const betSizeUSD = Math.min(portfolioValue * halfKelly, portfolioValue * maxBetPct);
    const expectedProfitUSD = betSizeUSD * payout * ourP - betSizeUSD * (1 - ourP);

    let recommendation: 'YES' | 'NO' | 'SKIP' = parsed.recommendedSide;
    if ((recommendation === 'YES' && edge <= 0) || (recommendation === 'NO' && edge >= 0)) recommendation = 'SKIP';
    if (absEdge < 0.08 || parsed.confidence < 60 || betSizeUSD < 1) {
      recommendation = 'SKIP';
    }

    const analysis: ProbabilityAnalysis = {
      question: market.question,
      conditionId: market.conditionId,
      marketImpliedProbability,
      ourEstimatedProbability: parsed.ourProbabilityYes,
      edge,
      confidence: parsed.confidence,
      recommendedSide: recommendation,
      betSizeUSD: recommendation === 'SKIP' ? 0 : Math.floor(betSizeUSD * 100) / 100,
      expectedProfitUSD: recommendation === 'SKIP' ? 0 : expectedProfitUSD,
      reasoning: parsed.reasoning,
      riskFactors: parsed.riskFactors || [],
      resolutionDate: market.endDate,
      daysToResolution
    };

    logger.info(`🎯 Polymarket Analysis: ${market.question.slice(0, 50)}... -> ${recommendation}`);
    return analysis;
  }

  // 4. Missing independent research remains unavailable.
  return unavailablePredictionAnalysis(market, daysToResolution);
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
  const allAnalyses: ProbabilityAnalysis[] = [];

  // Analyze ALL available markets — no artificial cap
  for (const event of events) {
    for (const market of event.markets) {
      try {
        const analysis = await analyzePolymarketEvent(market, portfolioValue);
        allAnalyses.push(analysis);
        if (analysis.recommendedSide !== 'SKIP' && analysis.betSizeUSD >= 1) {
          analyses.push(analysis);
        }
      } catch {
        // skip individual market errors
      }
      await new Promise(r => setTimeout(r, 80)); // Rate limit
    }
  }


  // Sort by expected profit
  analyses.sort((a, b) => b.expectedProfitUSD - a.expectedProfitUSD);
  allAnalyses.sort((a, b) => b.expectedProfitUSD - a.expectedProfitUSD);

  logger.info(`\n✅ Found ${analyses.length} actionable Polymarket opportunities`);
  analyses.slice(0, 3).forEach(a => {
    logger.info(`   ${a.recommendedSide} "${a.question.slice(0, 50)}..." — $${a.betSizeUSD} bet, EV: $${a.expectedProfitUSD.toFixed(2)}`);
  });



  await persistPredictionResearch(allAnalyses);

  // Record paper research only; the US live flag cannot select an international venue.
  const isPaper = true; // International research is separate from Polymarket US live mode.
  const actionableForBetting = allAnalyses.filter(a => a.recommendedSide !== 'SKIP' && a.betSizeUSD >= 1);
  logger.info(`📊 Auto-placing ${actionableForBetting.length} ${isPaper ? 'paper' : 'LIVE'} bets...`);
  for (const analysis of actionableForBetting) {
    await placePolymarketBet(analysis, analysis.conditionId, isPaper).catch(() => {});
  }


  // Return only actionable opportunities: SKIP-rated markets (persisted above for display) are excluded.
  getIO()?.emit('polymarket:scan-complete', { opportunities: analyses });
  return analyses;
}


// ── POLYMARKET CLOB AUTH (Ed25519) ────────────────────────────────────────────

// Gamma returns clobTokenIds either as an array or as a JSON-encoded string
function parseClobTokenIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ── PLACE POLYMARKET BET ──────────────────────────────────────────────────────

export async function placePolymarketBet(
  analysis: ProbabilityAnalysis,
  marketConditionId: string,
  isPaper: boolean = true
): Promise<{ success: boolean; txHash?: string; orderId?: string; message: string }> {

  if (isPaper) {
    if (!analysis || !['YES', 'NO'].includes(analysis.recommendedSide) || !Number.isFinite(analysis.betSizeUSD) || analysis.betSizeUSD <= 0 || !Number.isFinite(analysis.marketImpliedProbability) || analysis.marketImpliedProbability <= 0 || analysis.marketImpliedProbability >= 1 || typeof analysis.conditionId !== 'string' || !analysis.conditionId || typeof analysis.question !== 'string') {
      return { success: false, message: 'Invalid simulation inputs' };
    }
    logger.info(`📄 PAPER BET: ${analysis.recommendedSide} $${analysis.betSizeUSD} on "${analysis.question.slice(0, 50)}..."`);
    // Book the bet the way Polymarket does: you buy SHARES of one outcome at
    // that outcome's price; each share pays $1 if it wins, $0 if it loses.
    // (Old code stored the YES price for NO bets and quantity = dollars, so
    // every NO bet and every loss had the wrong P&L.)
    const sidePrice = analysis.recommendedSide === 'YES'
      ? analysis.marketImpliedProbability
      : 1 - analysis.marketImpliedProbability;
    const shares = sidePrice > 0 ? analysis.betSizeUSD / sidePrice : 0;
    await prisma.trade.create({
      data: {
        asset: 'POLYMARKET',
        market: 'prediction',
        type: analysis.recommendedSide === 'YES' ? 'BUY' : 'SELL',
        entryPrice: sidePrice,
        quantity: shares,
        status: 'LOCAL_SIMULATION',
        stopLossPrice: 0,
        takeProfitPrice: 1, // marker: share-based accounting (v2)
        brokerOrderId: analysis.conditionId,
        metadata: { executionMode: 'LOCAL_SIMULATION', venue: 'INTERNATIONAL_RESEARCH', brokerSubmitted: false, conditionId: analysis.conditionId, question: analysis.question },
      }
    });
    return { success: true, message: `Local simulation recorded: ${analysis.recommendedSide} $${analysis.betSizeUSD}` };
  }

  // Gamma condition IDs and tokens belong to the international exchange.
  // US Ed25519 credentials cannot authorize those orders. No fake fill is booked.
  return { success: false, message: 'International live execution is unavailable; Polymarket US requires its own qualified market and execution route' };
}

// ── RESOLUTION POLLING ────────────────────────────────────────────────────────
// Nothing previously checked whether a Polymarket market had resolved in the
// real world, so OPEN Polymarket trades sat forever with no P&L (see project
// memory: 16+ positions accumulated this way). conditionId (now flowing from
// analyzePolymarketEvent through placePolymarketBet into Trade.brokerOrderId)
// is the lookup key back to the market.

export async function pollPolymarketResolutions(): Promise<void> {
  const openTrades = await prisma.trade.findMany({
    where: { asset: 'POLYMARKET', status: 'OPEN', brokerOrderId: { not: null } },
  });
  if (openTrades.length === 0) return;

  const conditionIds = openTrades.map((t: any) => t.brokerOrderId).join(',');
  let markets: any[] = [];
  try {
    const response = await axios.get(`${POLYMARKET_GAMMA_API}/markets`, {
      params: { condition_ids: conditionIds },
      timeout: 10000,
    });
    markets = response.data || [];
  } catch (error) {
    logger.error('Failed to poll Polymarket resolutions', { error });
    return;
  }

  for (const trade of openTrades) {
    const market = markets.find((m: any) => (m.conditionId ?? m.condition_id) === trade.brokerOrderId);
    if (!market || !market.closed) continue;

    let prices: unknown;
    let outcomes: unknown;
    try {
      prices = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : market.outcomePrices;
      outcomes = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : market.outcomes;
    } catch { continue; }
    if (!Array.isArray(prices) || !Array.isArray(outcomes) || prices.length !== 2 || outcomes.length !== 2) continue;
    const labels = outcomes.map((value: unknown) => typeof value === 'string' ? value.toUpperCase() : '');
    const yesIndex = labels.indexOf('YES');
    const noIndex = labels.indexOf('NO');
    if (yesIndex < 0 || noIndex < 0 || yesIndex === noIndex) continue;
    const outcomePrices = prices.map((value: unknown) => typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN);
    const yesResolvedTrue = outcomePrices[yesIndex] === 1 && outcomePrices[noIndex] === 0;
    const noResolvedTrue = outcomePrices[noIndex] === 1 && outcomePrices[yesIndex] === 0;
    if (!yesResolvedTrue && !noResolvedTrue) continue;
    if ((trade.type !== 'BUY' && trade.type !== 'SELL') || !Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0 || trade.entryPrice >= 1 || !Number.isFinite(trade.quantity) || trade.quantity <= 0) continue;
    // Trade.type BUY == bet YES, SELL == bet NO (matches placePolymarketBet's mapping)
    const won = trade.type === 'BUY' ? yesResolvedTrue : !yesResolvedTrue;
    const exitPrice = won ? 1 : 0;
    let pnl: number;
    let pnlPct: number;
    if (trade.takeProfitPrice === 1) {
      // v2: quantity = shares, entryPrice = price paid per share of our side
      pnl = (exitPrice - trade.entryPrice) * trade.quantity;
      pnlPct = trade.entryPrice > 0 ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 : 0;
    } else {
      // legacy rows: quantity = USD stake, entryPrice = YES price for both sides
      const sidePrice = trade.type === 'BUY' ? trade.entryPrice : 1 - trade.entryPrice;
      const stake = trade.quantity;
      pnl = won ? stake * (1 - sidePrice) / Math.max(sidePrice, 0.01) : -stake;
      pnlPct = stake > 0 ? (pnl / stake) * 100 : 0;
    }

    await prisma.trade.update({
      where: { id: trade.id },
      data: { exitPrice, pnl, pnlPct, status: 'CLOSED', closedAt: new Date(), exitReason: 'market_resolved' },
    });
    logger.info(`🎯 Polymarket position resolved: ${trade.id} | Won: ${won} | PnL: $${pnl.toFixed(2)}`);
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

  return positions.map((p: any) => ({
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

/**
 * Fetch authenticated, account-specific Polymarket positions from official Data API
 * Replaces balance-inferred heuristics with authoritative contract positions
 */
export async function fetchAccountPositions(userAddress?: string): Promise<PolymarketAccountPosition[]> {
  const address = userAddress || wallet?.address;
  if (!address) {
    logger.warn('No Polymarket account/wallet address configured for position query');
    return [];
  }

  try {
    const response = await axios.get(`${POLYMARKET_DATA_API}/positions`, {
      params: { user: address },
      timeout: 10000
    });

    const rawList = Array.isArray(response.data) ? response.data : [];
    return rawList.map((item: any) => ({
      asset: item.asset || item.tokenId || '',
      conditionId: item.conditionId || '',
      title: item.title || item.question || '',
      outcome: (item.outcome || 'YES').toUpperCase() === 'YES' ? 'YES' : 'NO',
      size: Number(item.size) || 0,
      avgPrice: Number(item.avgPrice) || 0,
      currentPrice: Number(item.curPrice) || Number(item.currentPrice) || 0,
      curValue: Number(item.currentValue) || 0,
      initialValue: Number(item.initialValue) || 0,
      cashPnl: Number(item.cashPnl) || 0,
      percentPnl: Number(item.percentPnl) || 0,
      redeemed: Boolean(item.redeemed ?? false),
    }));
  } catch (err: any) {
    logger.error('Failed to query account-specific positions from Polymarket Data API', { error: err.message, address });
    return [];
  }
}

/**
 * Fetch authoritative level 2 order book from Polymarket CLOB
 */
export async function fetchOrderBook(tokenId: string): Promise<PolymarketOrderBook | null> {
  try {
    const response = await axios.get(`${POLYMARKET_CLOB_API}/book`, {
      params: { token_id: tokenId },
      timeout: 8000
    });

    const data = response.data;
    const bids = (data.bids || []).map((b: any) => ({ price: parseFloat(b.price), size: parseFloat(b.size) }));
    const asks = (data.asks || []).map((a: any) => ({ price: parseFloat(a.price), size: parseFloat(a.size) }));

    const bestBid = bids.length > 0 ? Math.max(...bids.map((b: any) => b.price)) : 0;
    const bestAsk = asks.length > 0 ? Math.min(...asks.map((a: any) => a.price)) : 1;
    const spread = parseFloat((bestAsk - bestBid).toFixed(4));

    return {
      tokenId,
      bids,
      asks,
      spread,
      bestBid,
      bestAsk,
      tickSize: 0.001,
      minSize: 1.0,
      timestamp: Date.now()
    };
  } catch (err: any) {
    logger.warn(`Failed to fetch CLOB order book for token ${tokenId}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch resolution criteria and source from official Polymarket Gamma API
 */
export async function fetchMarketResolution(conditionId: string): Promise<{
  resolved: boolean;
  resolutionSource: string;
  resolutionCriteria: string;
  payoutNumerator?: number[];
} | null> {
  try {
    const response = await axios.get(`${POLYMARKET_GAMMA_API}/markets`, {
      params: { condition_ids: conditionId },
      timeout: 8000
    });
    const market = response.data?.[0];
    if (!market) return null;

    return {
      resolved: Boolean(market.closed),
      resolutionSource: market.resolution_source || 'UMA Oracle / Decentralized Verification',
      resolutionCriteria: market.description || market.resolution_criteria || 'Resolution per official terms',
      payoutNumerator: market.outcomePrices ? JSON.parse(market.outcomePrices).map(Number) : undefined
    };
  } catch {
    return null;
  }
}
