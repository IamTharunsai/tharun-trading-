import { prisma } from '../utils/prisma';
import { getCurrentPrices } from './marketData';
import { getPortfolioState } from './portfolio';

export interface PerformanceMetrics {
  accountId?: string;
  brokerMode?: string;
  riskDataComplete?: boolean;
  feeDataComplete?: boolean;
  totalEquity: number;
  cashBalance: number;
  buyingPower: number;
  investedCollateral: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  dailyPnl: number;
  dailyPnlPct: number;
  totalFeesPaid: number;
  winRatePct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number | string;
  expectancy: number;
  sharpeRatio: number | string;
  sortinoRatio: number | string;
  maxDrawdownPct: number;
  exposurePct: number;
  turnover: number;
  alpacaEquity: number;
  polymarketEquity: number;
  combinedTotal: number;
  dataSource: string;
  isStale: boolean;
  timestamp: string;
}

// Display rounding; stored broker/accounting evidence retains full precision.
function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export async function calculateAuthenticatedPortfolio(): Promise<PerformanceMetrics> {
  const currentPortfolio = await getPortfolioState();
  const scope = { accountId: currentPortfolio.accountId, brokerMode: currentPortfolio.brokerMode };
  const prices = getCurrentPrices();
  const openPositions = currentPortfolio.positions;
  const allClosedTrades = await prisma.trade.findMany({ where: { ...scope, status: 'CLOSED' } });
  const partiallyClosed = await prisma.trade.findMany({ where: { ...scope, status: 'OPEN' } });

  // 1. Calculate Realized Trade Stats
  let realizedPnl = partiallyClosed.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0);
  let totalFeesPaid = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let breakEvenTrades = 0;
  let totalWinDollars = 0;
  let totalLossDollars = 0;

  for (const t of allClosedTrades) {
    const pnl = Number(t.pnl) || 0;
    const fees = Number(t.fees) || 0;
    realizedPnl += pnl;
    totalFeesPaid += fees;

    if (pnl > 0.0001) {
      winningTrades++;
      totalWinDollars += pnl;
    } else if (pnl < -0.0001) {
      losingTrades++;
      totalLossDollars += Math.abs(pnl);
    } else {
      breakEvenTrades++;
    }
  }

  const totalTrades = allClosedTrades.length;
  const winRatePct = totalTrades > 0 ? round2((winningTrades / totalTrades) * 100) : 0;
  const averageWin = winningTrades > 0 ? round2(totalWinDollars / winningTrades) : 0;
  const averageLoss = losingTrades > 0 ? round2(totalLossDollars / losingTrades) : 0;
  
  // Profit factor = gross profits / gross losses
  let profitFactor: number | string = 'N/A';
  if (totalLossDollars > 0) {
    profitFactor = round2(totalWinDollars / totalLossDollars);
  } else if (totalWinDollars > 0) {
    profitFactor = '∞';
  } else if (totalTrades > 0) {
    profitFactor = 0;
  }

  // Expectancy = (Win% * AvgWin) - (Loss% * AvgLoss)
  const winProb = totalTrades > 0 ? winningTrades / totalTrades : 0;
  const lossProb = totalTrades > 0 ? losingTrades / totalTrades : 0;
  const expectancy = round2((winProb * averageWin) - (lossProb * averageLoss));

  // 2. Calculate Open Positions & Unrealized PnL
  let investedCollateral = 0;
  let unrealizedPnl = 0;

  for (const pos of openPositions) {
    const currentPrice = prices[pos.asset] || pos.currentPrice;
    const positionValue = currentPrice * pos.quantity;
    investedCollateral += positionValue;

    const isShort = pos.side === 'SELL';
    const posUnrealized = isShort
      ? (pos.entryPrice - currentPrice) * pos.quantity
      : (currentPrice - pos.entryPrice) * pos.quantity;

    unrealizedPnl += posUnrealized;
  }

  // Equity/cash are scoped to the verified current broker account. Prediction
  // wallets are separate accounts and must not be mixed with a paper ledger.
  const alpacaEquity = currentPortfolio.totalValue;
  const polymarketEquity = 0;
  const totalEquity = currentPortfolio.totalValue;
  const cashBalance = currentPortfolio.cashBalance;
  const buyingPower = currentPortfolio.buyingPower ?? 0;
  const dataSource = `ALPACA_AUTHENTICATED_${currentPortfolio.brokerMode?.toUpperCase()}`;
  const totalPnl = round2(realizedPnl + unrealizedPnl);
  const dailyPnl = round2(currentPortfolio.pnlDay);
  const dailyPnlPct = round2(currentPortfolio.pnlDayPct);
  // Dollar trade profits are not period returns. A reconciled cash-flow-adjusted
  // return series is required before publishing Sharpe or Sortino.
  const sharpeRatio = 'N/A: verified return series required';
  const sortinoRatio = 'N/A: verified return series required';
  // Drawdown from peak
  const peakSnap = await prisma.portfolioSnapshot.findFirst({ where: scope, orderBy: { totalValue: 'desc' } });
  const peak = peakSnap ? Math.max(peakSnap.totalValue, totalEquity) : totalEquity;
  const maxDrawdownPct = (peak > 0 && totalEquity > 0) ? round2(((peak - totalEquity) / peak) * 100) : 0;

  // Exposure %
  const exposurePct = totalEquity > 0 ? round2((investedCollateral / totalEquity) * 100) : 0;

  return {
    accountId: currentPortfolio.accountId, brokerMode: currentPortfolio.brokerMode,
    riskDataComplete: currentPortfolio.riskDataComplete, feeDataComplete: false,
    totalEquity: round2(totalEquity),
    cashBalance: round2(cashBalance),
    buyingPower: round2(buyingPower),
    investedCollateral: round2(investedCollateral),
    realizedPnl: round2(realizedPnl),
    unrealizedPnl: round2(unrealizedPnl),
    totalPnl,
    dailyPnl,
    dailyPnlPct,
    totalFeesPaid: round2(totalFeesPaid),
    winRatePct,
    totalTrades,
    winningTrades,
    losingTrades,
    breakEvenTrades,
    averageWin,
    averageLoss,
    profitFactor,
    expectancy,
    sharpeRatio,
    sortinoRatio,
    maxDrawdownPct,
    exposurePct,
    turnover: totalTrades,
    alpacaEquity: round2(alpacaEquity),
    polymarketEquity: round2(polymarketEquity),
    combinedTotal: round2(totalEquity),
    dataSource,
    isStale: false,
    timestamp: new Date().toISOString()
  };
}
