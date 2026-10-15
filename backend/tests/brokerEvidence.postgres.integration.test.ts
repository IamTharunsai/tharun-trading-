// Only a disposable isolated-loopback CI database is permitted. No broker or
// provider implementation is called: this exercises real PG locks/uniqueness.
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false, activateKillSwitch: jest.fn() }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrices: () => ({ ZZEVIDENCE: 90 }), getCurrentPrice: jest.fn(), buildMarketSnapshot: jest.fn() }));
jest.mock('../src/services/alertService', () => ({ alert: { tradeFailed: jest.fn(async () => {}), drawdownWarning: jest.fn(async () => {}) } }));
import { prisma } from '../src/utils/prisma';
import { applyBrokerExitEvidence } from '../src/trading/brokerEvidence';
import { requestPositionExit } from '../src/trading/positionExits';
import { syncBrokerPositions } from '../src/services/brokerSync';
import { getPortfolioState } from '../src/services/portfolio';
import { calculateAuthenticatedPortfolio } from '../src/services/portfolioAccounting';
import { validateTradeSignal } from '../src/trading/riskManager';
import * as accountScopeModule from '../src/trading/accountScope';
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
  test('legacy partial polling survives the observeExit chain-array rewrite, repeated polls and restart progression', async () => {
    const id = `wrapper-legacy-${positionId}`;
    const position = await prisma.position.findUniqueOrThrow({ where: { id: positionId } });
    let cumulative = 4;
    const evidence = () => ({ ...order(id, cumulative, 90), client_order_id: id, status: cumulative === 10 ? 'filled' : 'partially_filled',
      legs: [], replaced_by: null, filled_at: cumulative === 10 ? new Date().toISOString() : null });
    await prisma.trade.update({ where: { id: tradeId }, data: { closedQuantity: 4, realizedPnl: -40, exitNotional: 360 } });
    await prisma.position.update({ where: { id: positionId }, data: { quantity: 6 } });
    const exit = await prisma.positionExit.create({ data: { positionId, accountId: scope.accountId, brokerMode: scope.mode,
      cycleKey: `${positionId}:${position.openedAt.toISOString()}:1`, clientOrderId: id, brokerOrderId: id,
      symbol: 'ZZEVIDENCE', side: 'sell', quantity: 10, status: 'PARTIAL', reason: 'fixture',
      appliedQuantity: 4, appliedNotional: 360, realizedPnl: -40, brokerEvidence: JSON.parse(JSON.stringify(evidence())) } });
    const broker = { getOrderVerified: jest.fn(async () => evidence()), getOrderByClientOrderId: jest.fn(async () => evidence()),
      getPosition: jest.fn(async () => cumulative === 10 ? null : { qty: String(10 - cumulative), side: 'long', avg_entry_price: '100' }),
      createOrder: jest.fn() };
    const pollScope = { ...scope, broker } as unknown as AccountScope;
    expect(await requestPositionExit(positionId, 'fixture-poll', pollScope)).toMatchObject({ closed: false, pending: true });
    expect(Array.isArray((await prisma.positionExit.findUniqueOrThrow({ where: { id: exit.id } })).brokerEvidence)).toBe(true);
    expect(await requestPositionExit(positionId, 'fixture-repeat', pollScope)).toMatchObject({ closed: false, pending: true });
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).toMatchObject({ closedQuantity: 4, realizedPnl: -40 });
    cumulative = 6;
    expect(await requestPositionExit(positionId, 'fixture-restart', { ...pollScope })).toMatchObject({ closed: false, pending: true });
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).toMatchObject({ closedQuantity: 6, realizedPnl: -60 });
    cumulative = 10;
    expect(await requestPositionExit(positionId, 'fixture-final', { ...pollScope })).toMatchObject({ closed: true });
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).toMatchObject({ closedQuantity: 10, pnl: -100 });
    expect(await prisma.brokerOrderEvidence.count({ where: { positionId } })).toBe(1);
    expect(broker.createOrder).not.toHaveBeenCalled();
  }, 15000);
  test('unmatched broker holdings after a closed cycle remain visible to portfolio, position risk and exit recovery', async () => {
    const accountId = `unmatched-${positionId}`;
    const activeKey = accountScopeModule.positionScopeKey(accountId, scope.mode, 'ZZEVIDENCE');
    await prisma.trade.update({ where: { id: tradeId }, data: { accountId, brokerConfirmed: true, status: 'CLOSED', closedQuantity: 10, pnl: -100,
      realizedPnl: -100, exitNotional: 900, closedAt: new Date() } });
    await prisma.position.update({ where: { id: positionId }, data: { accountId, scopeKey: activeKey, status: 'CLOSED', quantity: 0 } });
    let accepted: Record<string, unknown> | null = null;
    const observed = { asset_id: 'fixture-asset', asset_class: 'us_equity', symbol: 'ZZEVIDENCE', qty: '5', side: 'long',
      avg_entry_price: '101', current_price: '90' };
    const broker = { listPositionsVerified: jest.fn(async () => [observed]), listActivitiesVerified: jest.fn(async () => []),
      getPosition: jest.fn(async () => observed), listOrdersVerified: jest.fn(async () => []), cancelOrder: jest.fn(),
      getPortfolioSummary: jest.fn(async () => ({ account_id: accountId, portfolio_value: 100450, cash: 100000, buying_power: 100000, last_equity: 100450 })),
      createOrder: jest.fn(async (request: { client_order_id?: string }) => {
        accepted = { ...order(`unmatched-exit-${positionId}`, 0, 0), status: 'accepted', client_order_id: request.client_order_id, legs: [], replaced_by: null };
        return accepted;
      }), getOrderVerified: jest.fn(async () => accepted), getOrderByClientOrderId: jest.fn(async () => accepted) };
    const recoveryScope = { ...scope, accountId, broker } as unknown as AccountScope;
    const scopeSpy = jest.spyOn(accountScopeModule, 'getVerifiedAccountScope').mockResolvedValue(recoveryScope);
    const previousMaximum = process.env.MAX_OPEN_POSITIONS;
    try {
      const synced = await syncBrokerPositions(recoveryScope);
      expect(synced.imported).toContain('ZZEVIDENCE'); expect(broker.createOrder).not.toHaveBeenCalled();
      const old = await prisma.position.findUniqueOrThrow({ where: { id: positionId } });
      expect(old).toMatchObject({ status: 'CLOSED', quantity: 0, entryPrice: 100, scopeKey: null });
      expect(await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).toMatchObject({ pnl: -100, quantity: 10, entryPrice: 100 });
      const state = await getPortfolioState();
      expect(state.positions).toHaveLength(1);
      const imported = state.positions[0];
      expect(imported).toMatchObject({ status: 'OPEN', quantity: 5, brokerObservedQuantity: 5 });
      expect(imported.id).not.toBe(positionId); expect(state.invested).toBe(450);
      expect(state.tradesExecutedToday).toBe(1); // the opening balance is not an invented new execution
      expect(state.historyDataComplete).toBe(false); expect(state.accountingComplete).toBe(false);
      const opening = await prisma.trade.findFirstOrThrow({ where: { positionId: imported.id } });
      expect(opening).toMatchObject({ brokerConfirmed: false, quantity: 5, pnl: null, metadata: expect.objectContaining({ historyAvailable: false }) });
      expect(await calculateAuthenticatedPortfolio()).toMatchObject({ totalPnl: null, knownRealizedPnl: -100, historyDataComplete: false });
      process.env.MAX_OPEN_POSITIONS = '1';
      const risk = await validateTradeSignal({ asset: 'OTHER', market: 'stocks', direction: 'BUY', confidence: 80,
        entryPrice: 100, stopLossPrice: 90, takeProfitPrice: 120, positionSizePct: 1, reasoning: 'fixture', agentDecisionId: 'fixture',
        voteCounts: { supporting: 10, opposing: 0, abstaining: 0 } }, { ...state, riskDataComplete: true, pnlDayPct: 0, pnlWeekPct: 0, drawdownFromPeak: 0 });
      expect(risk.reason).toContain('MAX_POSITIONS');
      expect(await requestPositionExit(imported.id, 'fixture-recovery', recoveryScope)).toMatchObject({ closed: false, pending: true });
      expect(broker.createOrder).toHaveBeenCalledTimes(1);
      expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({ qty: 5, side: 'sell' }));
    } finally {
      scopeSpy.mockRestore();
      if (previousMaximum === undefined) delete process.env.MAX_OPEN_POSITIONS; else process.env.MAX_OPEN_POSITIONS = previousMaximum;
    }
  }, 20000);
});
