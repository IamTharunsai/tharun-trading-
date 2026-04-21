import { prisma } from '../utils/prisma';
import { PortfolioState } from '../agents/types';
import { getCurrentPrices } from './marketData';

const STARTING_CAPITAL = parseFloat(process.env.STARTING_CAPITAL || '100000');

export async function getPortfolioState(): Promise<PortfolioState> {
  const prices = getCurrentPrices();
  const openPositions = await prisma.position.findMany({ where: { status: 'OPEN' } });

  let invested = 0;
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
    await prisma.position.update({
      where: { id: pos.id },
      data: { currentPrice, unrealizedPnl, unrealizedPnlPct }
    }).catch(() => {});
  }

  // Get today's realized P&L
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTrades = await prisma.trade.findMany({
    where: { closedAt: { gte: today }, status: 'CLOSED' }
  });
  const pnlDay = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const tradesExecutedToday = await prisma.trade.count({ where: { openedAt: { gte: today } } });

  // Total P&L
  const allTrades = await prisma.trade.findMany({ where: { status: 'CLOSED' } });
  const pnlTotal = allTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  const cashBalance = STARTING_CAPITAL + pnlTotal - invested;
  const totalValue = cashBalance + invested;
  const pnlDayPct = (pnlDay / totalValue) * 100;

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
    pnlTotal,
    positions: openPositions,
    dailyLossToday: pnlDay < 0 ? Math.abs(pnlDay) : 0,
    tradesExecutedToday,
    drawdownFromPeak: Math.max(0, drawdownFromPeak)
  };
}
