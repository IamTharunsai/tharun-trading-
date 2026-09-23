/**
 * APEX-∞ One Law: EV = P(win)×Gain − P(loss)×Loss
 * Every trade must have positive expected value after fees.
 */

export interface EvInput {
  winProbability: number;
  avgWin: number;
  avgLoss: number;
  fees?: number;
}

export interface EvResult {
  ev: number;
  profitFactor: number;
  positive: boolean;
  halfKellyFraction: number;
  cappedBetPct: number;
}

export function computeExpectedValue(input: EvInput): EvResult {
  const p = Math.min(1, Math.max(0, input.winProbability));
  const q = 1 - p;
  const fees = input.fees || 0;
  const gain = Math.max(0, input.avgWin);
  const loss = Math.max(1e-9, input.avgLoss);
  const ev = p * gain - q * loss - fees;
  const profitFactor = (p * gain) / Math.max(q * loss, 1e-9);
  const b = gain / loss;
  const kelly = b > 0 ? (p * b - q) / b : 0;
  const halfKelly = Math.max(0, kelly * 0.5);
  const cappedBetPct = Math.min(halfKelly, 0.02);
  return {
    ev,
    profitFactor,
    positive: ev > 0.5 || (ev > 0 && fees === 0),
    halfKellyFraction: halfKelly,
    cappedBetPct,
  };
}

export function shouldKillTrade(ev: EvResult, minEvUsd = 0.5): boolean {
  return !ev.positive || ev.ev < minEvUsd || ev.profitFactor < 1.2;
}
