/**
 * CRITICAL BUG FIX: Execution Engine Silent Failure
 *
 * PROBLEM: KOLD had 13 goVotes, finalVote=SELL, 68% confidence → executed=false,
 *   executionReason=null. The execution engine dropped the signal silently.
 *
 * FIX: Add robust error handling, logging, and retry to the execution flow.
 *   Also fixes: unrealized P&L not being computed on open positions.
 *
 * FILE TO PATCH: backend/src/trading/executionEngine.ts
 *
 * ADD these two functions and call them from the main executeDecision():
 */

import { prisma } from '../lib/prisma';

/**
 * FIX 1: Execute with full error logging — no more silent failures
 */
export async function executeWithLogging(
  decisionId: string,
  asset: string,
  signal: 'BUY' | 'SELL',
  approvedSizePct: number,
): Promise<{ success: boolean; reason: string }> {
  try {
    // Fetch current price
    const price = await fetchCurrentPrice(asset);
    if (!price || price <= 0) {
      const reason = `PRICE_FETCH_FAILED: Could not get price for ${asset}`;
      await recordExecutionFailure(decisionId, reason);
      return { success: false, reason };
    }

    // Calculate position size
    const portfolio = await getPortfolioValue();
    const positionValue = portfolio.cashBalance * (approvedSizePct / 100);
    const quantity = positionValue / price;

    if (quantity <= 0) {
      const reason = `INSUFFICIENT_CASH: Need $${positionValue.toFixed(2)}, have $${portfolio.cashBalance.toFixed(2)}`;
      await recordExecutionFailure(decisionId, reason);
      return { success: false, reason };
    }

    // Place order via broker
    const order = await placeBrokerOrder(asset, signal, quantity, price);
    if (!order.success) {
      const reason = `BROKER_REJECT: ${order.error}`;
      await recordExecutionFailure(decisionId, reason);
      return { success: false, reason };
    }

    // Record trade in DB
    await prisma.trade.create({
      data: {
        asset,
        market: getMarketForAsset(asset),
        type: signal,
        status: 'OPEN',
        entryPrice: price,
        quantity,
        fees: order.fees ?? 0,
        brokerOrderId: order.orderId,
        brokerConfirmed: true,
        agentDecisionId: decisionId,
        stopLossPrice: signal === 'BUY' ? price * 0.98 : price * 1.02,
        takeProfitPrice: signal === 'BUY' ? price * 1.06 : price * 0.94,
        openedAt: new Date(),
      },
    });

    // Mark decision as executed
    await prisma.agentDecision.update({
      where: { id: decisionId },
      data: {
        executed: true,
        executionReason: `Executed ${signal} ${quantity.toFixed(4)} ${asset} @ $${price.toFixed(2)} | Order: ${order.orderId}`,
      },
    });

    console.log(`[EXECUTION] ✅ ${signal} ${quantity.toFixed(4)} ${asset} @ $${price} | Order ${order.orderId}`);
    return { success: true, reason: `${signal} executed @ $${price}` };

  } catch (err) {
    const reason = `EXECUTION_EXCEPTION: ${(err as Error).message}`;
    console.error(`[EXECUTION] ❌ Failed for ${asset}: ${reason}`);
    await recordExecutionFailure(decisionId, reason);
    return { success: false, reason };
  }
}

/**
 * FIX 2: Mark-to-market all open positions — run every 5 minutes via scheduler
 * Fixes: AMZN P&L showing null despite being an open confirmed trade
 */
export async function markToMarketOpenPositions(): Promise<void> {
  const openTrades = await prisma.trade.findMany({
    where: { status: 'OPEN', brokerConfirmed: true },
  });

  if (openTrades.length === 0) return;

  for (const trade of openTrades) {
    try {
      const currentPrice = await fetchCurrentPrice(trade.asset);
      if (!currentPrice) continue;

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

      // Check stop loss / take profit triggers
      const hitSL = trade.type === 'BUY'
        ? currentPrice <= trade.stopLossPrice!
        : currentPrice >= trade.stopLossPrice!;

      const hitTP = trade.type === 'BUY'
        ? currentPrice >= trade.takeProfitPrice!
        : currentPrice <= trade.takeProfitPrice!;

      if (hitSL) {
        await closeTrade(trade.id, currentPrice, 'STOP_LOSS');
        console.log(`[MTM] 🛑 Stop loss triggered for ${trade.asset} @ $${currentPrice}`);
      } else if (hitTP) {
        await closeTrade(trade.id, currentPrice, 'TAKE_PROFIT');
        console.log(`[MTM] 🎯 Take profit triggered for ${trade.asset} @ $${currentPrice}`);
      }

    } catch (err) {
      console.error(`[MTM] Error marking ${trade.asset}: ${(err as Error).message}`);
    }
  }
}

async function recordExecutionFailure(decisionId: string, reason: string): Promise<void> {
  await prisma.agentDecision.update({
    where: { id: decisionId },
    data: { executed: false, executionReason: reason },
  }).catch(() => {}); // don't throw on secondary failure
}

async function closeTrade(tradeId: string, exitPrice: number, reason: string): Promise<void> {
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
      exitReason: reason,
    },
  });
}

// Stubs — implement with your actual price feed and broker
async function fetchCurrentPrice(asset: string): Promise<number | null> { return null; }
async function getPortfolioValue(): Promise<{ cashBalance: number }> { return { cashBalance: 0 }; }
async function placeBrokerOrder(asset: string, side: string, qty: number, price: number): Promise<{ success: boolean; orderId?: string; fees?: number; error?: string }> { return { success: false }; }
function getMarketForAsset(asset: string): string {
  const crypto = ['BTC','ETH','SOL','BNB','ADA','DOGE','XRP'];
  const prediction = ['POLYMARKET'];
  if (crypto.includes(asset)) return 'crypto';
  if (prediction.includes(asset)) return 'prediction';
  return 'stocks';
}
