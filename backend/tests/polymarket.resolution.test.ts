import { prisma } from '../src/utils/prisma';
import axios from 'axios';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    trade: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn(), update: jest.fn() },
    position: {},
  },
}));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('axios');

describe('placePolymarketBet — stores conditionId', () => {
  it('writes analysis.conditionId into Trade.brokerOrderId for paper bets', async () => {
    const { placePolymarketBet } = require('../src/services/polymarket');
    const analysis = {
      question: 'Will X happen?', marketImpliedProbability: 0.4, ourEstimatedProbability: 0.6,
      edge: 0.2, confidence: 70, recommendedSide: 'YES', betSizeUSD: 100,
      expectedProfitUSD: 20, reasoning: 'test', riskFactors: [],
      resolutionDate: new Date().toISOString(), daysToResolution: 5,
      conditionId: 'cond-abc-123',
    };
    await placePolymarketBet(analysis as any, analysis.conditionId, true);
    expect(prisma.trade.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ brokerOrderId: 'cond-abc-123' }),
    }));
  });
});

describe('pollPolymarketResolutions', () => {
  it('closes an OPEN Polymarket trade whose market has resolved YES', async () => {
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([
      { id: 'trade-1', asset: 'POLYMARKET', brokerOrderId: 'cond-abc-123', entryPrice: 0.4, quantity: 100, type: 'BUY' },
    ]);
    (axios.get as jest.Mock).mockResolvedValue({
      data: [{ condition_id: 'cond-abc-123', closed: true, outcomes: ['YES', 'NO'], outcomePrices: '["1", "0"]' }],
    });

    const { pollPolymarketResolutions } = require('../src/services/polymarket');
    await pollPolymarketResolutions();

    expect(prisma.trade.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'trade-1' },
      data: expect.objectContaining({ status: 'CLOSED' }),
    }));
  });

  it('leaves an OPEN trade alone if its market has not closed yet', async () => {
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([
      { id: 'trade-2', asset: 'POLYMARKET', brokerOrderId: 'cond-def-456', entryPrice: 0.4, quantity: 100, type: 'BUY' },
    ]);
    (axios.get as jest.Mock).mockResolvedValue({
      data: [{ condition_id: 'cond-def-456', closed: false }],
    });

    const { pollPolymarketResolutions } = require('../src/services/polymarket');
    (prisma.trade.update as jest.Mock).mockClear();
    await pollPolymarketResolutions();

    expect(prisma.trade.update).not.toHaveBeenCalled();
  });
});

it('US live credentials cannot submit international token orders or fabricate fills', async () => {
  jest.clearAllMocks();
  process.env.POLYMARKET_US_LIVE = 'true';
  const { placePolymarketBet } = require('../src/services/polymarket');
  const result = await placePolymarketBet({ conditionId: 'fixture-condition', recommendedSide: 'YES' }, 'fixture-condition', false);
  expect(result.success).toBe(false);
  expect(axios.post).not.toHaveBeenCalled();
  expect(prisma.trade.create).not.toHaveBeenCalled();
});
it('simulation storage failure cannot claim a successful bet', async () => {
  jest.clearAllMocks();
  (prisma.trade.create as jest.Mock).mockRejectedValueOnce(new Error('fixture DB failure'));
  const { placePolymarketBet } = require('../src/services/polymarket');
  await expect(placePolymarketBet({ conditionId: 'fixture', question: 'Fixture?', recommendedSide: 'NO', betSizeUSD: 10, marketImpliedProbability: 0.4 }, 'fixture', true)).rejects.toThrow('fixture DB failure');
});
it('invalid simulation is refused before database work', async () => {
  jest.clearAllMocks();
  const { placePolymarketBet } = require('../src/services/polymarket');
  expect((await placePolymarketBet({ recommendedSide: 'SKIP' }, 'fixture', true)).success).toBe(false);
  expect(prisma.trade.create).not.toHaveBeenCalled();
});
it.each(['["0","0"]', '["0.5","0.5"]', '["0.99","0.01"]', 'invalid-json'])('ambiguous closed market is not a NO win: %s', async prices => {
  jest.clearAllMocks();
  (prisma.trade.findMany as jest.Mock).mockResolvedValue([{ id: 'fixture', brokerOrderId: 'fixture', type: 'SELL', entryPrice: 0.4, quantity: 10 }]);
  (axios.get as jest.Mock).mockResolvedValue({ data: [{ conditionId: 'fixture', closed: true, outcomes: ['YES', 'NO'], outcomePrices: prices }] });
  const { pollPolymarketResolutions } = require('../src/services/polymarket');
  await pollPolymarketResolutions();
  expect(prisma.trade.update).not.toHaveBeenCalled();
});