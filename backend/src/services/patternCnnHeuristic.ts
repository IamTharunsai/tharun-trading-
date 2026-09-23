/** Spec CA-1/CA-2 stand-in: 30×4 OHLCV momentum heuristic + regime multipliers. */

export type PatternDir = 'UP' | 'DOWN' | 'FLAT';
export type ApexRegime = 'BULL_TREND' | 'BEAR_TREND' | 'SIDEWAYS' | 'HIGH_VOL' | 'CRASH';

export const REGIME_MULT: Record<ApexRegime, { bull: number; bear: number; meanRev: number }> = {
  BULL_TREND: { bull: 1.35, bear: 0.8, meanRev: 1 },
  BEAR_TREND: { bull: 0.65, bear: 1.4, meanRev: 1 },
  SIDEWAYS: { bull: 0.85, bear: 0.85, meanRev: 1.45 },
  HIGH_VOL: { bull: 0.75, bear: 0.75, meanRev: 0.75 },
  CRASH: { bull: 1.2, bear: 0.2, meanRev: 0.5 },
};

export function classifyOhlcvPattern(
  candles: { open: number; high: number; low: number; close: number }[],
  regime: ApexRegime,
  rsi14 = 50,
  volumeRatio = 1
): { dir: PatternDir; raw: number; adjusted: number } {
  const slice = candles.slice(-30);
  if (slice.length < 8) return { dir: 'FLAT', raw: 1 / 3, adjusted: 1 / 3 };
  const first = slice[0].close;
  const last = slice[slice.length - 1].close;
  const ret = (last - first) / (first || 1);
  const range = slice.reduce((s, c) => s + (c.high - c.low), 0) / slice.length / (last || 1);
  let up = 0.33 + Math.tanh(ret * 8) * 0.25;
  let down = 0.33 - Math.tanh(ret * 8) * 0.25;
  let flat = 0.34 + (range < 0.005 ? 0.1 : 0);
  const z = up + down + flat;
  up /= z; down /= z; flat /= z;

  const m = REGIME_MULT[regime];
  let adjUp = up * m.bull;
  let adjDown = down * m.bear;
  if (regime === 'CRASH' && !(volumeRatio > 1.5 && rsi14 < 20)) {
    adjUp *= 0.1;
  }
  const az = adjUp + adjDown + flat * (regime === 'SIDEWAYS' ? m.meanRev : 1);
  adjUp /= az; adjDown /= az;
  const rawMax = Math.max(up, down, flat);
  const dir: PatternDir = adjUp >= adjDown && adjUp >= 0.4 ? 'UP' : adjDown >= 0.4 ? 'DOWN' : 'FLAT';
  return { dir, raw: rawMax, adjusted: Math.max(adjUp, adjDown, 1 - adjUp - adjDown) };
}

export function mapMarketRegime(name: string): ApexRegime {
  const n = (name || '').toUpperCase();
  if (n.includes('CRASH')) return 'CRASH';
  if (n.includes('BEAR')) return 'BEAR_TREND';
  if (n.includes('BULL') || n.includes('TRENDING_BULL')) return 'BULL_TREND';
  if (n.includes('VOL') || n.includes('HIGH')) return 'HIGH_VOL';
  return 'SIDEWAYS';
}
