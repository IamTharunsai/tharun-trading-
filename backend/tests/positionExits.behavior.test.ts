jest.mock('../src/utils/prisma', () => ({ prisma: {
  position: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  positionExit: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  executionIntent: { count: jest.fn() }, trade: { findMany: jest.fn() }, $transaction: jest.fn(), $executeRaw: jest.fn(),
  brokerOrderEvidence: { count: jest.fn() },
} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('../src/trading/accountScope', () => ({
  getVerifiedAccountScope: jest.fn(() => Promise.resolve(scope)),
  positionScopeKey: (a: string, m: string, s: string) => `${a}:${m}:${s}`,
  brokerSymbol: (a: string) => a,
}));
jest.mock('../src/trading/brokerEvidence', () => ({
  QUANTITY_EPS: 1e-9, FINAL_ORDER_STATES: new Set(['filled', 'canceled', 'expired', 'rejected']),
  remainingLotQuantity: (lot: { quantity: number; closedQuantity: number }) => lot.quantity - lot.closedQuantity,
  reconcileProtectionEvidence: jest.fn(), markAccountingUnknown: jest.fn(), applyBrokerExitEvidence: jest.fn(),
  readOrderChain: jest.fn(),
}));
import { prisma } from '../src/utils/prisma';
import { requestPositionExit, reconcilePositionExits } from '../src/trading/positionExits';
import { applyBrokerExitEvidence, markAccountingUnknown, readOrderChain, reconcileProtectionEvidence } from '../src/trading/brokerEvidence';
import type { AccountScope } from '../src/trading/accountScope';
const broker = { listOrdersVerified: jest.fn(), cancelOrder: jest.fn(), getPosition: jest.fn(), createOrder: jest.fn(),
  getOrderVerified: jest.fn(), getOrderByClientOrderId: jest.fn() };
const scope = { broker, accountId: 'fixture', mode: 'paper' } as unknown as AccountScope;
let position: any; let intent: any; let lot: any; let order: any; let brokerQuantity: number;
const update = (target: any, data: any) => { for (const [key, value] of Object.entries(data)) {
  target[key] = value && typeof value === 'object' && 'increment' in value ? (target[key] ?? 0) + Number(value.increment) : value;
} return { ...target }; };
beforeEach(() => {
  jest.clearAllMocks(); process.env.DRY_RUN = 'false'; intent = null; brokerQuantity = 10;
  position = { id: 'position', asset: 'AAPL', market: 'stocks', side: 'BUY', accountId: 'fixture', brokerMode: 'paper',
    openedAt: new Date('2026-10-15T13:00:00Z'), quantity: 10, status: 'OPEN', evidenceVersion: 0, accountingStatus: 'RECONCILED' };
  lot = { quantity: 10, closedQuantity: 0 };
  order = { id: 'exit', symbol: 'AAPL', side: 'sell', status: 'accepted', filled_qty: 0 };
  (prisma.position.findUnique as jest.Mock).mockImplementation(async () => ({ ...position }));
  (prisma.position.findUniqueOrThrow as jest.Mock).mockImplementation(async () => ({ ...position }));
  (prisma.position.update as jest.Mock).mockImplementation(async ({ data }) => update(position, data));
  (prisma.position.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
    if (where.evidenceVersion !== position.evidenceVersion) return { count: 0 };
    update(position, data); return { count: 1 };
  });
  (prisma.trade.findMany as jest.Mock).mockImplementation(async () => [lot]);
  (prisma.executionIntent.count as jest.Mock).mockResolvedValue(0);
  (prisma.brokerOrderEvidence.count as jest.Mock).mockResolvedValue(0);
  (prisma.positionExit.count as jest.Mock).mockResolvedValue(0);
  (prisma.positionExit.findFirst as jest.Mock).mockImplementation(async () => intent);
  (prisma.positionExit.findUnique as jest.Mock).mockImplementation(async () => intent);
  (prisma.positionExit.findMany as jest.Mock).mockImplementation(async () => intent ? [intent] : []);
  (prisma.positionExit.create as jest.Mock).mockImplementation(async ({ data }) => {
    intent = { id: 'intent', updatedAt: new Date(), realizedPnl: 0, ...data }; return intent;
  });
  (prisma.positionExit.update as jest.Mock).mockImplementation(async ({ data }) => update(intent, data));
  (prisma.positionExit.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
    if (!intent || (typeof where.status === 'string' && where.status !== intent.status)
      || (where.status?.in && !where.status.in.includes(intent.status))) return { count: 0 };
    update(intent, data); return { count: 1 };
  });
  (prisma.$transaction as jest.Mock).mockImplementation(async work => work(prisma));
  broker.getPosition.mockImplementation(async () => brokerQuantity ? { qty: String(brokerQuantity), side: 'long', avg_entry_price: '100' } : null);
  broker.listOrdersVerified.mockResolvedValue([]);
  broker.createOrder.mockImplementation(async request => { order.client_order_id = request.client_order_id; return { ...order }; });
  broker.getOrderVerified.mockImplementation(async () => ({ ...order }));
  broker.getOrderByClientOrderId.mockImplementation(async () => ({ ...order }));
  (readOrderChain as jest.Mock).mockImplementation(async () => [{ ...order }]);
  (reconcileProtectionEvidence as jest.Mock).mockResolvedValue(undefined);
  (markAccountingUnknown as jest.Mock).mockResolvedValue(undefined);
  (applyBrokerExitEvidence as jest.Mock).mockResolvedValue({ applied: false, positionClosed: false, pnl: 0 });
});
afterEach(() => { delete process.env.DRY_RUN; });

test('rejects lot/holding drift before canceling protection or submitting an exit', async () => {
  brokerQuantity = 6;
  broker.listOrdersVerified.mockResolvedValue([{ id: 'stop', symbol: 'AAPL', status: 'new' }]);
  expect(await requestPositionExit(position.id, 'manual', scope)).toMatchObject({ closed: false, pending: true, error: 'BROKER_INVENTORY_AND_EXECUTION_LOTS_DISAGREE' });
  expect(broker.cancelOrder).not.toHaveBeenCalled(); expect(broker.createOrder).not.toHaveBeenCalled();
});
test('reconciled protection partial sets the remaining order quantity before claiming submission', async () => {
  brokerQuantity = 6;
  (reconcileProtectionEvidence as jest.Mock).mockImplementation(async () => { lot.closedQuantity = 4; position.quantity = 6; position.evidenceVersion = 1; });
  expect(await requestPositionExit(position.id, 'STOP_LOSS', scope)).toMatchObject({ closed: false, pending: true });
  expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({ qty: 6, side: 'sell' }));
  expect(intent.quantity).toBe(6);
});
test('keeps unavailable protection evidence pending without removing live protection', async () => {
  (reconcileProtectionEvidence as jest.Mock).mockRejectedValue(new Error('BROKER_ORDER_EVIDENCE_UNAVAILABLE'));
  expect(await requestPositionExit(position.id, 'manual', scope)).toMatchObject({ closed: false, pending: true });
  expect(broker.cancelOrder).not.toHaveBeenCalled(); expect(broker.createOrder).not.toHaveBeenCalled();
});
test('an evidence version change invalidates the prepared holding before POST', async () => {
  let positions = 0;
  (prisma.position.findUniqueOrThrow as jest.Mock).mockImplementation(async () => { positions++; if (positions === 3) position.evidenceVersion++; return { ...position }; });
  expect(await requestPositionExit(position.id, 'manual', scope)).toMatchObject({ closed: false, pending: true, error: 'EXIT_PREFLIGHT_CHANGED' });
  expect(broker.createOrder).not.toHaveBeenCalled();
});
test('a lost submission response recovers the same identity and never re-posts', async () => {
  broker.createOrder.mockImplementationOnce(async request => { order.client_order_id = request.client_order_id; throw new Error('lost response'); });
  expect(await requestPositionExit(position.id, 'manual', scope)).toMatchObject({ closed: false, pending: true });
  expect(intent.status).toBe('RECONCILIATION_REQUIRED');
  await reconcilePositionExits(scope);
  expect(broker.getOrderByClientOrderId).toHaveBeenCalledWith(intent.clientOrderId);
  expect(broker.createOrder).toHaveBeenCalledTimes(1);
});
test('a stopped order cannot release a claim for a new attempt', async () => {
  order.status = 'stopped';
  await requestPositionExit(position.id, 'manual', scope);
  await requestPositionExit(position.id, 'manual', scope);
  expect(broker.createOrder).toHaveBeenCalledTimes(1); expect(intent.status).toBe('PARTIAL');
});
test('flat inventory with a still-executable protection leg cannot close the lifecycle or release it for a new entry', async () => {
  brokerQuantity = 0; position.quantity = 0; lot.closedQuantity = 10;
  (prisma.brokerOrderEvidence.count as jest.Mock).mockResolvedValue(1);
  expect(await requestPositionExit(position.id, 'manual', scope)).toMatchObject({ closed: false, pending: true });
  expect(position.status).toBe('OPEN'); expect(broker.createOrder).not.toHaveBeenCalled();
});
test('refuses another account and keeps broker-flat unknown exits pending', async () => {
  position.accountId = 'other';
  expect(await requestPositionExit(position.id, 'manual', scope)).toMatchObject({ closed: false, error: 'POSITION_ACCOUNT_UNVERIFIED' });
  position.accountId = scope.accountId; brokerQuantity = 0;
  expect(await requestPositionExit(position.id, 'manual', scope)).toMatchObject({ closed: false, pending: true });
  expect(broker.createOrder).not.toHaveBeenCalled();
});
