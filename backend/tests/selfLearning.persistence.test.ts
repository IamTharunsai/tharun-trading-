import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    agentLesson: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    agentPerformance: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    systemLog: { create: jest.fn() },
    marketEvent: { create: jest.fn() },
  },
}));

describe('selfLearning persistence — typed models, not SystemLog/MarketEvent', () => {
  it('saveAgentLesson writes to prisma.agentLesson, not prisma.systemLog', async () => {
    const { __test__saveAgentLesson } = require('../src/services/selfLearning');
    await __test__saveAgentLesson({
      agentId: 'technician', agentName: 'The Technician', asset: 'AAPL',
      setupType: 'breakout', prediction: 'BUY', outcome: 'WIN', correct: true,
      reasoning: 'test', confidenceScore: 80, newWeighting: 1.0,
      performanceImpact: 5,
    });
    expect(prisma.agentLesson.create).toHaveBeenCalled();
    expect(prisma.systemLog.create).not.toHaveBeenCalled();
  });
});

describe('updateAgentMetrics / getLatestAgentMetrics', () => {
  it('updateAgentMetrics reads AgentLesson and upserts AgentPerformance, not MarketEvent', async () => {
    (prisma.agentLesson.findMany as jest.Mock).mockResolvedValue([
      { agentId: 'technician', agentName: 'The Technician', correct: true, confidenceScore: 80, createdAt: new Date() },
      { agentId: 'technician', agentName: 'The Technician', correct: false, confidenceScore: 60, createdAt: new Date() },
    ]);
    const { updateAgentMetrics } = require('../src/services/selfLearning');
    await updateAgentMetrics('technician');
    expect(prisma.agentPerformance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: 'technician' },
    }));
    expect(prisma.marketEvent.create).not.toHaveBeenCalled();
  });

  it('getLatestAgentMetrics reads from AgentPerformance, not MarketEvent', async () => {
    (prisma.agentPerformance.findMany as jest.Mock).mockResolvedValue([
      { agentId: 'technician', accuracy: 75, status: 'ACTIVE' },
    ]);
    const { getLatestAgentMetrics } = require('../src/services/selfLearning');
    const result = await getLatestAgentMetrics();
    expect(prisma.agentPerformance.findMany).toHaveBeenCalled();
    expect(result.length).toBe(1);
  });
});
