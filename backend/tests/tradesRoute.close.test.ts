import { closePosition } from '../src/trading/riskManager';
import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    trade: { findFirst: jest.fn(), update: jest.fn() },
    position: { update: jest.fn() },
  },
}));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));

describe('closePosition — manual close', () => {
  it('closes the matching OPEN trade and position with the given exit price', async () => {
    (prisma.trade.findFirst as jest.Mock).mockResolvedValue({ id: 'trade-1', asset: 'AAPL' });
    (prisma.trade.update as jest.Mock).mockResolvedValue({});
    (prisma.position.update as jest.Mock).mockResolvedValue({});

    const position = { id: 'pos-1', asset: 'AAPL', side: 'BUY', entryPrice: 100, quantity: 10 };
    const result = await closePosition(position, 105, 'manual_close');

    expect(result.pnl).toBeCloseTo(50); // (105-100) * 10
    expect(prisma.trade.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'trade-1' },
      data: expect.objectContaining({ status: 'CLOSED', exitReason: 'manual_close' }),
    }));
    expect(prisma.position.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pos-1' },
      data: { status: 'CLOSED' },
    }));
  });
});
