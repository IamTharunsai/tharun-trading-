jest.mock('../src/utils/prisma', () => ({ prisma: {
  trade: { updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  position: { findUnique: jest.fn(), upsert: jest.fn() },
  agentDecision: { update: jest.fn() }, $transaction: jest.fn(),
} }));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));
import { prisma } from '../src/utils/prisma';
import { applyEntryObservation, classifyEntryOrder, reconcilePaperEntry } from '../src/trading/paperOrderLifecycle';

const trade: any = { id: 't1', asset: 'AAPL', market: 'stocks', type: 'BUY', quantity: 2, entryPrice: 100,
  brokerConfirmed: false, brokerOrderId: 'CLIENT:entry-t1', stopLossPrice: 95, takeProfitPrice: 110, status: 'OPEN' };
const order = { id: 'o1', symbol: 'AAPL', side: 'buy', status: 'filled', filled_qty: '2', filled_avg_price: '101' };
beforeEach(() => {
  jest.resetAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation(fn => fn(prisma));
  (prisma.trade.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.trade.findUnique as jest.Mock).mockResolvedValue({ ...trade, brokerConfirmed: true });
  (prisma.position.findUnique as jest.Mock).mockResolvedValue(null);
});

it.each(['accepted', 'new', 'pending_new', 'done_for_day', 'pending_cancel'])('keeps %s pending', state => {
  expect(classifyEntryOrder({ ...order, status: state, filled_qty: '0', filled_avg_price: null })).toBe('pending');
});
it.each(['canceled', 'expired', 'rejected'])('preserves shares filled before %s', state => {
  expect(classifyEntryOrder({ ...order, status: state, filled_qty: '0.3' })).toBe('filled');
});
it('does not fabricate a position from an accepted order', async () => {
  expect(await applyEntryObservation(trade, { ...order, status: 'accepted', filled_qty: '0', filled_avg_price: null })).toBe(false);
  expect(prisma.position.upsert).not.toHaveBeenCalled();
  expect(prisma.trade.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ status: 'FAILED' }) }));
});
it('atomically creates a position using the final cumulative fill', async () => {
  expect(await applyEntryObservation(trade, { ...order, status: 'canceled', filled_qty: '0.3' })).toBe(true);
  expect(prisma.position.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ quantity: 0.3, entryPrice: 101 }) }));
});
it('cannot recreate a position from an already-applied observation', async () => {
  (prisma.trade.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
  expect(await applyEntryObservation(trade, order)).toBe(false);
  expect(prisma.position.upsert).not.toHaveBeenCalled();
});
it('does not overwrite a different open position', async () => {
  (prisma.position.findUnique as jest.Mock).mockResolvedValue({ status: 'OPEN' });
  await expect(applyEntryObservation(trade, order)).rejects.toThrow('refusing to overwrite');
  expect(prisma.position.upsert).not.toHaveBeenCalled();
});
it('marks a truly rejected zero-fill order failed', async () => {
  await applyEntryObservation(trade, { ...order, status: 'rejected', filled_qty: '0', filled_avg_price: null });
  expect(prisma.trade.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
});
it('keeps a lost response pending for later recovery by client ID', async () => {
  const broker: any = { getOrderByClientId: jest.fn().mockResolvedValue(null) };
  expect(await reconcilePaperEntry(trade, broker)).toBe(false);
  expect(broker.getOrderByClientId).toHaveBeenCalledWith('entry-t1');
  expect(prisma.trade.updateMany).not.toHaveBeenCalled();
});
it('requests remainder cancellation without treating cancellation acceptance as final', async () => {
  const broker: any = { getOrderByClientId: jest.fn().mockResolvedValue({ ...order, status: 'partially_filled', filled_qty: '0.3' }), cancelOrder: jest.fn().mockResolvedValue(undefined) };
  expect(await reconcilePaperEntry(trade, broker)).toBe(false);
  expect(broker.cancelOrder).toHaveBeenCalledWith('o1');
  expect(prisma.position.upsert).not.toHaveBeenCalled();
});
it.each(['NaN', '-2', 'Infinity'])('rejects invalid filled quantity %s', qty => {
  expect(() => classifyEntryOrder({ ...order, filled_qty: qty })).toThrow('Invalid broker');
});
it('rejects a mismatched order before any database write', async () => {
  await expect(applyEntryObservation(trade, { ...order, symbol: 'MSFT' })).rejects.toThrow('identity');
  expect(prisma.trade.updateMany).not.toHaveBeenCalled();
});
