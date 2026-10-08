import { z } from 'zod';

const evidenceSchema = z.object({
  strategyKey: z.string().min(1), revision: z.string().regex(/^[a-f0-9]{40}$/),
  dataHash: z.string().regex(/^[a-f0-9]{64}$/), reportHash: z.string().regex(/^[a-f0-9]{64}$/),
  trialCount: z.number().int().positive(), noLeakage: z.literal(true),
  dsrProbability: z.number().finite().min(0).max(1),
  walkForwardPassed: z.literal(true), costsValidated: z.literal(true),
  executionValidated: z.literal(true), ledgerReconciled: z.literal(true),
  healthPassed: z.literal(true),
  expiresAt: z.coerce.date(),
});

/** Research metrics alone are never a live-money authorization. */
export function validateLiveQualification(raw: unknown, strategyKey: string, revision: string | undefined,
  minimumDsrProbability = 0.95, now = Date.now()): { approved: boolean; reason: string } {
  const result = evidenceSchema.safeParse(raw);
  if (!result.success || !revision || result.data.strategyKey !== strategyKey || result.data.revision !== revision) {
    return { approved: false, reason: 'LIVE_UNQUALIFIED: verified strategy/version evidence is missing or incomplete' };
  }
  if (!Number.isFinite(minimumDsrProbability) || minimumDsrProbability < 0.95 || minimumDsrProbability > 1
    || result.data.dsrProbability < minimumDsrProbability || result.data.expiresAt.getTime() <= now) {
    return { approved: false, reason: 'LIVE_UNQUALIFIED: significance or current health qualification failed' };
  }
  return { approved: true, reason: 'Verified current strategy qualification passed' };
}
