/**
 * APEX-∞ Devil's Advocate ×3
 * Macro, Fundamental, and Timing must ALL fail to kill the trade.
 */

export type DevilVerdict = 'KILL' | 'FAIL_TO_KILL';

export interface DevilInput {
  direction: 'BUY' | 'SELL' | 'HOLD';
  regime: string;
  vixLevel?: number;
  rsi14?: number;
  volumeRatio?: number;
  peVsSector?: number;
  newRiskCount?: number;
  mdaScore?: number;
  hoursToEvent?: number;
  confluenceScore?: number;
  tf1hContradicts?: boolean;
}

export interface DevilReport {
  macro: DevilVerdict;
  fundamental: DevilVerdict;
  timing: DevilVerdict;
  reasons: string[];
  proceed: boolean;
}

export function runDevilsAdvocateTriple(input: DevilInput): DevilReport {
  const reasons: string[] = [];
  const regime = (input.regime || '').toUpperCase();

  let macro: DevilVerdict = 'FAIL_TO_KILL';
  if (input.direction === 'BUY' && (regime.includes('CRASH') || regime.includes('BEAR'))) {
    macro = 'KILL';
    reasons.push('Macro Devil: long into crash/bear regime');
  } else if ((input.vixLevel || 0) > 35 && input.direction === 'BUY') {
    macro = 'KILL';
    reasons.push('Macro Devil: VIX>35 kills new longs');
  } else if (input.direction === 'HOLD') {
    macro = 'KILL';
    reasons.push('Macro Devil: no directional edge');
  }

  let fundamental: DevilVerdict = 'FAIL_TO_KILL';
  if ((input.newRiskCount || 0) > 3 && input.direction === 'BUY') {
    fundamental = 'KILL';
    reasons.push('Fundamental Devil: 10-K risk delta SHORT');
  } else if ((input.mdaScore || 0) <= -2 && input.direction === 'BUY') {
    fundamental = 'KILL';
    reasons.push('Fundamental Devil: MD&A red-flag cluster');
  } else if ((input.peVsSector || 0) > 2 && input.direction === 'BUY') {
    fundamental = 'KILL';
    reasons.push('Fundamental Devil: priced for perfection');
  }

  let timing: DevilVerdict = 'FAIL_TO_KILL';
  if (input.hoursToEvent != null && input.hoursToEvent >= 0 && input.hoursToEvent <= 0.25) {
    timing = 'KILL';
    reasons.push('Timing Devil: event within 15 minutes');
  } else if (input.tf1hContradicts && (input.confluenceScore || 0) < 0.6) {
    timing = 'KILL';
    reasons.push('Timing Devil: 1h contradicts higher TFs');
  } else if (input.direction === 'BUY' && (input.rsi14 || 50) > 80 && (input.volumeRatio || 1) < 0.7) {
    timing = 'KILL';
    reasons.push('Timing Devil: late chase on weak volume');
  }

  const proceed = macro === 'FAIL_TO_KILL' && fundamental === 'FAIL_TO_KILL' && timing === 'FAIL_TO_KILL';
  return { macro, fundamental, timing, reasons, proceed };
}
