export type TfDir = 'UP' | 'DOWN' | 'FLAT';

export interface TfScores {
  h1: number; // -1 to 1
  h4: number;
  daily: number;
}

export function confluenceFromScores(s: TfScores): {
  score: number;
  trade: boolean;
  sizeMultiplier: number;
  reason: string;
} {
  const dir = (x: number): TfDir => (x > 0.05 ? 'UP' : x < -0.05 ? 'DOWN' : 'FLAT');
  const d1 = dir(s.h1);
  const d4 = dir(s.h4);
  const dd = dir(s.daily);
  const score = (Math.abs(s.h1) + Math.abs(s.h4) + Math.abs(s.daily)) / 3;
  const aligned = (a: TfDir, b: TfDir) => a !== 'FLAT' && a === b;
  const strong = (x: number) => Math.abs(x) > 0.6;

  if (aligned(d1, d4) && aligned(d4, dd) && strong(s.h1) && strong(s.h4) && strong(s.daily)) {
    return { score, trade: true, sizeMultiplier: 1, reason: 'All 3 TFs same direction >0.6' };
  }
  if (aligned(d4, dd) && d1 !== 'FLAT' && d1 !== dd) {
    return { score, trade: true, sizeMultiplier: 0.5, reason: 'Daily+4h align, 1h contradicts — half size' };
  }
  if (aligned(d4, dd) && (d1 === 'FLAT' || d1 === dd)) {
    return { score, trade: true, sizeMultiplier: 1, reason: 'Daily+4h aligned, 1h does not contradict' };
  }
  return { score, trade: false, sizeMultiplier: 0, reason: 'No multi-TF confluence' };
}

export function scoresFromCandles(closes: number[]): number {
  if (closes.length < 5) return 0;
  const last = closes[closes.length - 1];
  const prev = closes[0];
  if (!prev) return 0;
  return Math.max(-1, Math.min(1, (last - prev) / prev * 8));
}
