// ── POLYMARKET US (CFTC-regulated exchange, api.polymarket.us) ─────────────
// Uses the official `polymarket-us` SDK. Requests are signed with Ed25519
// (X-PM-Access-Key / X-PM-Timestamp / X-PM-Signature) from
// POLYMARKET_KEY_ID + POLYMARKET_SECRET_KEY. Read-only calls are always
// allowed; real orders are refused unless ALL of these hold:
//   TRADING_MODE=live + LIVE_TRADING_CONFIRMED=I_ACCEPT_REAL_MONEY_RISK,
//   POLYMARKET_US_LIVE=true, kill switch off, and notional <=
//   POLYMARKET_US_MAX_ORDER_USD (alias POLYMARKET_MAX_BET_USD, default $5).
//   See trading/liveGate.ts.
//
// Public market data (no key): markets/events, order book, BBO, price history
// and settlement, normalized for the edge engine (services/polymarketEdge.ts)
// through the venue-pluggable `polymarketUSVenue` (services/predictionVenue.ts).
//
// Price convention (docs.polymarket.us/concepts/orders): every Polymarket US
// market is ONE instrument; book prices and order prices always refer to the
// YES (long) side. Buying NO at $0.40 is selling YES at $0.60, so a NO order
// is sent with price = 1 − NO price.
import axios from 'axios';
import { PolymarketUS } from 'polymarket-us';
import { logger } from '../utils/logger';
import { isKillSwitchActive } from '../agents/orchestrator';
import { createHash } from 'crypto';
import { polymarketLiveAllowed, getPolymarketMaxOrderUsd } from '../trading/liveGate';
import type { BookLevel } from '../trading/predictionMath';
import type { PredictionVenue, VenueBook, VenueMarket, VenuePricePoint } from './predictionVenue';
import { prisma } from '../utils/prisma';
import { validateLiveQualification } from '../trading/liveQualification';
import { bindPolymarketUSRest } from './polymarketUSRest';
import { predictionPendingStates, predictionRiskPolicyHash, readPredictionGeneration, advancePredictionGeneration,
  predictionAccountExposure, assertPredictionFillsReflected, predictionDailyRealizedPnl } from '../trading/predictionAuthority';

const GATEWAY = 'https://gateway.polymarket.us';

let client: PolymarketUS | null = null;
let clientIdentity = '';
let publicClient: PolymarketUS | null = null;
let accountObservation: { identity: string; verifiedAt: number } | null = null;
let accountRequestSequence = 0;

function credentialIdentity(): string {
  return createHash('sha256').update(JSON.stringify([process.env.POLYMARKET_KEY_ID, process.env.POLYMARKET_SECRET_KEY])).digest('hex');
}

export function getPolymarketUSHealth() {
  const configured = isPolymarketUSConfigured();
  const verified = configured && accountObservation?.identity === credentialIdentity() && Date.now() - accountObservation.verifiedAt < 90000;
  return { configured, connected: Boolean(verified), status: !configured ? 'unconfigured' : verified ? 'verified' : 'unverified' };
}

export function isPolymarketUSConfigured(): boolean {
  return Boolean(process.env.POLYMARKET_KEY_ID && process.env.POLYMARKET_SECRET_KEY);
}

function authed(): PolymarketUS {
  if (!isPolymarketUSConfigured()) throw new Error('POLYMARKET_KEY_ID / POLYMARKET_SECRET_KEY not set');
  const identity = credentialIdentity();
  if (!client || clientIdentity !== identity) {
    client = new PolymarketUS({ keyId: process.env.POLYMARKET_KEY_ID!, secretKey: process.env.POLYMARKET_SECRET_KEY!, timeout: 10000 });
    clientIdentity = identity;
  }
  return client;
}

function pub(): PolymarketUS {
  if (!publicClient) publicClient = new PolymarketUS({ timeout: 10000 });
  return publicClient;
}

export async function getPolymarketUSAccount() {
  const c = authed();
  const identity = credentialIdentity();
  const sequence = ++accountRequestSequence;
  const [balanceResult, positionsResult, ordersResult] = await Promise.allSettled([
    c.account.balances(),
    c.portfolio.positions(),
    c.orders.list(),
  ]);
  if (identity !== credentialIdentity()) throw new Error('Polymarket US credentials changed during account request');
  const currentRequest = sequence === accountRequestSequence;
  if (balanceResult.status !== 'fulfilled') {
    if (currentRequest && accountObservation?.identity === identity) accountObservation = null;
    throw new Error('Polymarket US balance request failed');
  }
  const balances = balanceResult.value;
  if (!Array.isArray((balances as any)?.balances)) {
    if (currentRequest && accountObservation?.identity === identity) accountObservation = null;
    throw new Error('Polymarket US balance response is invalid');
  }
  if (currentRequest) accountObservation = { identity, verifiedAt: Date.now() };
  const usd = (balances as any).balances.find((b: any) => typeof b?.currency === 'string' && b.currency.toUpperCase() === 'USD');
  const amount = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const positions = positionsResult.status === 'fulfilled' ? (positionsResult.value as any)?.positions : null;
  const openOrders = ordersResult.status === 'fulfilled' ? (ordersResult.value as any)?.orders : null;
  return {
    connected: true,
    cash: amount(usd?.currentBalance),
    buyingPower: amount(usd?.buyingPower),
    openOrderValue: amount(usd?.openOrders),
    balanceAvailable: amount(usd?.currentBalance) !== null,
    balances: (balances as any)?.balances ?? [],
    positions: positions && typeof positions === 'object' ? positions : null,
    openOrders: Array.isArray(openOrders) ? openOrders : null,
    sections: { balances: 'available', positions: positions && typeof positions === 'object' ? 'available' : 'unavailable', orders: Array.isArray(openOrders) ? 'available' : 'unavailable' },
    fetchedAt: new Date().toISOString(),
  };
}

export async function listPolymarketUSEvents(limit = 20) {
  const r: any = await pub().events.list({ limit, active: true, closed: false } as any);
  return (r?.events ?? []).filter((e: any) => !e.closed);
}

// ── Public market data (read-only, no key) ─────────────────────────────────

const num = (v: any): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'object' && (v.value === null || v.value === undefined || v.value === '')) return undefined;
  const n = typeof v === 'object' && v !== null ? Number(v.value) : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Normalize a gateway market (optionally with its parent event) into a VenueMarket. */
export function normalizeUSMarket(m: any, ev?: any): VenueMarket | null {
  if (!m?.slug) return null;
  const question = String(m.question || ev?.title || m.title || m.slug);
  const label = m.title && m.title !== question ? String(m.title) : undefined;
  const status = String(m.status || '');
  return {
    venue: 'polymarket_us',
    id: String(m.slug),
    question: label ? `${question}: ${label}` : question,
    outcomeLabel: label,
    description: m.description ? String(m.description).slice(0, 1500) : undefined,
    category: String(m.category || ev?.category || 'general').toLowerCase(),
    eventId: ev?.slug ? String(ev.slug) : (m.eventSlug ? String(m.eventSlug) : undefined),
    eventTitle: ev?.title ? String(ev.title) : undefined,
    endDate: m.endDate || ev?.endDate || undefined,
    gameStartTime: m.gameStartTime || undefined,
    marketType: m.marketType || m.sportsMarketType || undefined,
    open: Boolean(m.active) && !m.closed && !m.archived && (!status || status === 'MARKET_STATUS_OPEN'),
    bestBid: num(m.bestBidQuote),
    bestAsk: num(m.bestAskQuote),
    feeCoefficient: num(m.feeCoefficient) ?? Number(process.env.POLYMARKET_US_TAKER_FEE_THETA || 0.0695),
    tickSize: num(m.orderPriceMinTickSize) ?? 0.001,
    minQty: num(m.minimumTradeQty) ?? 1,
    executionMetadataVerified: num(m.feeCoefficient) !== undefined && num(m.orderPriceMinTickSize) !== undefined && num(m.minimumTradeQty) !== undefined,
  };
}

/** Active markets with their event context (events carry the grouping used for correlation caps). */
export async function listPolymarketUSMarkets(max = 200): Promise<VenueMarket[]> {
  const out: VenueMarket[] = [];
  const pageSize = 50;
  for (let offset = 0; out.length < max && offset < max * 4; offset += pageSize) {
    const r: any = await pub().events.list({ limit: pageSize, offset, active: true, closed: false } as any);
    const events: any[] = r?.events ?? [];
    for (const ev of events) {
      if (ev?.closed) continue;
      for (const m of ev?.markets ?? []) {
        const vm = normalizeUSMarket(m, ev);
        if (vm) out.push(vm);
        if (out.length >= max) break;
      }
      if (out.length >= max) break;
    }
    if (events.length < pageSize) break;
  }
  return out;
}

function levels(raw: any[] | undefined): BookLevel[] {
  return (raw ?? [])
    .map((l: any) => ({ price: num(l?.px) ?? NaN, size: Number(l?.qty) }))
    .filter((l: BookLevel) => Number.isFinite(l.price) && l.size > 0);
}

export function classifyPolymarketBookFailure(error: unknown): string {
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined;
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'market_unavailable';
  if (status === 401 || status === 403) return 'access_refused';
  if (typeof status === 'number' && status >= 500 && status <= 599) return 'provider_unavailable';
  if (status === 0) return 'transport_failure';
  return 'unclassified_failure';
}

// Fixed categories only; no market identifiers, provider messages or credentials.
// At most one log per category/minute per process. A failed logger cannot affect reads.
const bookFailureLogTimes = new Map<string, number>();
function recordBookFailure(code: string): void {
  const now = Date.now(), previous = bookFailureLogTimes.get(code);
  if (previous !== undefined && now >= previous && now - previous < 60000) return;
  bookFailureLogTimes.set(code, now);
  try { logger.warn('polymarket_book_read_failed', { venue: 'polymarket_us', code }); } catch { /* diagnostic only */ }
}

/** Full YES-side book: bids high→low, asks low→high. */
export async function getPolymarketUSBook(slug: string): Promise<VenueBook | null> {
  let received = false;
  try {
    const r: any = await pub().markets.book(slug);
    received = true;
    const d = r?.marketData ?? r; // gateway wraps the book in { marketData }
    if (!d) { recordBookFailure('response_missing'); return null; }
    return {
      bids: levels(d.bids).sort((a, b) => b.price - a.price),
      asks: levels(d.offers ?? d.asks).sort((a, b) => a.price - b.price),
      state: d.state,
      lastTrade: num(d.stats?.lastTradePx),
      lastTradeAt: d.stats?.lastTradeSetTime ? Date.parse(d.stats.lastTradeSetTime) || undefined : undefined,
      openInterest: num(d.stats?.openInterest),
      volume: num(d.stats?.sharesTraded),
      fetchedAt: Date.now(),
    };
  } catch (err: any) {
    recordBookFailure(received ? 'normalization_failed' : classifyPolymarketBookFailure(err));
    return null;
  }
}

export interface PmUsBBO {
  bestBid?: number; bestAsk?: number; lastTrade?: number;
  openInterest?: number; volume?: number; state?: string; fetchedAt: number;
}

export async function getPolymarketUSBBO(slug: string): Promise<PmUsBBO | null> {
  try {
    const r: any = await pub().markets.bbo(slug);
    const d = r?.marketData ?? r;
    if (!d) return null;
    return {
      bestBid: num(d.bestBid), bestAsk: num(d.bestAsk), lastTrade: num(d.lastTradePx),
      openInterest: num(d.openInterest), volume: num(d.sharesTraded), state: d.state, fetchedAt: Date.now(),
    };
  } catch (err: any) {
    logger.debug(`[PM-US] bbo ${slug} failed: ${err?.message}`);
    return null;
  }
}

/**
 * GET /v1/price-history (not wrapped by the SDK). Points are book-derived
 * display prices: longPrice ≈ YES ask, shortPrice ≈ 1 − YES bid; we return
 * the YES mid. Default: one week at 3-hour points.
 */
export async function getPolymarketUSPriceHistory(
  slug: string, fixedInterval = 'INTERVAL_1W', fidelity = 180,
): Promise<VenuePricePoint[]> {
  try {
    const r = await axios.get(`${GATEWAY}/v1/price-history`, { params: { symbol: slug, fixedInterval, fidelity }, timeout: 10_000 });
    const hist: any[] = Array.isArray(r?.data?.history) ? r.data.history : [];
    return hist
      .map(h => {
        const yesAsk = Number(h.longPrice), noAsk = Number(h.shortPrice);
        const p = Number.isFinite(yesAsk) && Number.isFinite(noAsk) ? (yesAsk + (1 - noAsk)) / 2 : yesAsk;
        return { t: Number(h.timestamp), p };
      })
      .filter(x => Number.isFinite(x.t) && Number.isFinite(x.p));
  } catch (err: any) {
    logger.debug(`[PM-US] price history ${slug} failed: ${err?.message}`);
    return [];
  }
}

/** YES settlement value (0..1) once the market has settled; null otherwise (404 = not settled). */
export async function getPolymarketUSSettlement(slug: string): Promise<number | null> {
  try {
    const r: any = await pub().markets.settlement(slug);
    const v = num(r?.settlement) ?? num(r?.settlementPrice) ?? num(r?.marketData?.settlementPrice);
    return v !== undefined && v >= 0 && v <= 1 ? v : null;
  } catch {
    return null;
  }
}

/** Read-only venue adapter for the edge engine. */
export const polymarketUSVenue: PredictionVenue = {
  id: 'polymarket_us',
  listMarkets: listPolymarketUSMarkets,
  getBook: getPolymarketUSBook,
  getPriceHistory: (slug: string) => getPolymarketUSPriceHistory(slug),
  getSettlement: getPolymarketUSSettlement,
};

// ── Orders (real money — gated) ─────────────────────────────────────────────

/** Order price is always the YES price; a NO bid at q is sent as 1 − q. */
export function toYesOrderPrice(side: 'YES' | 'NO', sidePrice: number): number {
  return side === 'YES' ? sidePrice : 1 - sidePrice;
}

export interface PmUsOrderRequest {
  marketSlug: string;
  side: 'YES' | 'NO';
  price: number;      // price per share OF `side` (0.01 - 0.99); converted to the YES price on send
  quantity: number;   // shares
  /** Default IOC. GTD rests until goodTillTime (exchange-side expiry). */
  tif?: 'IOC' | 'GTD';
  goodTillTime?: string;
  /** Maker-only: rejected instead of crossing the spread. */
  postOnly?: boolean;
}

export const POLYMARKET_LIVE_STRATEGY = 'BHISHMA_POLYMARKET_US';
export function getPolymarketUSCredentialScope(): { scopeKey: string; identity: string } {
  if (!isPolymarketUSConfigured()) throw new Error('Polymarket US credentials unavailable');
  // This identifies the authenticated API grant, not an invented exchange account ID.
  return { scopeKey: 'polymarket-us:' + createHash('sha256').update(process.env.POLYMARKET_KEY_ID!).digest('hex'), identity: credentialIdentity() };
}

export interface PmUsExecutionSnapshot {
  scopeKey: string; identity: string; observedAt: number;
  cash: number; buyingPower: number; positions: Record<string, any>; openOrders: any[];
}

/** Account authority requires every section and complete position pagination.
 * UI partial results are useful for display, but cannot authorize orders. */
export async function getPolymarketUSExecutionSnapshot(): Promise<PmUsExecutionSnapshot> {
  const scope = getPolymarketUSCredentialScope();
  const observedAt = Date.now();
  const request = bindPolymarketUSRest(process.env.POLYMARKET_KEY_ID!, process.env.POLYMARKET_SECRET_KEY!);
  const [balances, orders] = await Promise.all([request('GET', '/v1/account/balances'), request('GET', '/v1/orders/open')]);
  const usd = Array.isArray((balances as any)?.balances)
    ? (balances as any).balances.find((b: any) => b?.currency === 'USD') : null;
  if (typeof usd?.currentBalance !== 'number' || !Number.isFinite(usd.currentBalance) || usd.currentBalance < 0
    || typeof usd?.buyingPower !== 'number' || !Number.isFinite(usd.buyingPower) || usd.buyingPower < 0
    || !Array.isArray((orders as any)?.orders)) throw new Error('Polymarket US account authority incomplete');
  const positions: Record<string, any> = {};
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let complete = false;
  for (let page = 0; page < 20; page++) {
    if (Date.now() - observedAt > 5000) throw new Error('Polymarket US account snapshot deadline exceeded');
    const result: any = await request('GET', '/v1/portfolio/positions', undefined, { limit: 100, ...(cursor ? { cursor } : {}) });
    if (!result?.positions || typeof result.positions !== 'object' || Array.isArray(result.positions)) throw new Error('Invalid Polymarket US position page');
    for (const [slug, value] of Object.entries(result.positions)) {
      if (Object.prototype.hasOwnProperty.call(positions, slug)) throw new Error('Duplicate position across pages');
      Object.defineProperty(positions, slug, { value, enumerable: true });
    }
    if (result.eof === true || (!result.nextCursor && result.eof !== false)) { complete = true; break; }
    if (typeof result.nextCursor !== 'string' || !result.nextCursor || cursors.has(result.nextCursor)) throw new Error('Incomplete Polymarket US position pagination');
    cursors.add(result.nextCursor); cursor = result.nextCursor;
  }
  if (!complete || scope.identity !== credentialIdentity() || Date.now() - observedAt > 5000) throw new Error('Polymarket US account authority changed, expired or pagination exceeded its bound');
  return { ...scope, observedAt, cash: usd.currentBalance, buyingPower: usd.buyingPower, positions, openOrders: (orders as any).orders };
}

/** Read-only reconciliation remains available with live disabled or kill active. */
export async function getPolymarketUSOrder(orderId: string, scopeKey: string): Promise<unknown> {
  const scope = getPolymarketUSCredentialScope();
  if (scope.scopeKey !== scopeKey || typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) throw new Error('Invalid bound Polymarket order read');
  const request = bindPolymarketUSRest(process.env.POLYMARKET_KEY_ID!, process.env.POLYMARKET_SECRET_KEY!);
  const result = await request('GET', '/v1/order/' + orderId);
  if (scope.identity !== credentialIdentity()) throw new Error('Polymarket US credentials changed during order read');
  return result;
}

function assertLiveAllowed() {
  // Same rule as every other live path: TRADING_MODE=live + LIVE_TRADING_CONFIRMED
  // phrase + POLYMARKET_US_LIVE=true + kill switch off.
  const gate = polymarketLiveAllowed(process.env, isKillSwitchActive());
  if (!gate.allowed) throw new Error(`Polymarket US live orders are disabled: ${gate.reason}`);
  if (isKillSwitchActive()) throw new Error('Kill switch active');
}

export function buildPolymarketUSOrder(req: PmUsOrderRequest) {
  const maxUsd = getPolymarketMaxOrderUsd();
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('Invalid Polymarket US order limit');
  if (!req || typeof req.marketSlug !== 'string' || !req.marketSlug.trim() || req.marketSlug !== req.marketSlug.trim()) throw new Error('Invalid market slug');
  if (req.side !== 'YES' && req.side !== 'NO') throw new Error('Invalid outcome side');
  if (!Number.isFinite(req.price) || req.price < 0.01 || req.price > 0.99 || !Number.isSafeInteger(req.quantity) || req.quantity <= 0) throw new Error('Invalid price/quantity');
  // Preserve exchange prices down to a micro-dollar; never silently round a quote.
  const units = Math.round(req.price * 1000000);
  if (Math.abs(req.price * 1000000 - units) > 1e-7) throw new Error('Order price precision exceeds six decimals');
  const notional = units * req.quantity / 1000000;
  if (!Number.isFinite(notional)) throw new Error('Invalid order notional');
  if (notional > maxUsd) throw new Error(`Order notional $${notional.toFixed(2)} exceeds POLYMARKET_US_MAX_ORDER_USD $${maxUsd}`);
  const gtd = req.tif === 'GTD';
  if (req.tif !== undefined && !['IOC', 'GTD'].includes(req.tif)) throw new Error('Invalid time in force');
  if (gtd && (!req.goodTillTime || !Number.isFinite(Date.parse(req.goodTillTime)) || Date.parse(req.goodTillTime) <= Date.now())) throw new Error('GTD order needs a future goodTillTime');
  if (!gtd && (req.goodTillTime !== undefined || req.postOnly)) throw new Error('Resting/maker instructions require GTD');

  return {
    marketSlug: req.marketSlug,
    // Long YES = buy long; a NO view is expressed as buying the short side.
    intent: req.side === 'YES' ? 'ORDER_INTENT_BUY_LONG' : 'ORDER_INTENT_BUY_SHORT',
    type: 'ORDER_TYPE_LIMIT',
    // Previously the NO price itself was sent, which for a NO order means
    // "sell YES at the NO price" — i.e. paying 1 − q for NO instead of q.
    price: { value: toYesOrderPrice(req.side, req.price).toFixed(6), currency: 'USD' },
    quantity: req.quantity,
    // IOC by default: never leave a resting order the bot forgets about.
    tif: gtd ? 'TIME_IN_FORCE_GOOD_TILL_DATE' : 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL',
    ...(gtd ? { goodTillTime: req.goodTillTime } : {}),
    ...(req.postOnly ? { participateDontInitiate: true } : {}),
    manualOrderIndicator: 'MANUAL_ORDER_INDICATOR_AUTOMATIC',
  } as const;
}

/** The last writer consumes a durable, qualified PREPARING claim atomically.
 * The public exchange create contract has no client-order ID, so uncertain
 * submissions must retain their claim rather than repeat the POST. */
export async function submitPolymarketUSExecution(claimId: string) {
  const db = prisma as any;
  const request = bindPolymarketUSRest(process.env.POLYMARKET_KEY_ID!, process.env.POLYMARKET_SECRET_KEY!);
  const scope = getPolymarketUSCredentialScope();
  let posting = false;
  try {
    const claim = await db.predictionExecution.findUnique({ where: { id: claimId } });
    if (!claim || claim.status !== 'PREPARING' || claim.credentialScopeKey !== scope.scopeKey || claim.credentialIdentity !== scope.identity) throw new Error('Prediction submission claim unavailable');
    // Re-read every broker section, not just cash. No broker I/O is performed
    // inside a database transaction or after consuming the submission claim.
    const snapshot = await getPolymarketUSExecutionSnapshot();
    const exposure = predictionAccountExposure(snapshot);
    const payload = buildPolymarketUSOrder({ marketSlug: claim.marketSlug, side: claim.side, price: claim.sideLimitPrice, quantity: claim.quantity });
    const revision = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RELEASE_COMMIT_SHA;
    const authorization = await db.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.scopeKey}))`;
      const current = await tx.predictionExecution.findUnique({ where: { id: claimId } });
      if (!current || current.status !== 'PREPARING' || current.credentialScopeKey !== scope.scopeKey || current.credentialIdentity !== scope.identity
        || await readPredictionGeneration(tx, scope.scopeKey) !== current.authorityGeneration
        || current.quantity !== claim.quantity || current.sideLimitPrice !== claim.sideLimitPrice || current.marketSlug !== claim.marketSlug
        || current.side !== claim.side || current.reservedUsd !== claim.reservedUsd) throw new Error('Prediction claim authority changed');
      const other = await tx.predictionExecution.findFirst({ where: { credentialScopeKey: scope.scopeKey, status: { in: predictionPendingStates }, id: { not: claimId } } });
      if (other) throw new Error('Another prediction claim requires reconciliation');
      await assertPredictionFillsReflected(tx, snapshot);
      const pnl = await predictionDailyRealizedPnl(tx, scope.scopeKey);
      const qualification = revision ? await tx.strategyQualification.findFirst({ where: { strategyKey: POLYMARKET_LIVE_STRATEGY, revision }, orderBy: { createdAt: 'desc' } }) : null;
      const owner = await tx.user.findUnique({ where: { id: current.ownerId }, select: { email: true, role: true } });
      const risk = await tx.settings.findUnique({ where: { id: 'settings-1' } });
      if (!owner || owner.role !== 'OWNER' || owner.email !== process.env.OWNER_EMAIL?.trim().toLowerCase()
        || predictionRiskPolicyHash(risk) !== current.riskPolicyHash) throw new Error('Prediction owner or risk authority changed');
      for (const name of ['maxPositionSizePct', 'maxRiskPerTradePct', 'dailyLossLimitPct']) {
        if (typeof risk?.[name] !== 'number' || !Number.isFinite(risk[name]) || risk[name] < .01 || risk[name] > 100) throw new Error('Prediction risk policy invalid');
      }
      if (exposure.slugs.has(current.marketSlug) || !Number.isFinite(current.reservedUsd) || current.reservedUsd <= 0
        || Math.min(snapshot.cash, snapshot.buyingPower) < current.reservedUsd
        || current.reservedUsd > Math.min(getPolymarketMaxOrderUsd(), snapshot.cash * risk.maxPositionSizePct / 100, snapshot.cash * risk.maxRiskPerTradePct / 100)
        || exposure.cost + current.reservedUsd > snapshot.cash * risk.dailyLossLimitPct / 100 + Math.min(0, pnl) + 1e-8) throw new Error('Prediction funds or aggregate risk changed before submission');
      const check = validateLiveQualification(qualification, POLYMARKET_LIVE_STRATEGY, revision);
      if (!check.approved || qualification?.id !== current.qualificationId || qualification?.evidence?.credentialScopeKey !== scope.scopeKey) throw new Error('Prediction qualification changed or expired');
      const expiresAt = new Date(current.planExpiresAt).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || Date.now() - snapshot.observedAt > 5000
        || snapshot.scopeKey !== scope.scopeKey || snapshot.identity !== scope.identity) throw new Error('Prediction plan or broker evidence expired');
      const minEdge = Number(process.env.POLYMARKET_MIN_EDGE ?? .05);
      if (!Number.isFinite(minEdge) || minEdge < 0 || minEdge > 1 || !Number.isFinite(current.planNetEdge) || current.planNetEdge < minEdge) throw new Error('Prediction net edge policy changed');
      assertLiveAllowed();
      if (scope.identity !== credentialIdentity()) throw new Error('Prediction credential authority changed');
      const authorityGeneration = await advancePredictionGeneration(tx, scope.scopeKey);
      const taken = await tx.predictionExecution.updateMany({ where: { id: claimId, status: 'PREPARING', credentialIdentity: scope.identity }, data: { status: 'SUBMITTING', authorityGeneration } });
      if (taken.count !== 1) throw new Error('Prediction submission claim already consumed');
      return { qualification, expiresAt, observedAt: snapshot.observedAt };
    });
    // The last checks follow all awaits and are immediately before the single POST.
    assertLiveAllowed();
    if (scope.identity !== credentialIdentity() || authorization.expiresAt <= Date.now()
      || Date.now() - authorization.observedAt > 5000
      || !validateLiveQualification(authorization.qualification, POLYMARKET_LIVE_STRATEGY, revision).approved) throw new Error('Prediction final authorization expired or changed');
    posting = true;
    const acknowledgement = await request('POST', '/v1/orders', payload);
    if (typeof acknowledgement?.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(acknowledgement.id)) throw new Error('Prediction acknowledgement has no valid broker identity');
    return { id: acknowledgement.id };
  } catch (error) {
    if (!posting) throw new PredictionSubmissionRefused();
    throw error;
  }
}

export class PredictionSubmissionRefused extends Error {
  constructor() { super('Prediction submission refused before broker POST'); this.name = 'PredictionSubmissionRefused'; }
}

/** Retired direct writer: callers must use the durable live execution service. */
export async function placePolymarketUSOrder(_req: PmUsOrderRequest): Promise<never> {
  throw new Error('Polymarket US direct orders disabled; use durable prediction execution');
}

/** Cancel a resting order (same live gate; cancelling never adds risk but still touches the real account). */
export async function cancelPolymarketUSOrder(orderId: string, marketSlug: string): Promise<void> {
  assertLiveAllowed();
  await authed().orders.cancel(orderId, { marketSlug });
}
