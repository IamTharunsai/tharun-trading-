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
// NOTE: the autonomous Polymarket scanner (services/polymarket.ts) reads the
// international Gamma API, whose markets are identified by conditionId, not by
// Polymarket US slugs — so the scanner stays paper-only until it scans US
// markets directly.
import { PolymarketUS } from 'polymarket-us';
import { logger } from '../utils/logger';
import { isKillSwitchActive } from '../agents/orchestrator';
import { polymarketLiveAllowed, getPolymarketMaxOrderUsd } from '../trading/liveGate';

let client: PolymarketUS | null = null;
let publicClient: PolymarketUS | null = null;

export function isPolymarketUSConfigured(): boolean {
  return Boolean(process.env.POLYMARKET_KEY_ID && process.env.POLYMARKET_SECRET_KEY);
}

function authed(): PolymarketUS {
  if (!isPolymarketUSConfigured()) throw new Error('POLYMARKET_KEY_ID / POLYMARKET_SECRET_KEY not set');
  if (!client) {
    client = new PolymarketUS({ keyId: process.env.POLYMARKET_KEY_ID!, secretKey: process.env.POLYMARKET_SECRET_KEY! });
  }
  return client;
}

function pub(): PolymarketUS {
  if (!publicClient) publicClient = new PolymarketUS();
  return publicClient;
}

export async function getPolymarketUSAccount() {
  const c = authed();
  const [balances, positions, openOrders] = await Promise.all([
    c.account.balances(),
    c.portfolio.positions(),
    c.orders.list(),
  ]);
  const usd = (balances as any)?.balances?.find((b: any) => (b.currency || '').toUpperCase().includes('USD'));
  return {
    connected: true,
    cash: usd?.currentBalance ?? 0,
    buyingPower: usd?.buyingPower ?? 0,
    openOrderValue: usd?.openOrders ?? 0,
    balances: (balances as any)?.balances ?? [],
    positions: (positions as any)?.positions ?? {},
    openOrders: (openOrders as any)?.orders ?? [],
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
  const maxUsd = getPolymarketMaxOrderUsd();
  const notional = req.price * req.quantity;
  // Same rule as every other live path: TRADING_MODE=live + LIVE_TRADING_CONFIRMED
  // phrase + POLYMARKET_US_LIVE=true + kill switch off. (Previously this checked
  // appConfig.TRADING_MODE, which also required Alpaca live keys.)
  const gate = polymarketLiveAllowed(process.env, isKillSwitchActive());
  if (!gate.allowed) {
    throw new Error(`Polymarket US live orders are disabled: ${gate.reason}`);
  }
  if (isKillSwitchActive()) throw new Error('Kill switch active');
  if (!(req.price > 0 && req.price < 1) || !(req.quantity > 0)) throw new Error('Invalid price/quantity');
  if (notional > maxUsd) throw new Error(`Order notional $${notional.toFixed(2)} exceeds POLYMARKET_US_MAX_ORDER_USD $${maxUsd}`);

  const order = await authed().orders.create({
    marketSlug: req.marketSlug,
    // Long YES = buy long; a NO view is expressed as buying the short side.
    intent: req.side === 'YES' ? 'ORDER_INTENT_BUY_LONG' : 'ORDER_INTENT_BUY_SHORT',
    type: 'ORDER_TYPE_LIMIT',
    price: { value: req.price.toFixed(2), currency: 'USD' },
    quantity: Math.floor(req.quantity),
    // IOC: never leave a resting order the bot forgets about.
    tif: 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL',
    manualOrderIndicator: 'MANUAL_ORDER_INDICATOR_AUTOMATIC',
  });
  logger.info(`🎯 Polymarket US order ${order.id}: ${req.side} ${req.quantity} @ ${req.price} on ${req.marketSlug}`);
  return order;
}
