import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { TradeSignal, PortfolioState } from '../agents/types';
import { getIO } from '../websocket/server';
import { activateKillSwitch } from '../agents/orchestrator';

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

  // Daily loss limit
  if (portfolio.pnlDayPct <= -dailyLossLimit) {
    logger.warn(`🛑 Daily loss limit hit: ${portfolio.pnlDayPct.toFixed(2)}%`);
    getIO()?.emit('guardrail:triggered', { rule: 'DAILY_LOSS_LIMIT', value: portfolio.pnlDayPct });
    return { approved: false, reason: `Daily loss limit: ${portfolio.pnlDayPct.toFixed(2)}%` };
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

  // Position concentration check
  const tradeValue = signal.entryPrice * 0.01 * maxPositionPct; // rough estimate
  if ((tradeValue / portfolio.totalValue) * 100 > maxPositionPct) {
    return { approved: false, reason: `Position size would exceed ${maxPositionPct}% limit` };
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

      const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      // Update current price
      await prisma.position.update({
        where: { id: position.id },
        data: { currentPrice, unrealizedPnl: (currentPrice - position.entryPrice) * position.quantity, unrealizedPnlPct: pnlPct }
      });

      // Stop loss check
      if (currentPrice <= position.stopLossPrice) {
        logger.warn(`🛑 STOP LOSS TRIGGERED for ${position.asset}: $${currentPrice} <= $${position.stopLossPrice}`);
        await triggerStopLoss(position, currentPrice, 'stop_loss');
      }

      // Take profit check
      if (currentPrice >= position.takeProfitPrice) {
        logger.info(`🎯 TAKE PROFIT HIT for ${position.asset}: $${currentPrice} >= $${position.takeProfitPrice}`);
        await triggerStopLoss(position, currentPrice, 'take_profit');
      }
    }
  } catch (error) {
    logger.error('Stop loss check failed', { error });
  }
}

async function triggerStopLoss(position: any, exitPrice: number, reason: string) {
  const pnl = (exitPrice - position.entryPrice) * position.quantity;
  const pnlPct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

  // Close the trade
  const openTrade = await prisma.trade.findFirst({
    where: { asset: position.asset, status: 'OPEN' }
  });

  if (openTrade) {
    await prisma.trade.update({
      where: { id: openTrade.id },
      data: { exitPrice, pnl, pnlPct, status: 'CLOSED', closedAt: new Date(), exitReason: reason }
    });
  }

  await prisma.position.update({
    where: { id: position.id },
    data: { status: 'CLOSED' }
  });

  getIO()?.emit('position:closed', { asset: position.asset, exitPrice, pnl, pnlPct, reason });
  logger.info(`Position closed: ${position.asset} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) | Reason: ${reason}`);
}
