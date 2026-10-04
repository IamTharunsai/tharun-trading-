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
