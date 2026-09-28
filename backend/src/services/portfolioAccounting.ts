import { prisma } from '../utils/prisma';
import { getCurrentPrices } from './marketData';
import { accountManager } from './accountManager';
import { appConfig } from '../utils/config';

export interface PerformanceMetrics {
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

// Decimal-safe precision rounding
function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function round4(val: number): number {
  return Math.round((val + Number.EPSILON) * 10000) / 10000;
}

export async function calculateAuthenticatedPortfolio(): Promise<PerformanceMetrics> {
  const prices = getCurrentPrices();
  const openPositions = await prisma.position.findMany({ where: { status: 'OPEN' } });
  const allClosedTrades = await prisma.trade.findMany({ where: { status: 'CLOSED' } });

  // 1. Calculate Realized Trade Stats
  let realizedPnl = 0;
  let totalFeesPaid = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let breakEvenTrades = 0;
  let totalWinDollars = 0;
  let totalLossDollars = 0;
  const pnlList: number[] = [];

  for (const t of allClosedTrades) {
    const pnl = Number(t.pnl) || 0;
    const fees = Number(t.fees) || 0;
    realizedPnl += pnl;
    totalFeesPaid += fees;
    pnlList.push(pnl);

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

  // 3. Ground-truth Broker & Wallet Synchronization
  let alpacaEquity = 0;
  let alpacaCash = 0;
  let alpacaBuyingPower = 0;
  let polymarketEquity = 0;
  let dataSource = 'INTERNAL_LEDGER';

  if (accountManager.isAlpacaConnected()) {
    const alp = accountManager.getAlpacaState();
    alpacaEquity = alp.portfolioValue;
    alpacaCash = alp.cash;
    alpacaBuyingPower = alp.buyingPower;
    dataSource = 'ALPACA_AUTHENTICATED';
  }

  if (accountManager.isPolymarketConnected()) {
    const poly = accountManager.getPolymarketState();
    polymarketEquity = poly.portfolioValue;
    if (dataSource === 'ALPACA_AUTHENTICATED') {
      dataSource = 'HYBRID_ALPACA_POLYMARKET';
    } else {
      dataSource = 'POLYMARKET_ONCHAIN';
    }
  }

  // If live broker is connected, use real live broker equity
  let totalEquity = 0;
  let cashBalance = 0;
  let buyingPower = 0;

  if (accountManager.isAlpacaConnected() || accountManager.isPolymarketConnected()) {
    totalEquity = round2(alpacaEquity + polymarketEquity);
    cashBalance = round2(alpacaCash + (accountManager.getPolymarketState()?.usdcBalance || 0));
    buyingPower = round2(alpacaBuyingPower + (accountManager.getPolymarketState()?.usdcBalance || 0));
  } else {
    // When no external broker keys are connected, report authentic ledger totals
    // Do not fabricate a fake $100k balance — report real cash deposits or zero
    const deposits = Number(process.env.INITIAL_LEDGER_DEPOSIT) || 0;
    cashBalance = round2(deposits + realizedPnl - investedCollateral);
    totalEquity = round2(cashBalance + investedCollateral + unrealizedPnl);
    buyingPower = cashBalance;
  }

  const totalPnl = round2(realizedPnl + unrealizedPnl);

  // Daily P&L calculated against start-of-day snapshot
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfDaySnap = await prisma.portfolioSnapshot.findFirst({
    where: { timestamp: { lt: today } },
    orderBy: { timestamp: 'desc' }
  });

  const dailyPnl = (startOfDaySnap && totalEquity > 0)
    ? round2(totalEquity - startOfDaySnap.totalValue)
    : round2(realizedPnl + unrealizedPnl);

  const dailyPnlPct = (startOfDaySnap && startOfDaySnap.totalValue > 0 && totalEquity > 0)
    ? round2((dailyPnl / startOfDaySnap.totalValue) * 100)
    : (totalEquity > 0 ? round2((dailyPnl / totalEquity) * 100) : 0);

  // Sharpe and Sortino Ratios (strictly calculated if >= 10 returns exist)
  let sharpeRatio: number | string = 'N/A (<10 trades)';
  let sortinoRatio: number | string = 'N/A (<10 trades)';

  if (pnlList.length >= 10) {
    const mean = pnlList.reduce((a, b) => a + b, 0) / pnlList.length;
    const variance = pnlList.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / (pnlList.length - 1);
    const stdDev = Math.sqrt(variance);

    if (stdDev > 0) {
      sharpeRatio = round2(mean / stdDev);
    }

    const downReturns = pnlList.filter(p => p < 0);
    if (downReturns.length > 0) {
      const downVariance = downReturns.reduce((sum, p) => sum + Math.pow(p, 2), 0) / downReturns.length;
      const downDev = Math.sqrt(downVariance);
      if (downDev > 0) {
        sortinoRatio = round2(mean / downDev);
      }
    }
  }

  // Drawdown from peak
  const peakSnap = await prisma.portfolioSnapshot.findFirst({ orderBy: { totalValue: 'desc' } });
  const peak = peakSnap ? Math.max(peakSnap.totalValue, totalEquity) : totalEquity;
  const maxDrawdownPct = (peak > 0 && totalEquity > 0) ? round2(((peak - totalEquity) / peak) * 100) : 0;

  // Exposure %
  const exposurePct = totalEquity > 0 ? round2((investedCollateral / totalEquity) * 100) : 0;

  return {
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
