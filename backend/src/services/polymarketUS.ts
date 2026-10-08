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
    client = new PolymarketUS({ keyId: process.env.POLYMARKET_KEY_ID!, secretKey: process.env.POLYMARKET_SECRET_KEY! });
    clientIdentity = identity;
  }
  return client;
}

function pub(): PolymarketUS {
  if (!publicClient) publicClient = new PolymarketUS();
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

/** Full YES-side book: bids high→low, asks low→high. */
export async function getPolymarketUSBook(slug: string): Promise<VenueBook | null> {
  try {
    const r: any = await pub().markets.book(slug);
    const d = r?.marketData ?? r; // gateway wraps the book in { marketData }
    if (!d) return null;
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
    logger.debug(`[PM-US] book ${slug} failed: ${err?.message}`);
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

function assertLiveAllowed() {
  // Same rule as every other live path: TRADING_MODE=live + LIVE_TRADING_CONFIRMED
  // phrase + POLYMARKET_US_LIVE=true + kill switch off.
  const gate = polymarketLiveAllowed(process.env, isKillSwitchActive());
  if (!gate.allowed) throw new Error(`Polymarket US live orders are disabled: ${gate.reason}`);
  if (isKillSwitchActive()) throw new Error('Kill switch active');
}

export async function placePolymarketUSOrder(req: PmUsOrderRequest) {
  const maxUsd = getPolymarketMaxOrderUsd();
  assertLiveAllowed();
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('Invalid Polymarket US order limit');
  if (!req || typeof req.marketSlug !== 'string' || !req.marketSlug.trim() || req.marketSlug !== req.marketSlug.trim()) throw new Error('Invalid market slug');
  if (req.side !== 'YES' && req.side !== 'NO') throw new Error('Invalid outcome side');
  if (!Number.isFinite(req.price) || req.price < 0.01 || req.price > 0.99 || !Number.isSafeInteger(req.quantity) || req.quantity <= 0) throw new Error('Invalid price/quantity');
  // This adapter submits two-decimal prices; refuse hidden price/quantity changes.
  const cents = Math.round(req.price * 100);
  if (Math.abs(req.price * 100 - cents) > 1e-8) throw new Error('Price must use whole cents');
  const notional = cents * req.quantity / 100;
  if (!Number.isFinite(notional)) throw new Error('Invalid order notional');
  if (notional > maxUsd) throw new Error(`Order notional $${notional.toFixed(2)} exceeds POLYMARKET_US_MAX_ORDER_USD $${maxUsd}`);
  const gtd = req.tif === 'GTD';
  if (gtd && !req.goodTillTime) throw new Error('GTD order needs goodTillTime');

  const order = await authed().orders.create({
    marketSlug: req.marketSlug,
    // Long YES = buy long; a NO view is expressed as buying the short side.
    intent: req.side === 'YES' ? 'ORDER_INTENT_BUY_LONG' : 'ORDER_INTENT_BUY_SHORT',
    type: 'ORDER_TYPE_LIMIT',
    // Previously the NO price itself was sent, which for a NO order means
    // "sell YES at the NO price" — i.e. paying 1 − q for NO instead of q.
    price: { value: toYesOrderPrice(req.side, req.price).toFixed(3), currency: 'USD' },
    quantity: req.quantity,
    // IOC by default: never leave a resting order the bot forgets about.
    tif: gtd ? 'TIME_IN_FORCE_GOOD_TILL_DATE' : 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL',
    ...(gtd ? { goodTillTime: req.goodTillTime } : {}),
    ...(req.postOnly ? { participateDontInitiate: true } : {}),
    manualOrderIndicator: 'MANUAL_ORDER_INDICATOR_AUTOMATIC',
  });
  logger.info(`🎯 Polymarket US order ${order.id}: ${req.side} ${req.quantity} @ ${req.price} on ${req.marketSlug}`);
  return order;
}

/** Cancel a resting order (same live gate; cancelling never adds risk but still touches the real account). */
export async function cancelPolymarketUSOrder(orderId: string, marketSlug: string): Promise<void> {
  assertLiveAllowed();
  await authed().orders.cancel(orderId, { marketSlug });
}
