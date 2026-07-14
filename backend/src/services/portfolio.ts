import { prisma } from '../utils/prisma';
import { PortfolioState } from '../agents/types';
import { getCurrentPrices } from './marketData';
import { createAlpacaBroker } from './alpacaBroker';
import { logger } from '../utils/logger';

const STARTING_CAPITAL = parseFloat(process.env.STARTING_CAPITAL || '100000');

export async function getPortfolioState(): Promise<PortfolioState> {
  const prices = getCurrentPrices();
  const openPositions = await prisma.position.findMany({ where: { status: 'OPEN' } });

  let invested = 0;
  let unrealizedPnlTotal = 0;
  for (const pos of openPositions) {
    const currentPrice = prices[pos.asset] || pos.currentPrice;
    invested += currentPrice * pos.quantity;
    const isShort = pos.side === 'SELL';
    const unrealizedPnl = isShort
      ? (pos.entryPrice - currentPrice) * pos.quantity
      : (currentPrice - pos.entryPrice) * pos.quantity;
    const unrealizedPnlPct = isShort
      ? ((pos.entryPrice - currentPrice) / pos.entryPrice) * 100
      : ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    unrealizedPnlTotal += unrealizedPnl;
    await prisma.position.update({
      where: { id: pos.id },
      data: { currentPrice, unrealizedPnl, unrealizedPnlPct }
    }).catch(() => {});
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tradesExecutedToday = await prisma.trade.count({ where: { openedAt: { gte: today } } });

  // Total P&L = realized (closed trades) + unrealized (open positions) — was
  // realized-only, so it read exactly $0.00 forever until the first trade
  // closed even while open positions had real, visible gains/losses.
  const allTrades = await prisma.trade.findMany({ where: { status: 'CLOSED' } });
  const realizedPnlTotal = allTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const pnlTotal = realizedPnlTotal + unrealizedPnlTotal;

  let cashBalance = STARTING_CAPITAL + pnlTotal - invested;
  let totalValue = cashBalance + invested;

  // Ground-truth reconciliation against the real Alpaca paper account (stocks side).
  // Local DB tracking can drift from Alpaca when orders fill/close asynchronously
  // (stop-loss/take-profit) without a matching local update, so prefer Alpaca's
  // reported cash/portfolio_value over the locally-computed estimate when available.
  const cryptoInvested = openPositions
    .filter(p => p.market === 'crypto')
    .reduce((sum, p) => sum + (prices[p.asset] || p.currentPrice) * p.quantity, 0);

  try {
    const alpaca = createAlpacaBroker(true);
    if (alpaca) {
      const account = await alpaca.getPortfolioSummary();
      if (account) {
        cashBalance = account.cash;
        totalValue = account.portfolio_value + cryptoInvested;
      }
    }
  } catch (err) {
    logger.warn('Alpaca account fetch failed, falling back to locally-tracked portfolio value', { error: (err as Error).message });
  }

  // Today's P&L = change in total portfolio value since the start of today,
  // not just realized trades — matches what "Today's P&L" means on every real
  // broker dashboard (and what the Portfolio Value chart right next to it
  // already implies). Falls back to realized+unrealized when there's no prior
  // snapshot yet (e.g. very first day of a fresh deployment).
  const startOfDaySnapshot = await prisma.portfolioSnapshot.findFirst({
    where: { timestamp: { lt: today } },
    orderBy: { timestamp: 'desc' }
  });
  const pnlDay = startOfDaySnapshot
    ? totalValue - startOfDaySnapshot.totalValue
    : realizedPnlTotal + unrealizedPnlTotal;
  // % denominator must be the baseline (start-of-day) value, matching
  // pnlWeekPct's convention below — dividing by current totalValue instead
  // inflates the magnitude after a loss (100k->50k reads as -100% instead of
  // -50%), which desyncs DAILY_LOSS_LIMIT_PCT from WEEKLY_DRAWDOWN_LIMIT_PCT
  // for an identical dollar swing. No baseline yet (first day) -> fall back
  // to current totalValue, guarded against a zero denominator.
  const pnlDayPct = startOfDaySnapshot
    ? (pnlDay / startOfDaySnapshot.totalValue) * 100
    : (totalValue > 0 ? (pnlDay / totalValue) * 100 : 0);

  // Weekly P&L = same start-of-window snapshot pattern as Today's P&L above,
  // just a 7-day window instead of a same-day one — backs the
  // WEEKLY_DRAWDOWN_LIMIT_PCT circuit breaker in riskManager.ts.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekStartSnapshot = await prisma.portfolioSnapshot.findFirst({
    where: { timestamp: { gte: sevenDaysAgo } },
    orderBy: { timestamp: 'asc' }
  });
  const pnlWeekPct = weekStartSnapshot
    ? ((totalValue - weekStartSnapshot.totalValue) / weekStartSnapshot.totalValue) * 100
    : 0;

  // Get portfolio peak
  const peakSnapshot = await prisma.portfolioSnapshot.findFirst({ orderBy: { totalValue: 'desc' } });
  const peakValue = peakSnapshot?.totalValue || totalValue;
  const drawdownFromPeak = peakValue > 0 ? ((peakValue - totalValue) / peakValue) * 100 : 0;

  return {
    totalValue: Math.max(0, totalValue),
    cashBalance: Math.max(0, cashBalance),
    invested,
    pnlDay,
    pnlDayPct,
    pnlWeekPct,
    pnlTotal,
    positions: openPositions,
    dailyLossToday: pnlDay < 0 ? Math.abs(pnlDay) : 0,
    tradesExecutedToday,
    drawdownFromPeak: Math.max(0, drawdownFromPeak)
  };
}
