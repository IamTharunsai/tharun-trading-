/**
 * APEX-3 capital survival engine + APEX-∞ EV constraints.
 * Combines 5 bankroll tiers with drawdown protection modes.
 * $100 start follows APEX-∞ CRITICAL: Polymarket 8%+ only, $1–2 bets, no stocks
 * until bankroll reaches GROWTH (~$300). $500+ is full NORMAL stack.
 */

export type CapitalTier = 'NORMAL' | 'CAUTION' | 'SURVIVAL' | 'CRITICAL' | 'REBIRTH';
export type DrawdownMode = 'NORMAL' | 'CAUTION' | 'RECOVERY' | 'DEFEND';
export type AiTier = 1 | 2 | 3;

export interface SurvivalPolicy {
  capitalTier: CapitalTier;
  drawdownMode: DrawdownMode;
  maxRiskPerTradePct: number;
  aiMaxTier: AiTier;
  allowStocks: boolean;
  allowPolymarket: boolean;
  allowOptionsScreening: boolean;
  allowCloudAI: boolean;
  allowLocalLlm: boolean;
  minPolymarketEdge: number;
  maxOpenPositions: number;
  minConfidence: number;
  tradesPerDayCap: number;
  riskMultiplier: number;
  alertUser: boolean;
  strategy: string;
}

export function resolveCapitalTier(bankroll: number): CapitalTier {
  if (bankroll >= 500) return 'NORMAL';
  if (bankroll >= 300) return 'CAUTION';
  if (bankroll >= 100) return 'CRITICAL';
  if (bankroll >= 20) return 'SURVIVAL';
  return 'REBIRTH';
}

export function resolveDrawdownMode(drawdownFromPeakPct: number, dailyLossPct: number): DrawdownMode {
  if (drawdownFromPeakPct >= 20 || dailyLossPct <= -5) return 'DEFEND';
  if (drawdownFromPeakPct >= 10 || dailyLossPct <= -3) return 'RECOVERY';
  if (drawdownFromPeakPct >= 5 || dailyLossPct <= -1.5) return 'CAUTION';
  return 'NORMAL';
}

const TIER_BASE: Record<CapitalTier, Omit<SurvivalPolicy, 'capitalTier' | 'drawdownMode' | 'riskMultiplier' | 'alertUser'>> = {
  NORMAL: {
    maxRiskPerTradePct: 1,
    aiMaxTier: 3,
    allowStocks: true,
    allowPolymarket: true,
    allowOptionsScreening: true,
    allowCloudAI: true,
    allowLocalLlm: true,
    minPolymarketEdge: 0.08, // APEX-∞ superforecasting floor (stricter than APEX-3 5%)
    maxOpenPositions: 5,
    minConfidence: 65,
    tradesPerDayCap: 50,
    strategy: 'Full debate. Best opportunities. Compound.',
  },
  CAUTION: {
    maxRiskPerTradePct: 0.75,
    aiMaxTier: 2,
    allowStocks: true,
    allowPolymarket: true,
    allowOptionsScreening: false,
    allowCloudAI: false,
    allowLocalLlm: true,
    minPolymarketEdge: 0.08,
    maxOpenPositions: 4,
    minConfidence: 70,
    tradesPerDayCap: 20,
    strategy: 'Skip Claude. Highest-probability trades only.',
  },
  SURVIVAL: {
    maxRiskPerTradePct: 0.5,
    aiMaxTier: 1,
    allowStocks: false,
    allowPolymarket: true,
    allowOptionsScreening: false,
    allowCloudAI: false,
    allowLocalLlm: false,
    minPolymarketEdge: 0.10,
    maxOpenPositions: 3,
    minConfidence: 75,
    tradesPerDayCap: 8,
    strategy: 'Zero API calls. Polymarket only with >10% edge.',
  },
  CRITICAL: {
    maxRiskPerTradePct: 0.25,
    aiMaxTier: 1,
    allowStocks: false,
    allowPolymarket: true,
    allowOptionsScreening: false,
    allowCloudAI: false,
    allowLocalLlm: false,
    minPolymarketEdge: 0.08,
    maxOpenPositions: 2,
    minConfidence: 80,
    tradesPerDayCap: 4,
    strategy: 'APEX-∞ $100 CRITICAL: Polymarket 8%+ only, $1–2 max, zero stocks.',
  },
  REBIRTH: {
    maxRiskPerTradePct: 0.5,
    aiMaxTier: 1,
    allowStocks: false,
    allowPolymarket: true,
    allowOptionsScreening: false,
    allowCloudAI: false,
    allowLocalLlm: false,
    minPolymarketEdge: 0.15,
    maxOpenPositions: 1,
    minConfidence: 85,
    tradesPerDayCap: 1,
    strategy: 'One high-conviction 1–3 day Polymarket trade. Alert user.',
  },
};

export function resolveSurvivalPolicy(input: {
  bankroll: number;
  drawdownFromPeakPct: number;
  dailyLossPct: number;
  openPositions?: number;
}): SurvivalPolicy {
  const capitalTier = resolveCapitalTier(input.bankroll);
  const drawdownMode = resolveDrawdownMode(input.drawdownFromPeakPct, input.dailyLossPct);
  const base = TIER_BASE[capitalTier];

  let riskMultiplier = 1;
  let allowCloudAI = base.allowCloudAI;
  let allowStocks = base.allowStocks;
  let maxOpenPositions = base.maxOpenPositions;
  let minConfidence = base.minConfidence;
  let maxRiskPerTradePct = base.maxRiskPerTradePct;

  if (drawdownMode === 'CAUTION') {
    riskMultiplier = 0.5;
    minConfidence = Math.max(minConfidence, 70);
  } else if (drawdownMode === 'RECOVERY') {
    riskMultiplier = 0.4;
    allowCloudAI = false;
    maxOpenPositions = Math.min(maxOpenPositions, 1);
    minConfidence = Math.max(minConfidence, 80);
  } else if (drawdownMode === 'DEFEND') {
    riskMultiplier = 0;
    allowCloudAI = false;
    allowStocks = false;
    maxOpenPositions = 0;
    minConfidence = 90;
  }

  return {
    ...base,
    capitalTier,
    drawdownMode,
    allowCloudAI,
    allowStocks,
    maxOpenPositions,
    minConfidence,
    maxRiskPerTradePct: maxRiskPerTradePct * (riskMultiplier || 1),
    riskMultiplier,
    alertUser: capitalTier === 'REBIRTH' || drawdownMode === 'DEFEND',
  };
}

export function marketAllowed(policy: SurvivalPolicy, market: 'stocks' | 'crypto' | 'forex' | 'prediction'): boolean {
  if (policy.drawdownMode === 'DEFEND') return false;
  if (market === 'prediction') return policy.allowPolymarket;
  if (market === 'stocks' || market === 'crypto' || market === 'forex') return policy.allowStocks;
  return false;
}
