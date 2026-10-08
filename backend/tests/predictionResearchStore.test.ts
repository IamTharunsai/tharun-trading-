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