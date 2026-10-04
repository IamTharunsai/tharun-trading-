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

  // HARD STOPS — these are legitimate vetoes
  if (weeklyDrawdownPct >= 5) {
    return { approved: false, reason: `WEEKLY_DRAWDOWN_GATE: -${weeklyDrawdownPct.toFixed(1)}% (limit: 5%)` };
  }
  if (currentDrawdownPct >= 10) {
    return { approved: false, reason: `DRAWDOWN_LIMIT: -${currentDrawdownPct.toFixed(1)}% (limit: 10%)` };
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

  // Conviction override: ≥75% agreement → approve regardless of position size constraints
  if (goRatio >= 0.75 && avgConfidence >= 60) {
    const size = Math.min(proposedPositionSizePct, 10); // cap at 10% per trade
    return {
      approved: true,
      reason: `HIGH_CONVICTION: ${(goRatio * 100).toFixed(0)}% votes, ${avgConfidence}% confidence`,
      adjustedSize: size,
    };
  }

  // Standard approval: ≥55% goVotes AND ≥50% confidence
  if (goRatio >= 0.55 && avgConfidence >= 50) {
    const size = Math.min(proposedPositionSizePct, 7); // moderate cap at 7%
    return {
      approved: true,
      reason: `APPROVED: ${(goRatio * 100).toFixed(0)}% votes, ${avgConfidence}% confidence`,
      adjustedSize: size,
    };
  }

  // Borderline: 45–55% with high confidence
  if (goRatio >= 0.45 && avgConfidence >= 70) {
    const size = Math.min(proposedPositionSizePct, 4); // small size, high confidence
    return {
      approved: true,
      reason: `BORDERLINE_HIGH_CONF: ${(goRatio * 100).toFixed(0)}% votes, ${avgConfidence}% confidence`,
      adjustedSize: size,
    };
  }

  // Genuine no-trade signal
  return {
    approved: false,
    reason: `INSUFFICIENT_CONSENSUS: ${(goRatio * 100).toFixed(0)}% goVotes (need 55%), ${avgConfidence}% confidence (need 50%)`,
  };
}

// ─── Shared imports for the helpers below ────────────────────────────────────
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { TradeSignal, PortfolioState } from '../agents/types';

// ─── validateTradeSignal — thin wrapper called by scheduler.ts ───────────────
/**
 * Quick risk gate before executeTradeSignal is called.
 * Uses the portfolio state to derive risk params, then calls evaluateRisk.
 */
export async function validateTradeSignal(
  signal: TradeSignal,
  portfolio: PortfolioState,
): Promise<{ approved: boolean; reason: string; adjustedSize?: number }> {
  const openCount = portfolio.positions?.length ?? 0;
  const maxPositions = 10;
  const startingCapital = parseFloat(process.env['STARTING_CAPITAL'] || '100000');
  const drawdownPct = portfolio.totalValue > 0 && startingCapital > 0
    ? Math.max(0, (startingCapital - portfolio.totalValue) / startingCapital * 100)
    : 0;

  // Block HOLD signals early
  if (signal.direction === 'HOLD') {
    return { approved: false, reason: 'HOLD — no position change needed' };
  }

  const result = evaluateRisk({
    goVotes: Math.round((signal.confidence ?? 0.6) * 10),
    noGoVotes: 10 - Math.round((signal.confidence ?? 0.6) * 10),
    totalVotes: 10,
    avgConfidence: (signal.confidence ?? 0.6) * 100,
    asset: signal.asset,
    signal: signal.direction,
    proposedPositionSizePct: signal.positionSizePct ?? 5,
    currentDrawdownPct: drawdownPct,
    weeklyDrawdownPct: drawdownPct, // approximate
    existingPositionCount: openCount,
    maxPositions,
  });

  return result;
}

// ─── checkStopLosses — fast (10 s) SL/TP monitor called by scheduler.ts ──────
/**
 * Scans all open trades against the current in-memory price map.
 * Closes any that have crossed their stop-loss or take-profit level.
 */
export async function checkStopLosses(prices: Record<string, number>): Promise<void> {
  if (!prices || Object.keys(prices).length === 0) return;

  const openTrades = await prisma.trade.findMany({ where: { status: 'OPEN' } });
  if (openTrades.length === 0) return;

  for (const trade of openTrades) {
    const currentPrice = prices[trade.asset];
    if (!currentPrice || currentPrice <= 0) continue;

    const sl = trade.stopLossPrice;
    const tp = trade.takeProfitPrice;

    const hitSL = sl && (trade.type === 'BUY' ? currentPrice <= sl : currentPrice >= sl);
    const hitTP = tp && (trade.type === 'BUY' ? currentPrice >= tp : currentPrice <= tp);

    if (!hitSL && !hitTP) continue;

    const reason = hitSL ? 'STOP_LOSS' : 'TAKE_PROFIT';
    const pnl = trade.type === 'BUY'
      ? (currentPrice - trade.entryPrice) * trade.quantity
      : (trade.entryPrice - currentPrice) * trade.quantity;

    await prisma.trade.update({
      where: { id: trade.id },
      data: {
        status: 'CLOSED',
        exitPrice: currentPrice,
        pnl,
        pnlPct: trade.entryPrice > 0 ? pnl / (trade.entryPrice * trade.quantity) : 0,
        closedAt: new Date(),
        exitReason: reason,
      },
    }).catch((err: any) => logger.error(`[RISK] SL/TP close failed for ${trade.asset}: ${err?.message}`));

    logger.info(`[RISK] ${reason} triggered: ${trade.asset} @ $${currentPrice.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
  }
}

// ─── Position closer (used by intradayEngine for time-stops and EOD flatten) ──

/**
 * closePosition — marks a position and its open trades as CLOSED in the DB.
 * Does NOT send a broker order (assumes the caller handles that or it's a paper position).
 */
export async function closePosition(
  pos: { id?: string; asset: string },
  exitPrice: number,
  reason: string,
): Promise<void> {
  const openTrades = await prisma.trade.findMany({
    where: { asset: pos.asset, status: 'OPEN' },
  });

  for (const trade of openTrades) {
    const pnl = trade.type === 'BUY'
      ? (exitPrice - trade.entryPrice) * trade.quantity
      : (trade.entryPrice - exitPrice) * trade.quantity;

    await prisma.trade.update({
      where: { id: trade.id },
      data: {
        status: 'CLOSED',
        exitPrice,
        pnl,
        pnlPct: trade.entryPrice > 0 ? pnl / (trade.entryPrice * trade.quantity) : 0,
        closedAt: new Date(),
        exitReason: reason,
      },
    }).catch((err: any) => logger.error(`[RISK] closePosition trade update failed: ${err?.message}`));
  }

  await prisma.position.updateMany({
    where: { asset: pos.asset, status: 'OPEN' },
    data: { status: 'CLOSED' },
  }).catch((err: any) => logger.error(`[RISK] closePosition position update failed: ${err?.message}`));

  logger.info(`[RISK] Position closed: ${pos.asset} @ $${exitPrice.toFixed(2)} reason=${reason}`);
}
