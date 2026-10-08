jest.mock('../src/utils/prisma', () => ({ prisma: {
  position: { findUnique: jest.fn(), update: jest.fn() },
  positionExit: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  trade: { findMany: jest.fn(), update: jest.fn() }, $transaction: jest.fn(),
} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/trading/accountScope', () => ({
  getVerifiedAccountScope: jest.fn(() => Promise.resolve(mockScope)),
  brokerSymbol: (asset: string, market: string) => market === 'crypto' ? `${asset}/USD` : asset,
}));
import { prisma } from '../src/utils/prisma';
import { requestPositionExit, reconcilePositionExits } from '../src/trading/positionExits';

const broker = { listOrdersVerified: jest.fn(), cancelOrder: jest.fn(), getPosition: jest.fn(),
  createOrder: jest.fn(), getOrder: jest.fn(), getOrderByClientOrderId: jest.fn() };
const mockScope = { broker, accountId: 'paper-1', mode: 'paper' };
let position: any;
let intent: any;
let trade: any;
let order: any;
beforeEach(() => {
  jest.clearAllMocks(); process.env.DRY_RUN = 'false';
  position = { id: 'pos-1', asset: 'AAPL', market: 'stocks', accountId: 'paper-1', brokerMode: 'paper',
    side: 'BUY', quantity: 10, entryPrice: 100, currentPrice: 101, status: 'OPEN', openedAt: new Date('2026-10-07T14:00:00Z') };
  trade = { id: 'trade-1', positionId: 'pos-1', accountId: 'paper-1', brokerMode: 'paper', type: 'BUY',
    quantity: 10, closedQuantity: 0, entryPrice: 100, realizedPnl: 0, exitNotional: 0, fees: 0, status: 'OPEN' };
  intent = null;
  order = { id: 'exit-1', symbol: 'AAPL', side: 'sell', status: 'filled', filled_qty: '10', filled_avg_price: '105' };
  (prisma.position.findUnique as jest.Mock).mockImplementation(async () => position);
  (prisma.position.update as jest.Mock).mockImplementation(async ({ data }) => Object.assign(position, data));
  (prisma.positionExit.findFirst as jest.Mock).mockImplementation(async () => intent);
  (prisma.positionExit.findUnique as jest.Mock).mockImplementation(async () => intent);
  (prisma.positionExit.findMany as jest.Mock).mockImplementation(async () => intent ? [intent] : []);
  (prisma.positionExit.create as jest.Mock).mockImplementation(async ({ data }) => {
    if (intent?.cycleKey === data.cycleKey) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
    intent = { id: 'intent-1', evidenceKind: 'CLIENT_ORDER', appliedQuantity: 0, appliedNotional: 0, realizedPnl: 0, entryBasis: 0,
      createdAt: new Date(), updatedAt: new Date(), ...data }; return intent;
  });
  (prisma.positionExit.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
    if (!intent || (where.id && where.id !== intent.id) || (where.positionId && where.positionId !== intent.positionId)
      || (typeof where.status === 'string' && where.status !== intent.status)
      || (where.status?.in && !where.status.in.includes(intent.status))
      || (where.appliedQuantity !== undefined && where.appliedQuantity !== intent.appliedQuantity)
      || (where.appliedNotional !== undefined && where.appliedNotional !== intent.appliedNotional)) return { count: 0 };
    Object.assign(intent, data, { updatedAt: new Date() }); return { count: 1 };
  });
  (prisma.positionExit.update as jest.Mock).mockImplementation(async ({ data }) => Object.assign(intent, data));
  (prisma.trade.findMany as jest.Mock).mockImplementation(async () => trade.status === 'OPEN' ? [trade] : []);
  (prisma.trade.update as jest.Mock).mockImplementation(async ({ data }) => Object.assign(trade, data));
  (prisma.$transaction as jest.Mock).mockImplementation(async work => {
    const before = structuredClone({ position, trade, intent });
    try { return await work(prisma); } catch (error) {
      ({ position, trade, intent } = before); throw error;
    }
  });
  broker.listOrdersVerified.mockResolvedValue([]);
  broker.cancelOrder.mockResolvedValue(undefined);
  broker.getPosition.mockImplementation(async () => {
    if (!intent || intent.status === 'PREPARING') return { qty: String(position.quantity), side: position.side === 'SELL' ? 'short' : 'long' };
    const remaining = intent.quantity - Number(order.filled_qty);
    return remaining > 0 ? { qty: String(remaining), side: position.side === 'SELL' ? 'short' : 'long' } : null;
  });
  broker.createOrder.mockImplementation(async request => { order.client_order_id = request.client_order_id; return { ...order }; });
  broker.getOrder.mockImplementation(async () => ({ ...order }));
  broker.getOrderByClientOrderId.mockImplementation(async () => ({ ...order }));
});
afterEach(() => { process.env.DRY_RUN = 'true'; });

it('closes only after an actual broker fill, using that fill price and percent units', async () => {
  const result = await requestPositionExit('pos-1', 'manual_close');
  expect(result.closed).toBe(true); expect(result.pnl).toBe(50);
  expect(trade).toMatchObject({ status: 'CLOSED', exitPrice: 105, pnl: 50, pnlPct: 5, closedQuantity: 10 });
  expect(position).toMatchObject({ status: 'CLOSED', quantity: 0 });
  expect(prisma.positionExit.create.mock.invocationCallOrder[0]).toBeLessThan(broker.createOrder.mock.invocationCallOrder[0]);
});
it('keeps an accepted unfilled exit open', async () => {
  Object.assign(order, { status: 'accepted', filled_qty: '0', filled_avg_price: null });
  expect(await requestPositionExit('pos-1', 'STOP_LOSS')).toMatchObject({ closed: false, pending: true });
  expect(position.status).toBe('OPEN'); expect(trade.status).toBe('OPEN');
  expect(prisma.trade.update).not.toHaveBeenCalled();
});
it('attributes partial fills incrementally and does not realize the same fill twice', async () => {
  Object.assign(order, { status: 'partially_filled', filled_qty: '4', filled_avg_price: '102' });
  await requestPositionExit('pos-1', 'TAKE_PROFIT');
  expect(trade.closedQuantity).toBe(4); expect(trade.realizedPnl).toBe(8); expect(position.quantity).toBe(6);
  await reconcilePositionExits();
  expect(trade.closedQuantity).toBe(4); expect(trade.realizedPnl).toBe(8);
  Object.assign(order, { status: 'filled', filled_qty: '10', filled_avg_price: '103' });
  await reconcilePositionExits();
  expect(trade).toMatchObject({ status: 'CLOSED', closedQuantity: 10, exitPrice: 103 });
  expect(trade.pnl).toBeCloseTo(30, 8); expect(trade.pnlPct).toBeCloseTo(3, 8);
  expect(broker.createOrder).toHaveBeenCalledTimes(1);
});
it('does not submit from a position belonging to another account', async () => {
  position.accountId = 'different-account';
  expect(await requestPositionExit('pos-1', 'manual_close')).toMatchObject({ closed: false, error: 'POSITION_ACCOUNT_UNVERIFIED' });
  expect(broker.createOrder).not.toHaveBeenCalled();
});
it('does not guess an exit price merely because the broker is flat', async () => {
  broker.getPosition.mockResolvedValue(null);
  expect((await requestPositionExit('pos-1', 'broker_sync')).closed).toBe(false);
  expect(position.status).toBe('OPEN'); expect(prisma.trade.update).not.toHaveBeenCalled();
});
it('retains a lost submission response and recovers the same client identity', async () => {
  broker.createOrder.mockImplementation(async request => { order.client_order_id = request.client_order_id; throw new Error('response lost'); });
  expect((await requestPositionExit('pos-1', 'manual_close')).closed).toBe(false);
  expect(intent.status).toBe('RECONCILIATION_REQUIRED');
  await reconcilePositionExits();
  expect(position.status).toBe('CLOSED'); expect(broker.createOrder).toHaveBeenCalledTimes(1);
});
it('refuses a mismatched broker order identity', async () => {
  broker.getOrder.mockResolvedValue({ ...order, client_order_id: 'somebody-else' });
  expect((await requestPositionExit('pos-1', 'manual_close')).closed).toBe(false);
  expect(trade.status).toBe('OPEN');
});
it('does not submit if protective order cancellation is unconfirmed', async () => {
  broker.listOrdersVerified.mockResolvedValue([{ id: 'protective', symbol: 'AAPL', status: 'accepted', legs: [] }]);
  broker.getOrder.mockResolvedValue({ status: 'pending_cancel' });
  expect((await requestPositionExit('pos-1', 'manual_close')).closed).toBe(false);
  expect(broker.createOrder).not.toHaveBeenCalled();
});
it('rolls back ledger updates if the lot attribution is unavailable', async () => {
  trade.quantity = 9;
  expect((await requestPositionExit('pos-1', 'manual_close')).closed).toBe(false);
  expect(position.status).toBe('OPEN'); expect(trade.status).toBe('OPEN');
  expect(intent.status).toBe('RECONCILIATION_REQUIRED');
});
it('uses correct direction and P&L for a short position', async () => {
  position.side = 'SELL'; trade.type = 'SELL'; order.side = 'buy'; order.filled_avg_price = '95';
  expect((await requestPositionExit('pos-1', 'manual_close')).pnl).toBe(50);
  expect(trade.pnlPct).toBe(5);
});
