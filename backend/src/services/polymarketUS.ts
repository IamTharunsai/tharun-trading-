// ── POLYMARKET US (CFTC-regulated exchange, api.polymarket.us) ─────────────
// Uses the official `polymarket-us` SDK. Requests are signed with Ed25519
// (X-PM-Access-Key / X-PM-Timestamp / X-PM-Signature) from
// POLYMARKET_KEY_ID + POLYMARKET_SECRET_KEY. Read-only calls are always
// allowed; real orders are refused unless ALL of these hold:
//   TRADING_MODE=live (with fail-closed config), POLYMARKET_US_LIVE=true,
//   kill switch off, and notional <= POLYMARKET_US_MAX_ORDER_USD (default $5).
//
// NOTE: the autonomous Polymarket scanner (services/polymarket.ts) reads the
// international Gamma API, whose markets are identified by conditionId, not by
// Polymarket US slugs — so the scanner stays paper-only until it scans US
// markets directly.
import { PolymarketUS } from 'polymarket-us';
import { logger } from '../utils/logger';
import { appConfig } from '../utils/config';
import { isKillSwitchActive } from '../agents/orchestrator';
import { createHash } from 'crypto';

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

export interface PmUsOrderRequest {
  marketSlug: string;
  side: 'YES' | 'NO';
  price: number;      // 0.01 - 0.99 per share
  quantity: number;   // shares
}

export async function placePolymarketUSOrder(req: PmUsOrderRequest) {
  const maxUsd = Number(process.env.POLYMARKET_US_MAX_ORDER_USD ?? 5);
  if (appConfig.TRADING_MODE !== 'live' || process.env.POLYMARKET_US_LIVE !== 'true') {
    throw new Error('Polymarket US live orders are disabled (need TRADING_MODE=live and POLYMARKET_US_LIVE=true)');
  }
  if (isKillSwitchActive()) throw new Error('Kill switch active');
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

  const order = await authed().orders.create({
    marketSlug: req.marketSlug,
    // Long YES = buy long; a NO view is expressed as buying the short side.
    intent: req.side === 'YES' ? 'ORDER_INTENT_BUY_LONG' : 'ORDER_INTENT_BUY_SHORT',
    type: 'ORDER_TYPE_LIMIT',
    price: { value: req.price.toFixed(2), currency: 'USD' },
    quantity: req.quantity,
    // IOC: never leave a resting order the bot forgets about.
    tif: 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL',
    manualOrderIndicator: 'MANUAL_ORDER_INDICATOR_AUTOMATIC',
  });
  logger.info(`🎯 Polymarket US order ${order.id}: ${req.side} ${req.quantity} @ ${req.price} on ${req.marketSlug}`);
  return order;
}
