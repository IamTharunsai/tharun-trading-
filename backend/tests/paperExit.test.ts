jest.mock('../src/utils/prisma', () => ({ prisma: {
  trade: { findFirst: jest.fn(), updateMany: jest.fn() },
  position: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
} }));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../src/services/alpacaBroker', () => ({ createAlpacaBroker: jest.fn() }));
jest.mock('../src/trading/executionEngine', () => ({ confirmOrderFill: jest.fn() }));

import { closePosition } from '../src/trading/riskManager';
import { prisma } from '../src/utils/prisma';
import { createAlpacaBroker } from '../src/services/alpacaBroker';
import { confirmOrderFill } from '../src/trading/executionEngine';

const position = { id: 'pos-1', asset: 'AAPL', market: 'stocks', status: 'OPEN', side: 'BUY', entryPrice: 100, quantity: 10 };
const broker = { getOrderByClientId: jest.fn(), getPosition: jest.fn(), createOrder: jest.fn() };

beforeEach(() => {
  jest.resetAllMocks();
  process.env.TRADING_MODE = 'paper';
  delete process.env.ALPACA_BASE_URL;
  (prisma.position.findUnique as jest.Mock).mockResolvedValue(position);
  (prisma.trade.findFirst as jest.Mock).mockResolvedValue({ id: 'trade-1', brokerConfirmed: true, brokerOrderId: 'entry-1' });
  (prisma.trade.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.$transaction as jest.Mock).mockImplementation(fn => fn(prisma));
  (createAlpacaBroker as jest.Mock).mockReturnValue(broker);
  broker.getOrderByClientId.mockResolvedValue(null);
  broker.getPosition.mockResolvedValue({ qty: '10' });
  broker.createOrder.mockResolvedValue({ id: 'exit-1' });
  (confirmOrderFill as jest.Mock).mockResolvedValue({ fillPrice: 103, fillQty: 10 });
});

it('closes at the paper broker fill, not the displayed quote', async () => {
  const result = await closePosition(position, 105, 'manual_close');
  expect(result.pnl).toBe(30);
  expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({ side: 'sell', qty: 10, client_order_id: 'close-trade-1' }));
  expect(prisma.trade.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED', exitPrice: 103, pnl: 30 }) }));
});

it('keeps the local position open when the exit is unconfirmed', async () => {
  (confirmOrderFill as jest.Mock).mockRejectedValue(new Error('not filled'));
  await expect(closePosition(position, 105, 'stop_loss')).rejects.toThrow('not filled');
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('reuses a pending exit after a previous poll timed out or the server restarted', async () => {
  broker.getOrderByClientId.mockResolvedValue({ id: 'existing-exit' });
  await closePosition(position, 105, 'take_profit');
  expect(broker.createOrder).not.toHaveBeenCalled();
  expect(confirmOrderFill).toHaveBeenCalledWith(broker, 'existing-exit');
});

it('recovers an accepted order when its submission response was lost', async () => {
  broker.createOrder.mockRejectedValue(new Error('network timeout'));
  broker.getOrderByClientId.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'accepted-exit' });
  await closePosition(position, 105, 'manual_close');
  expect(broker.createOrder).toHaveBeenCalledTimes(1);
  expect(confirmOrderFill).toHaveBeenCalledWith(broker, 'accepted-exit');
});

it('coalesces concurrent stop-loss and manual close requests', async () => {
  await Promise.all([closePosition(position, 90, 'stop_loss'), closePosition(position, 91, 'manual_close')]);
  expect(broker.createOrder).toHaveBeenCalledTimes(1);
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});

it('does not submit a new order when order lookup fails', async () => {
  broker.getOrderByClientId.mockRejectedValue(new Error('broker offline'));
  await expect(closePosition(position, 105, 'manual_close')).rejects.toThrow('broker offline');
  expect(broker.createOrder).not.toHaveBeenCalled();
});

it('does not trade against mismatched broker holdings', async () => {
  broker.getPosition.mockResolvedValue({ qty: '5' });
  await expect(closePosition(position, 105, 'manual_close')).rejects.toThrow('differs');
  expect(broker.createOrder).not.toHaveBeenCalled();
});

it('buys back a paper short and computes its realized P&L', async () => {
  (prisma.position.findUnique as jest.Mock).mockResolvedValue({ ...position, side: 'SELL' });
  broker.getPosition.mockResolvedValue({ qty: '-10' });
  const result = await closePosition(position, 105, 'stop_loss');
  expect(result.pnl).toBe(-30);
  expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({ side: 'buy' }));
});

it('locally closes simulated crypto without submitting a stock order', async () => {
  (prisma.position.findUnique as jest.Mock).mockResolvedValue({ ...position, market: 'crypto' });
  expect((await closePosition(position, 105, 'take_profit')).pnl).toBe(50);
  expect(createAlpacaBroker).not.toHaveBeenCalled();
});

it('rejects an invalid simulation quote', async () => {
  (prisma.position.findUnique as jest.Mock).mockResolvedValue({ ...position, market: 'crypto' });
  await expect(closePosition(position, NaN, 'manual_close')).rejects.toThrow('valid current');
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
