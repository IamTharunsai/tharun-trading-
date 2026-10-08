import { z } from 'zod';
import type { TradeSignal } from '../agents/types';

export const executionPlanSchema = z.object({
  purpose: z.literal('ENTRY').default('ENTRY'),
  version: z.literal(1), approved: z.literal(true), mode: z.enum(['paper', 'live']),
  market: z.enum(['stocks', 'crypto']), direction: z.enum(['BUY', 'SELL']),
  entryPrice: z.number().finite().positive(), stopLossPrice: z.number().finite().positive(),
  takeProfitPrice: z.number().finite().positive(), positionSizePct: z.number().finite().positive().max(100),
  confidence: z.number().finite().min(0).max(100),
  lane: z.enum(['COUNCIL', 'INTRADAY']).default('COUNCIL'),
});
const voteSchema = z.object({
  agentId: z.number().int().min(1).max(14), finalVote: z.enum(['BUY', 'SELL', 'HOLD']),
  confidence: z.number().finite().min(0).max(100), executionEligible: z.boolean(),
  failureState: z.boolean().optional(),
});

/** Bind execution to persisted evidence; caller consensus is never authority. */
export function authorizePersistedDecision(raw: unknown, signal: TradeSignal, mode: string, now = Date.now(), maxAgeMs = 300000): TradeSignal {
  const decision = raw as Record<string, any> | null;
  if (!decision || decision.id !== signal.agentDecisionId || decision.asset !== signal.asset
    || decision.executed !== false || decision.executionReason || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error('DECISION_AUTHORITY: missing, blocked, executed or mismatched decision');
  }
  const snapshot = decision.marketSnapshot;
  if (snapshot?.positionReview !== undefined || snapshot?.executionPlan?.purpose === 'POSITION_REVIEW') {
    throw new Error('DECISION_AUTHORITY: held-position research has no execution authority');
  }
  const timestamp = new Date(decision.timestamp).getTime();
  if (!snapshot || snapshot.asset !== signal.asset || !Number.isFinite(snapshot.timestamp)
    || !Number.isFinite(timestamp) || now - timestamp > maxAgeMs || timestamp > now + 5000
    || now - snapshot.timestamp > maxAgeMs || snapshot.timestamp > now + 5000
    || typeof snapshot.inputFingerprint !== 'string' || snapshot.inputFingerprint.length !== 64) {
    throw new Error('DECISION_AUTHORITY: stale or unidentified evidence');
  }
  const plan = executionPlanSchema.parse(snapshot.executionPlan);
  if (plan.mode !== mode || plan.market !== signal.market || snapshot.market !== plan.market
    || plan.direction !== signal.direction || decision.finalVote !== plan.direction || decision.signal !== plan.direction
    || plan.entryPrice !== signal.entryPrice || plan.stopLossPrice !== signal.stopLossPrice
    || plan.takeProfitPrice !== signal.takeProfitPrice || plan.confidence !== signal.confidence
    || !Number.isFinite(signal.positionSizePct) || signal.positionSizePct <= 0 || signal.positionSizePct > plan.positionSizePct) {
    throw new Error('DECISION_AUTHORITY: signal exceeds or differs from the saved plan');
  }
  const votes = voteSchema.array().length(14).parse(decision.agentVotes);
  if (new Set(votes.map(v => v.agentId)).size !== 14) throw new Error('DECISION_AUTHORITY: invalid roster');
  const eligible = (v: typeof votes[number]) => v.executionEligible && !v.failureState;
  const supporting = votes.filter(v => eligible(v) && v.finalVote === plan.direction).length;
  const opposing = votes.filter(v => eligible(v) && v.finalVote !== 'HOLD' && v.finalVote !== plan.direction).length;
  const riskReviewer = votes.find(v => v.agentId === 5)!;
  if (!eligible(riskReviewer) || riskReviewer.finalVote !== plan.direction
    || decision.totalVotes !== 14 || decision.goVotes !== supporting || decision.noGoVotes !== 14 - supporting
    || decision.avgConfidence !== plan.confidence || supporting / 14 < 0.55) {
    throw new Error('DECISION_AUTHORITY: stored approval and genuine consensus disagree');
  }
  return { ...signal, voteCounts: { supporting, opposing, abstaining: 14 - supporting - opposing } };
}
