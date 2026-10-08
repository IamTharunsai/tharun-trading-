// ── POLYMARKET EDGE ENGINE (Polymarket US, paper) ────────────────────────────
// Scan → filter → estimate a calibrated fair probability → bet only when the
// edge beats fees + half-spread + POLYMARKET_MIN_EDGE → size with fractional
// Kelly under per-bet / per-event / per-category / total caps → place an
// order-book-aware PAPER order → manage exits → score every prediction
// against the real resolution (scorecard).
//
// PAPER ONLY. This engine never sends real orders: the scheduler calls it,
// fills are simulated against the public order book, and the only real-money
// order path remains polymarketUS.placePolymarketUSOrder behind
// trading/liveGate.ts. Profitability is unproven until the scorecard shows
// the model beating the market price on resolved markets.
//
// The venue is pluggable (services/predictionVenue.ts); only Polymarket US is
// implemented.
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { getPolymarketMaxOrderUsd } from '../trading/liveGate';
import * as M from '../trading/predictionMath';
import type { PredictionVenue, VenueBook, VenueMarket } from './predictionVenue';

const db = prisma as any;
const VENUE_TAG = 'polymarket_us';

// ── Config ───────────────────────────────────────────────────────────────────

const envNum = (k: string, d: number): number => {
  const raw = process.env[k];
  if (raw === undefined || raw === '') return d;
  const n = Number(String(raw).split('#')[0].trim());
  return Number.isFinite(n) ? n : d;
};

export interface EdgeConfig {
  minEdge: number;
  maxSpread: number;
  minHoursToResolution: number;
  nearResolutionHours: number;
  staleInfoHours: number;
  minOpenInterest: number;
  minVolume: number;
  minDepthUsd: number;
  minPrice: number;
  maxPrice: number;
  maxDepthPct: number;
  orderMode: 'limit' | 'taker';
  orderTtlMin: number;
  kellyMultiplier: number;
  bankrollUsd: number;
  maxBetUsd: number;
  maxBetPct: number;
  maxEventExposureUsd: number;
  maxCategoryExposureUsd: number;
  maxTotalExposureUsd: number;
  dailyLossLimitUsd: number;
  maxLlmPerScan: number;
  scanMaxMarkets: number;
  predictionTtlMin: number;
  repriceThreshold: number;
  tpBuffer: number;
  exitEdge: number;
  evidenceShift: number;
  calibrationMinSamples: number;
  weights: M.FairWeights;
}

export function readEdgeConfig(): EdgeConfig {
  const bankrollUsd = Math.max(1, envNum('POLYMARKET_BANKROLL_USD', 100));
  const total = envNum('POLYMARKET_MAX_TOTAL_EXPOSURE_USD', 0);
  return {
    minEdge: Math.max(0, envNum('POLYMARKET_MIN_EDGE', 0.05)),
    maxSpread: envNum('POLYMARKET_MAX_SPREAD', 0.05),
    minHoursToResolution: envNum('POLYMARKET_MIN_HOURS_TO_RESOLUTION', 6),
    nearResolutionHours: envNum('POLYMARKET_NEAR_RESOLUTION_HOURS', 72),
    staleInfoHours: envNum('POLYMARKET_STALE_INFO_HOURS', 24),
    minOpenInterest: envNum('POLYMARKET_MIN_OPEN_INTEREST', 1000),
    minVolume: envNum('POLYMARKET_MIN_VOLUME', 5000),
    minDepthUsd: envNum('POLYMARKET_MIN_DEPTH_USD', 100),
    minPrice: envNum('POLYMARKET_MIN_PRICE', 0.05),
    maxPrice: envNum('POLYMARKET_MAX_PRICE', 0.95),
    maxDepthPct: Math.min(1, Math.max(0.01, envNum('POLYMARKET_MAX_DEPTH_PCT', 0.2))),
    orderMode: String(process.env.POLYMARKET_ORDER_MODE || 'limit').toLowerCase() === 'taker' ? 'taker' : 'limit',
    orderTtlMin: Math.max(1, envNum('POLYMARKET_ORDER_TTL_MIN', 60)),
    kellyMultiplier: Math.min(1, Math.max(0, envNum('POLYMARKET_KELLY_FRACTION', 0.25))),
    bankrollUsd,
    maxBetUsd: getPolymarketMaxOrderUsd(),
    maxBetPct: Math.min(1, Math.max(0, envNum('POLYMARKET_MAX_BET_PCT', 0.05))),
    maxEventExposureUsd: envNum('POLYMARKET_MAX_EVENT_EXPOSURE_USD', 10),
    maxCategoryExposureUsd: envNum('POLYMARKET_MAX_CATEGORY_EXPOSURE_USD', 30),
    maxTotalExposureUsd: total > 0 ? total : bankrollUsd * 0.5,
    dailyLossLimitUsd: Math.max(0, envNum('POLYMARKET_DAILY_LOSS_LIMIT_USD', 10)),
    maxLlmPerScan: Math.max(0, envNum('POLYMARKET_MAX_LLM_PER_SCAN', 15)),
    scanMaxMarkets: Math.max(1, envNum('POLYMARKET_SCAN_MAX_MARKETS', 200)),
    predictionTtlMin: envNum('POLYMARKET_PREDICTION_TTL_MIN', 60),
    repriceThreshold: envNum('POLYMARKET_REPRICE_THRESHOLD', 0.03),
    tpBuffer: envNum('POLYMARKET_TP_BUFFER', 0.01),
    exitEdge: envNum('POLYMARKET_EXIT_EDGE', 0.02),
    evidenceShift: envNum('POLYMARKET_EVIDENCE_SHIFT', 0.1),
    calibrationMinSamples: Math.max(10, envNum('POLYMARKET_CALIBRATION_MIN_SAMPLES', 50)),
    weights: {
      ...M.DEFAULT_FAIR_WEIGHTS,
      wLlm: envNum('POLYMARKET_W_LLM', M.DEFAULT_FAIR_WEIGHTS.wLlm),
      wSentiment: envNum('POLYMARKET_W_SENTIMENT', M.DEFAULT_FAIR_WEIGHTS.wSentiment),
      wMomentum: envNum('POLYMARKET_W_MOMENTUM', M.DEFAULT_FAIR_WEIGHTS.wMomentum),
      maxDeviation: envNum('POLYMARKET_MAX_MODEL_DEVIATION', M.DEFAULT_FAIR_WEIGHTS.maxDeviation),
      staleHours: envNum('POLYMARKET_STALE_INFO_HOURS', M.DEFAULT_FAIR_WEIGHTS.staleHours),
    },
  };
}

// ── Filters ──────────────────────────────────────────────────────────────────

const hoursUntil = (iso: string | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (t - now) / 3_600_000 : null;
};

/** Cheap checks on the market listing (no extra requests). Returns a skip reason or null. */
export function preFilterMarket(m: VenueMarket, cfg: EdgeConfig, now = Date.now()): string | null {
  if (!m.open) return 'market not open';
  if (m.bestBid == null || m.bestAsk == null || !(m.bestAsk > m.bestBid)) return 'no two-sided quote';
  const spread = m.bestAsk - m.bestBid;
  if (spread > cfg.maxSpread + 1e-9) return `spread ${(spread * 100).toFixed(1)}pt > max`;
  const mid = (m.bestBid + m.bestAsk) / 2;
  if (mid < cfg.minPrice || mid > cfg.maxPrice) return 'price too close to 0/1';
  const h = hoursUntil(m.endDate, now);
  if (h != null && h < cfg.minHoursToResolution) return 'too close to resolution';
  const start = m.gameStartTime ? Date.parse(m.gameStartTime) : NaN;
  if (m.marketType !== 'futures' && Number.isFinite(start) && start <= now) return 'event already in progress';
  return null;
}

/** Liquidity checks on the full book. Returns a skip reason or null. */
export function liquidityFilter(book: VenueBook, cfg: EdgeConfig): string | null {
  if (book.state && book.state !== 'MARKET_STATE_OPEN') return `book state ${book.state}`;
  const bid = M.bestBid(book), ask = M.bestAsk(book);
  if (bid == null || ask == null || !(ask > bid)) return 'no two-sided book';
  if (ask - bid > cfg.maxSpread + 1e-9) return 'spread too wide';
  if (book.openInterest == null || book.openInterest < cfg.minOpenInterest) return 'open interest too low';
  if (book.volume == null || book.volume < cfg.minVolume) return 'volume too low';
  const within = (lv: M.BookLevel[], top: number, dir: 'buy' | 'sell') =>
    lv.filter(l => (dir === 'buy' ? l.price <= top + 0.05 : l.price >= top - 0.05)).reduce((s, l) => s + l.size * l.price, 0);
  const askUsd = within(book.asks, ask, 'buy');
  const bidUsd = within(book.bids, bid, 'sell');
  if (Math.min(askUsd, bidUsd) < cfg.minDepthUsd) return 'book too thin';
  return null;
}

// ── Exposure ─────────────────────────────────────────────────────────────────

export interface ExposureSnapshot {
  totalUsd: number;
  byEvent: Record<string, number>;
  byCategory: Record<string, number>;
  slugs: Set<string>;
  openCount: number;
}

export async function getExposureSnapshot(): Promise<ExposureSnapshot> {
  const snap: ExposureSnapshot = { totalUsd: 0, byEvent: {}, byCategory: {}, slugs: new Set(), openCount: 0 };
  const add = (usd: number, slug?: string, ev?: string, cat?: string) => {
    snap.totalUsd += usd;
    if (ev) snap.byEvent[ev] = (snap.byEvent[ev] || 0) + usd;
    if (cat) snap.byCategory[cat] = (snap.byCategory[cat] || 0) + usd;
    if (slug) snap.slugs.add(slug);
  };
  const trades: any[] = (await db.trade.findMany({ where: { asset: 'POLYMARKET', status: 'OPEN' } }).catch(() => [])) || [];
  for (const t of trades) {
    const md = (t.metadata || {}) as any;
    snap.openCount++;
    add((Number(t.entryPrice) || 0) * (Number(t.quantity) || 0), t.brokerOrderId || md.marketSlug, md.eventSlug, md.category);
  }
  // Resting paper orders reserve exposure too.
  const orders: any[] = (await db.polymarketPaperOrder.findMany({ where: { status: 'OPEN' } }).catch(() => [])) || [];
  for (const o of orders) add((Number(o.limitPrice) || 0) * (Number(o.shares) || 0), o.marketSlug, o.eventSlug || undefined, o.category || undefined);
  return snap;
}

/** Realized Polymarket P&L since 00:00 UTC (negative = loss). */
export async function polymarketDailyPnl(now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows: any[] = (await db.trade.findMany({
    where: { asset: 'POLYMARKET', status: 'CLOSED', closedAt: { gte: start } },
    select: { pnl: true },
  }).catch(() => [])) || [];
  return rows.reduce((s, r) => s + (Number(r.pnl) || 0), 0);
}

// ── Entry planning (pure) ────────────────────────────────────────────────────

export interface FairEstimate {
  fair: number;
  rawFair: number;
  evidenceWeight: number;
  llmProb: number | null;
  llmConfidence: number | null;
  headlineCount: number;
  freshestHours: number | null;
  sentimentScore: number | null;
  sentimentMentions: number;
  momentum: number | null;
  reasoning?: string;
}

export interface EntryPlan {
  side: M.Side;
  mode: 'limit' | 'taker';
  price: number;          // limit price, or expected VWAP for taker
  shares: number;
  usd: number;
  feePerShare: number;
  fairSide: number;
  netEdge: number;
  halfSpread: number;
}

export type PlanResult = { ok: true; plan: EntryPlan; edges: M.SideEdge[] } | { ok: false; reason: string; edges: M.SideEdge[] };

export function planEntry(
  m: VenueMarket, book: VenueBook, fair: FairEstimate, cfg: EdgeConfig, exposure: ExposureSnapshot,
): PlanResult {
  const bid = M.bestBid(book), ask = M.bestAsk(book);
  if (bid == null || ask == null) return { ok: false, reason: 'no two-sided book', edges: [] };
  const edges = M.computeSideEdges({ fairYes: fair.fair, bestBid: bid, bestAsk: ask, theta: m.feeCoefficient, minEdge: cfg.minEdge, mode: cfg.orderMode, tick: m.tickSize });
  const best = edges[0];
  if (!best || best.netEdge <= 0) return { ok: false, reason: 'edge below fees + half-spread + min edge', edges };

  // Size: fractional Kelly scaled by evidence, then per-bet / event / category / total caps.
  let usd = M.sizeBetUsd({
    fairSide: best.fairSide, costPerShare: best.execPrice + best.feePerShare, confidence: fair.evidenceWeight,
    bankrollUsd: cfg.bankrollUsd, kellyMultiplier: cfg.kellyMultiplier, maxBetUsd: cfg.maxBetUsd, maxBetPctOfBankroll: cfg.maxBetPct,
  });
  const room = Math.min(
    cfg.maxTotalExposureUsd - exposure.totalUsd,
    m.eventId ? cfg.maxEventExposureUsd - (exposure.byEvent[m.eventId] || 0) : Infinity,
    cfg.maxCategoryExposureUsd - (exposure.byCategory[m.category] || 0),
  );
  usd = Math.min(usd, room);
  if (!(usd >= 1)) return { ok: false, reason: room < 1 ? 'exposure cap reached (event/category/total)' : 'Kelly size below $1', edges };

  let shares = Math.floor(usd / best.execPrice);
  if (shares < Math.max(1, m.minQty)) return { ok: false, reason: 'size below venue minimum', edges };

  // Depth: only count liquidity at prices that still clear the edge threshold.
  const levels = M.buyLevels(book, best.side);
  const worstOk = best.fairSide - best.halfSpread - cfg.minEdge - M.takerFeePerShare(m.feeCoefficient, best.execPrice);
  const usable = M.depthAtOrBetter(levels, worstOk, 'buy');
  if (shares > cfg.maxDepthPct * usable) {
    return { ok: false, reason: `size ${shares} > ${(cfg.maxDepthPct * 100).toFixed(0)}% of usable depth (${usable.toFixed(0)})`, edges };
  }

  let price = best.execPrice;
  let feePerShare = best.feePerShare;
  if (cfg.orderMode === 'taker') {
    const fill = M.walkLevels(levels, shares, 'buy');
    if (!fill.fullyFilled) return { ok: false, reason: 'book cannot fill the size', edges };
    price = fill.vwap;
    feePerShare = M.takerFeePerShare(m.feeCoefficient, fill.vwap);
    const netAfterSlippage = best.fairSide - price - feePerShare - best.halfSpread - cfg.minEdge;
    if (netAfterSlippage <= 0) return { ok: false, reason: 'edge gone after slippage', edges };
  }
  usd = Math.round(shares * price * 100) / 100;
  return {
    ok: true,
    edges,
    plan: { side: best.side, mode: cfg.orderMode, price, shares, usd, feePerShare, fairSide: best.fairSide, netEdge: best.fairSide - price - feePerShare - best.halfSpread - cfg.minEdge, halfSpread: best.halfSpread },
  };
}

// ── Calibration (from our own resolved predictions) ─────────────────────────

let calibrationCache: { at: number; params: M.PlattParams | null } | null = null;

export async function loadCalibration(cfg: EdgeConfig): Promise<M.PlattParams | null> {
  if (calibrationCache && Date.now() - calibrationCache.at < 3_600_000) return calibrationCache.params;
  let params: M.PlattParams | null = null;
  try {
    const rows: any[] = (await db.polymarketPrediction.findMany({
      where: { outcome: { not: null }, llmProb: { not: null } },
      select: { rawFair: true, outcome: true },
      take: 5000,
      orderBy: { createdAt: 'desc' },
    })) || [];
    if (rows.length >= cfg.calibrationMinSamples) {
      params = M.fitPlatt(rows.map(r => ({ p: Number(r.rawFair), outcome: Number(r.outcome) })));
    }
  } catch { params = null; }
  calibrationCache = { at: Date.now(), params };
  return params;
}

export function __resetCalibrationCache() { calibrationCache = null; }

// ── Fair-probability estimate (I/O) ──────────────────────────────────────────

export async function estimateFair(
  venue: PredictionVenue, m: VenueMarket, book: VenueBook, cfg: EdgeConfig, calibration: M.PlattParams | null,
): Promise<FairEstimate> {
  const bid = M.bestBid(book)!, ask = M.bestAsk(book)!;
  const mid = (bid + ask) / 2;

  let qs = { score: 0, mentions: 0, freshestHours: null as number | null, headlines: [] as string[] };
  try {
    const { getQuerySentiment } = await import('./sentimentService');
    qs = await getQuerySentiment(m.question, 6);
  } catch { /* sentiment is optional */ }

  let llm: Awaited<ReturnType<typeof import('./polymarket').estimateProbabilityWithLLM>> = null;
  try {
    const { estimateProbabilityWithLLM } = await import('./polymarket');
    llm = await estimateProbabilityWithLLM({
      question: m.question, description: m.description, endDate: m.endDate, yesPrice: mid,
      volume: book.volume, liquidity: book.openInterest, headlines: qs.headlines,
    });
  } catch { llm = null; }

  let momentum: number | null = null;
  try { momentum = M.momentumFromHistory(await venue.getPriceHistory(m.id), 86_400); } catch { momentum = null; }

  const inputs: M.FairInputs = {
    marketMid: mid,
    llmProb: llm?.pYes ?? null,
    llmConfidence: llm?.confidence ?? null,
    headlineCount: qs.headlines.length,
    freshestHeadlineHours: qs.freshestHours,
    sentimentScore: qs.mentions ? qs.score : null,
    sentimentMentions: qs.mentions,
    momentum,
  };
  const r = M.blendFairProbability(inputs, cfg.weights, calibration);
  return {
    fair: r.fair, rawFair: r.rawFair, evidenceWeight: r.evidenceWeight,
    llmProb: inputs.llmProb ?? null, llmConfidence: inputs.llmConfidence ?? null,
    headlineCount: inputs.headlineCount ?? 0, freshestHours: qs.freshestHours,
    sentimentScore: inputs.sentimentScore ?? null, sentimentMentions: qs.mentions,
    momentum, reasoning: llm?.reasoning,
  };
}

// ── Paper execution ──────────────────────────────────────────────────────────

async function openPaperTrade(args: {
  m: { id: string; eventId?: string; category: string; question: string; feeCoefficient: number };
  side: M.Side; price: number; shares: number; feePerShare: number; predictionId?: string | null;
  fairSide?: number; mode: 'limit' | 'taker';
}): Promise<string | null> {
  const fee = Math.round(args.feePerShare * args.shares * 100) / 100;
  const t = await db.trade.create({
    data: {
      asset: 'POLYMARKET',
      market: 'prediction',
      type: args.side === 'YES' ? 'BUY' : 'SELL',
      entryPrice: args.price,
      quantity: args.shares,
      fees: fee,
      status: 'OPEN',
      stopLossPrice: 0,
      takeProfitPrice: 1, // share-based accounting marker (see polymarket.ts)
      brokerOrderId: args.m.id,
      brokerConfirmed: false,
      metadata: {
        venue: VENUE_TAG, paper: true, marketSlug: args.m.id, eventSlug: args.m.eventId ?? null,
        category: args.m.category, question: args.m.question, side: args.side, orderMode: args.mode,
        predictionId: args.predictionId ?? null, fairAtEntry: args.fairSide ?? null,
        entryFee: fee, feeCoefficient: args.m.feeCoefficient,
      },
    },
  }).catch((err: any) => { logger.warn(`[PM-EDGE] trade create failed: ${err?.message}`); return null; });
  return t?.id ?? null;
}

export async function placePaperEntry(
  m: VenueMarket, plan: EntryPlan, cfg: EdgeConfig, predictionId: string | null,
): Promise<{ placed: boolean; kind?: 'order' | 'trade'; id?: string | null; reason?: string }> {
  // Same de-dupe / POLYMARKET_MAX_OPEN / total USD cap as every other Polymarket bet.
  const { checkPolymarketExposure } = await import('./polymarket');
  const ex = await checkPolymarketExposure(m.id, plan.usd);
  if (!ex.ok) return { placed: false, reason: ex.reason };
  const resting = await db.polymarketPaperOrder.findFirst({ where: { marketSlug: m.id, status: 'OPEN' } }).catch(() => null);
  if (resting) return { placed: false, reason: 'paper order already resting on this market' };

  if (plan.mode === 'taker') {
    const id = await openPaperTrade({ m, side: plan.side, price: plan.price, shares: plan.shares, feePerShare: plan.feePerShare, predictionId, fairSide: plan.fairSide, mode: 'taker' });
    return id ? { placed: true, kind: 'trade', id } : { placed: false, reason: 'trade write failed' };
  }
  const order = await db.polymarketPaperOrder.create({
    data: {
      venue: VENUE_TAG, marketSlug: m.id, eventSlug: m.eventId ?? null, category: m.category, question: m.question.slice(0, 500),
      side: plan.side, limitPrice: plan.price, shares: plan.shares, status: 'OPEN', predictionId,
      fairAtOrder: plan.fairSide, expiresAt: new Date(Date.now() + cfg.orderTtlMin * 60_000),
    },
  }).catch((err: any) => { logger.warn(`[PM-EDGE] paper order create failed: ${err?.message}`); return null; });
  return order ? { placed: true, kind: 'order', id: order.id } : { placed: false, reason: 'order write failed' };
}

/** A resting buy at `limit` fills only if the market trades THROUGH it (strictly better price). */
export function limitWouldFill(order: { side: M.Side; limitPrice: number; createdAt?: Date | string }, book: VenueBook, tick = 0.001): boolean {
  const top = M.buyLevels(book, order.side)[0];
  if (top && top.price <= order.limitPrice - tick + 1e-9) return true;
  if (book.lastTrade != null && book.lastTradeAt != null && order.createdAt) {
    const created = new Date(order.createdAt).getTime();
    const lastSide = order.side === 'YES' ? book.lastTrade : 1 - book.lastTrade;
    if (book.lastTradeAt > created && lastSide < order.limitPrice - 1e-9) return true;
  }
  return false;
}

async function latestPrediction(slug: string): Promise<any | null> {
  return db.polymarketPrediction.findFirst({ where: { marketSlug: slug }, orderBy: { createdAt: 'desc' } }).catch(() => null);
}

/** Fill, expire or cancel resting paper orders. */
export async function processPaperOrders(venue: PredictionVenue, cfg = readEdgeConfig()): Promise<{ filled: number; expired: number; canceled: number }> {
  const res = { filled: 0, expired: 0, canceled: 0 };
  const orders: any[] = (await db.polymarketPaperOrder.findMany({ where: { status: 'OPEN' } }).catch(() => [])) || [];
  for (const o of orders) {
    const close = (status: string, reason: string) =>
      db.polymarketPaperOrder.update({ where: { id: o.id }, data: { status, cancelReason: reason } }).catch(() => {});
    if (new Date(o.expiresAt).getTime() <= Date.now()) { await close('EXPIRED', 'ttl'); res.expired++; continue; }

    // Cancel when the latest estimate no longer supports the price.
    const pred = await latestPrediction(o.marketSlug);
    if (pred && Number.isFinite(Number(pred.fairProb))) {
      const fairSide = o.side === 'YES' ? Number(pred.fairProb) : 1 - Number(pred.fairProb);
      if (fairSide - o.limitPrice < cfg.minEdge) { await close('CANCELED', 'edge gone'); res.canceled++; continue; }
    }
    const book = await venue.getBook(o.marketSlug);
    if (!book) continue;
    if (book.state && book.state !== 'MARKET_STATE_OPEN') { await close('CANCELED', `market ${book.state}`); res.canceled++; continue; }
    if (!limitWouldFill(o, book)) continue;

    const others: any[] = (await db.trade.findMany({ where: { asset: 'POLYMARKET', status: 'OPEN', brokerOrderId: o.marketSlug } }).catch(() => [])) || [];
    if (others.length) { await close('CANCELED', 'already holding this market'); res.canceled++; continue; }
    const tradeId = await openPaperTrade({
      m: { id: o.marketSlug, eventId: o.eventSlug || undefined, category: o.category || 'general', question: o.question || o.marketSlug, feeCoefficient: 0 },
      side: o.side, price: o.limitPrice, shares: o.shares, feePerShare: 0, predictionId: o.predictionId, fairSide: o.fairAtOrder, mode: 'limit',
    });
    if (!tradeId) continue;
    await db.polymarketPaperOrder.update({ where: { id: o.id }, data: { status: 'FILLED', filledAt: new Date(), fillPrice: o.limitPrice, tradeId } }).catch(() => {});
    if (o.predictionId) await db.polymarketPrediction.update({ where: { id: o.predictionId }, data: { tradeId } }).catch(() => {});
    logger.info(`📄 [PM-EDGE] paper limit FILLED: ${o.side} ${o.shares} @ ${o.limitPrice} on ${o.marketSlug}`);
    res.filled++;
  }
  return res;
}

// ── Exits ────────────────────────────────────────────────────────────────────

export type ExitDecision = { exit: false } | { exit: true; reason: 'tp_converged' | 'edge_flipped' | 'evidence_changed' };

/** Pure exit rules for one position. */
export function decideExit(args: {
  side: M.Side; entryPrice: number; exitPrice: number; fairNowYes: number | null; fairAtEntrySide: number | null; cfg: EdgeConfig;
}): ExitDecision {
  if (args.fairNowYes == null) return { exit: false };
  const fairSide = args.side === 'YES' ? args.fairNowYes : 1 - args.fairNowYes;
  // Thesis checks first, so a collapse in fair value is labelled as such.
  if (fairSide < args.entryPrice - args.cfg.exitEdge) return { exit: true, reason: 'edge_flipped' };
  if (args.fairAtEntrySide != null && fairSide < args.fairAtEntrySide - args.cfg.evidenceShift) return { exit: true, reason: 'evidence_changed' };
  if (args.exitPrice >= fairSide - args.cfg.tpBuffer) return { exit: true, reason: 'tp_converged' };
  return { exit: false };
}

async function closeTrade(t: any, exitPrice: number, exitFee: number, reason: string) {
  const qty = Number(t.quantity) || 0;
  const entryFee = Number(t.fees) || 0;
  const fees = Math.round((entryFee + exitFee) * 100) / 100;
  const pnl = (exitPrice - Number(t.entryPrice)) * qty - fees;
  const cost = Number(t.entryPrice) * qty;
  await db.trade.update({
    where: { id: t.id },
    data: { exitPrice, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : 0, fees, status: 'CLOSED', closedAt: new Date(), exitReason: reason },
  });
  logger.info(`🎯 [PM-EDGE] closed ${t.brokerOrderId} (${reason}) @ ${exitPrice.toFixed(3)} | P&L after fees $${pnl.toFixed(2)}`);
}

/** Resolution first, then take-profit / edge-flip / evidence-change exits (paper). */
export async function managePolymarketPositions(venue: PredictionVenue, cfg = readEdgeConfig()): Promise<{ resolved: number; exited: number }> {
  const out = { resolved: 0, exited: 0 };
  const open: any[] = (await db.trade.findMany({ where: { asset: 'POLYMARKET', status: 'OPEN' } }).catch(() => [])) || [];
  for (const t of open) {
    const md = (t.metadata || {}) as any;
    if (md.venue !== VENUE_TAG || !md.paper) continue; // only positions this engine opened
    const slug = t.brokerOrderId || md.marketSlug;
    const side: M.Side = t.type === 'BUY' ? 'YES' : 'NO';

    const settle = await venue.getSettlement(slug);
    if (settle != null) {
      await closeTrade(t, side === 'YES' ? settle : 1 - settle, 0, 'market_resolved');
      out.resolved++;
      continue;
    }
    const book = await venue.getBook(slug);
    if (!book || (book.state && book.state !== 'MARKET_STATE_OPEN')) continue;
    const fill = M.walkLevels(M.sellLevels(book, side), Number(t.quantity) || 0, 'sell');
    if (!fill.fullyFilled) continue; // can't exit the full size at a known price — hold
    const theta = Number(md.feeCoefficient) || Number(process.env.POLYMARKET_US_TAKER_FEE_THETA || 0.0695);
    const exitFeePerShare = M.takerFeePerShare(theta, fill.vwap);
    const pred = await latestPrediction(slug);
    const d = decideExit({
      side, entryPrice: Number(t.entryPrice), exitPrice: fill.vwap - exitFeePerShare,
      fairNowYes: pred ? Number(pred.fairProb) : null,
      fairAtEntrySide: md.fairAtEntry != null ? Number(md.fairAtEntry) : null, cfg,
    });
    if (!d.exit) continue;
    await closeTrade(t, fill.vwap, Math.round(exitFeePerShare * fill.filledShares * 100) / 100, d.reason);
    out.exited++;
  }
  return out;
}

// ── Scan ─────────────────────────────────────────────────────────────────────

let edgeScanRunning = false;
export function isEdgeScanRunning() { return edgeScanRunning; }

export interface EdgeScanSummary {
  listed: number;
  candidates: number;
  estimated: number;
  reused: number;
  entries: number;
  entriesBlocked?: string;
  skips: Record<string, number>;
}

async function getVenue(v?: PredictionVenue): Promise<PredictionVenue> {
  if (v) return v;
  return (await import('./polymarketUS')).polymarketUSVenue;
}

export async function runPolymarketEdgeScan(opts: { venue?: PredictionVenue } = {}): Promise<EdgeScanSummary> {
  const summary: EdgeScanSummary = { listed: 0, candidates: 0, estimated: 0, reused: 0, entries: 0, skips: {} };
  if (edgeScanRunning) { summary.entriesBlocked = 'scan already running'; return summary; }
  edgeScanRunning = true;
  try {
    const venue = await getVenue(opts.venue);
    const cfg = readEdgeConfig();
    const skip = (r: string) => { const k = r.replace(/[\d.]+/g, '#'); summary.skips[k] = (summary.skips[k] || 0) + 1; };

    try {
      const { isKillSwitchActive } = await import('../agents/orchestrator');
      if (isKillSwitchActive()) summary.entriesBlocked = 'kill switch active';
    } catch { /* orchestrator unavailable in some contexts */ }
    const dayPnl = await polymarketDailyPnl();
    if (cfg.dailyLossLimitUsd > 0 && dayPnl <= -cfg.dailyLossLimitUsd) {
      summary.entriesBlocked = `daily loss stop hit ($${dayPnl.toFixed(2)} ≤ -$${cfg.dailyLossLimitUsd})`;
    }

    const calibration = await loadCalibration(cfg);
    const markets = await venue.listMarkets(cfg.scanMaxMarkets);
    summary.listed = markets.length;
    let exposure = await getExposureSnapshot();

    // Held markets are re-estimated first (exits need a fresh fair value),
    // then the tightest-spread new candidates.
    const now = Date.now();
    const held = markets.filter(m => exposure.slugs.has(m.id));
    const fresh = markets
      .filter(m => !exposure.slugs.has(m.id))
      .filter(m => { const r = preFilterMarket(m, cfg, now); if (r) skip(r); return !r; })
      .sort((a, b) => ((a.bestAsk! - a.bestBid!) - (b.bestAsk! - b.bestBid!)));
    const queue = [...held, ...fresh];
    summary.candidates = queue.length;
    const displayRows: any[] = [];

    let llmCalls = 0;
    for (const m of queue) {
      const isHeld = exposure.slugs.has(m.id);
      const book = await venue.getBook(m.id);
      if (!book) { skip('no book'); continue; }
      const liq = liquidityFilter(book, cfg);
      if (liq && !isHeld) { skip(liq); continue; }
      const bid = M.bestBid(book), ask = M.bestAsk(book);
      if (bid == null || ask == null) { skip('no two-sided book'); continue; }
      const mid = (bid + ask) / 2;

      // Re-use a recent estimate unless the price moved (saves LLM calls).
      const recent = await latestPrediction(m.id);
      const recentOk = recent && cfg.predictionTtlMin > 0
        && now - new Date(recent.createdAt).getTime() < cfg.predictionTtlMin * 60_000
        && Math.abs(Number(recent.marketMid) - mid) < cfg.repriceThreshold;
      if (recentOk && (isHeld || recent.decision === 'SKIP')) { summary.reused++; continue; }

      if (!recentOk && llmCalls >= cfg.maxLlmPerScan) { skip('LLM budget for this scan used'); continue; }
      let fair: FairEstimate;
      if (recentOk) {
        summary.reused++;
        fair = {
          fair: Number(recent.fairProb), rawFair: Number(recent.rawFair), evidenceWeight: Number(recent.evidenceWeight),
          llmProb: recent.llmProb, llmConfidence: recent.llmConfidence, headlineCount: recent.headlineCount || 0,
          freshestHours: null, sentimentScore: recent.sentimentScore, sentimentMentions: recent.sentimentMentions || 0, momentum: recent.momentum,
        };
      } else {
        llmCalls++;
        fair = await estimateFair(venue, m, book, cfg, calibration);
        summary.estimated++;
      }

      let decision: 'YES' | 'NO' | 'SKIP' = 'SKIP';
      let skipReason: string | null = null;
      let plan: EntryPlan | null = null;
      let edges: M.SideEdge[] = [];
      const hLeft = hoursUntil(m.endDate, now);
      if (isHeld) skipReason = 'already holding (re-estimated for exits)';
      else if (fair.llmProb == null) skipReason = 'no LLM estimate (no edge without evidence)';
      else if (!recentOk && hLeft != null && hLeft < cfg.nearResolutionHours && (fair.freshestHours == null || fair.freshestHours > cfg.staleInfoHours)) {
        skipReason = 'near resolution with stale/no news';
      } else {
        const r = planEntry(m, book, fair, cfg, exposure);
        edges = r.edges;
        if (r.ok) { plan = r.plan; decision = plan.side; } else skipReason = r.reason;
      }
      if (plan && summary.entriesBlocked) { skipReason = summary.entriesBlocked; decision = 'SKIP'; plan = null; }

      const bestEdge = plan ? null : edges[0];
      let predictionId: string | null = recentOk ? recent.id : null;
      if (!recentOk) {
        const row = await db.polymarketPrediction.create({
          data: {
            venue: venue.id, marketSlug: m.id, eventSlug: m.eventId ?? null, category: m.category, question: m.question.slice(0, 500),
            endDate: m.endDate ? new Date(m.endDate) : null, marketMid: mid, bestBid: bid, bestAsk: ask,
            llmProb: fair.llmProb, llmConfidence: fair.llmConfidence, headlineCount: fair.headlineCount,
            sentimentScore: fair.sentimentScore, sentimentMentions: fair.sentimentMentions, momentum: fair.momentum,
            rawFair: fair.rawFair, fairProb: fair.fair, evidenceWeight: fair.evidenceWeight,
            decision, skipReason, side: plan?.side ?? bestEdge?.side ?? null,
            netEdge: plan?.netEdge ?? bestEdge?.netEdge ?? null, execPrice: plan?.price ?? bestEdge?.execPrice ?? null,
            feePerShare: plan?.feePerShare ?? bestEdge?.feePerShare ?? null,
          },
        }).catch((err: any) => { logger.debug(`[PM-EDGE] prediction write failed: ${err?.message}`); return null; });
        predictionId = row?.id ?? null;
      }
      displayRows.push({ m, mid, fair, decision, netEdge: plan?.netEdge ?? bestEdge?.netEdge ?? 0, reasoning: fair.reasoning, hLeft });

      if (!plan) { if (skipReason) skip(skipReason); continue; }
      const placed = await placePaperEntry(m, plan, cfg, predictionId);
      if (!placed.placed) { skip(placed.reason || 'placement refused'); continue; }
      summary.entries++;
      if (placed.kind === 'trade' && predictionId) await db.polymarketPrediction.update({ where: { id: predictionId }, data: { tradeId: placed.id } }).catch(() => {});
      logger.info(`📄 [PM-EDGE] PAPER ${plan.mode} ${plan.side} ${plan.shares} @ ${plan.price.toFixed(3)} ($${plan.usd}) on "${m.question.slice(0, 60)}" | fair ${(plan.fairSide * 100).toFixed(1)}% net edge ${(plan.netEdge * 100).toFixed(1)}pt`);
      exposure = await getExposureSnapshot();
    }

    await writeDisplayRows(displayRows);
    logger.info(`🎯 [PM-EDGE] scan: ${summary.listed} listed, ${summary.candidates} candidates, ${summary.estimated} estimated, ${summary.reused} reused, ${summary.entries} paper entries${summary.entriesBlocked ? ` (entries blocked: ${summary.entriesBlocked})` : ''}`);
    return summary;
  } finally {
    edgeScanRunning = false;
  }
}

/** Keep the existing Predictions UI populated (it reads the Prediction table). */
async function writeDisplayRows(rows: any[]) {
  if (!rows.length) return;
  try {
    await db.prediction.deleteMany({ where: { asset: 'POLYMARKET', resolvedAt: null } });
    for (const r of rows) {
      await db.prediction.create({
        data: {
          asset: 'POLYMARKET', market: 'polymarket', title: r.m.question.slice(0, 300), category: r.m.category || 'prediction',
          direction: r.decision === 'YES' ? 'UP' : r.decision === 'NO' ? 'DOWN' : 'NEUTRAL',
          confidence: Math.round((r.fair.evidenceWeight || 0) * 100), yesPrice: r.mid, noPrice: 1 - r.mid,
          edge: r.netEdge, recommendedBet: r.decision, expectedValue: 0, kellyFraction: 0,
          targetPrice: r.fair.fair * 100, currentPrice: r.mid * 100,
          timeHorizon: r.hLeft != null ? `${Math.max(0, Math.ceil(r.hLeft / 24))}D` : 'n/a',
          keyRisks: [], reasoning: r.reasoning || null, status: 'ACTIVE',
        },
      }).catch(() => {});
    }
  } catch { /* display only */ }
}

// ── Resolution of predictions (scorecard input) ─────────────────────────────

export async function resolvePolymarketPredictions(opts: { venue?: PredictionVenue; maxMarkets?: number } = {}): Promise<number> {
  const venue = await getVenue(opts.venue);
  const rows: any[] = (await db.polymarketPrediction.findMany({
    where: { outcome: null, venue: venue.id },
    select: { marketSlug: true, endDate: true },
    orderBy: { endDate: 'asc' },
    take: 2000,
  }).catch(() => [])) || [];
  const slugs = [...new Set(rows.map(r => r.marketSlug))].slice(0, opts.maxMarkets ?? 60);
  let resolved = 0;
  for (const slug of slugs) {
    const v = await venue.getSettlement(slug);
    if (v == null) continue;
    await db.polymarketPrediction.updateMany({ where: { marketSlug: slug, outcome: null }, data: { outcome: v, resolvedAt: new Date() } }).catch(() => {});
    resolved++;
  }
  if (resolved) logger.info(`🎯 [PM-EDGE] ${resolved} market(s) resolved for the scorecard`);
  return resolved;
}

// ── Scorecard ────────────────────────────────────────────────────────────────

export interface Scorecard {
  generatedAt: string;
  windowDays: number | null;
  predictions: { total: number; resolved: number; withModel: number };
  model: { n: number; brier: number | null; logLoss: number | null };
  market: { brier: number | null; logLoss: number | null };
  brierSkillVsMarket: number | null;    // 1 − model/market; > 0 means the model beat the market price
  perMarketLatest: { n: number; brierModel: number | null; brierMarket: number | null };
  calibration: M.CalibrationBucket[];
  calibrationFit: M.PlattParams | null;
  trades: {
    closed: number; open: number; wins: number; winRate: number | null;
    pnlAfterFeesUsd: number; feesUsd: number; costBasisUsd: number; roiPct: number | null;
    avgExpectedNetEdge: number | null; avgRealizedEdgePerShare: number | null;
    byExitReason: Record<string, { n: number; pnl: number }>;
  };
  openPaperOrders: number;
  verdict: string;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function computeScorecard(opts: { days?: number } = {}): Promise<Scorecard> {
  const cfg = readEdgeConfig();
  const since = opts.days ? new Date(Date.now() - opts.days * 86_400_000) : undefined;
  const where: any = since ? { createdAt: { gte: since } } : {};
  const all: any[] = (await db.polymarketPrediction.findMany({ where, orderBy: { createdAt: 'asc' }, take: 20000 }).catch(() => [])) || [];
  const resolved = all.filter(r => r.outcome != null);
  const withModel = resolved.filter(r => r.llmProb != null);

  const pts = withModel.map(r => ({ p: Number(r.fairProb), mkt: Number(r.marketMid), o: Number(r.outcome) }));
  const brierModel = mean(pts.map(x => M.brier(x.p, x.o)));
  const brierMarket = mean(pts.map(x => M.brier(x.mkt, x.o)));
  const latestBySlug = new Map<string, typeof pts[number]>();
  withModel.forEach((r, i) => latestBySlug.set(r.marketSlug, pts[i]));
  const latest = [...latestBySlug.values()];

  const trades: any[] = ((await db.trade.findMany({ where: { asset: 'POLYMARKET' } }).catch(() => [])) || [])
    .filter((t: any) => (t.metadata as any)?.venue === VENUE_TAG && (!since || new Date(t.openedAt ?? t.createdAt ?? 0) >= since));
  const closed = trades.filter(t => t.status === 'CLOSED');
  const pnl = closed.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const fees = closed.reduce((s, t) => s + (Number(t.fees) || 0), 0);
  const cost = closed.reduce((s, t) => s + Number(t.entryPrice) * Number(t.quantity), 0);
  const predById = new Map(all.map(r => [r.id, r]));
  const expectedEdges = closed.map(t => predById.get((t.metadata as any)?.predictionId)?.netEdge).filter((x: any) => Number.isFinite(Number(x))).map(Number);
  const realizedEdges = closed.filter(t => Number(t.quantity) > 0).map(t => (Number(t.pnl) || 0) / Number(t.quantity));
  const byExit: Record<string, { n: number; pnl: number }> = {};
  for (const t of closed) {
    const k = t.exitReason || 'unknown';
    byExit[k] = byExit[k] || { n: 0, pnl: 0 };
    byExit[k].n++; byExit[k].pnl += Number(t.pnl) || 0;
  }
  const wins = closed.filter(t => (Number(t.pnl) || 0) > 0).length;
  const openOrders = await db.polymarketPaperOrder.count({ where: { status: 'OPEN' } }).catch(() => 0);

  const skill = brierModel != null && brierMarket != null && brierMarket > 0 ? 1 - brierModel / brierMarket : null;
  let verdict: string;
  if (withModel.length < cfg.calibrationMinSamples || latest.length < 20) {
    verdict = `Not enough evidence yet: ${withModel.length} resolved model predictions across ${latest.length} markets (want ≥ ${cfg.calibrationMinSamples} and ≥ 20 markets). Stay in paper.`;
  } else if (skill != null && skill > 0.02 && pnl > 0) {
    verdict = `Model beats the market price (Brier skill ${(skill * 100).toFixed(1)}%) and paper P&L after fees is positive ($${pnl.toFixed(2)}). Keep collecting data before considering live.`;
  } else {
    verdict = `No demonstrated edge: Brier skill ${skill != null ? (skill * 100).toFixed(1) + '%' : 'n/a'}, paper P&L after fees $${pnl.toFixed(2)}. Do not go live.`;
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays: opts.days ?? null,
    predictions: { total: all.length, resolved: resolved.length, withModel: withModel.length },
    model: { n: pts.length, brier: brierModel, logLoss: mean(pts.map(x => M.logLoss(x.p, x.o))) },
    market: { brier: brierMarket, logLoss: mean(pts.map(x => M.logLoss(x.mkt, x.o))) },
    brierSkillVsMarket: skill,
    perMarketLatest: { n: latest.length, brierModel: mean(latest.map(x => M.brier(x.p, x.o))), brierMarket: mean(latest.map(x => M.brier(x.mkt, x.o))) },
    calibration: M.calibrationBuckets(pts.map(x => ({ p: x.p, outcome: x.o }))),
    calibrationFit: await loadCalibration(cfg),
    trades: {
      closed: closed.length, open: trades.length - closed.length, wins, winRate: closed.length ? wins / closed.length : null,
      pnlAfterFeesUsd: Math.round(pnl * 100) / 100, feesUsd: Math.round(fees * 100) / 100, costBasisUsd: Math.round(cost * 100) / 100,
      roiPct: cost > 0 ? (pnl / cost) * 100 : null,
      avgExpectedNetEdge: mean(expectedEdges), avgRealizedEdgePerShare: mean(realizedEdges), byExitReason: byExit,
    },
    openPaperOrders: openOrders,
    verdict,
  };
}

export async function logScorecardSummary(): Promise<void> {
  const s = await computeScorecard();
  const f = (x: number | null, d = 4) => (x == null ? 'n/a' : x.toFixed(d));
  logger.info(`📊 [PM-EDGE] scorecard: ${s.predictions.resolved}/${s.predictions.total} resolved | Brier model ${f(s.model.brier)} vs market ${f(s.market.brier)} | log loss ${f(s.model.logLoss)} vs ${f(s.market.logLoss)} | paper trades ${s.trades.closed} closed, P&L after fees $${s.trades.pnlAfterFeesUsd} | ${s.verdict}`);
}
