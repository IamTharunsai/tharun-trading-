import { prisma } from '../utils/prisma';
import type { ProbabilityAnalysis } from './polymarket';

export async function persistPredictionResearch(analyses: ProbabilityAnalysis[]) {
  if (!analyses.length) throw new Error('No prediction research available to persist');
  const data = analyses.map(analysis => {
    const noPrice = 1 - analysis.marketImpliedProbability;
    return {
        asset: 'POLYMARKET',
        market: 'polymarket',
        title: analysis.question,
        category: 'prediction',
        direction: analysis.recommendedSide === 'YES' ? 'UP' : analysis.recommendedSide === 'NO' ? 'DOWN' : 'NEUTRAL',
        confidence: analysis.confidence,
        yesPrice: analysis.marketImpliedProbability,
        noPrice,
        edge: analysis.edge,
        recommendedBet: analysis.recommendedSide,
        expectedValue: analysis.expectedProfitUSD,
        kellyFraction: null, // No calibrated Kelly fraction is established by this research.
        recommendedWager: analysis.betSizeUSD,
        targetPrice: analysis.ourEstimatedProbability === null ? null : analysis.ourEstimatedProbability * 100,
        currentPrice: analysis.marketImpliedProbability * 100,
        timeHorizon: `${analysis.daysToResolution}D`,
        keyRisks: analysis.riskFactors || [],
        reasoning: analysis.reasoning || null,
        status: 'ACTIVE',
      };
  });
  await prisma.$transaction(async tx => {
    await tx.prediction.deleteMany({ where: { asset: 'POLYMARKET', market: 'polymarket', resolvedAt: null } });
    await tx.prediction.createMany({ data });
  });
}
