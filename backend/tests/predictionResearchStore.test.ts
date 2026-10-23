jest.mock('../src/utils/prisma', () => ({ prisma: { $transaction: jest.fn() } }));
import { prisma } from '../src/utils/prisma';
import { persistPredictionResearch } from '../src/services/predictionResearchStore';
test('empty scan preserves stored research', async () => {
  await expect(persistPredictionResearch([])).rejects.toThrow('No prediction research');
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
test('persistence keeps unknown forecast and Kelly unknown and propagates failure', async () => {
  const tx = { prediction: { deleteMany: jest.fn(), createMany: jest.fn().mockRejectedValue(new Error('fixture write failure')) } };
  (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));
  await expect(persistPredictionResearch([{ question: 'Fixture?', marketImpliedProbability: 0.4, ourEstimatedProbability: null, recommendedSide: 'SKIP', betSizeUSD: 0, confidence: 0, edge: 0, expectedProfitUSD: 0, daysToResolution: 5 } as any])).rejects.toThrow('fixture write failure');
  expect(tx.prediction.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ targetPrice: null, kellyFraction: null, recommendedWager: 0 })] });
});

// The legacy scan writer feeds the same Prediction rows the Polymarket page
// renders. Its old mapping stored the SKIP-zeroed dollar profit as
// expectedValue and a literal null as kellyFraction, so every card showed
// EV 0.0% / no Kelly even when the model edge was real.
async function persistedRow(analysis: any) {
  const tx = { prediction: { deleteMany: jest.fn(), createMany: jest.fn().mockResolvedValue({ count: 1 }) } };
  (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));
  await persistPredictionResearch([analysis]);
  return tx.prediction.createMany.mock.calls[0][0].data[0];
}

test('scan rows carry computed EV/Kelly for a SKIP row with a real sub-gate edge', async () => {
  // +7.7pt edge: below the analyzer's 8pt bet gate, so the recommendation is
  // SKIP and expectedProfitUSD was zeroed — the stored EV/Kelly must still be
  // computed from the estimate (fairSide − costSide, full Kelly on YES).
  const row = await persistedRow({ question: 'Fixture?', marketImpliedProbability: 0.40, ourEstimatedProbability: 0.477, recommendedSide: 'SKIP', betSizeUSD: 0, confidence: 70, edge: 0.077, expectedProfitUSD: 0, daysToResolution: 5 });
  expect(row.expectedValue).toBeCloseTo(0.077, 10);
  expect(row.kellyFraction).toBeCloseTo((0.477 - 0.40) / (1 - 0.40), 10);
});

test('scan rows price the NO side when the signed edge points down', async () => {
  const row = await persistedRow({ question: 'Fixture?', marketImpliedProbability: 0.45, ourEstimatedProbability: 0.30, recommendedSide: 'SKIP', betSizeUSD: 0, confidence: 70, edge: -0.15, expectedProfitUSD: 0, daysToResolution: 5 });
  expect(row.expectedValue).toBeCloseTo((1 - 0.30) - (1 - 0.45), 10);
  expect(row.kellyFraction).toBeCloseTo(((1 - 0.30) - (1 - 0.45)) / (1 - (1 - 0.45)), 10);
});

test('scan rows store per-share EV (not the dollar bet profit) for a recommended bet', async () => {
  const row = await persistedRow({ question: 'Fixture?', marketImpliedProbability: 0.40, ourEstimatedProbability: 0.70, recommendedSide: 'YES', betSizeUSD: 25, confidence: 80, edge: 0.30, expectedProfitUSD: 999, daysToResolution: 5 });
  expect(row.expectedValue).toBeCloseTo(0.30, 10);
  expect(row.kellyFraction).toBeCloseTo((0.70 - 0.40) / (1 - 0.40), 10);
});

test('scan rows keep EV/Kelly at exactly zero when the edge is genuinely zero', async () => {
  const row = await persistedRow({ question: 'Fixture?', marketImpliedProbability: 0.40, ourEstimatedProbability: 0.40, recommendedSide: 'SKIP', betSizeUSD: 0, confidence: 70, edge: 0, expectedProfitUSD: 0, daysToResolution: 5 });
  expect(row.expectedValue).toBe(0);
  expect(row.kellyFraction).toBe(0);
});