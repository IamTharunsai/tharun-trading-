import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    agentLearningState: { upsert: jest.fn().mockResolvedValue({}) },
    systemLog: { create: jest.fn() },
  },
}));
jest.mock('axios', () => ({ get: jest.fn().mockResolvedValue({ data: {} }) }));
jest.mock('../src/utils/redis', () => ({ redis: { get: jest.fn().mockResolvedValue(null), setex: jest.fn() } }));

describe('agentResourceLearning persistence', () => {
  it('buildAgentLearningState upserts AgentLearningState, not SystemLog', async () => {
    const { buildAgentLearningState } = require('../src/services/agentResourceLearning');
    await buildAgentLearningState(1, 'AAPL');
    expect(prisma.agentLearningState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId_assetId: { agentId: '1', assetId: 'AAPL' } },
    }));
    expect(prisma.systemLog.create).not.toHaveBeenCalled();
  });
});
