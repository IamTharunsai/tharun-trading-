import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { TradeSignal, PortfolioState } from '../agents/types';
import { getIO } from '../websocket/server';
import { activateKillSwitch } from '../agents/orchestrator';
import { correlationService } from '../services/correlationService';
import { resolveSurvivalPolicy, marketAllowed } from '../services/survivalEngine';
import { createAlpacaBroker } from '../services/alpacaBroker';
import { confirmOrderFill } from './executionEngine';
import { assertPaperTrading } from './paperConfig';

// ── RISK MANAGER ──────────────────────────────────────────────────────────────
export async function validateTradeSignal(
  signal: TradeSignal,
  portfolio: PortfolioState
): Promise<{ approved: boolean; reason?: string }> {

  const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT_PCT || '5');
  const weeklyDrawdownLimit = parseFloat(process.env.WEEKLY_DRAWDOWN_LIMIT_PCT || '10');
  const maxDrawdown = parseFloat(process.env.MAX_DRAWDOWN_ALL_TIME_PCT || '20');
  const cashReservePct = parseFloat(process.env.CASH_RESERVE_PCT || '30');
  const maxPositionPct = parseFloat(process.env.MAX_POSITION_SIZE_PCT || '10');
  const maxTradesPerDay = parseInt(process.env.MAX_TRADES_PER_DAY || '50');

  const policy = resolveSurvivalPolicy({
    bankroll: portfolio.totalValue,
    drawdownFromPeakPct: portfolio.drawdownFromPeak,
    dailyLossPct: portfolio.pnlDayPct,
    openPositions: portfolio.positions?.length || 0,
  });

  if (policy.drawdownMode === 'DEFEND' || policy.riskMultiplier === 0) {
    return { approved: false, reason: `DEFEND/REBIRTH protection: no new trades (${policy.capitalTier})` };
  }

  if (!marketAllowed(policy, signal.market === 'forex' ? 'forex' : signal.market)) {
    return { approved: false, reason: `${policy.capitalTier} mode does not allow ${signal.market}` };
  }

  if ((portfolio.positions?.length || 0) >= policy.maxOpenPositions) {
    return { approved: false, reason: `Position cap ${policy.maxOpenPositions} in ${policy.capitalTier}` };
  }

  if (portfolio.tradesExecutedToday >= Math.min(maxTradesPerDay, policy.tradesPerDayCap)) {
    return { approved: false, reason: `Daily trade cap for ${policy.capitalTier}` };
  }

  if (signal.confidence < policy.minConfidence) {
    return { approved: false, reason: `Confidence ${signal.confidence}% below ${policy.minConfidence}% for ${policy.capitalTier}` };
  }

  // Daily loss limit
  if (portfolio.pnlDayPct <= -dailyLossLimit) {
    logger.warn(`🛑 Daily loss limit hit: ${portfolio.pnlDayPct.toFixed(2)}%`);
    getIO()?.emit('guardrail:triggered', { rule: 'DAILY_LOSS_LIMIT', value: portfolio.pnlDayPct });
    return { approved: false, reason: `Daily loss limit: ${portfolio.pnlDayPct.toFixed(2)}%` };
  }

  // Weekly drawdown limit — middle tier between the daily and all-time
  // drawdown checks. pnlWeekPct is computed against a start-of-window
  // PortfolioSnapshot baseline the same way pnlDayPct is (see portfolio.ts),
  // just with a 7-day window instead of a same-day one.
  if (portfolio.pnlWeekPct <= -weeklyDrawdownLimit) {
    logger.warn(`🛑 Weekly drawdown limit hit: ${portfolio.pnlWeekPct.toFixed(2)}%`);
    getIO()?.emit('guardrail:triggered', { rule: 'WEEKLY_DRAWDOWN_LIMIT', value: portfolio.pnlWeekPct });
    return { approved: false, reason: `Weekly drawdown limit hit: ${portfolio.pnlWeekPct.toFixed(2)}% (limit ${weeklyDrawdownLimit}%)` };
  }

  // Max drawdown
  if (portfolio.drawdownFromPeak >= maxDrawdown) {
    logger.error(`🚨 MAX DRAWDOWN HIT: ${portfolio.drawdownFromPeak.toFixed(2)}% — ACTIVATING KILL SWITCH`);
    activateKillSwitch();
    getIO()?.emit('guardrail:triggered', { rule: 'MAX_DRAWDOWN_KILL_SWITCH', value: portfolio.drawdownFromPeak });
    return { approved: false, reason: `Max drawdown emergency stop: ${portfolio.drawdownFromPeak.toFixed(2)}%` };
  }

  // Daily trade limit
  if (portfolio.tradesExecutedToday >= maxTradesPerDay) {
    return { approved: false, reason: `Daily trade limit: ${portfolio.tradesExecutedToday}` };
  }

  // Cash reserve check
  const cashPct = (portfolio.cashBalance / portfolio.totalValue) * 100;
  if (cashPct < cashReservePct) {
    return { approved: false, reason: `Cash reserve too low: ${cashPct.toFixed(1)}% (min: ${cashReservePct}%)` };
  }

  // Position concentration check — signal.positionSizePct is already a
  // percent of portfolio (from Kelly/micro-position sizing), so the trade's
  // dollar value is just that percent of totalValue.
  const tradeValuePct = signal.positionSizePct || 0;
  if (tradeValuePct > maxPositionPct) {
    return { approved: false, reason: `Position size would exceed ${maxPositionPct}% limit` };
  }

  // Cross-asset correlation check — topTraderRules LAW 15 only counts crypto
  // positions, so e.g. 5 correlated tech stocks wasn't caught. Uses real
  // Pearson correlation on daily returns (correlationService), not the flat
  // always-true stub this used to be.
  const heldAssets = (portfolio.positions || []).map((p: any) => p.asset).filter((a: string) => a !== signal.asset);
  if (heldAssets.length > 0) {
    const concentration = await correlationService.shouldAddAssetToPortfolio(signal.asset, heldAssets, 0.7).catch(() => null);
    if (concentration && !concentration.shouldAdd) {
      logger.warn(`🛑 Concentration risk blocked: ${signal.asset}`, { reason: concentration.reason });
      return { approved: false, reason: concentration.reason };
    }
  }

  return { approved: true };
}

// ── STOP LOSS MONITOR ─────────────────────────────────────────────────────────
export async function checkStopLosses(currentPrices: Record<string, number>) {
  try {
    const openPositions = await prisma.position.findMany({ where: { status: 'OPEN' } });

    for (const position of openPositions) {
      const currentPrice = currentPrices[position.asset];
      if (!currentPrice) continue;

      const isShort = position.side === 'SELL';
      const pnlPct = isShort
        ? ((position.entryPrice - currentPrice) / position.entryPrice) * 100
        : ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      const unrealizedPnl = isShort
        ? (position.entryPrice - currentPrice) * position.quantity
        : (currentPrice - position.entryPrice) * position.quantity;

      await prisma.position.update({
        where: { id: position.id },
        data: { currentPrice, unrealizedPnl, unrealizedPnlPct: pnlPct }
      });

      // Stop loss: for LONG price falls below stop, for SHORT price rises above stop
      const stopHit = isShort
        ? currentPrice >= position.stopLossPrice
        : currentPrice <= position.stopLossPrice;

      // Take profit: for LONG price rises above target, for SHORT price falls below target
      const tpHit = isShort
        ? currentPrice <= position.takeProfitPrice
        : currentPrice >= position.takeProfitPrice;

      if (stopHit) {
        logger.warn(`🛑 STOP LOSS TRIGGERED for ${position.asset} (${isShort ? 'SHORT' : 'LONG'}): $${currentPrice}`);
        await closePosition(position, currentPrice, 'stop_loss');
      } else if (tpHit) {
        logger.info(`🎯 TAKE PROFIT HIT for ${position.asset} (${isShort ? 'SHORT' : 'LONG'}): $${currentPrice}`);
        await closePosition(position, currentPrice, 'take_profit');
      }
    }
  } catch (error) {
    logger.error('Stop loss check failed', { error });
  }
}

const closingPositions = new Map<string, Promise<{ pnl: number; pnlPct: number }>>();

export async function closePosition(position: any, exitPrice: number, reason: string) {
  const pending = closingPositions.get(position.id);
  if (pending) return pending;
  const operation = closePositionOnce(position, exitPrice, reason);
  closingPositions.set(position.id, operation);
  try {
    return await operation;
  } finally {
    closingPositions.delete(position.id);
  }
}

async function closePositionOnce(position: any, exitPrice: number, reason: string) {
  assertPaperTrading();
  const current = await prisma.position.findUnique({ where: { id: position.id } });
  if (!current || current.status !== 'OPEN') throw new Error('Position is no longer open');
  position = current;
  const openTrade = await prisma.trade.findFirst({
    where: { asset: position.asset, market: position.market, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  });
  if (!openTrade) throw new Error('No open trade found for position');

  if (position.market === 'stocks') {
    if (!openTrade.brokerConfirmed || !openTrade.brokerOrderId) {
      throw new Error('Stock entry is not broker-confirmed; reconcile before closing');
    }
    const broker = createAlpacaBroker(true);
    if (!broker) throw new Error('Paper broker unavailable; position remains open');
    // A stable broker-side key survives restarts and a lost submission response.
    // Reuse the original exit on retry instead of submitting a second sell/buy.
    const clientOrderId = `close-${openTrade.id}`;
    let order = await broker.getOrderByClientId(clientOrderId);
    if (!order) {
      const held = await broker.getPosition(position.asset);
      if (!held || Math.abs(Number(held.qty) - (position.side === 'SELL' ? -position.quantity : position.quantity)) > 1e-6) {
        throw new Error('Broker position differs from local position; reconciliation required');
      }
      try {
        order = await broker.createOrder({
          symbol: position.asset,
          qty: position.quantity,
          side: position.side === 'SELL' ? 'buy' : 'sell',
          type: 'market',
          time_in_force: 'day',
          client_order_id: clientOrderId,
        });
      } catch (error) {
        order = await broker.getOrderByClientId(clientOrderId);
        if (!order) throw error;
      }
    }
    const fill = await confirmOrderFill(broker, order.id);
    if (Math.abs(fill.fillQty - position.quantity) > 1e-6) {
      throw new Error('Exit fill quantity differs from position; reconciliation required');
    }
    exitPrice = fill.fillPrice;
  }
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) throw new Error('A valid current exit price is required');
  const isShort = position.side === 'SELL';
  const pnl = isShort
    ? (position.entryPrice - exitPrice) * position.quantity
    : (exitPrice - position.entryPrice) * position.quantity;
  const pnlPct = isShort
    ? ((position.entryPrice - exitPrice) / position.entryPrice) * 100
    : ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

  // Commit trade and position together. A failed DB commit can safely retry
  // using the same confirmed exit order above.
  await prisma.$transaction(async tx => {
    const updated = await tx.trade.updateMany({
      where: { id: openTrade.id, status: 'OPEN' },
      data: { exitPrice, pnl, pnlPct, status: 'CLOSED', closedAt: new Date(), exitReason: reason }
    });
    if (updated.count !== 1) throw new Error('Trade was already closed');
    await tx.position.update({
      where: { id: position.id },
      data: { status: 'CLOSED', currentPrice: exitPrice, unrealizedPnl: 0, unrealizedPnlPct: 0 }
    });
  });

  getIO()?.emit('position:closed', { asset: position.asset, exitPrice, pnl, pnlPct, reason });
  logger.info(`Position closed: ${position.asset} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) | Reason: ${reason}`);
  return { pnl, pnlPct };
}
