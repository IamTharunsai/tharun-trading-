import type { Side } from './predictionMath';

export type ExitThresholds = { tpBuffer: number; exitEdge: number; evidenceShift: number };
export type ExitDecision = { exit: false } | { exit: true; reason: 'tp_converged' | 'edge_flipped' | 'evidence_changed' };

/** Shared existing policy. Live callers separately validate all its evidence. */
export function decideExit(args: {
  side: Side; entryPrice: number; exitPrice: number; fairNowYes: number | null; fairAtEntrySide: number | null; cfg: ExitThresholds;
}): ExitDecision {
  if (args.fairNowYes == null) return { exit: false };
  const fairSide = args.side === 'YES' ? args.fairNowYes : 1 - args.fairNowYes;
  if (fairSide < args.entryPrice - args.cfg.exitEdge) return { exit: true, reason: 'edge_flipped' };
  if (args.fairAtEntrySide != null && fairSide < args.fairAtEntrySide - args.cfg.evidenceShift) return { exit: true, reason: 'evidence_changed' };
  if (args.exitPrice >= fairSide - args.cfg.tpBuffer) return { exit: true, reason: 'tp_converged' };
  return { exit: false };
}
