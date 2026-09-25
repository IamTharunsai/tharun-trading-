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
      data: [{ condition_id: 'cond-abc-123', closed: true, outcomePrices: '["1", "0"]' }],
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
