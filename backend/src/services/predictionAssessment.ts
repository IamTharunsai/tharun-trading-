import { z } from 'zod';

const assessmentSchema = z.object({
  ourProbabilityYes: z.number().finite().min(0).max(1),
  confidence: z.number().finite().min(0).max(100),
  recommendedSide: z.enum(['YES', 'NO', 'SKIP']),
  reasoning: z.string().trim().min(1).max(8000),
  riskFactors: z.array(z.string().max(1000)).max(30).default([]),
});

/** Structural validation only; confidence is not a calibrated success probability. */
export function parsePredictionAssessment(value: unknown) {
  const result = assessmentSchema.safeParse(value);
  return result.success ? result.data : null;
}
