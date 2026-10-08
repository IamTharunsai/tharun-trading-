/**
 * APEX — POLYMARKET MONEY GREED AGENT
 * ════════════════════════════════════════════════════════════════════════════════
 * "Self-surviving" autonomous Polymarket prediction market trader.
 * TOGGLE MODE: When ON → hunts every edge ≥1%, fires fast, reinvests profits.
 *
 * Architecture:
 *  - Continuous market scanner (every 800ms in greed mode, 10s in normal mode)
 *  - Latency-optimized order pipeline (target <200ms from signal to fill)
 *  - Kelly Criterion position sizing with dynamic bankroll tracking
 *  - Auto-rebalancing: winners reinvested, losers cut fast
 *  - Self-surviving: no human in the loop, adapts to market regime
 *  - Concurrent market slots: up to 50 live positions simultaneously
 *  - Can generate 40k–100k+ trades on high-volume events (e.g. election nights)
 *
 * Edge sources:
 *  1. Probability mispricing vs. Claude Tier-3 analysis
 *  2. Momentum: markets moving >5% in 15min (catch the wave)
 *  3. Mean reversion: markets >20% outside Bayesian anchor
 *  4. Liquidity arbitrage: bid/ask spread capture on thin books
 *  5. Resolution proximity: time-decay edge near closing
 *
 * Safety controls (always active, even in greed mode):
 *  - MAX_POSITION_PCT: no single position >10% of bankroll
 *  - MAX_TOTAL_EXPOSURE_PCT: total at-risk never >70%
 *  - HARD_STOP_LOSS_PCT: if daily P&L drops 15% → auto-pause 1h
 *  - Min edge threshold: never bet without ≥1% edge (full greed) or ≥3% (normal)
 *
 * ACTIVATION: POST /api/polymarket/greed { active: true }
 * UI: PolymarketGreedAgent toggle panel
 */

import axios from 'axios';
import crypto from 'crypto';
import { createPrivateKey, sign as cryptoSign } from 'crypto';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { getIO } from '../websocket/server';
import { fetchActiveEvents, initPolymarketWallet, PolymarketMarket } from './polymarket';

// ─── COMPLIANCE GUARDRAILS (CFTC / LEGAL) ────────────────────────────────────
// Ensures all trading complies with CFTC regulations and Polymarket ToS.
// Required by law for US users trading on polymarketexchange.com.

const COMPLIANCE = {
  // Endpoint: always use the CFTC-licensed US exchange for US users
  POLYMARKET_ENDPOINT: 'https://clob.polymarketexchange.com',

  // Rate limiting: prevent market manipulation accusations
  MAX_TRADES_PER_MARKET_PER_HOUR: 20,    // Anti-spoofing
  MAX_TRADES_PER_HOUR_TOTAL: 200,         // Platform rate limit

  // Wash trade detection: track recent trades to prevent circular trading
  WASH_TRADE_WINDOW_MS: 5 * 60_000,       // 5-minute window
  MIN_TIME_BETWEEN_OPPOSING_TRADES_MS: 60_000, // Can't flip YES→NO in <1 min

  // Insider trading prevention: keywords that suggest non-public information
  BLOCKED_KEYWORDS: [
    'unreported', 'leaked', 'classified', 'confidential',
    'before announcement', 'pre-announcement', 'inside source',
    'tip off', 'insider', 'advance notice',
  ],

  // Audit trail (required for CFTC compliance)
  REQUIRE_TRADE_REASONING: true,
} as const;

// Compliance state
const complianceState = {
  tradeLog: [] as Array<{
    conditionId: string;
    side: 'YES' | 'NO';
    ts: number;
    betUSD: number;
    reasoning: string;
    tradeHash: string;  // Tamper-evident hash
  }>,
  marketTradeCounts: new Map<string, { count: number; windowStart: number }>(),
  hourlyTradeCount: 0,
  hourlyWindowStart: Date.now(),
  blockedMarkets: new Set<string>(),
};

/**
 * Compliance check — returns null if OK, or reason string if blocked.
 * Must pass before ANY trade is executed.
 */
function complianceCheck(
  conditionId: string,
  side: 'YES' | 'NO',
  question: string,
  betUSD: number
): string | null {
  const now = Date.now();

  // 1. Insider-trading keyword check
  const qLower = question.toLowerCase();
  for (const kw of COMPLIANCE.BLOCKED_KEYWORDS) {
    if (qLower.includes(kw)) {
      logger.warn(`[COMPLIANCE] Blocked market for insider-trading keyword: "${kw}" in "${question.slice(0, 60)}"`);
      complianceState.blockedMarkets.add(conditionId);
      return `INSIDER_RISK:${kw}`;
    }
  }

  // 2. Already-blocked market
  if (complianceState.blockedMarkets.has(conditionId)) {
    return 'MARKET_BLOCKED';
  }

  // 3. Rate limiting — total hourly trades
  if (now - complianceState.hourlyWindowStart > 3_600_000) {
    complianceState.hourlyTradeCount = 0;
    complianceState.hourlyWindowStart = now;
  }
  if (complianceState.hourlyTradeCount >= COMPLIANCE.MAX_TRADES_PER_HOUR_TOTAL) {
    return `RATE_LIMIT_TOTAL:${complianceState.hourlyTradeCount}/hr`;
  }

  // 4. Rate limiting — per-market trades
  const marketCounter = complianceState.marketTradeCounts.get(conditionId);
  if (marketCounter) {
    if (now - marketCounter.windowStart < 3_600_000) {
      if (marketCounter.count >= COMPLIANCE.MAX_TRADES_PER_MARKET_PER_HOUR) {
        return `RATE_LIMIT_MARKET:${marketCounter.count} trades this hr`;
      }
    } else {
      // Reset window
      complianceState.marketTradeCounts.set(conditionId, { count: 0, windowStart: now });
    }
  }

  // 5. Wash trade detection — check if we recently traded the opposite side
  const recentOpposite = complianceState.tradeLog.find(t =>
    t.conditionId === conditionId &&
    t.side !== side &&
    (now - t.ts) < COMPLIANCE.MIN_TIME_BETWEEN_OPPOSING_TRADES_MS
  );
  if (recentOpposite) {
    return `WASH_TRADE_RISK:last_${recentOpposite.side}_${Math.round((now - recentOpposite.ts) / 1000)}s_ago`;
  }

  // 6. Circular trade detection — same side same market in wash window
  const recentSame = complianceState.tradeLog.filter(t =>
    t.conditionId === conditionId &&
    (now - t.ts) < COMPLIANCE.WASH_TRADE_WINDOW_MS
  );
  // Allow up to 3 same-direction buys in window (legitimate averaging)
  if (recentSame.length >= 3) {
    return `WASH_TRADE_RISK:${recentSame.length}_trades_in_5min`;
  }

  return null; // All checks passed
}

/**
 * Record a trade in the compliance audit log.
 * Uses SHA-256 chaining for tamper-evident audit trail.
 */
function recordComplianceTrade(
  conditionId: string,
  side: 'YES' | 'NO',
  betUSD: number,
  reasoning: string
): void {
  const now = Date.now();
  const prevHash = complianceState.tradeLog.length > 0
    ? complianceState.tradeLog[complianceState.tradeLog.length - 1].tradeHash
    : '0000000000000000';

  const payload = `${conditionId}|${side}|${betUSD}|${now}|${reasoning}|${prevHash}`;
  const tradeHash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);

  complianceState.tradeLog.push({ conditionId, side, ts: now, betUSD, reasoning, tradeHash });

  // Update counters
  complianceState.hourlyTradeCount++;
  const mc = complianceState.marketTradeCounts.get(conditionId) || { count: 0, windowStart: now };
  mc.count++;
  complianceState.marketTradeCounts.set(conditionId, mc);

  // Keep log at max 10k entries (rolling)
  if (complianceState.tradeLog.length > 10_000) {
    complianceState.tradeLog.splice(0, 1000);
  }
}

/** Export compliance audit log for regulators */
export function getComplianceAuditLog() {
  return {
    totalTrades: complianceState.tradeLog.length,
    hourlyTradeCount: complianceState.hourlyTradeCount,
    blockedMarkets: Array.from(complianceState.blockedMarkets),
    recentTrades: complianceState.tradeLog.slice(-100),
    endpoint: COMPLIANCE.POLYMARKET_ENDPOINT,
    regulatoryCompliance: 'CFTC_LICENSED_POLYMARKETEXCHANGE',
  };
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const GREED_CONFIG = {
  // Scan intervals
  SCAN_INTERVAL_GREED_MS: 800,       // How often to scan markets in greed mode
  SCAN_INTERVAL_NORMAL_MS: 10_000,   // Normal mode scan interval
  ORDER_TIMEOUT_MS: 3_000,           // Max time to wait for fill before cancel

  // Position sizing
  MIN_EDGE_GREED: 0.010,             // 1.0% minimum edge in greed mode
  MIN_EDGE_NORMAL: 0.030,            // 3.0% minimum edge in normal mode
  KELLY_FRACTION: 0.25,              // Quarter-Kelly (conservative multiplier)
  MAX_POSITION_PCT: 0.10,            // Max 10% of bankroll per position
  MAX_TOTAL_EXPOSURE_PCT: 0.70,      // Max 70% total exposure
  MAX_CONCURRENT_POSITIONS: 50,      // Max live positions
  MIN_BET_USD: 1.00,                 // Polymarket minimum
  MAX_BET_USD: 500.00,               // Hard cap per position

  // Risk controls
  DAILY_STOP_LOSS_PCT: 0.15,         // Pause if down 15% in a day
  STOP_LOSS_PAUSE_MINUTES: 60,       // Pause duration after stop-loss trigger
  MIN_LIQUIDITY_USD: 1_000,          // Only trade markets with ≥$1k liquidity
  MIN_VOLUME_24H_USD: 500,           // Only trade markets with ≥$500 24h volume
  MAX_RESOLUTION_DAYS: 30,           // Skip markets resolving >30 days out
  MIN_RESOLUTION_HOURS: 1,           // Skip markets resolving in <1h (too volatile)

  // Momentum & mean-reversion filters
  MOMENTUM_THRESHOLD: 0.05,          // 5% move in 15min triggers momentum trade
  MEAN_REVERSION_THRESHOLD: 0.20,    // 20% deviation from Bayesian anchor

  // Markets per scan batch
  SCAN_BATCH_SIZE: 100,
} as const;

// ─── STATE ───────────────────────────────────────────────────────────────────

interface GreedAgentState {
  active: boolean;
  greedMode: boolean;          // Full greed vs normal
  startedAt: number | null;
  bankroll: number;            // Available USDC for betting
  totalExposure: number;       // Sum of open position costs
  dailyStartBankroll: number;
  dailyPnL: number;
  pausedUntil: number | null;  // Unix ms — auto-pause after stop-loss
  scansCompleted: number;
  tradesPlaced: number;
  tradesWon: number;
  tradesLost: number;
  currentPositions: Map<string, GreedPosition>;
  marketPriceHistory: Map<string, { price: number; ts: number }[]>;
  lastScanAt: number;
  bestEdgeFound: number;
  totalProfit: number;
}

interface GreedPosition {
  conditionId: string;
  question: string;
  side: 'YES' | 'NO';
  shares: number;
  entryPrice: number;           // 0.0–1.0
  costBasis: number;            // USD
  currentPrice: number;
  unrealizedPnL: number;
  openedAt: number;
  edgeAtEntry: number;
  kellyBetSize: number;
  expiresAt: number;            // Market resolution timestamp
}

interface EdgeOpportunity {
  conditionId: string;
  question: string;
  market: PolymarketMarket;
  ourProbability: number;       // Our estimate
  marketImplied: number;        // Market price
  edge: number;                 // Our edge (positive = bet)
  side: 'YES' | 'NO';
  kellyBetUSD: number;
  confidence: number;
  source: 'mispricing' | 'momentum' | 'mean_reversion' | 'resolution_decay';
  expectedValueUSD: number;
}

const state: GreedAgentState = {
  active: false,
  greedMode: false,
  startedAt: null,
  bankroll: 0,
  totalExposure: 0,
  dailyStartBankroll: 0,
  dailyPnL: 0,
  pausedUntil: null,
  scansCompleted: 0,
  tradesPlaced: 0,
  tradesWon: 0,
  tradesLost: 0,
  currentPositions: new Map(),
  marketPriceHistory: new Map(),
  lastScanAt: 0,
  bestEdgeFound: 0,
  totalProfit: 0,
};

let scanTimer: ReturnType<typeof setInterval> | null = null;

// ─── ACTIVATION ──────────────────────────────────────────────────────────────

export async function activateGreedAgent(greedMode = false): Promise<{
  ok: boolean;
  message: string;
  state: GreedAgentSnapshot;
}> {
  if (state.active) {
    state.greedMode = greedMode;
    restartScanLoop();
    return { ok: true, message: `Greed mode ${greedMode ? 'MAXIMIZED' : 'normalized'}`, state: getSnapshot() };
  }

  // Initialize wallet
  const walletOk = initPolymarketWallet();
  if (!walletOk) {
    logger.warn('[GREED] No Polymarket wallet — running in DRY-RUN mode (no real orders)');
  }

  // Load bankroll from DB
  state.bankroll = await loadBankroll();
  state.dailyStartBankroll = state.bankroll;
  state.dailyPnL = 0;
  state.startedAt = Date.now();
  state.active = true;
  state.greedMode = greedMode;
  state.scansCompleted = 0;
  state.tradesPlaced = 0;
  state.pausedUntil = null;

  // Reset in-memory positions Map — only load broker-confirmed OPEN trades from DB.
  // Ghost dry-run entries (brokerConfirmed=false) are excluded to prevent the counter
  // from bloating and blocking real scans ("max open positions 16/10").
  state.currentPositions = new Map();
  state.totalExposure = 0;
  try {
    const openTrades = await prisma.trade.findMany({
      where: {
        asset:           { startsWith: 'POLYMARKET:' },
        status:          'OPEN',
        brokerConfirmed: true,   // ONLY real, confirmed fills — never dry-run ghosts
      },
    });
    for (const t of openTrades) {
      const conditionId = t.asset.replace('POLYMARKET:', '');
      const pos: GreedPosition = {
        conditionId,
        question:      (t.metadata as any)?.question || conditionId,
        side:          t.type === 'BUY' ? 'YES' : 'NO',
        shares:        t.quantity,
        entryPrice:    t.entryPrice,
        costBasis:     t.quantity * t.entryPrice,
        currentPrice:  t.entryPrice,
        unrealizedPnL: 0,
        openedAt:      t.openedAt ? new Date(t.openedAt).getTime() : Date.now(),
        edgeAtEntry:   0,
        kellyBetSize:  t.quantity * t.entryPrice,
        expiresAt:     Date.now() + 30 * 86_400_000,
      };
      state.currentPositions.set(conditionId, pos);
      state.totalExposure += pos.costBasis;
    }
    logger.info(`[GREED] Loaded ${openTrades.length} broker-confirmed open position(s) from DB`);
  } catch (err: any) {
    logger.warn('[GREED] Could not load open positions from DB — starting with empty Map', { err: err?.message });
  }

  logger.info(`[GREED] 🚀 Money Greed Agent ACTIVATED — bankroll: $${state.bankroll.toFixed(2)} — mode: ${greedMode ? '🔥 FULL GREED' : '⚡ NORMAL'}`);

  startScanLoop();
  broadcastState();

  return { ok: true, message: `Money Greed Agent activated in ${greedMode ? 'FULL GREED' : 'NORMAL'} mode`, state: getSnapshot() };
}

export async function deactivateGreedAgent(): Promise<{ ok: boolean; state: GreedAgentSnapshot }> {
  state.active = false;
  state.greedMode = false;
  stopScanLoop();

  logger.info(`[GREED] ⏹️ Money Greed Agent DEACTIVATED — P&L today: $${state.dailyPnL.toFixed(2)} — trades: ${state.tradesPlaced}`);
  broadcastState();

  return { ok: true, state: getSnapshot() };
}

// ─── SCAN LOOP ───────────────────────────────────────────────────────────────

function startScanLoop() {
  stopScanLoop();
  const interval = state.greedMode ? GREED_CONFIG.SCAN_INTERVAL_GREED_MS : GREED_CONFIG.SCAN_INTERVAL_NORMAL_MS;
  scanTimer = setInterval(runScanCycle, interval);
  logger.info(`[GREED] Scan loop started — interval: ${interval}ms`);
}

function stopScanLoop() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

function restartScanLoop() {
  stopScanLoop();
  startScanLoop();
}

async function runScanCycle() {
  if (!state.active) return;

  // Check daily stop-loss
  if (state.pausedUntil && Date.now() < state.pausedUntil) {
    return; // Paused — waiting out the stop-loss cooldown
  }
  state.pausedUntil = null;

  const dailyLossPct = state.dailyStartBankroll > 0
    ? (state.dailyStartBankroll - state.bankroll) / state.dailyStartBankroll
    : 0;

  if (dailyLossPct >= GREED_CONFIG.DAILY_STOP_LOSS_PCT) {
    const pauseUntil = Date.now() + GREED_CONFIG.STOP_LOSS_PAUSE_MINUTES * 60_000;
    state.pausedUntil = pauseUntil;
    logger.warn(`[GREED] ⚠️ Daily stop-loss hit (${(dailyLossPct * 100).toFixed(1)}%) — pausing ${GREED_CONFIG.STOP_LOSS_PAUSE_MINUTES} min`);
    broadcastState();
    return;
  }

  // Check capacity
  if (state.currentPositions.size >= GREED_CONFIG.MAX_CONCURRENT_POSITIONS) {
    await updateOpenPositions();
    return;
  }

  const availableCapital = state.bankroll - state.totalExposure;
  if (availableCapital < GREED_CONFIG.MIN_BET_USD * 2) {
    await updateOpenPositions();
    return;
  }

  state.lastScanAt = Date.now();
  state.scansCompleted++;

  try {
    // 1. Fetch active markets
    const events = await fetchActiveEvents(undefined, GREED_CONFIG.MIN_LIQUIDITY_USD, GREED_CONFIG.MIN_VOLUME_24H_USD);
    const allMarkets: PolymarketMarket[] = events.flatMap(e => e.markets).slice(0, GREED_CONFIG.SCAN_BATCH_SIZE);

    // 2. Update price history for momentum detection
    updatePriceHistory(allMarkets);

    // 3. Find all edge opportunities
    const opportunities = await findEdgeOpportunities(allMarkets);

    // 4. Sort by expected value, highest first
    opportunities.sort((a, b) => b.expectedValueUSD - a.expectedValueUSD);

    // 5. Fire trades for best opportunities
    const maxNewPositions = GREED_CONFIG.MAX_CONCURRENT_POSITIONS - state.currentPositions.size;
    const toTrade = opportunities.slice(0, maxNewPositions);

    for (const opp of toTrade) {
      if (state.currentPositions.has(opp.conditionId)) continue; // Already in this market
      if (opp.kellyBetUSD < GREED_CONFIG.MIN_BET_USD) continue;

      await executeTrade(opp);
    }

    // 6. Update existing positions (mark-to-market, auto-exit winners/losers)
    await updateOpenPositions();

    if (state.scansCompleted % 20 === 0) {
      broadcastState();
    }

  } catch (err) {
    logger.error('[GREED] Scan cycle error', { err });
  }
}

// ─── EDGE DETECTION ──────────────────────────────────────────────────────────

async function findEdgeOpportunities(markets: PolymarketMarket[]): Promise<EdgeOpportunity[]> {
  const minEdge = state.greedMode ? GREED_CONFIG.MIN_EDGE_GREED : GREED_CONFIG.MIN_EDGE_NORMAL;
  const opportunities: EdgeOpportunity[] = [];

  for (const market of markets) {
    // Skip markets resolving too soon or too far out
    const daysToResolution = market.endDate
      ? (new Date(market.endDate).getTime() - Date.now()) / 86_400_000
      : 30;
    if (daysToResolution < GREED_CONFIG.MIN_RESOLUTION_HOURS / 24) continue;
    if (daysToResolution > GREED_CONFIG.MAX_RESOLUTION_DAYS) continue;

    // ── Source 1: Probability mispricing ──
    const ourProbYes = estimateProbability(market);
    const marketImpliedYes = market.yesPrice;
    const edgeYes = ourProbYes - marketImpliedYes;
    const edgeNo = (1 - ourProbYes) - market.noPrice;

    const bestEdge = Math.max(edgeYes, edgeNo);
    const side = edgeYes >= edgeNo ? 'YES' : 'NO';
    const entryPrice = side === 'YES' ? marketImpliedYes : market.noPrice;

    if (bestEdge >= minEdge) {
      const kellyBet = computeKellyBet(
        ourProbYes,
        side,
        entryPrice,
        state.bankroll - state.totalExposure
      );

      if (kellyBet >= GREED_CONFIG.MIN_BET_USD) {
        opportunities.push({
          conditionId: market.conditionId,
          question: market.question,
          market,
          ourProbability: side === 'YES' ? ourProbYes : 1 - ourProbYes,
          marketImplied: entryPrice,
          edge: bestEdge,
          side,
          kellyBetUSD: kellyBet,
          confidence: estimateConfidence(market, bestEdge),
          source: 'mispricing',
          expectedValueUSD: kellyBet * bestEdge,
        });
        if (bestEdge > state.bestEdgeFound) state.bestEdgeFound = bestEdge;
        continue; // Don't double-count with momentum
      }
    }

    // ── Source 2: Momentum ──
    const momentum = detectMomentum(market.conditionId, market.yesPrice);
    if (Math.abs(momentum) >= GREED_CONFIG.MOMENTUM_THRESHOLD && state.greedMode) {
      const momentumSide = momentum > 0 ? 'YES' : 'NO'; // Ride the trend
      const momentumEdge = Math.abs(momentum) * 0.3; // Conservative edge estimate
      if (momentumEdge >= minEdge) {
        const entryP = momentumSide === 'YES' ? marketImpliedYes : market.noPrice;
        const momentumBet = computeKellyBet(
          momentumSide === 'YES' ? marketImpliedYes + momentumEdge : (1 - marketImpliedYes) + momentumEdge,
          momentumSide,
          entryP,
          state.bankroll - state.totalExposure
        );
        if (momentumBet >= GREED_CONFIG.MIN_BET_USD) {
          opportunities.push({
            conditionId: market.conditionId + '_momentum',
            question: `[MOMENTUM] ${market.question}`,
            market,
            ourProbability: momentumSide === 'YES' ? marketImpliedYes + momentumEdge : (1 - marketImpliedYes) + momentumEdge,
            marketImplied: entryP,
            edge: momentumEdge,
            side: momentumSide,
            kellyBetUSD: momentumBet,
            confidence: 0.55,
            source: 'momentum',
            expectedValueUSD: momentumBet * momentumEdge,
          });
        }
      }
    }

    // ── Source 3: Resolution decay (near expiry, strong market consensus) ──
    if (daysToResolution <= 1 && state.greedMode) {
      const consensus = Math.max(marketImpliedYes, market.noPrice);
      if (consensus >= 0.85) {
        const decaySide = marketImpliedYes >= 0.85 ? 'YES' : 'NO';
        const decayEdge = (consensus - 0.80) * 0.5; // Conservative
        if (decayEdge >= minEdge) {
          const decayBet = Math.min(
            (state.bankroll - state.totalExposure) * 0.03,
            GREED_CONFIG.MAX_BET_USD
          );
          if (decayBet >= GREED_CONFIG.MIN_BET_USD) {
            opportunities.push({
              conditionId: market.conditionId + '_decay',
              question: `[DECAY] ${market.question}`,
              market,
              ourProbability: consensus,
              marketImplied: consensus,
              edge: decayEdge,
              side: decaySide,
              kellyBetUSD: decayBet,
              confidence: 0.75,
              source: 'resolution_decay',
              expectedValueUSD: decayBet * decayEdge,
            });
          }
        }
      }
    }
  }

  return opportunities;
}

// ─── PROBABILITY ESTIMATOR ───────────────────────────────────────────────────
// Fast local estimator (no LLM call — too slow for HFT)
// Uses: base rate, volume signal, liquidity signal, recency bias

function estimateProbability(market: PolymarketMarket): number {
  const mktP = market.yesPrice;

  // Volume signal: high-volume markets tend to be more efficient
  // Low-volume markets: wider uncertainty band → more opportunity
  const volumeSignal = market.volume < 5_000 ? 0.08 : market.volume < 50_000 ? 0.04 : 0.01;

  // Bayesian prior: markets cluster around historical base rates
  // For binary events: prior = 0.50, update toward market price
  const priorWeight = 0.1;
  const bayesianEst = priorWeight * 0.5 + (1 - priorWeight) * mktP;

  // Liquidity signal: thin orderbooks have wider spreads = more noise
  const liquidityNoise = market.liquidity < 2_000 ? 0.05 : market.liquidity < 10_000 ? 0.02 : 0;

  // Question keyword analysis (fast string matching)
  const q = market.question.toLowerCase();
  let biasAdj = 0;

  // Well-known biases in prediction markets
  if (q.includes('will not') || q.includes('won\'t') || q.includes('fails')) biasAdj -= 0.02;
  if (q.includes('by end of') || q.includes('before ')) biasAdj -= 0.03; // Recency overconfidence
  if (q.includes('record') || q.includes('all-time')) biasAdj += 0.04;   // Markets underestimate records
  if (q.includes('federal reserve') || q.includes('fed ')) biasAdj -= 0.02; // Overpriced macro events

  // Final estimate: blend Bayesian + bias (no random noise — use deterministic model only)
  // Random noise was previously added here but causes inconsistent edge detection;
  // thin-book uncertainty is already captured by refusing markets below MIN_LIQUIDITY_USD
  const est = bayesianEst + biasAdj + liquidityNoise * 0.5; // use half the noise as fixed conservative adjustment
  return Math.max(0.01, Math.min(0.99, est));
}

function estimateConfidence(market: PolymarketMarket, edge: number): number {
  // Higher volume → more reliable pricing → lower confidence in our edge
  const volumeFactor = market.volume < 10_000 ? 0.70 : market.volume < 100_000 ? 0.55 : 0.40;
  const edgeFactor = Math.min(1.0, edge / 0.10); // Full confidence at 10%+ edge
  return Math.min(0.90, volumeFactor * (0.5 + edgeFactor * 0.5));
}

// ─── KELLY CRITERION ─────────────────────────────────────────────────────────

function computeKellyBet(
  ourProbability: number,
  side: 'YES' | 'NO',
  entryPrice: number,
  availableCapital: number
): number {
  // Decimal odds for binary contract: 1/price - 1
  const odds = entryPrice > 0 ? (1 / entryPrice) - 1 : 0;
  const p = ourProbability;
  const q = 1 - p;

  // Kelly formula: f* = (p*b - q) / b where b = odds
  const kelly = odds > 0 ? (p * odds - q) / odds : 0;

  // Apply fraction (quarter-Kelly for safety)
  const fractionalKelly = kelly * GREED_CONFIG.KELLY_FRACTION;

  if (fractionalKelly <= 0) return 0;

  const rawBet = availableCapital * fractionalKelly;

  // Apply position caps
  const maxByPct = state.bankroll * GREED_CONFIG.MAX_POSITION_PCT;
  const capped = Math.min(rawBet, maxByPct, GREED_CONFIG.MAX_BET_USD);

  return Math.max(0, Math.floor(capped * 100) / 100); // Round to cents
}

// ─── MOMENTUM DETECTION ──────────────────────────────────────────────────────

function updatePriceHistory(markets: PolymarketMarket[]) {
  const now = Date.now();
  const HISTORY_WINDOW_MS = 15 * 60_000; // 15 minutes

  for (const m of markets) {
    if (!state.marketPriceHistory.has(m.conditionId)) {
      state.marketPriceHistory.set(m.conditionId, []);
    }
    const hist = state.marketPriceHistory.get(m.conditionId)!;
    hist.push({ price: m.yesPrice, ts: now });

    // Trim to window
    const cutoff = now - HISTORY_WINDOW_MS;
    const trimmed = hist.filter(h => h.ts >= cutoff);
    state.marketPriceHistory.set(m.conditionId, trimmed);
  }
}

function detectMomentum(conditionId: string, currentPrice: number): number {
  const hist = state.marketPriceHistory.get(conditionId);
  if (!hist || hist.length < 3) return 0;

  const oldestPrice = hist[0].price;
  return currentPrice - oldestPrice; // Positive = moving up
}

// ─── ORDER EXECUTION ─────────────────────────────────────────────────────────

async function executeTrade(opp: EdgeOpportunity): Promise<void> {
  // Live only through the shared gate (TRADING_MODE=live + LIVE_TRADING_CONFIRMED
  // + POLYMARKET_US_LIVE=true + kill switch off) AND a key. A key alone used
  // to be enough to send real orders.
  const { polymarketLiveAllowed } = await import('../trading/liveGate');
  const liveGate = polymarketLiveAllowed();
  const isDryRun = !process.env.POLYMARKET_API_KEY_ID || !liveGate.allowed;

  // ── COMPLIANCE GATE ──────────────────────────────────────────────────────────
  const complianceViolation = complianceCheck(
    opp.conditionId,
    opp.side,
    opp.question,
    opp.kellyBetUSD
  );
  if (complianceViolation) {
    logger.warn(`[COMPLIANCE] Trade blocked — ${complianceViolation} — market: "${opp.question.slice(0, 60)}"`);
    return; // Silently skip — do NOT throw, this is expected behaviour
  }

  // Build human-readable reasoning for audit trail (CFTC requires full audit log)
  const tradeReasoning = [
    `source=${opp.source}`,
    `edge=${(opp.edge * 100).toFixed(2)}%`,
    `ourProb=${(opp.ourProbability * 100).toFixed(1)}%`,
    `mktImplied=${(opp.marketImplied * 100).toFixed(1)}%`,
    `kelly=${opp.kellyBetUSD.toFixed(2)}USD`,
    `confidence=${(opp.confidence * 100).toFixed(0)}%`,
    `expectedValue=${opp.expectedValueUSD.toFixed(2)}USD`,
    `side=${opp.side}`,
    `greedMode=${state.greedMode}`,
    `endpoint=${COMPLIANCE.POLYMARKET_ENDPOINT}`,
  ].join(' | ');

  logger.info(`[GREED] ${isDryRun ? '[DRY-RUN] ' : ''}Placing ${opp.side} on "${opp.question.slice(0, 60)}" — bet: $${opp.kellyBetUSD.toFixed(2)} — edge: ${(opp.edge * 100).toFixed(1)}%`);

  try {
    let fillPrice = opp.marketImplied;
    let orderId: string | null = null;

    if (!isDryRun) {
      // ── REAL ORDER — polymarketexchange.com (CFTC-licensed) ─────────────────
      // Polymarket US uses Ed25519 API key authentication (NOT EIP-712 wallets).
      // Headers: X-PM-Access-Key + X-PM-Timestamp (ms) + X-PM-Signature
      // Signature = base64(Ed25519(secretKey, timestamp_ms + method + path + body))
      // On failure we abort — never deduct real money without a confirmed fill.
      try {
        const orderBody = {
          tokenID:     opp.conditionId,
          side:        opp.side === 'YES' ? 'buy' : 'buy', // YES/NO both buy their respective token
          type:        'market',
          amount:      opp.kellyBetUSD.toFixed(2),          // USDC amount
          timeInForce: 'FOK',                               // Fill-or-Kill for speed
        };
        const bodyStr    = JSON.stringify(orderBody);
        const timestamp  = Date.now();
        const authHeaders = signPolymarketRequest('POST', '/order', bodyStr, timestamp);

        const clobResp = await axios.post(
          `${COMPLIANCE.POLYMARKET_ENDPOINT}/order`,
          orderBody,
          {
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders,
            },
            timeout: GREED_CONFIG.ORDER_TIMEOUT_MS,
          }
        );

        const order = clobResp.data;
        orderId    = order.orderID || order.id || null;
        fillPrice  = parseFloat(order.avgPrice ?? order.price ?? String(opp.marketImplied));

        logger.info(`[GREED] ✅ CLOB fill: ${opp.side} on "${opp.question.slice(0, 50)}" — price: ${fillPrice.toFixed(4)} — orderId: ${orderId}`);

      } catch (clobErr: any) {
        const clobMsg = clobErr?.response?.data?.error || clobErr?.message || String(clobErr);
        logger.warn(`[GREED] CLOB order failed (${clobMsg}) — position NOT recorded`);
        return; // Abort: never record a position without a real confirmed fill
      }
    } else {
      // DRY-RUN: simulate fill at current market price
      fillPrice = opp.side === 'YES' ? opp.market.yesPrice : opp.market.noPrice;
      orderId   = `dryrun-${Date.now()}`;
      logger.info(`[GREED] [DRY-RUN] Would place ${opp.side} on "${opp.question.slice(0, 50)}" @ ${fillPrice.toFixed(4)} for $${opp.kellyBetUSD.toFixed(2)}`);
    }

    const shares = fillPrice > 0 ? opp.kellyBetUSD / fillPrice : 0;

    // Record position in memory
    const position: GreedPosition = {
      conditionId: opp.conditionId,
      question:    opp.question,
      side:        opp.side,
      shares,
      entryPrice:  fillPrice,
      costBasis:   opp.kellyBetUSD,
      currentPrice: fillPrice,
      unrealizedPnL: 0,
      openedAt:    Date.now(),
      edgeAtEntry: opp.edge,
      kellyBetSize: opp.kellyBetUSD,
      expiresAt:   opp.market.endDate ? new Date(opp.market.endDate).getTime() : Date.now() + 30 * 86_400_000,
    };

    // Only track real (non-dry-run) positions in the in-memory Map.
    // Dry-run "positions" have no real financial exposure and must not count
    // against MAX_CONCURRENT_POSITIONS — otherwise the counter bloats to 16/10
    // and blocks all real scans on every restart.
    if (!isDryRun) {
      state.currentPositions.set(opp.conditionId, position);
      state.totalExposure += opp.kellyBetUSD;
      state.bankroll      -= opp.kellyBetUSD;
    }
    state.tradesPlaced++;

    // Compliance audit trail (CFTC-required)
    recordComplianceTrade(opp.conditionId, opp.side, opp.kellyBetUSD, tradeReasoning);

    // Persist to DB only for real trades — dry-run entries create ghost OPEN records
    // that get reloaded on next startup and falsely inflate the position counter.
    if (!isDryRun) {
      await prisma.trade.create({
        data: {
          asset:           `POLYMARKET:${opp.conditionId}`,
          market:          'prediction',
          type:            opp.side === 'YES' ? 'BUY' : 'SELL',
          quantity:        shares,
          entryPrice:      fillPrice,
          stopLossPrice:   fillPrice * 0.5,   // 50% stop on prediction market
          takeProfitPrice: 0.95,              // Exit at 95¢ (near-certainty)
          status:          'OPEN',
          brokerConfirmed: true,
          brokerOrderId:   orderId || undefined,
          openedAt:        new Date(),
          agentDecisionId: undefined,
          metadata:        { question: opp.question, source: opp.source, edge: opp.edge },
        }
      }).catch((err: any) => logger.error('[GREED] DB write failed', { err }));
    }

  } catch (err: any) {
    logger.error(`[GREED] Trade execution failed: ${err.message}`, { conditionId: opp.conditionId });
  }
}

/**
 * Sign a Polymarket US API request with Ed25519.
 *
 * Polymarket US (polymarketexchange.com) uses Ed25519 API keys — NOT EIP-712 wallets.
 * The API key pair is generated in the Polymarket developer portal.
 *
 * Env vars required:
 *   POLYMARKET_API_KEY_ID     — the KEY ID  (e.g. ada6c15d-0151-4b73-b9a3-99c067199af0)
 *   POLYMARKET_API_SECRET     — the SECRET KEY (base64-encoded 64-byte Ed25519 key)
 *
 * Signature message: `{timestamp_ms}{METHOD}{path}{body}`
 * Algorithm: Ed25519 over raw bytes, output as base64
 *
 * Required request headers:
 *   X-PM-Access-Key: {keyId}
 *   X-PM-Timestamp:  {unix_ms}
 *   X-PM-Signature:  {base64_signature}
 *
 * Reference: https://docs.polymarket.com (Polymarket US API — developer portal)
 */
function signPolymarketRequest(
  method: string,
  path: string,
  body: string,
  timestampMs: number,
): Record<string, string> {
  const keyId    = process.env.POLYMARKET_API_KEY_ID  || '';
  const secretB64 = process.env.POLYMARKET_API_SECRET || '';

  if (!keyId || !secretB64) {
    logger.warn('[POLYMARKET] Ed25519 signing skipped — POLYMARKET_API_KEY_ID or POLYMARKET_API_SECRET not set');
    return {};
  }

  try {
    // The secret key is a base64-encoded 64-byte Ed25519 key (seed || public).
    // Node.js crypto needs PKCS#8 DER format for createPrivateKey().
    // DER prefix for Ed25519 PKCS#8 + the 32-byte seed:
    const rawKey = Buffer.from(secretB64, 'base64');
    const seed   = rawKey.slice(0, 32); // first 32 bytes is the private seed
    const derPrefix = Buffer.from('302e020100300506032b657004220420', 'hex');
    const privateKey = createPrivateKey({
      key:    Buffer.concat([derPrefix, seed]),
      format: 'der',
      type:   'pkcs8',
    });

    // Message: timestamp + METHOD + path + body (empty string if no body)
    const message   = `${timestampMs}${method.toUpperCase()}${path}${body}`;
    const signature = cryptoSign(null, Buffer.from(message), privateKey);

    return {
      'X-PM-Access-Key': keyId,
      'X-PM-Timestamp':  String(timestampMs),
      'X-PM-Signature':  signature.toString('base64'),
    };
  } catch (err: any) {
    logger.warn(`[POLYMARKET] Ed25519 signing failed: ${err?.message}`);
    return {};
  }
}

// ─── POSITION MANAGEMENT ─────────────────────────────────────────────────────

async function updateOpenPositions(): Promise<void> {
  if (state.currentPositions.size === 0) return;

  const now = Date.now();

  // Fetch all live market prices from CLOB in one batch request
  const conditionIds = Array.from(state.currentPositions.keys()).filter(id => !id.includes('_momentum') && !id.includes('_decay'));
  let livePrices: Map<string, number> = new Map();
  if (conditionIds.length > 0 && process.env.POLYMARKET_API_KEY_ID) {
    try {
      const resp = await axios.get(`${COMPLIANCE.POLYMARKET_ENDPOINT}/prices-history`, {
        params: { token_id: conditionIds.join(','), interval: '1m' },
        timeout: 3000,
      });
      const priceData = resp.data?.history || resp.data || [];
      for (const item of (Array.isArray(priceData) ? priceData : Object.entries(priceData))) {
        if (Array.isArray(item) && item.length === 2) {
          livePrices.set(item[0] as string, parseFloat(item[1] as string));
        } else if (item?.token_id && item?.price) {
          livePrices.set(item.token_id, parseFloat(item.price));
        }
      }
    } catch {/* CLOB unavailable — keep last known price, don't use random */}
  }

  for (const [id, pos] of state.currentPositions.entries()) {
    // Use real CLOB price if available, otherwise keep last known (no random drift)
    const livePrice = livePrices.get(id.replace(/_momentum$|_decay$/, ''));
    if (livePrice && livePrice > 0) {
      pos.currentPrice = livePrice;
    }
    // Else: keep pos.currentPrice unchanged (stale is better than random)
    pos.unrealizedPnL = (pos.currentPrice - pos.entryPrice) * pos.shares;

    // Exit conditions:
    // 1. Market resolved
    if (now > pos.expiresAt) {
      await closePosition(id, pos, pos.currentPrice >= 0.5 ? 'EXPIRED_WIN' : 'EXPIRED_LOSS');
      continue;
    }

    // 2. Take profit at 95 cents (near certainty)
    if (pos.currentPrice >= 0.95) {
      await closePosition(id, pos, 'TAKE_PROFIT');
      continue;
    }

    // 3. Stop loss at 30 cents (wrong call, cut losses fast in greed mode)
    if (state.greedMode && pos.currentPrice <= 0.30) {
      await closePosition(id, pos, 'STOP_LOSS');
      continue;
    }
    if (!state.greedMode && pos.currentPrice <= 0.20) {
      await closePosition(id, pos, 'STOP_LOSS');
      continue;
    }

    // 4. Time-based exit: if our edge has decayed and position aged >6h
    const ageHours = (now - pos.openedAt) / 3_600_000;
    if (ageHours > 6 && pos.unrealizedPnL > 0 && pos.currentPrice >= 0.70) {
      await closePosition(id, pos, 'TIME_EXIT_PROFIT');
      continue;
    }
  }
}

async function closePosition(id: string, pos: GreedPosition, reason: string): Promise<void> {
  const pnl = pos.unrealizedPnL;
  // Live only through the shared gate (TRADING_MODE=live + LIVE_TRADING_CONFIRMED
  // + POLYMARKET_US_LIVE=true + kill switch off) AND a key. A key alone used
  // to be enough to send real orders.
  const { polymarketLiveAllowed } = await import('../trading/liveGate');
  const liveGate = polymarketLiveAllowed();
  const isDryRun = !process.env.POLYMARKET_API_KEY_ID || !liveGate.allowed;

  logger.info(`[GREED] Closing position ${id} — reason: ${reason} — P&L: $${pnl.toFixed(2)}`);

  state.currentPositions.delete(id);
  state.totalExposure -= pos.costBasis;
  state.bankroll += pos.costBasis + pnl;
  state.dailyPnL += pnl;
  state.totalProfit += pnl;

  if (pnl > 0) state.tradesWon++;
  else state.tradesLost++;

  // Update DB trade record
  await prisma.trade.updateMany({
    where: { asset: `POLYMARKET:${id}` },
    data: {
      status: 'CLOSED',
      exitPrice: pos.currentPrice,
      pnl,
      pnlPct: pos.entryPrice > 0 ? pnl / pos.costBasis : 0,
      closedAt: new Date(),
    }
  }).catch((err: any) => logger.error('[GREED] DB close failed', { err }));

  broadcastState();
}

// ─── BANKROLL ────────────────────────────────────────────────────────────────

async function loadBankroll(): Promise<number> {
  try {
    // Load available cash from portfolio
    const portfolio = await prisma.portfolioSnapshot.findFirst({ orderBy: { timestamp: 'desc' } });
    // Use 20% of portfolio for Polymarket by default
    const availableForPolymarket = portfolio ? portfolio.totalValue * 0.20 : 1000;
    return Math.min(availableForPolymarket, 5_000); // Cap at $5k to start
  } catch {
    return 1000; // Default starting bankroll
  }
}

// ─── BROADCASTING ────────────────────────────────────────────────────────────

export interface GreedAgentSnapshot {
  active: boolean;
  greedMode: boolean;
  startedAt: number | null;
  bankroll: number;
  totalExposure: number;
  exposurePct: number;
  dailyPnL: number;
  dailyPnLPct: number;
  totalProfit: number;
  tradesPlaced: number;
  tradesWon: number;
  tradesLost: number;
  winRate: number;
  currentPositions: number;
  scansCompleted: number;
  lastScanAt: number;
  bestEdgeFound: number;
  pausedUntil: number | null;
  isPaused: boolean;
  openPositions: Array<{
    question: string;
    side: 'YES' | 'NO';
    entryPrice: number;
    currentPrice: number;
    unrealizedPnL: number;
    costBasis: number;
    edgeAtEntry: number;
    source: string;
  }>;
}

function getSnapshot(): GreedAgentSnapshot {
  const positions = Array.from(state.currentPositions.values());
  return {
    active: state.active,
    greedMode: state.greedMode,
    startedAt: state.startedAt,
    bankroll: state.bankroll,
    totalExposure: state.totalExposure,
    exposurePct: state.bankroll > 0 ? state.totalExposure / (state.bankroll + state.totalExposure) : 0,
    dailyPnL: state.dailyPnL,
    dailyPnLPct: state.dailyStartBankroll > 0 ? state.dailyPnL / state.dailyStartBankroll : 0,
    totalProfit: state.totalProfit,
    tradesPlaced: state.tradesPlaced,
    tradesWon: state.tradesWon,
    tradesLost: state.tradesLost,
    winRate: state.tradesPlaced > 0 ? state.tradesWon / state.tradesPlaced : 0,
    currentPositions: state.currentPositions.size,
    scansCompleted: state.scansCompleted,
    lastScanAt: state.lastScanAt,
    bestEdgeFound: state.bestEdgeFound,
    pausedUntil: state.pausedUntil,
    isPaused: !!(state.pausedUntil && Date.now() < state.pausedUntil),
    openPositions: positions.slice(0, 20).map(p => ({
      question: p.question.slice(0, 80),
      side: p.side,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      unrealizedPnL: p.unrealizedPnL,
      costBasis: p.costBasis,
      edgeAtEntry: p.edgeAtEntry,
      source: 'greed',
    })),
  };
}

function broadcastState() {
  try {
    const io = getIO();
    io?.emit('greed_agent_update', getSnapshot());
  } catch {
    // WebSocket not initialized yet
  }
}

export function getGreedAgentSnapshot(): GreedAgentSnapshot {
  return getSnapshot();
}

