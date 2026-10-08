import { z } from 'zod';

// Zod 3 runtime validation: https://github.com/colinhacks/zod/tree/v3.22.4#safeparse
const confidence = z.number().finite().min(0).max(100);
const direction = z.enum(['BUY', 'SELL', 'HOLD']);
const boundedText = z.string().trim().min(1).max(2000);
const factors = z.array(z.string().max(500)).max(10).default([]);

export const openingArgumentSchema = z.object({
  vote: direction, confidence, openingArgument: boundedText,
  keyFactors: factors, riskWarnings: factors,
  weaknessOfMyOwnView: z.string().max(1000).default(''),
});

export const finalVoteSchema = z.object({
  finalVote: direction, confidence, finalReason: boundedText,
  changedMind: z.boolean().default(false),
});

export const masterDecisionSchema = z.object({
  finalDecision: direction, confidence, synthesis: boundedText,
  blockReason: z.string().max(1000).nullable().optional().default(null),
  positionSizeRecommendation: z.number().finite().min(0).max(15).optional().default(1),
});

export const checkpointArgumentSchema = openingArgumentSchema.extend({
  agentId: z.number().int().min(1).max(14), agentName: z.string().min(1).max(100),
  agentIcon: z.string().max(20).default(''), failureState: z.boolean().default(false),
});

export const checkpointEvidenceSchema = z.object({
  fundamentalsSummary: z.string().max(40000), stockMemory: z.string().max(20000),
  newsSummary: z.string().max(20000), macroSummary: z.string().max(20000),
  optionsSummary: z.string().max(20000), forecastSummary: z.string().max(20000),
  regimeLessons: z.string().max(20000), marketContext: z.string().max(150000),
});

export const exchangeSchema = z.object({
  challenger: z.string().min(1).max(100), target: z.string().min(1).max(100),
  challenge: boundedText, rebuttal: boundedText,
});
