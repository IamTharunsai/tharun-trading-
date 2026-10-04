/**
 * APEX Trading — Execution Engine
 *
 * Implements executeTradeSignal (imported by scheduler.ts) and
 * markToMarketOpenPositions (periodic P&L updater).
 *
 * Broker routing:
 *   stocks / ETFs  → Alpaca REST API (paper or live depending on env)
 *   crypto         → Alpaca REST API (crypto-enabled account)
 *   prediction     → polymarketMoneyGreed.ts handles its own execution
 */

import { prisma } from '../utils/prisma';
import { TradeSignal, PortfolioState } from '../agents/types';
import { createAlpacaBroker } from '../services/alpacaBroker';
import { getCurrentPrice, buildMarketSnapshot } from '../services/marketData';
import { logger } from '../utils/logger';
import { isKillSwitchActive } from '../agents/orchestrator';

// ─── Env flags ───────────────────────────────────────────────────────────────
const PAPER_MODE = (process.env.VITE_TRADING_MODE || process.env.TRADING_MODE || 'PAPER').toUpperCase() !== 'LIVE';
const DRY_RUN    = process.env.DRY_RUN === 'true';   // never sends broker orders when true

// ─── Market classifier ────────────────────────────────────────────────────────
function getMarketForAsset(asset: string): 'crypto' | 'stocks' {
  const CRYPTO = new Set(['BTC','ETH','SOL','BNB','ADA','AVAX','LINK','DOT','UNI','MATIC',
    'XRP','DOGE','SHIB','LTC','BCH','ATOM','FIL','NEAR','APT','ARB','OP','INJ','SUI',
    'SEI','TIA','PYTH','JTO','BONK','WIF','PEPE']);
  if (CRYPTO.has(asset)) return 'crypto';
  return 'stocks'; // prediction-market assets use polymarketMoneyGreed.ts, not this path
}

// ─── Price resolution (in-memory ws cache first, Binance/Alpaca fallback) ────
async function fetchCurrentPrice(asset: string): Promise<number | null> {
  // 1. In-memory WebSocket cache (populated by marketData.ts stream)
  const cached = getCurrentPrice(asset);
  if (cached && cached > 0) return cached;

  // 2. Live fetch fallback
  try {
    const market = getMarketForAsset(asset);
    const snap = await buildMarketSnapshot(asset, market);
    if (snap?.price && snap.price > 0) return snap.price;
  } catch {/* fall through */}

  return null;
}

// ─── Portfolio cash from DB ───────────────────────────────────────────────────
async function getLocalCashBalance(): Promise<number> {
  try {
    // Prefer Alpaca account cash (ground truth)
    const broker = createAlpacaBroker(PAPER_MODE);
    if (broker) {
      const summary = await broker.getPortfolioSummary().catch(() => null);
      if (summary?.cash && summary.cash > 0) return summary.cash;
    }
  } catch {/* fall through */}

  // Fallback: derive from DB snapshot
  const STARTING_CAPITAL = parseFloat(process.env.STARTING_CAPITAL || '100000');
  const closedTrades = await prisma.trade.findMany({ where: { status: 'CLOSED' } });
  const realizedPnl = closedTrades.reduce((s: number, t: any) => s + (t.pnl || 0), 0);
  const openPositions = await prisma.position.findMany({ where: { status: 'OPEN' } });
  const invested = openPositions.reduce((s: number, p: any) => s + p.entryPrice * p.quantity, 0);
  return Math.max(0, STARTING_CAPITAL + realizedPnl - invested);
}

// ─── Broker order placement (Alpaca) ─────────────────────────────────────────
async function placeBrokerOrder(
  asset: string,
  side: 'BUY' | 'SELL',
  qty: number,
  _price: number,   // reference only; we use market order
  stopLoss?: number,
  takeProfit?: number,
): Promise<{ success: boolean; orderId?: string; fillPrice?: number; fees?: number; error?: string }> {

  if (DRY_RUN) {
    logger.info(`[EXEC] DRY_RUN — would ${side} ${qty.toFixed(4)} ${asset}`);
    return { success: true, orderId: `dryrun-${Date.now()}`, fillPrice: _price, fees: 0 };
  }

  const broker = createAlpacaBroker(PAPER_MODE);
  if (!broker) {
    return { success: false, error: 'Alpaca credentials not configured — set ALPACA_API_KEY and ALPACA_SECRET_KEY in Railway env vars' };
  }

  try {
    const market = getMarketForAsset(asset);

    // Crypto: Alpaca uses "BTC/USD" format
    const symbol = market === 'crypto' ? `${asset}/USD` : asset;

    const orderRequest: any = {
      symbol,
      qty: parseFloat(qty.toFixed(6)),
      side: side === 'BUY' ? 'buy' : 'sell',
      type: 'market',
      time_in_force: market === 'crypto' ? 'gtc' : 'day',
    };

    // Bracket order (stop-loss + take-profit) when levels provided
    if (stopLoss && takeProfit && side === 'BUY') {
      orderRequest.order_class = 'bracket';
      orderRequest.take_profit = { limit_price: parseFloat(takeProfit.toFixed(2)) };
      orderRequest.stop_loss   = { stop_price: parseFloat(stopLoss.toFixed(2)) };
    }

    const order = await broker.createOrder(orderRequest);

    // Poll for fill price (Alpaca fills market orders almost instantly)
    let fillPrice = _price;
    let attempts = 0;
    while (attempts < 6) {
      await new Promise(r => setTimeout(r, 1000));
      const filled = await broker.getOrder(order.id).catch(() => null);
      if (filled?.filled_avg_price) {
        fillPrice = parseFloat(String(filled.filled_avg_price));
        break;
      }
      attempts++;
    }

    return {
      success: true,
      orderId: order.id,
      fillPrice,
      fees: 0, // Alpaca charges $0 commissions
    };
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.message || String(err);
    logger.error(`[EXEC] Alpaca order failed for ${asset}: ${msg}`);
    return { success: false, error: msg };
  }
}

// ─── Record failure on AgentDecision row ─────────────────────────────────────
async function recordExecutionFailure(decisionId: string, reason: string): Promise<void> {
  if (!decisionId) return;
  await prisma.agentDecision.update({
    where: { id: decisionId },
    data: { executed: false, executionReason: reason },
  }).catch(() => {});
}

// ─── Close a trade (SL/TP trigger or manual) ─────────────────────────────────
async function closeTrade(tradeId: string, exitPrice: number, exitReason: string): Promise<void> {
  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade) return;

  const pnl = trade.type === 'BUY'
    ? (exitPrice - trade.entryPrice) * trade.quantity
    : (trade.entryPrice - exitPrice) * trade.quantity;

  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      status: 'CLOSED',
      exitPrice,
      pnl,
      pnlPct: pnl / (trade.entryPrice * trade.quantity),
      closedAt: new Date(),
      exitReason,
    },
  });

  logger.info(`[MTM] Trade ${tradeId} closed: ${exitReason} @ $${exitPrice.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
}

// ─── Poll for fill confirmation (used by intradayEngine) ─────────────────────
/**
 * confirmOrderFill — polls the broker until the order is filled or maxAttempts exhausted.
 * @param broker        AlpacaBroker instance
 * @param orderId       Broker order ID to poll
 * @param maxAttempts   Max polling attempts (default 8)
 * @param intervalMs    Delay between polls in ms (default 750)
 * @returns { fillPrice, fillQty } — values from last known state if never confirmed
 */
export async function confirmOrderFill(
  broker: ReturnType<typeof createAlpacaBroker>,
  orderId: string,
  maxAttempts = 8,
  intervalMs = 750,
): Promise<{ fillPrice: number; fillQty: number }> {
  if (!broker) return { fillPrice: 0, fillQty: 0 };

  let fillPrice = 0;
  let fillQty = 0;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const order = await broker.getOrder(orderId).catch(() => null);
      if (!order) continue;
      if (order.filled_avg_price) fillPrice = parseFloat(String(order.filled_avg_price));
      if (order.filled_qty)       fillQty   = parseFloat(String(order.filled_qty));
      if (order.status === 'filled') break;
    } catch { /* fall through, retry */ }
  }

  return { fillPrice, fillQty };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API — these are what scheduler.ts and the rest of the system import
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * executeTradeSignal — the function scheduler.ts imports.
 * Returns true if the order was successfully placed/recorded.
 */
export async function executeTradeSignal(
  signal: TradeSignal,
  _portfolio: PortfolioState,
): Promise<boolean> {
  if (isKillSwitchActive()) {
    logger.warn('[EXEC] Kill switch active — trade blocked');
    return false;
  }

  const { asset, market, direction, agentDecisionId } = signal;

  try {
    // 1. Price
    const price = signal.entryPrice > 0
      ? signal.entryPrice
      : await fetchCurrentPrice(asset);

    if (!price || price <= 0) {
      const reason = `PRICE_FETCH_FAILED: Cannot get current price for ${asset}`;
      logger.warn(`[EXEC] ❌ ${reason}`);
      await recordExecutionFailure(agentDecisionId, reason);
      return false;
    }

    // 2. Cash / position size
    const cashBalance = await getLocalCashBalance();
    const sizePct = Math.min(signal.positionSizePct || 5, 10) / 100;  // max 10%
    const positionValue = cashBalance * sizePct;

    if (positionValue < 1) {
      const reason = `INSUFFICIENT_CASH: Available $${cashBalance.toFixed(2)}, need at least $1`;
      logger.warn(`[EXEC] ❌ ${reason}`);
      await recordExecutionFailure(agentDecisionId, reason);
      return false;
    }

    const quantity = positionValue / price;

    // 3. Place broker order (direction is VoteDirection which includes 'HOLD';
    //    signals with HOLD direction should never reach here, but cast for TS)
    if (direction !== 'BUY' && direction !== 'SELL') {
      const reason = `INVALID_DIRECTION: ${direction} is not a tradeable direction`;
      logger.warn(`[EXEC] ❌ ${reason}`);
      await recordExecutionFailure(agentDecisionId, reason);
      return false;
    }
    const order = await placeBrokerOrder(
      asset,
      direction as 'BUY' | 'SELL',
      quantity,
      price,
      signal.stopLossPrice,
      signal.takeProfitPrice,
    );

    if (!order.success) {
      const reason = `BROKER_REJECT: ${order.error}`;
      logger.warn(`[EXEC] ❌ ${reason}`);
      await recordExecutionFailure(agentDecisionId, reason);
      return false;
    }

    const fillPrice = order.fillPrice || price;

    // 4. Write trade to DB
    await prisma.trade.create({
      data: {
        asset,
        market: market || getMarketForAsset(asset),
        type: direction,
        status: 'OPEN',
        entryPrice: fillPrice,
        quantity,
        fees: order.fees ?? 0,
        brokerOrderId: order.orderId,
        brokerConfirmed: !DRY_RUN,
        agentDecisionId: agentDecisionId || undefined,
        stopLossPrice: signal.stopLossPrice || (direction === 'BUY' ? fillPrice * 0.97 : fillPrice * 1.03),
        takeProfitPrice: signal.takeProfitPrice || (direction === 'BUY' ? fillPrice * 1.06 : fillPrice * 0.94),
        openedAt: new Date(),
      },
    });

    // 5. Also create/update Position row (used for portfolio NAV)
    await prisma.position.upsert({
      where: { asset },
      create: {
        asset,
        market: market || getMarketForAsset(asset),
        side: direction,
        entryPrice: fillPrice,
        currentPrice: fillPrice,
        quantity,
        status: 'OPEN',
        openedAt: new Date(),
        stopLossPrice: signal.stopLossPrice || (direction === 'BUY' ? fillPrice * 0.97 : fillPrice * 1.03),
        takeProfitPrice: signal.takeProfitPrice || (direction === 'BUY' ? fillPrice * 1.06 : fillPrice * 0.94),
      },
      update: {
        side: direction,
        entryPrice: fillPrice,
        currentPrice: fillPrice,
        quantity,
        status: 'OPEN',
        openedAt: new Date(),
        stopLossPrice: signal.stopLossPrice || (direction === 'BUY' ? fillPrice * 0.97 : fillPrice * 1.03),
        takeProfitPrice: signal.takeProfitPrice || (direction === 'BUY' ? fillPrice * 1.06 : fillPrice * 0.94),
      },
    }).catch(() => {/* ignore if Position table has changed */});

    // 6. Mark decision executed
    if (agentDecisionId) {
      await prisma.agentDecision.update({
        where: { id: agentDecisionId },
        data: {
          executed: true,
          executionReason: `${direction} ${quantity.toFixed(4)} ${asset} @ $${fillPrice.toFixed(2)} | Order: ${order.orderId} | ${DRY_RUN ? 'DRY_RUN' : PAPER_MODE ? 'PAPER' : 'LIVE'}`,
        },
      }).catch(() => {});
    }

    logger.info(`[EXEC] ✅ ${direction} ${quantity.toFixed(4)} ${asset} @ $${fillPrice.toFixed(2)} | Order: ${order.orderId}`);
    return true;

  } catch (err: any) {
    const reason = `EXECUTION_EXCEPTION: ${err?.message || String(err)}`;
    logger.error(`[EXEC] ❌ Exception for ${asset}: ${reason}`);
    await recordExecutionFailure(agentDecisionId, reason);
    return false;
  }
}

/**
 * markToMarketOpenPositions — run every 5 min from scheduler.
 * Updates unrealized P&L on all open trades and triggers SL/TP closes.
 */
export async function markToMarketOpenPositions(): Promise<void> {
  const openTrades = await prisma.trade.findMany({
    where: { status: 'OPEN' },
  });

  if (openTrades.length === 0) return;

  logger.info(`[MTM] Marking ${openTrades.length} open trade(s) to market`);

  for (const trade of openTrades) {
    try {
      const currentPrice = await fetchCurrentPrice(trade.asset);
      if (!currentPrice || currentPrice <= 0) {
        logger.debug(`[MTM] No price for ${trade.asset}, skipping`);
        continue;
      }

      const pnl = trade.type === 'BUY'
        ? (currentPrice - trade.entryPrice) * trade.quantity
        : (trade.entryPrice - currentPrice) * trade.quantity;

      const pnlPct = trade.type === 'BUY'
        ? (currentPrice - trade.entryPrice) / trade.entryPrice
        : (trade.entryPrice - currentPrice) / trade.entryPrice;

      await prisma.trade.update({
        where: { id: trade.id },
        data: { pnl, pnlPct },
      });

      // Trigger stop-loss / take-profit
      const sl = trade.stopLossPrice;
      const tp = trade.takeProfitPrice;

      const hitSL = sl && (trade.type === 'BUY' ? currentPrice <= sl : currentPrice >= sl);
      const hitTP = tp && (trade.type === 'BUY' ? currentPrice >= tp : currentPrice <= tp);

      if (hitSL) {
        await closeTrade(trade.id, currentPrice, 'STOP_LOSS');
        logger.warn(`[MTM] 🛑 SL triggered: ${trade.asset} @ $${currentPrice.toFixed(2)}`);
      } else if (hitTP) {
        await closeTrade(trade.id, currentPrice, 'TAKE_PROFIT');
        logger.info(`[MTM] 🎯 TP triggered: ${trade.asset} @ $${currentPrice.toFixed(2)}`);
      }

    } catch (err: any) {
      logger.error(`[MTM] Error for ${trade.asset}: ${err?.message}`);
    }
  }
}

/**
 * executeWithLogging — kept for any direct callers that use this older API.
 * Wraps executeTradeSignal with a decisionId + simpler args.
 */
export async function executeWithLogging(
  decisionId: string,
  asset: string,
  signal: 'BUY' | 'SELL',
  approvedSizePct: number,
): Promise<{ success: boolean; reason: string }> {
  const price = await fetchCurrentPrice(asset);
  if (!price) return { success: false, reason: `PRICE_FETCH_FAILED: no price for ${asset}` };

  const fakeSignal: TradeSignal = {
    asset,
    market: getMarketForAsset(asset),
    direction: signal,
    confidence: 0.7,
    entryPrice: price,
    stopLossPrice: signal === 'BUY' ? price * 0.97 : price * 1.03,
    takeProfitPrice: signal === 'BUY' ? price * 1.06 : price * 0.94,
    positionSizePct: approvedSizePct,
    agentDecisionId: decisionId,
    reasoning: 'via executeWithLogging',
  };

  const ok = await executeTradeSignal(fakeSignal, {} as PortfolioState);
  return { success: ok, reason: ok ? `${signal} executed @ $${price}` : 'See execution logs' };
}
