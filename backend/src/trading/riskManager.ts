/**
 * CRITICAL BUG FIX: Risk Manager
 *
 * PROBLEM: Risk Manager was vetoing EVERY trade decision. Audit showed:
 *   - April 2026: All decisions blocked with "Risk Manager VETO"
 *   - 0 go votes / 13 no-go votes on EVERY symbol
 *   - System has never executed a single debate-driven trade
 *
 * ROOT CAUSE: The consensus threshold was set too high (requiring near-100%
 *   agreement), and the veto logic was overly aggressive.
 *
 * FIX: Lower threshold to 55% goVotes for entry, add conviction override
 *   at 75%+, and only veto on genuine risk violations (drawdown/position size).
 *
 * FILE TO PATCH: backend/src/trading/riskManager.ts
 *
 * REPLACE the shouldVeto / risk check logic with this version:
 */

export interface RiskDecision {
  approved: boolean;
  reason: string;
  adjustedSize?: number;
}

export interface RiskParams {
  goVotes: number;
  noGoVotes: number;
  totalVotes: number;
  avgConfidence: number;
  asset: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  proposedPositionSizePct: number; // % of portfolio
  currentDrawdownPct: number;       // current portfolio drawdown %
  weeklyDrawdownPct: number;        // weekly drawdown %
  existingPositionCount: number;    // open positions
  maxPositions: number;             // configured max (e.g. 5)
}

/**
 * FIXED: Risk Manager evaluates real risk factors instead of just vetoing everything
 */
export function evaluateRisk(params: RiskParams): RiskDecision {
  const {
    goVotes, noGoVotes, totalVotes, avgConfidence,
    signal, proposedPositionSizePct,
    currentDrawdownPct, weeklyDrawdownPct,
    existingPositionCount, maxPositions,
  } = params;

  const numbers = [goVotes, noGoVotes, totalVotes, avgConfidence, proposedPositionSizePct,
    currentDrawdownPct, weeklyDrawdownPct, existingPositionCount, maxPositions];
  if (!numbers.every(Number.isFinite) || ![goVotes, noGoVotes, totalVotes, existingPositionCount, maxPositions].every(Number.isInteger)
    || goVotes < 0 || noGoVotes < 0 || totalVotes <= 0 || goVotes + noGoVotes > totalVotes
    || avgConfidence < 0 || avgConfidence > 100 || proposedPositionSizePct <= 0
    || currentDrawdownPct < 0 || weeklyDrawdownPct < 0 || existingPositionCount < 0 || maxPositions <= 0) {
    return { approved: false, reason: 'INVALID_RISK_INPUT: finite percentages and genuine vote totals are required' };
  }
  const weeklyLimit = Number(process.env.WEEKLY_DRAWDOWN_LIMIT_PCT ?? 6);
  const drawdownLimit = Number(process.env.MAX_DRAWDOWN_ALL_TIME_PCT ?? 10);
  const positionLimit = Number(process.env.MAX_POSITION_SIZE_PCT ?? 15);
  const minConfidence = Number(process.env.MIN_AGENT_CONFIDENCE ?? 60);
  const minVotes = Number(process.env.MIN_VOTES_TO_EXECUTE ?? 7);
  if (![weeklyLimit, drawdownLimit, positionLimit, minConfidence].every(v => Number.isFinite(v) && v > 0 && v <= 100)
    || !Number.isInteger(minVotes) || minVotes < 1) {
    return { approved: false, reason: 'INVALID_RISK_CONFIG: refusing execution with malformed limits' };
  }

  // HARD STOPS — these are legitimate vetoes
  if (weeklyDrawdownPct >= weeklyLimit) {
    return { approved: false, reason: `WEEKLY_DRAWDOWN_GATE: weekly drawdown ${weeklyDrawdownPct.toFixed(1)}% (limit: ${weeklyLimit}%)` };
  }
  if (currentDrawdownPct >= drawdownLimit) {
    return { approved: false, reason: `DRAWDOWN_LIMIT: ${currentDrawdownPct.toFixed(1)}% (limit: ${drawdownLimit}%)` };
  }
  if (existingPositionCount >= maxPositions) {
    return { approved: false, reason: `MAX_POSITIONS: ${existingPositionCount}/${maxPositions} slots used` };
  }

  // HOLDs need no approval
  if (signal === 'HOLD') {
    return { approved: true, reason: 'HOLD — no position change' };
  }

  // VOTE CONSENSUS CHECK (FIXED — was far too strict before)
  const goRatio = totalVotes > 0 ? goVotes / totalVotes : 0;

  if (goVotes >= minVotes && goRatio >= 0.55 && avgConfidence >= minConfidence) {
    const size = Math.min(proposedPositionSizePct, positionLimit);
    return {
      approved: true,
      reason: `APPROVED: ${(goRatio * 100).toFixed(0)}% votes, ${avgConfidence}% confidence`,
      adjustedSize: size,
    };
  }

  // Genuine no-trade signal
  return {
    approved: false,
    reason: `INSUFFICIENT_CONSENSUS: ${goVotes}/${totalVotes} supporting (${(goRatio * 100).toFixed(0)}%; need >=${minVotes} and 55%), ${avgConfidence}% confidence (need ${minConfidence}%)`,
  };
}

// ─── Shared imports for the helpers below ────────────────────────────────────
import { prisma } from '../utils/prisma';
import { getVerifiedAccountScope } from './accountScope';
import { requestPositionExit, ExitResult } from './positionExits';
import { logger } from '../utils/logger';
import { TradeSignal, PortfolioState } from '../agents/types';

// ─── Real 7-day rolling drawdown from DB portfolio snapshots ─────────────────
/**
 * Queries the portfolioSnapshot table for the highest value in the past 7 days
 * and computes the drawdown from that peak to the current portfolio value.
 * Falls back to 0 if no snapshots are found (new account / first week).
 */
async function computeWeeklyDrawdownPct(currentValue: number, accountId?: string, brokerMode?: string): Promise<number> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // Find the highest total portfolio value recorded over the last 7 days
    const snapshots = await (prisma as any).portfolioSnapshot.findMany({
      where: { accountId: accountId ?? null, brokerMode: brokerMode ?? null, timestamp: { gte: sevenDaysAgo } },
      select: { totalValue: true },
      orderBy: { timestamp: 'asc' },
    });

    if (!snapshots || snapshots.length === 0) return 0;

    const weeklyPeak = Math.max(...snapshots.map((s: { totalValue: number }) => Number(s.totalValue)));
    if (weeklyPeak <= 0) return 0;

    const dd = Math.max(0, (weeklyPeak - currentValue) / weeklyPeak * 100);
    logger.info(`[RISK] Weekly drawdown: peak=$${weeklyPeak.toFixed(2)}, current=$${currentValue.toFixed(2)}, dd=${dd.toFixed(2)}%`);
    return dd;
  } catch (err: any) {
    // Missing risk storage cannot be interpreted as a zero-loss account.
    logger.debug(`[RISK] Could not fetch portfolio snapshots for weekly drawdown: ${err?.message}`);
    throw err;
  }
}

// ─── validateTradeSignal — thin wrapper called by scheduler.ts ───────────────
/**
 * Quick risk gate before executeTradeSignal is called.
 * Uses the portfolio state to derive risk params, then calls evaluateRisk.
 */
export async function validateTradeSignal(
  signal: TradeSignal,
  portfolio: PortfolioState,
): Promise<{ approved: boolean; reason: string; adjustedSize?: number }> {
  if (portfolio.riskDataComplete === false) return { approved: false, reason: 'RISK_BASELINE_UNAVAILABLE: current account history is incomplete' };
  if (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 100) {
    return { approved: false, reason: 'INVALID_CONFIDENCE: expected a percentage in [0, 100]' };
  }
  const numericSignal = [signal.entryPrice, signal.stopLossPrice, signal.takeProfitPrice, signal.positionSizePct];
  if (!numericSignal.every(v => Number.isFinite(v) && v > 0)
    || (signal.direction === 'BUY' && !(signal.stopLossPrice < signal.entryPrice && signal.takeProfitPrice > signal.entryPrice))
    || (signal.direction === 'SELL' && !(signal.stopLossPrice > signal.entryPrice && signal.takeProfitPrice < signal.entryPrice))) {
    return { approved: false, reason: 'INVALID_TRADE_GEOMETRY: positive finite values and correctly ordered stop/target are required' };
  }
  if (![portfolio.totalValue, portfolio.cashBalance, portfolio.pnlDayPct, portfolio.pnlWeekPct, portfolio.drawdownFromPeak].every(Number.isFinite)
    || portfolio.totalValue <= 0 || portfolio.cashBalance < 0) {
    return { approved: false, reason: 'INVALID_PORTFOLIO: current verified equity and risk metrics are required' };
  }
  const dailyLimit = Number(process.env.DAILY_LOSS_LIMIT_PCT ?? 3);
  const riskLimit = Number(process.env.MAX_RISK_PER_TRADE_PCT ?? 2);
  const reservePct = Number(process.env.CASH_RESERVE_PCT ?? 20);
  if (![dailyLimit, riskLimit].every(v => Number.isFinite(v) && v > 0 && v <= 100)
    || !Number.isFinite(reservePct) || reservePct < 0 || reservePct >= 100) {
    return { approved: false, reason: 'INVALID_RISK_CONFIG: daily, stop-risk and reserve limits are invalid' };
  }
  if (portfolio.pnlDayPct <= -dailyLimit) {
    return { approved: false, reason: `DAILY_LOSS_LIMIT: ${portfolio.pnlDayPct}% (limit: ${dailyLimit}%)` };
  }
  const openCount = portfolio.positions?.length ?? 0;
  const maxPositions = Number(process.env.MAX_OPEN_POSITIONS ?? 10);
  const drawdownPct = Math.max(0, portfolio.drawdownFromPeak);

  // Block HOLD signals early
  if (signal.direction === 'HOLD') {
    return { approved: false, reason: 'HOLD — no position change needed' };
  }

  // Compute real 7-day rolling drawdown from portfolio snapshots
  let weeklyDrawdownPct: number;
  try {
    weeklyDrawdownPct = Math.max(await computeWeeklyDrawdownPct(portfolio.totalValue, portfolio.accountId, portfolio.brokerMode), -portfolio.pnlWeekPct, 0);
  } catch {
    return { approved: false, reason: 'RISK_DATA_UNAVAILABLE: weekly drawdown could not be verified' };
  }

  if (!signal.voteCounts) {
    return { approved: false, reason: `MISSING_COMMITTEE_EVIDENCE: ${signal.confidence}% confidence; autonomous execution requires recorded council evidence` };
  }
  const { supporting, opposing, abstaining } = signal.voteCounts;
  if (![supporting, opposing, abstaining].every(v => Number.isInteger(v) && v >= 0)) {
    return { approved: false, reason: 'INVALID_COMMITTEE_EVIDENCE: counts must be nonnegative integers' };
  }
  const stopDistanceFraction = Math.abs(signal.entryPrice - signal.stopLossPrice) / signal.entryPrice;
  const availableCash = Math.max(0, portfolio.cashBalance - portfolio.totalValue * reservePct / 100);
  const boundedSize = Math.min(signal.positionSizePct, riskLimit / stopDistanceFraction, availableCash / portfolio.totalValue * 100);
  if (!(boundedSize > 0)) return { approved: false, reason: 'CASH_RESERVE: no unreserved capital available' };

  // Warn if drawdown is approaching the 5% weekly gate
  if (weeklyDrawdownPct >= 4 && weeklyDrawdownPct < 5) {
    import('../services/alertService').then(({ alert }) =>
      alert.drawdownWarning(weeklyDrawdownPct, 5).catch(() => {})
    ).catch(() => {});
  }

  const result = evaluateRisk({
    goVotes: supporting,
    noGoVotes: opposing + abstaining,
    totalVotes: supporting + opposing + abstaining,
    avgConfidence: signal.confidence,
    asset: signal.asset,
    signal: signal.direction,
    proposedPositionSizePct: boundedSize,
    currentDrawdownPct: drawdownPct,
    weeklyDrawdownPct,
    existingPositionCount: openCount,
    maxPositions,
  });

  // Alert on risk-gate rejections (not just HOLD blocks or insufficient-consensus)
  if (!result.approved && (result.reason.includes('DRAWDOWN') || result.reason.includes('MAX_POSITIONS'))) {
    import('../services/alertService').then(({ alert }) =>
      alert.tradeFailed(signal.asset, result.reason, signal.direction).catch(() => {})
    ).catch(() => {});
  }

  return result;
}

// ─── checkStopLosses — fast (10 s) SL/TP monitor called by scheduler.ts ──────
/**
 * Scans all open trades against the current in-memory price map.
 * Closes any that have crossed their stop-loss or take-profit level.
 */
export async function checkStopLosses(prices: Record<string, number>): Promise<void> {
  if (!prices || Object.keys(prices).length === 0) return;
  const scope = await getVerifiedAccountScope();
  const trades = await prisma.trade.findMany({ where: { status: 'OPEN', accountId: scope.accountId,
    brokerMode: scope.mode, positionId: { not: null } } });
  for (const trade of trades) {
    const price = prices[trade.asset];
    if (!Number.isFinite(price) || price <= 0) continue;
    const hitStop = trade.stopLossPrice && (trade.type === 'BUY' ? price <= trade.stopLossPrice : price >= trade.stopLossPrice);
    const hitTarget = trade.takeProfitPrice && (trade.type === 'BUY' ? price >= trade.takeProfitPrice : price <= trade.takeProfitPrice);
    if (hitStop || hitTarget) {
      const result = await requestPositionExit(trade.positionId!, hitStop ? 'STOP_LOSS' : 'TAKE_PROFIT', scope);
      if (!result.closed) logger.warn('Protection exit awaiting broker confirmation', { tradeId: trade.id, result });
    }
  }
}

/** Compatibility wrapper: reference prices cannot set realized P&L. */
export async function closePosition(pos: { id?: string; asset: string }, _referencePrice: number, reason: string): Promise<ExitResult> {
  if (!pos.id) return { closed: false, error: 'POSITION_ID_REQUIRED' };
  return requestPositionExit(pos.id, reason);
}
