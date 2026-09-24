import { PortfolioState, TradeSignal } from '../agents/types';
import { resolveSurvivalPolicy } from '../services/survivalEngine';

/** All limits apply to the submitted quantity, including fractional rounding. */
export function executionQuantity(signal: TradeSignal, portfolio: PortfolioState, proposedQty: number): number {
  const values = [signal.entryPrice, signal.stopLossPrice, signal.takeProfitPrice, signal.positionSizePct,
    portfolio.totalValue, proposedQty];
  if (values.some(v => !Number.isFinite(v) || v <= 0) || !Number.isFinite(portfolio.cashBalance)) return 0;
  const long = signal.direction === 'BUY';
  if (!long && signal.direction !== 'SELL') return 0;
  if (long ? signal.stopLossPrice >= signal.entryPrice || signal.takeProfitPrice <= signal.entryPrice
    : signal.stopLossPrice <= signal.entryPrice || signal.takeProfitPrice >= signal.entryPrice) return 0;

  const policy = resolveSurvivalPolicy({ bankroll: portfolio.totalValue, drawdownFromPeakPct: portfolio.drawdownFromPeak, dailyLossPct: portfolio.pnlDayPct });
  if (policy.riskMultiplier === 0) return 0;
  const reservePct = Number(process.env.CASH_RESERVE_PCT || '30');
  const maxPositionPct = Number(process.env.MAX_POSITION_SIZE_PCT || '10');
  if (!Number.isFinite(reservePct) || reservePct < 0 || reservePct > 100 || !Number.isFinite(maxPositionPct) || maxPositionPct <= 0) return 0;
  const available = Math.max(0, portfolio.cashBalance - portfolio.totalValue * reservePct / 100);
  const allocation = portfolio.totalValue * Math.min(signal.positionSizePct, maxPositionPct) / 100;
  const riskQty = portfolio.totalValue * policy.maxRiskPerTradePct / 100 / Math.abs(signal.entryPrice - signal.stopLossPrice);
  const capped = Math.min(proposedQty, allocation / signal.entryPrice, available / signal.entryPrice, riskQty);
  // Alpaca permits fractional long orders, but opening fractional shorts is unsupported.
  const precision = signal.market === 'stocks' && !long ? 1 : 1e6;
  return Math.floor(capped * precision) / precision;
}
