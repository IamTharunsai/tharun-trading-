import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    newsItem: { create: jest.fn().mockResolvedValue({}) },
    geopoliticalEvent: { create: jest.fn().mockResolvedValue({}) },
  },
}));

describe('geopoliticalDataService — DB persistence alongside in-memory cache', () => {
  it('persists a geopolitical event derived from cached news to the DB', async () => {
    const { geopoliticalDataService } = require('../src/services/geopoliticalDataService');
    await geopoliticalDataService.persistGeopoliticalEvent({
      id: 'markets-1', region: 'Middle East', event: 'Test sanctions event',
      severity: 'HIGH', affectedAssets: ['Energy'], timestamp: Date.now(), source: 'Reuters',
    });
    expect(prisma.geopoliticalEvent.create).toHaveBeenCalled();
  });

  it('persists a news item to the DB', async () => {
    const { geopoliticalDataService } = require('../src/services/geopoliticalDataService');
    await geopoliticalDataService.persistNewsItem({
      id: 'markets-2', title: 'Test headline', source: 'Reuters', timestamp: Date.now(),
      category: 'MACROECONOMICS', sentiment: 'NEUTRAL', impact: 'MEDIUM', tags: [],
      summary: 'test summary', sectorsAffected: ['Broad Market'],
    });
    expect(prisma.newsItem.create).toHaveBeenCalled();
  });
});
