jest.mock('../src/utils/prisma', () => ({ prisma: {
  position: { findMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  executionIntent: { findFirst: jest.fn() }, trade: { create: jest.fn() }, $transaction: jest.fn(), $executeRaw: jest.fn(),
} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn() } }));
jest.mock('../src/trading/accountScope', () => ({ positionScopeKey: (a: string, m: string, s: string) => `${a}:${m}:${s}` }));
jest.mock('../src/trading/executionEngine', () => ({ reconcileExecutionIntents: jest.fn() }));
jest.mock('../src/trading/positionExits', () => ({ reconcilePositionExits: jest.fn(), verifyPositionInventory: jest.fn() }));
jest.mock('../src/trading/brokerEvidence', () => ({ reconcileProtectionEvidence: jest.fn(), retainBrokerActivities: jest.fn(), markAccountingUnknown: jest.fn() }));
import { prisma } from '../src/utils/prisma';
import { syncBrokerPositions } from '../src/services/brokerSync';
import { verifyPositionInventory } from '../src/trading/positionExits';
import { markAccountingUnknown } from '../src/trading/brokerEvidence';
import type { AccountScope } from '../src/trading/accountScope';
import { logger } from '../src/utils/logger';
const broker = { listPositionsVerified: jest.fn(), listActivitiesVerified: jest.fn(), createOrder: jest.fn() };
const scope = { broker, accountId: 'fixture', mode: 'paper' } as unknown as AccountScope;
let position: any; let importedPosition: any;
beforeEach(() => {
  jest.clearAllMocks();
  position = { id: 'position', accountId: 'fixture', brokerMode: 'paper', asset: 'AAPL', market: 'stocks',
    quantity: 10, entryPrice: 100, status: 'OPEN', openedAt: new Date(), scopeKey: 'fixture:paper:AAPL' };
  broker.listPositionsVerified.mockResolvedValue([{ asset_class: 'us_equity', asset_id: 'asset', symbol: 'AAPL', side: 'long',
    qty: '6', avg_entry_price: '101', current_price: '90' }]);
  broker.listActivitiesVerified.mockResolvedValue([]);
  (prisma.position.findMany as jest.Mock).mockResolvedValue([position]);
  (prisma.position.findUnique as jest.Mock).mockResolvedValue(position);
  (prisma.position.findUniqueOrThrow as jest.Mock).mockImplementation(async ({ where }) => where.id === 'observed-new' ? importedPosition : position);
  (prisma.position.update as jest.Mock).mockImplementation(async ({ data }) => Object.assign(position, data));
  (prisma.executionIntent.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.$transaction as jest.Mock).mockImplementation(async work => work(prisma));
  (prisma.position.upsert as jest.Mock).mockImplementation(async ({ create, update }) => {
    if (position.scopeKey === null) { importedPosition = { ...create, id: 'observed-new', openedAt: new Date() }; return importedPosition; }
    return { ...position, ...update };
  });
  (verifyPositionInventory as jest.Mock).mockRejectedValue(new Error('BROKER_INVENTORY_AND_EXECUTION_LOTS_DISAGREE'));
});
test('a reduced broker holding remains a distinct observation and cannot rewrite known inventory/basis', async () => {
  const result = await syncBrokerPositions(scope);
  const update = (prisma.position.upsert as jest.Mock).mock.calls[0][0].update;
  expect(update).toMatchObject({ brokerObservedQuantity: 6, brokerObservedEntryPrice: 101 });
  expect(update).not.toHaveProperty('quantity'); expect(update).not.toHaveProperty('entryPrice');
  expect(prisma.trade.create).not.toHaveBeenCalled();
  expect(result.unresolved).toContain('AAPL'); expect(markAccountingUnknown).toHaveBeenCalled();
  expect(broker.createOrder).not.toHaveBeenCalled();
});
test('broker-flat without known execution evidence retains unknown attribution and never submits', async () => {
  broker.listPositionsVerified.mockResolvedValue([]);
  const result = await syncBrokerPositions(scope);
  expect(result.unresolved).toContain('AAPL'); expect(broker.createOrder).not.toHaveBeenCalled();
  expect(prisma.position.upsert).not.toHaveBeenCalled();
});

test('distinguishes activity transport failure from unresolved inventory without leaking broker text', async () => {
  broker.listActivitiesVerified.mockRejectedValueOnce(Object.assign(new Error('PRIVATE_ACCOUNT_AND_TOKEN'), { code: 'ECONNABORTED' }));
  const result = await syncBrokerPositions(scope);
  expect(result.activityEvidence).toBe('ACTIVITY_EVIDENCE_UNAVAILABLE');
  expect(logger.info).toHaveBeenCalledWith('broker_reconciliation_observed', {
    mode: 'paper', unresolved: 1, activityEvidence: 'ACTIVITY_EVIDENCE_UNAVAILABLE',
    activityFailureReason: 'TRANSPORT_TIMEOUT_OR_CANCEL',
    unresolvedReasonCounts: { BROKER_INVENTORY_AND_EXECUTION_LOTS_DISAGREE: 1 },
  });
  expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toMatch(/PRIVATE_|AAPL|fixture/);
  expect(broker.createOrder).not.toHaveBeenCalled();
});

test('unknown per-position errors remain unresolved and cannot enter diagnostic logs', async () => {
  (verifyPositionInventory as jest.Mock).mockRejectedValueOnce(new Error('PRIVATE_ACCOUNT_AND_TOKEN'));
  expect((await syncBrokerPositions(scope)).unresolved).toEqual(['AAPL']);
  expect(logger.info).toHaveBeenCalledWith('broker_reconciliation_observed', expect.objectContaining({
    activityFailureReason: null, unresolvedReasonCounts: { OTHER_EVIDENCE_FAILURE: 1 },
  }));
  expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toContain('PRIVATE_');
});
test('an unmatched holding gets a visible OPEN opening balance while its closed historical cycle stays preserved', async () => {
  position.status = 'CLOSED';
  (prisma.position.findMany as jest.Mock).mockResolvedValue([]);
  const result = await syncBrokerPositions(scope);
  expect(result.imported).toContain('AAPL');
  expect(position).toMatchObject({ id: 'position', status: 'CLOSED', quantity: 10, entryPrice: 100, scopeKey: null });
  expect(importedPosition).toMatchObject({ id: 'observed-new', status: 'OPEN', quantity: 6, brokerObservedQuantity: 6 });
  expect(prisma.trade.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    positionId: 'observed-new', brokerConfirmed: false, metadata: expect.objectContaining({ historyAvailable: false, precedingClosedPositionId: 'position' }),
  }) }));
  expect(broker.createOrder).not.toHaveBeenCalled();
});
