// Only a disposable isolated-loopback CI database is permitted. No broker or
// provider implementation is called: this exercises real PG locks/uniqueness.
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import { prisma } from '../src/utils/prisma';
import { applyBrokerExitEvidence } from '../src/trading/brokerEvidence';
import { requestPositionExit } from '../src/trading/positionExits';
import type { AccountScope } from '../src/trading/accountScope';
import type { AlpacaOrder } from '../src/services/alpacaBroker';
const suite = process.env.RUN_BROKER_EVIDENCE_POSTGRES === 'true' ? describe : describe.skip;
suite('broker evidence concurrency on disposable PostgreSQL', () => {
  const scope = { accountId: 'broker-evidence-fixture', mode: 'paper', broker: {} } as AccountScope;
  let positionId: string; let tradeId: string;
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== 'postgresql://fixture:fixture@127.0.0.1:5432/fixture') throw new Error('Disposable fixture database required');
  });
  beforeEach(async () => {
    const position = await prisma.position.create({ data: { accountId: scope.accountId, brokerMode: scope.mode,
      asset: 'ZZEVIDENCE', market: 'stocks', side: 'BUY', quantity: 10, entryPrice: 100, currentPrice: 100,
      stopLossPrice: 90, takeProfitPrice: 110, accountingStatus: 'RECONCILED' } });
    positionId = position.id;
    const trade = await prisma.trade.create({ data: { positionId, accountId: scope.accountId, brokerMode: scope.mode,
      asset: 'ZZEVIDENCE', market: 'stocks', type: 'BUY', quantity: 10, entryPrice: 100 } });
    tradeId = trade.id;
  });
  afterAll(async () => { await prisma.$disconnect(); });
  const order = (id: string, quantity: number, average: number) => ({ id, symbol: 'ZZEVIDENCE', side: 'sell',
    status: quantity === 10 ? 'filled' : 'partially_filled', filled_qty: quantity, filled_avg_price: average } as AlpacaOrder);
  test('two workers apply the same cumulative fill exactly once and recover the final delta', async () => {
    const id = `same-${positionId}`;
    await Promise.all([applyBrokerExitEvidence(scope, positionId, order(id, 4, 90), 'APPLICATION_EXIT'),
      applyBrokerExitEvidence(scope, positionId, order(id, 4, 90), 'APPLICATION_EXIT')]);
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).toMatchObject({ closedQuantity: 4, realizedPnl: -40 });
    expect(await prisma.brokerOrderEvidence.count({ where: { positionId } })).toBe(1);
    await Promise.all([applyBrokerExitEvidence(scope, positionId, order(id, 10, 90), 'APPLICATION_EXIT'),
      applyBrokerExitEvidence(scope, positionId, order(id, 10, 90), 'APPLICATION_EXIT')]);
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).toMatchObject({ quantity: 10, entryPrice: 100, closedQuantity: 10, pnl: -100 });
    expect(await prisma.position.findUniqueOrThrow({ where: { id: positionId } })).toMatchObject({ quantity: 0, status: 'OPEN' });
  }, 15000);
  test('competing order evidence cannot allocate more inventory than exists; failed application is atomic', async () => {
    const results = await Promise.allSettled([applyBrokerExitEvidence(scope, positionId, order(`a-${positionId}`, 6, 90), 'APPLICATION_EXIT'),
      applyBrokerExitEvidence(scope, positionId, order(`b-${positionId}`, 6, 90), 'APPLICATION_EXIT')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).toMatchObject({ closedQuantity: 6, realizedPnl: -60 });
    expect(await prisma.brokerOrderEvidence.count({ where: { positionId } })).toBe(1);
    expect(await prisma.brokerFillAllocation.count({ where: { tradeId } })).toBe(1);
  }, 15000);
  test('an existing partial exit upgrades its durable applied broker evidence without repeating the loss', async () => {
    const id = `legacy-${positionId}`;
    await prisma.trade.update({ where: { id: tradeId }, data: { closedQuantity: 4, realizedPnl: -40, exitNotional: 360 } });
    await prisma.position.update({ where: { id: positionId }, data: { quantity: 6 } });
    await prisma.positionExit.create({ data: { positionId, accountId: scope.accountId, brokerMode: scope.mode,
      cycleKey: id, clientOrderId: id, brokerOrderId: id, symbol: 'ZZEVIDENCE', side: 'sell', quantity: 10,
      status: 'PARTIAL', reason: 'fixture', appliedQuantity: 4, appliedNotional: 360, realizedPnl: -40,
      brokerEvidence: JSON.parse(JSON.stringify(order(id, 4, 90))) } });
    await applyBrokerExitEvidence(scope, positionId, order(id, 4, 90), 'APPLICATION_EXIT');
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).toMatchObject({ closedQuantity: 4, realizedPnl: -40 });
    await applyBrokerExitEvidence(scope, positionId, order(id, 10, 90), 'APPLICATION_EXIT');
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).toMatchObject({ closedQuantity: 10, pnl: -100 });
  });
  test('partial FIFO allocation recomputes remaining position basis and preserves both entry fills', async () => {
    await prisma.trade.update({ where: { id: tradeId }, data: { quantity: 5, openedAt: new Date(Date.now() - 2000) } });
    const second = await prisma.trade.create({ data: { positionId, accountId: scope.accountId, brokerMode: scope.mode,
      asset: 'ZZEVIDENCE', market: 'stocks', type: 'BUY', quantity: 5, entryPrice: 120, openedAt: new Date(Date.now() - 1000) } });
    await applyBrokerExitEvidence(scope, positionId, order(`fifo-${positionId}`, 5, 90), 'APPLICATION_EXIT');
    expect(await prisma.position.findUniqueOrThrow({ where: { id: positionId } })).toMatchObject({ quantity: 5, entryPrice: 120 });
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).toMatchObject({ quantity: 5, entryPrice: 100, pnl: -50 });
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ quantity: 5, entryPrice: 120, closedQuantity: 0 });
  });
  test('concurrent close callers acquire one durable POST claim and an ambiguous response is never reposted', async () => {
    let accepted: Record<string, unknown> | null = null;
    const createOrder = jest.fn(async (request: { client_order_id?: string }) => {
      accepted = { ...order(`claim-${positionId}`, 0, 0), status: 'accepted', client_order_id: request.client_order_id,
        legs: [], replaced_by: null };
      throw new Error('fixture response lost after acceptance');
    });
    const broker = { listOrdersVerified: jest.fn(async () => []), cancelOrder: jest.fn(), createOrder,
      getPosition: jest.fn(async () => ({ qty: '10', side: 'long', avg_entry_price: '100' })),
      getOrderVerified: jest.fn(async () => accepted), getOrderByClientOrderId: jest.fn(async () => accepted) };
    const executionScope = { ...scope, broker } as unknown as AccountScope;
    const results = await Promise.all([requestPositionExit(positionId, 'fixture-close', executionScope),
      requestPositionExit(positionId, 'fixture-close', executionScope)]);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(results.every(result => !result.closed && result.pending)).toBe(true);
    expect(await prisma.positionExit.count({ where: { positionId } })).toBe(1);
    await requestPositionExit(positionId, 'fixture-restart', executionScope);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(await prisma.position.findUniqueOrThrow({ where: { id: positionId } })).toMatchObject({ quantity: 10, status: 'OPEN' });
  }, 15000);
});
