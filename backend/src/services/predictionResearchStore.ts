import { prisma } from '../utils/prisma';
import type { ProbabilityAnalysis } from './polymarket';
import { sideEvKelly } from '../trading/predictionMath';

export async function persistPredictionResearch(analyses: ProbabilityAnalysis[]) {
  if (!analyses.length) throw new Error('No prediction research available to persist');
  const data = analyses.map(analysis => {
    const noPrice = 1 - analysis.marketImpliedProbability;
    // EV / Kelly for the card, from predictionMath's sideEvKelly — the same
    // definition the edge scan's display writer uses. Previously this writer
    // stored expectedProfitUSD (a dollar figure for the sized bet, which
    // analyzePolymarketEvent zeroes whenever the recommendation is forced to
    // SKIP — e.g. every edge under its 8% gate) as expectedValue and a
    // literal null as kellyFraction, so scan cards showed EV 0.0% and no
    // Kelly on every market with a real, sub-gate model edge.
    // The priced side is the recommendation; for a SKIP row it is the side
    // the signed edge points to. No estimate at all stays unknown (null
    // Kelly), and a genuinely zero edge computes to exactly 0 / 0.
    const estimate = analysis.ourEstimatedProbability;
    const side = analysis.recommendedSide === 'YES' || analysis.recommendedSide === 'NO'
      ? analysis.recommendedSide
      : estimate == null ? null
      : analysis.edge > 0 ? 'YES' : analysis.edge < 0 ? 'NO' : null;
    const evKelly = estimate == null ? null : sideEvKelly(estimate, analysis.marketImpliedProbability, side);
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
        expectedValue: evKelly ? evKelly.expectedValue : analysis.expectedProfitUSD,
        kellyFraction: evKelly ? evKelly.kellyFraction : null, // null only when no estimate exists to price
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
