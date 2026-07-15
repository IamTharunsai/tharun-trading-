import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    agentDecision: { findMany: jest.fn() },
  },
}));

describe('getRegimeMatchedLessons', () => {
  it('returns an empty string when no past debates match this asset+regime', async () => {
    (prisma.agentDecision.findMany as jest.Mock).mockResolvedValue([]);
    const { getRegimeMatchedLessons } = require('../src/services/stockMemoryService');
    const result = await getRegimeMatchedLessons('AAPL', 'TRENDING_BULL');
    expect(result).toBe('');
  });

  it('queries only same-asset, same-regime, completed debates, most recent first', async () => {
    (prisma.agentDecision.findMany as jest.Mock).mockResolvedValue([]);
    const { getRegimeMatchedLessons } = require('../src/services/stockMemoryService');
    await getRegimeMatchedLessons('AAPL', 'TRENDING_BULL');
    expect(prisma.agentDecision.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ asset: 'AAPL', regime: 'TRENDING_BULL' }),
      orderBy: { timestamp: 'desc' },
      take: 3,
    }));
  });

  it('formats a short note citing the past decision, confidence, and whether it executed', async () => {
    (prisma.agentDecision.findMany as jest.Mock).mockResolvedValue([
      { finalVote: 'BUY', avgConfidence: 72, executed: true, timestamp: new Date('2026-07-01') },
      { finalVote: 'SELL', avgConfidence: 65, executed: false, timestamp: new Date('2026-06-20') },
    ]);
    const { getRegimeMatchedLessons } = require('../src/services/stockMemoryService');
    const result = await getRegimeMatchedLessons('AAPL', 'TRENDING_BULL');
    expect(result).toContain('TRENDING_BULL');
    expect(result).toContain('BUY');
    expect(result).toContain('72');
    expect(result).toContain('SELL');
  });
});
