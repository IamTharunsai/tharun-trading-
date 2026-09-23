/** Bayesian combination of independent-ish signals on [0,1] → P_final. */

export interface BayesianSignals {
  baseRate: number;
  technical?: number;
  fundamental?: number;
  alternative?: number;
  microstructure?: number;
}

function clamp01(x: number): number {
  return Math.min(0.99, Math.max(0.01, x));
}

/** Sequential Bayes: treat each signal as likelihood ratio vs 0.5 chance. */
export function synthesizeProbability(s: BayesianSignals): number {
  let odds = clamp01(s.baseRate) / (1 - clamp01(s.baseRate));
  const extras = [s.technical, s.fundamental, s.alternative, s.microstructure];
  for (const p of extras) {
    if (p == null || !Number.isFinite(p)) continue;
    const q = clamp01(p);
    const lr = q / (1 - q);
    odds *= lr;
  }
  return clamp01(odds / (1 + odds));
}
