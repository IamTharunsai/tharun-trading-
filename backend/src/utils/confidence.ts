/**
 * Confidence is 0-100 everywhere in this codebase (AgentVote, debate
 * transcripts, scheduler signals). Some older callers passed 0-1 fractions,
 * and the risk gate used to multiply a 0-100 value by 10 as if it were 0-1
 * (60 → "600 of 10 votes"), approving nearly everything as HIGH_CONVICTION.
 * Normalise defensively: values in (0, 1] are treated as fractions.
 */
export function normalizeConfidence(c: number | undefined | null): number {
  const n = Number(c);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const pct = n <= 1 ? n * 100 : n;
  return Math.min(100, pct);
}
