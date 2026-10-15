import { prisma } from '../utils/prisma';
import { PortfolioState } from '../agents/types';
import { getCurrentPrices } from './marketData';
import { getVerifiedAccountScope } from '../trading/accountScope';

/** Current account only. Legacy history is not silently assigned to new credentials. */
export async function getPortfolioState(): Promise<PortfolioState> {
  const scope = await getVerifiedAccountScope();
  const summary = await scope.broker.getPortfolioSummary();
  if (!summary || summary.account_id !== scope.accountId || !Number.isFinite(summary.portfolio_value)
    || summary.portfolio_value <= 0 || !Number.isFinite(summary.cash) || summary.cash < 0) throw new Error('VERIFIED_ACCOUNT_VALUE_UNAVAILABLE');
  const where = { accountId: scope.accountId, brokerMode: scope.mode };
  const prices = getCurrentPrices();
  const rows = await prisma.position.findMany({ where: { ...where, status: 'OPEN' } });
  const positions = rows.map(position => ({ ...position, ledgerQuantity: position.quantity }));
  let invested = 0;
  let unrealizedPnl = 0;
  for (const position of positions) {
    const price = Number(prices[position.asset] ?? position.currentPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error('POSITION_VALUE_UNAVAILABLE');
    // Exposure includes observed holdings; trade P&L uses execution inventory.
    invested += price * Math.max(position.quantity, position.brokerObservedQuantity ?? 0);
    if (position.quantity <= 0) continue; // Keep unresolved ledger rows visible.
    const pnl = (price - position.entryPrice) * position.quantity * (position.side === 'SELL' ? -1 : 1);
    const pnlPct = (price - position.entryPrice) / position.entryPrice * 100 * (position.side === 'SELL' ? -1 : 1);
    unrealizedPnl += pnl;
    Object.assign(position, { currentPrice: price, unrealizedPnl: pnl, unrealizedPnlPct: pnlPct });
    await prisma.position.update({ where: { id: position.id }, data: { currentPrice: price, unrealizedPnl: pnl, unrealizedPnlPct: pnlPct } });
  }
  const trades = await prisma.trade.findMany({ where: { ...where, status: { in: ['OPEN', 'CLOSED'] } } });
  const historyDataComplete = trades.every(trade => !(trade.metadata && typeof trade.metadata === 'object'
    && !Array.isArray(trade.metadata) && trade.metadata.historyAvailable === false));
  const hiddenDiscrepancies = await prisma.position.count({ where: { ...where, status: 'CLOSED', accountingStatus: 'RECONCILIATION_REQUIRED' } });
  const realizedPnl = trades.reduce((sum, trade) => sum + (trade.status === 'CLOSED' ? trade.pnl ?? 0 : trade.realizedPnl ?? 0), 0);
  const totalValue = summary.portfolio_value;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const day = await prisma.portfolioSnapshot.findFirst({ where: { ...where, timestamp: { lt: today } }, orderBy: { timestamp: 'desc' } });
  const week = await prisma.portfolioSnapshot.findFirst({ where: { ...where, timestamp: { gte: new Date(Date.now() - 7 * 86400000) } }, orderBy: { timestamp: 'asc' } });
  const peak = await prisma.portfolioSnapshot.findFirst({ where, orderBy: { totalValue: 'desc' } });
  const dayBaseline = day?.totalValue ?? summary.last_equity;
  const dayKnown = Number.isFinite(dayBaseline) && dayBaseline > 0;
  const weekKnown = !!week && Number.isFinite(week.totalValue) && week.totalValue > 0;
  const pnlDay = dayKnown ? totalValue - dayBaseline : 0;
  const pnlDayPct = dayKnown ? pnlDay / dayBaseline * 100 : 0;
  const pnlWeekPct = weekKnown ? (totalValue - week.totalValue) / week.totalValue * 100 : 0;
  const peakValue = Math.max(peak?.totalValue ?? totalValue, totalValue);
  return {
    accountId: scope.accountId, brokerMode: scope.mode, buyingPower: summary.buying_power,
    riskDataComplete: dayKnown && weekKnown,
    historyDataComplete,
    accountingComplete: historyDataComplete && hiddenDiscrepancies === 0 && positions.every(position => position.accountingStatus === 'RECONCILED'),
    totalValue, cashBalance: summary.cash, invested, pnlDay, pnlDayPct, pnlWeekPct,
    pnlTotal: realizedPnl + unrealizedPnl,
    positions: positions.map(position => position.accountingStatus === 'RECONCILED' ? position
      : { ...position, unrealizedPnl: null, unrealizedPnlPct: null }),
    tradesExecutedToday: await prisma.trade.count({ where: { ...where, brokerConfirmed: true, openedAt: { gte: today }, status: { in: ['OPEN', 'CLOSED'] } } }),
    dailyLossToday: Math.max(0, -pnlDay), drawdownFromPeak: (peakValue - totalValue) / peakValue * 100,
  };
}
