import type { PortfolioState } from '../../src/agents/types';
import type { CashFlowRiskMetrics } from '../../src/services/cashFlowRisk';

/**
 * Builds a portfolio fixture that satisfies the capital-evidence contract
 * enforced by validateTradeSignal (src/trading/riskManager.ts) since the
 * capital-risk rollout (PR #54): the caller must attach complete, fresh,
 * account-scoped capital-adjusted history (CashFlowRiskMetrics) whose
 * headline metrics exactly mirror the portfolio's own pnlDayPct /
 * pnlWeekPct / drawdownFromPeak, and set riskDataComplete. Fixtures that
 * predate the contract are rejected at the RISK_BASELINE_UNAVAILABLE gate
 * before they can exercise the behaviour actually under test.
 *
 * The evidence is derived from the portfolio passed in, so apply per-test
 * overrides BEFORE wrapping:
 *
 *   validateTradeSignal(signal, withRiskEvidence({ ...base, pnlDayPct: -2.99 }))
 */
export function withRiskEvidence<T extends Record<string, any>>(pf: T): T & PortfolioState {
  const now = new Date().toISOString();
  const pnlDayPct = pf.pnlDayPct ?? 0;
  const pnlWeekPct = pf.pnlWeekPct ?? 0;
  const drawdownFromPeak = pf.drawdownFromPeak ?? 0;
  const capitalRisk: CashFlowRiskMetrics = {
    accountId: pf.accountId ?? 'test-account',
    brokerMode: pf.brokerMode ?? 'paper',
    complete: true,
    reason: null,
    asOf: now,
    referenceAt: now,
    revision: 1,
    valuationAgeMs: 0,
    equity: pf.totalValue ?? null,
    dailyPnl: pf.pnlDay ?? null,
    dailyPnlPct: pnlDayPct,
    weeklyPnl: pf.pnlWeek ?? null,
    weeklyPnlPct: pnlWeekPct,
    weeklyDrawdownPct: Math.max(0, -pnlWeekPct),
    drawdownPct: drawdownFromPeak,
    returnMethod: 'EXTERNAL_CAPITAL_ADJUSTED_OPENING_NAV',
  };
  return {
    ...pf,
    pnlDayPct,
    pnlWeekPct,
    drawdownFromPeak,
    accountId: capitalRisk.accountId,
    brokerMode: capitalRisk.brokerMode,
    riskDataComplete: true,
    capitalRisk,
  } as T & PortfolioState;
}
