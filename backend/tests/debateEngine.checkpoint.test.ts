import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    debateCheckpoint: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
  },
}));

describe('debate checkpoint helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saveDebateCheckpoint upserts by asset with the given status and results', async () => {
    const { saveDebateCheckpoint } = require('../src/agents/debateEngine');
    const round1Results = [{ agentId: 1, vote: 'BUY' }];
    await saveDebateCheckpoint('AAPL', 'ROUND1_DONE', round1Results, null, 'TRENDING_BULL');
    expect(prisma.debateCheckpoint.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { asset: 'AAPL' },
      create: expect.objectContaining({ asset: 'AAPL', status: 'ROUND1_DONE', round1Results, round2Exchange: null, marketRegime: 'TRENDING_BULL' }),
      update: expect.objectContaining({ status: 'ROUND1_DONE', round1Results, round2Exchange: null, marketRegime: 'TRENDING_BULL' }),
    }));
  });

  it('saveDebateCheckpoint never throws even if the DB call fails', async () => {
    (prisma.debateCheckpoint.upsert as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const { saveDebateCheckpoint } = require('../src/agents/debateEngine');
    await expect(saveDebateCheckpoint('AAPL', 'ROUND1_DONE', [], null, 'TRENDING_BULL')).resolves.toBeUndefined();
  });

  it('loadDebateCheckpoint returns null when none exists', async () => {
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValue(null);
    const { loadDebateCheckpoint } = require('../src/agents/debateEngine');
    const result = await loadDebateCheckpoint('AAPL');
    expect(result).toBeNull();
  });

  it('loadDebateCheckpoint returns the checkpoint when fresh', async () => {
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValue({
      asset: 'AAPL', status: 'ROUND1_DONE', round1Results: [{ agentId: 1 }], round2Exchange: null,
      marketRegime: 'TRENDING_BULL', updatedAt: new Date(),
    });
    const { loadDebateCheckpoint } = require('../src/agents/debateEngine');
    const result = await loadDebateCheckpoint('AAPL');
    expect(result).toEqual(expect.objectContaining({ status: 'ROUND1_DONE', round1Results: [{ agentId: 1 }] }));
  });

  it('loadDebateCheckpoint discards and returns null for a checkpoint older than 30 minutes', async () => {
    const staleDate = new Date(Date.now() - 31 * 60 * 1000);
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValue({
      asset: 'AAPL', status: 'ROUND1_DONE', round1Results: [], round2Exchange: null,
      marketRegime: 'TRENDING_BULL', updatedAt: staleDate,
    });
    const { loadDebateCheckpoint } = require('../src/agents/debateEngine');
    const result = await loadDebateCheckpoint('AAPL');
    expect(result).toBeNull();
    expect(prisma.debateCheckpoint.delete).toHaveBeenCalledWith({ where: { asset: 'AAPL' } });
  });

  it('clearDebateCheckpoint deletes by asset', async () => {
    const { clearDebateCheckpoint } = require('../src/agents/debateEngine');
    await clearDebateCheckpoint('AAPL');
    expect(prisma.debateCheckpoint.deleteMany).toHaveBeenCalledWith({ where: { asset: 'AAPL' } });
  });
});
