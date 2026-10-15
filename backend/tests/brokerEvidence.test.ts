jest.mock('../src/utils/prisma', () => ({ prisma: {
  position: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  trade: { findMany: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
  positionExit: { findMany: jest.fn() },
  brokerOrderEvidence: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  brokerFillAllocation: { upsert: jest.fn(), findMany: jest.fn() },
  brokerActivity: { upsert: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
  $executeRaw: jest.fn(), $transaction: jest.fn(),
} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/trading/accountScope', () => ({ positionScopeKey: (a: string, m: string, s: string) => `${a}:${m}:${s}`,
  brokerSymbol: (a: string, m: string) => m === 'crypto' ? `${a}/USD` : a }));
import { Prisma, Trade, Position } from '@prisma/client';
import { prisma } from '../src/utils/prisma';
import { applyBrokerExitEvidence, incrementalFill, readOrderChain, reconcileProtectionEvidence, retainBrokerActivities } from '../src/trading/brokerEvidence';
import type { AlpacaOrder } from '../src/services/alpacaBroker';
import type { AccountScope } from '../src/trading/accountScope';

type Lot = Pick<Trade, 'id' | 'positionId' | 'asset' | 'market' | 'accountId' | 'brokerMode' | 'type' | 'quantity' | 'entryPrice' | 'closedQuantity' | 'feeQuantity' | 'fees' | 'actualFeeCash' | 'realizedPnl' | 'exitNotional' | 'status' | 'brokerOrderId'> & Partial<Trade>;
type Holding = Pick<Position, 'id' | 'asset' | 'market' | 'side' | 'accountId' | 'brokerMode' | 'openedAt' | 'quantity' | 'status' | 'evidenceVersion'>;
let lot: Lot; let holding: Holding;
let cursors: Map<string, any>; let activities: Map<string, any>;
const broker = { getOrderVerified: jest.fn(), listActivitiesVerified: jest.fn() };
const scope = { broker, accountId: 'fixture-paper', mode: 'paper' } as unknown as AccountScope;
const order = (id: string, qty: number, average: number, status = 'partially_filled') => ({ id, symbol: 'AAPL', side: 'sell',
  filled_qty: qty, filled_avg_price: average, status, legs: [], replaced_by: null, created_at: '2026-10-15T14:00:00Z' } as unknown as AlpacaOrder);
const mutate = (target: any, data: any) => { for (const [key, value] of Object.entries(data)) {
  const operation = value as { increment?: number; decrement?: number } | null;
  target[key] = operation && typeof operation === 'object' && 'increment' in operation ? (target[key] ?? 0) + Number(operation.increment)
    : operation && typeof operation === 'object' && 'decrement' in operation ? target[key] - Number(operation.decrement) : value;
} return { ...target }; };

beforeEach(() => {
  jest.clearAllMocks(); cursors = new Map(); activities = new Map();
  holding = { id: 'position', asset: 'AAPL', market: 'stocks', side: 'BUY', accountId: scope.accountId, brokerMode: scope.mode,
    openedAt: new Date('2026-10-15T13:00:00Z'), quantity: 10, status: 'OPEN', evidenceVersion: 0 };
  lot = { id: 'lot', positionId: holding.id, asset: 'AAPL', market: 'stocks', accountId: scope.accountId, brokerMode: scope.mode,
    type: 'BUY', quantity: 10, entryPrice: 100, closedQuantity: 0, feeQuantity: 0, fees: 0, actualFeeCash: 0,
    realizedPnl: 0, exitNotional: 0, status: 'OPEN', brokerOrderId: 'entry' };
  (prisma.position.findUniqueOrThrow as jest.Mock).mockImplementation(async () => ({ ...holding }));
  (prisma.position.update as jest.Mock).mockImplementation(async ({ data }) => mutate(holding, data));
  (prisma.trade.findMany as jest.Mock).mockImplementation(async ({ where }) => !where.status || lot.status === where.status ? [{ ...lot }] : []);
  (prisma.positionExit.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.trade.findUniqueOrThrow as jest.Mock).mockImplementation(async () => ({ ...lot }));
  (prisma.trade.update as jest.Mock).mockImplementation(async ({ data }) => mutate(lot, data));
  (prisma.brokerOrderEvidence.upsert as jest.Mock).mockImplementation(async ({ create }) => {
    if (!cursors.has(create.brokerOrderId)) cursors.set(create.brokerOrderId, { id: create.brokerOrderId,
      appliedQuantity: new Prisma.Decimal(0), appliedNotional: new Prisma.Decimal(0), ...create });
    return { ...cursors.get(create.brokerOrderId) };
  });
  (prisma.brokerOrderEvidence.update as jest.Mock).mockImplementation(async ({ where, data }) => mutate(cursors.get(where.id), data));
  (prisma.brokerOrderEvidence.findUnique as jest.Mock).mockImplementation(async ({ where }) => cursors.get(where.accountId_brokerMode_brokerOrderId.brokerOrderId) ?? null);
  (prisma.brokerFillAllocation.upsert as jest.Mock).mockResolvedValue({});
  (prisma.brokerFillAllocation.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.brokerActivity.upsert as jest.Mock).mockImplementation(async ({ create }) => {
    if (!activities.has(create.brokerActivityId)) activities.set(create.brokerActivityId, { id: create.brokerActivityId, appliedAt: null, ...create });
    return activities.get(create.brokerActivityId);
  });
  (prisma.brokerActivity.findUniqueOrThrow as jest.Mock).mockImplementation(async ({ where }) => activities.get(where.accountId_brokerMode_brokerActivityId.brokerActivityId));
  (prisma.brokerActivity.update as jest.Mock).mockImplementation(async ({ where, data }) => mutate(activities.get(where.id), data));
  (prisma.$transaction as jest.Mock).mockImplementation(async work => {
    const beforeLot = { ...lot }; const beforeHolding = { ...holding };
    const beforeCursors = new Map([...cursors].map(([key, value]) => [key, { ...value }]));
    try { return await work(prisma); } catch (error) { lot = beforeLot; holding = beforeHolding; cursors = beforeCursors; throw error; }
  });
});

test('a protection partial, replay and remaining application exit preserve the entire $100 loss', async () => {
  await applyBrokerExitEvidence(scope, holding.id, order('protect', 4, 90), 'PROTECTION_LEG', 'entry');
  expect(lot.closedQuantity).toBe(4); expect(lot.realizedPnl).toBe(-40); expect(holding.quantity).toBe(6);
  await applyBrokerExitEvidence(scope, holding.id, order('protect', 4, 90), 'PROTECTION_LEG', 'entry');
  expect(lot.realizedPnl).toBe(-40);
  await applyBrokerExitEvidence(scope, holding.id, order('manual', 6, 90, 'filled'), 'APPLICATION_EXIT');
  expect(lot).toMatchObject({ quantity: 10, entryPrice: 100, closedQuantity: 10, pnl: -100, status: 'CLOSED' });
  expect(holding).toMatchObject({ quantity: 0, status: 'OPEN' }); // broker/family flatness not yet verified
});
test('uses cumulative average differences rather than repricing previously applied executions', async () => {
  await applyBrokerExitEvidence(scope, holding.id, order('exit', 4, 102), 'APPLICATION_EXIT');
  await applyBrokerExitEvidence(scope, holding.id, order('exit', 10, 103, 'filled'), 'APPLICATION_EXIT');
  expect(lot.realizedPnl).toBeCloseTo(30); expect(lot.exitNotional).toBeCloseTo(1030);
});
test('an upgraded legacy partial starts from its persisted applied amount instead of realizing it again', async () => {
  Object.assign(lot, { closedQuantity: 4, realizedPnl: -40, exitNotional: 360 }); holding.quantity = 6;
  (prisma.positionExit.findMany as jest.Mock).mockResolvedValue([{ appliedQuantity: 4, appliedNotional: 360, brokerEvidence: order('exit', 4, 90) }]);
  await applyBrokerExitEvidence(scope, holding.id, order('exit', 4, 90), 'APPLICATION_EXIT');
  expect(lot.realizedPnl).toBe(-40); expect(lot.closedQuantity).toBe(4);
  await applyBrokerExitEvidence(scope, holding.id, order('exit', 10, 90, 'filled'), 'APPLICATION_EXIT');
  expect(lot).toMatchObject({ pnl: -100, closedQuantity: 10 });
});
test('unknown excess quantity rolls back without overwriting original evidence or basis', async () => {
  await expect(applyBrokerExitEvidence(scope, holding.id, order('exit', 11, 90), 'APPLICATION_EXIT')).rejects.toThrow('EXCEEDS_VERIFIED_LOTS');
  expect(lot).toMatchObject({ quantity: 10, entryPrice: 100, closedQuantity: 0, realizedPnl: 0 });
  expect(cursors.size).toBe(0);
});
test('does not silently swallow a same-quantity notional correction or regress an older observation', () => {
  expect(() => incrementalFill(order('x', 4, 101), 4, 408)).toThrow('CORRECTION_REQUIRES_RECONCILIATION');
  expect(incrementalFill(order('x', 2, 102), 4, 408)).toBeNull();
});
test('reconciles child partials while the original holding still exists', async () => {
  const leg = order('leg', 4, 90);
  broker.getOrderVerified.mockImplementation(async id => id === 'entry' ? { ...order('entry', 10, 100, 'filled'), side: 'buy', legs: [leg] } : leg);
  await reconcileProtectionEvidence(scope, holding.id);
  expect(lot.realizedPnl).toBe(-40); expect(holding.quantity).toBe(6);
});
test('a stopped order or missing replacement cannot establish a safe terminal retry', async () => {
  broker.getOrderVerified.mockResolvedValue({ ...order('exit', 0, 0, 'replaced'), replaced_by: null });
  await expect(readOrderChain(scope, 'exit')).rejects.toThrow('REPLACEMENT_UNAVAILABLE');
});
test('replacement carried counters are reconciled from distinct actual order-linked fills', async () => {
  const original = { ...order('old', 4, 90, 'replaced'), replaced_by: 'new' };
  const successor = { ...order('new', 10, 90, 'filled'), replaces: 'old' };
  broker.getOrderVerified.mockImplementation(async id => id === 'old' ? original : successor);
  broker.listActivitiesVerified.mockImplementation(async (_after, _until, _limit, id) => [{ id: `fill-${id}`, activity_type: 'FILL',
    order_id: id, symbol: 'AAPL', side: 'sell', qty: id === 'old' ? '4' : '6', price: '90' }]);
  const chain = await readOrderChain(scope, 'old');
  expect(chain.map(state => state.filled_qty)).toEqual([4, 6]);
  for (const state of chain) await applyBrokerExitEvidence(scope, holding.id, state, 'APPLICATION_EXIT');
  expect(lot).toMatchObject({ closedQuantity: 10, pnl: -100 });
});
test('fee without an order identity remains attributable only at account level even with one local lot', async () => {
  await retainBrokerActivities(scope, [{ id: 'fee', activity_type: 'FEE', currency: 'USD', net_amount: '-.5', date: '2026-10-15' }]);
  expect(activities.get('fee')).toMatchObject({ attributionStatus: 'UNATTRIBUTED', appliedAt: null, dateOnly: true });
  expect(lot.realizedPnl).toBe(0); expect(prisma.trade.update).not.toHaveBeenCalled();
});
test('explicitly linked USD entry fees apply once; immutable fill is preserved', async () => {
  const fee = { id: 'fee', activity_type: 'FEE', order_id: 'entry', currency: 'USD', net_amount: '-.5', date: '2026-10-15' };
  await retainBrokerActivities(scope, [fee]); await retainBrokerActivities(scope, [fee]);
  expect(lot).toMatchObject({ quantity: 10, entryPrice: 100, realizedPnl: -.5, actualFeeCash: .5 });
});
test('explicit crypto quantity fee consumes inventory at basis without rewriting the entry', async () => {
  Object.assign(lot, { market: 'crypto', asset: 'ETH', quantity: 1, entryPrice: 1000 });
  Object.assign(holding, { market: 'crypto', asset: 'ETH', quantity: 1 });
  const fee = { id: 'crypto-fee', activity_type: 'CFEE', order_id: 'entry', symbol: 'ETHUSD', qty: '-.0025', price: '1000', status: 'executed' };
  await retainBrokerActivities(scope, [fee]); await retainBrokerActivities(scope, [fee]);
  expect(lot).toMatchObject({ quantity: 1, entryPrice: 1000, feeQuantity: .0025, realizedPnl: -2.5 });
  expect(holding.quantity).toBeCloseTo(.9975);
});
