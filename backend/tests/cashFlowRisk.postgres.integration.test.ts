// Actual PG persistence/locking; broker responses below are fixtures only.
// No provider implementation, credential or live account is reachable in CI.
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('axios', () => ({ __esModule: true, default: { create: jest.fn() } }));
import axios from 'axios';
import { createServer, get as httpGet, IncomingMessage } from 'http';
import { AlpacaBroker } from '../src/services/alpacaBroker';
import { prisma } from '../src/utils/prisma';
import { getCashFlowRisk, readCashFlowRisk, recordPortfolioObservation, RISK_STEP_MS as STEP } from '../src/services/cashFlowRisk';
import type { PortfolioState } from '../src/agents/types';
import type { AccountScope } from '../src/trading/accountScope';
import type { AlpacaActivity } from '../src/services/alpacaBroker';
const suite = process.env.RUN_CASH_FLOW_POSTGRES === 'true' ? describe : describe.skip;
const baseNow = new Date('2026-10-16T12:00:30Z');
suite('cash flow risk on isolated disposable PostgreSQL', () => {
  let serial = 0; let scope: AccountScope; let broker: any;
  let flows: { type: string; at: number; amount: number }[]; let equityChanges: { at: number; amount: number }[]; let activities: AlpacaActivity[];
  const history = (start: string, end: string) => {
    const timestamp: number[] = []; const equity: number[] = []; const cashflow: Record<string, number[]> = {};
    for (let left = Date.parse(start); left < Date.parse(end); left += STEP) {
      timestamp.push(left / 1000);
      equity.push(100000 + equityChanges.filter(change => change.at < left + STEP).reduce((sum, change) => sum + change.amount, 0));
      for (const type of new Set(flows.map(flow => flow.type))) {
        (cashflow[type] ??= []).push(flows.filter(flow => flow.type === type && flow.at >= left && flow.at < left + STEP).reduce((sum, flow) => sum + flow.amount, 0));
      }
    }
    return { timestamp, equity, cashflow, timeframe: '5Min' };
  };
  beforeAll(() => {
    if (process.env.DATABASE_URL !== 'postgresql://fixture:fixture@127.0.0.1:5432/fixture') throw new Error('Disposable fixture database required');
  });
  beforeEach(() => {
    flows = []; equityChanges = []; activities = [];
    broker = { listActivitiesVerified: jest.fn(async () => activities), getPortfolioHistoryVerified: jest.fn(async (start, end) => history(start, end)),
      getPortfolioSummary: jest.fn(async () => ({ account_id: scope.accountId, currency: 'USD' })) };
    scope = { accountId: `cash-flow-fixture-${++serial}`, mode: 'paper', broker };
  });
  afterAll(async () => { await prisma.$disconnect(); });
  const event = (type: string, amount: number, at = Date.parse('2026-10-16T10:00:00Z')) => {
    flows.push({ type, amount, at }); equityChanges.push({ amount, at });
    activities.push({ id: `capital-${activities.length}`, activity_type: type, net_amount: String(amount), date: new Date(at).toISOString().slice(0, 10) });
  };
  test('concurrent withdrawal refresh and replay apply absolute capital once, retain a single revision', async () => {
    expect(await prisma.capitalRiskState.count({ where: { accountId: scope.accountId } })).toBe(0);
    event('CSW', -10000);
    let arrivals = 0; let release!: () => void; const fetched = new Promise<void>(resolve => { release = resolve; });
    broker.listActivitiesVerified.mockImplementation(async () => { if (++arrivals === 2) release(); await fetched; return activities; });
    const nativeCreate = prisma.capitalRiskState.createMany.bind(prisma.capitalRiskState);
    let initializers = 0; let releaseInitializers!: () => void;
    const bothInitializers = new Promise<void>(resolve => { releaseInitializers = resolve; });
    const initializer = jest.spyOn(prisma.capitalRiskState, 'createMany');
    initializer.mockImplementation((async (args: any) => {
      expect(args.skipDuplicates).toBe(true);
      if (++initializers === 2) releaseInitializers();
      await bothInitializers;
      return nativeCreate(args);
    }) as any);
    let values;
    try { values = await Promise.all([getCashFlowRisk(scope, baseNow), getCashFlowRisk(scope, baseNow)]); }
    finally { initializer.mockRestore(); releaseInitializers(); }
    expect(initializers).toBe(2);
    values.forEach(value => expect(value).toMatchObject({ complete: true, dailyPnl: 0, drawdownPct: 0, equity: 90000 }));
    expect(await prisma.capitalRiskObservation.count({ where: { accountId: scope.accountId } })).toBe(1);
    expect(await prisma.capitalRiskActivity.count({ where: { accountId: scope.accountId } })).toBe(1);
    expect((await getCashFlowRisk(scope, baseNow)).revision).toBe(1);
    expect(broker.getPortfolioHistoryVerified).toHaveBeenCalledTimes(2); // both fetched, one CAS committed
  }, 25000);
  test('omission-only finite coverage retains raw response and old losses; late capital invalidates instead of rewriting zero', async () => {
    equityChanges.push({ at: Date.parse('2026-10-16T10:00:00Z'), amount: -4000 });
    broker.getPortfolioHistoryVerified.mockImplementation(async (start: string, end: string) => {
      const { cashflow: _omitted, ...raw } = history(start, end); return raw;
    });
    let financialEvents: Record<string, unknown>[] = [{ account_id: scope.accountId,
      event_id: '01K7M5S8Q00000000000000000', ref_id: 'fixture-trade', activity_type: 'TRD',
      at: '2026-10-16T10:00:00Z', executed_at: '2026-10-16T10:00:00Z', settle_date: '2026-10-19',
      currency: 'USD', status: 'executed', qty: '1', price: '50', net_amount: '-50',
      details: { execution_type: 'fill', order_id: 'fixture-order', side: 'buy', symbol: 'MSFT' } }];
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const activity of financialEvents) response.write(`data: ${JSON.stringify(activity)}\n\n`);
      response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture listener missing');
    const transport = { get: jest.fn(async (_path: string, options: { signal: AbortSignal }) => {
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        const request = httpGet(`http://127.0.0.1:${address.port}/fixture`, { signal: options.signal }, resolve);
        request.on('error', reject);
      });
      return { status: response.statusCode, headers: response.headers, data: response };
    }) };
    (axios.create as jest.Mock).mockReturnValueOnce(transport);
    const adapter = new AlpacaBroker('fixture', 'fixture', true);
    jest.spyOn(adapter, 'getAccount').mockResolvedValue({ id: scope.accountId, currency: 'USD', created_at: '2026-03-01T00:00:01Z' } as any);
    broker.getActivityHistoryVerified = adapter.getActivityHistoryVerified.bind(adapter);
    try {
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, dailyPnl: -4000, dailyPnlPct: -4, drawdownPct: 4 });
    const retained = await prisma.capitalRiskObservation.findFirstOrThrow({ where: { accountId: scope.accountId } });
    const first = (retained.history as any[])[0];
    expect(first.response).not.toHaveProperty('cashflow'); expect(first.capitalCoverageObservationId).toBeTruthy();
    expect(await prisma.capitalActivityCoverageObservation.count({ where: { accountId: scope.accountId } })).toBe(1);
    financialEvents = [{ account_id: scope.accountId, event_id: '01K7M5S8Q00000000000000001', ref_id: 'late-capital',
      activity_type: 'CSW', currency: 'USD', status: 'executed',
      at: '2026-10-12T10:00:00Z', executed_at: '2026-10-20T10:00:00Z', settle_date: '2026-10-12' }];
    expect(await getCashFlowRisk(scope, new Date(baseNow.getTime() + STEP))).toMatchObject({ complete: false, reason: 'CAPITAL_ACTIVITY_COVERAGE_UNAVAILABLE' });
    expect(await prisma.capitalActivityCoverageObservation.count({ where: { accountId: scope.accountId } })).toBe(2);
    expect((await prisma.capitalRiskObservation.findUniqueOrThrow({ where: { id: retained.id } })).history).toEqual(retained.history);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, 30000);

  test('deposit plus trading loss retains negative opening-equity results despite rising NAV', async () => {
    event('CSD', 10000); equityChanges.push({ at: Date.parse('2026-10-16T11:00:00Z'), amount: -4000 });
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, dailyPnl: -4000, dailyPnlPct: -4, weeklyPnlPct: -4, drawdownPct: 4, equity: 106000 });
  }, 25000);
  test('date-only transfer just before the fixed reference is evidenced in prior bins, not subtracted twice', async () => {
    event('CSD', 10000, Date.parse('2026-10-07T10:00:00Z'));
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, referenceAt: '2026-10-08T00:00:00.000Z',
      dailyPnl: 0, weeklyPnlPct: 0, drawdownPct: 0, equity: 110000 });
  }, 25000);
  test('newly created old-effective flow refetches past bins and recomputes while retaining original response', async () => {
    const at = Date.parse('2026-10-12T10:00:00Z'); equityChanges.push({ at, amount: -10000 });
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, weeklyPnlPct: -10, drawdownPct: 10 });
    const snapshot = await recordPortfolioObservation({ accountId: scope.accountId, brokerMode: scope.mode,
      totalValue: 90000, cashBalance: 90000, invested: 0, pnlTotal: -100 } as PortfolioState, baseNow);
    expect(snapshot.adjustedWeeklyPnlPct?.toNumber()).toBe(-10);
    flows.push({ at, type: 'CSW', amount: -10000 }); activities.push({ id: 'late-created-today', activity_type: 'CSW', date: '2026-10-12', net_amount: '-10000' });
    const next = new Date(baseNow.getTime() + STEP);
    expect(await getCashFlowRisk(scope, next)).toMatchObject({ complete: true, weeklyPnlPct: 0, drawdownPct: 0, revision: 2 });
    expect(broker.listActivitiesVerified.mock.calls[1][0]).toBe('2026-10-14T12:00:30.000Z'); // creation scan overlaps
    expect(broker.getPortfolioHistoryVerified.mock.calls.some(([start]: string[]) => Date.parse(start) <= Date.parse('2026-10-11T00:00:00Z'))).toBe(true);
    const observations = await prisma.capitalRiskObservation.findMany({ where: { accountId: scope.accountId }, orderBy: { revision: 'asc' } });
    expect(observations).toHaveLength(2);
    expect(JSON.stringify(observations[0].history)).not.toContain('CSW');
    expect(JSON.stringify(observations[1].history)).toContain('CSW');
    expect((await getCashFlowRisk(scope, next)).revision).toBe(2);
    const revised = await prisma.portfolioSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(revised).toMatchObject({ riskDataComplete: true, riskRevision: 2, totalValue: 90000, pnlTotal: -100 });
    expect(revised.adjustedWeeklyPnlPct?.toNumber()).toBe(0); expect(revised.adjustedPeakLossPct?.toNumber()).toBe(0);
    expect(revised.riskRecomputedAt).toEqual(next);
  }, 25000);
  test('late same-day cash revises stored daily loss; a stale portfolio capture cannot restore the old revision', async () => {
    const at = Date.parse('2026-10-16T10:00:00Z'); equityChanges.push({ at, amount: -10000 });
    const oldRisk = await getCashFlowRisk(scope, baseNow);
    const oldPortfolio = { accountId: scope.accountId, brokerMode: scope.mode, totalValue: 90000,
      cashBalance: 90000, invested: 0, pnlTotal: -100, capitalRisk: oldRisk } as PortfolioState;
    const snapshot = await recordPortfolioObservation(oldPortfolio, baseNow);
    expect(snapshot.adjustedDailyPnl?.toNumber()).toBe(-10000);
    flows.push({ at, type: 'CSW', amount: -10000 }); activities.push({ id: 'late-day', activity_type: 'CSW', date: '2026-10-16', net_amount: '-10000' });
    const next = new Date(baseNow.getTime() + STEP); await getCashFlowRisk(scope, next);
    const revised = await prisma.portfolioSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(revised).toMatchObject({ riskDataComplete: true, riskRevision: 2, totalValue: 90000, pnlDay: -10000, pnlTotal: -100 });
    expect(revised.adjustedDailyPnl?.toNumber()).toBe(0); expect(revised.adjustedDailyPnlPct?.toNumber()).toBe(0);
    const capturedAfter = await recordPortfolioObservation(oldPortfolio, next);
    expect(capturedAfter.riskRevision).toBe(2); expect(capturedAfter.adjustedDailyPnl?.toNumber()).toBe(0);
  }, 25000);
  test('account and paper/live switching keep identical broker activity IDs and baselines isolated', async () => {
    event('CSW', -10000);
    expect((await getCashFlowRisk(scope, baseNow)).equity).toBe(90000);
    const paperId = scope.accountId;
    scope = { ...scope, mode: 'live' }; flows = []; activities = []; equityChanges = [];
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, brokerMode: 'live', equity: 100000, drawdownPct: 0 });
    scope = { ...scope, accountId: 'different-account' };
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, accountId: 'different-account', equity: 100000 });
    expect(await prisma.capitalRiskState.count({ where: { accountId: paperId } })).toBe(2);
  }, 30000);
  test('unknown journal and date-only unmatched flow do not become a zero result', async () => {
    activities.push({ id: 'unknown-journal', activity_type: 'JNLC', net_amount: '10000', date: '2026-10-16' });
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: false, reason: 'UNKNOWN_JOURNAL_OR_SECURITY_CAPITAL_EFFECT', equity: 100000, dailyPnl: null, drawdownPct: null });
    scope = { ...scope, accountId: 'date-only-mismatch' };
    activities = [{ id: 'date-only', activity_type: 'CSD', net_amount: '10000', date: '2026-10-16' }];
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: false, reason: 'CAPITAL_ACTIVITY_HISTORY_MISMATCH', dailyPnl: null });
  }, 25000);
  test('history gap or paging failure preserves evidence and known valuation while invalidating current risk readiness', async () => {
    event('CSW', -10000); await getCashFlowRisk(scope, baseNow);
    broker.getPortfolioHistoryVerified.mockImplementation(async (start: string, end: string) => {
      const response = history(start, end); response.timestamp.splice(3, 1); response.equity.splice(3, 1);
      for (const values of Object.values(response.cashflow)) values.splice(3, 1);
      return response;
    });
    expect(await getCashFlowRisk(scope, new Date(baseNow.getTime() + STEP))).toMatchObject({ complete: false, equity: 90000, dailyPnl: null, reason: 'RISK_HISTORY_COVERAGE_GAP' });
    broker.listActivitiesVerified.mockRejectedValue(new Error('BROKER_ACTIVITY_SCAN_BOUND_EXCEEDED'));
    expect(await getCashFlowRisk(scope, new Date(baseNow.getTime() + 2 * STEP))).toMatchObject({ complete: false, reason: 'BROKER_ACTIVITY_SCAN_BOUND_EXCEEDED', dailyPnlPct: null });
    expect(await prisma.capitalRiskObservation.count({ where: { accountId: scope.accountId } })).toBe(1);
  }, 25000);
  test('actual adapter failure in a later daily window preserves cursor, recorded loss, and immutable evidence', async () => {
    event('CSW', -10000); equityChanges.push({ at: Date.parse('2026-10-16T11:00:00Z'), amount: -4000 });
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, dailyPnl: -4000, equity: 86000 });
    const snapshot = await recordPortfolioObservation({ accountId: scope.accountId, brokerMode: scope.mode,
      totalValue: 86000, cashBalance: 86000, invested: 0, pnlTotal: -100 } as PortfolioState, baseNow);
    const before = await prisma.capitalRiskState.findFirstOrThrow({ where: { accountId: scope.accountId } });
    const http = jest.fn().mockResolvedValueOnce({ data: [{ id: 'partial-late-fee', activity_type: 'CFEE', net_amount: '-1', date: '2026-10-01' }] })
      .mockRejectedValueOnce(Object.assign(new Error('private-provider-timeout'), { code: 'ECONNABORTED' }));
    (axios.create as jest.Mock).mockReturnValue({ get: http });
    scope = { ...scope, broker: new AlpacaBroker('fixture-not-a-credential', 'fixture-not-a-secret', true) };
    expect(await getCashFlowRisk(scope, new Date(baseNow.getTime() + STEP))).toMatchObject({
      complete: false, reason: 'CAPITAL_EVIDENCE_UNAVAILABLE', equity: 86000, dailyPnl: null, dailyPnlPct: null });
    expect(http).toHaveBeenCalledTimes(2);
    http.mock.calls.forEach(([path, config]) => {
      expect(path).toBe('/v2/account/activities');
      expect(Date.parse(config.params.until) - Date.parse(config.params.after)).toBeLessThanOrEqual(86400000);
    });
    const after = await prisma.capitalRiskState.findFirstOrThrow({ where: { accountId: scope.accountId } });
    expect(after).toMatchObject({ status: 'UNVERIFIED', revision: before.revision,
      activityThrough: before.activityThrough, coveredThrough: before.coveredThrough });
    expect(await prisma.capitalRiskObservation.count({ where: { accountId: scope.accountId } })).toBe(1);
    expect(await prisma.capitalRiskActivity.findFirst({ where: { accountId: scope.accountId, brokerActivityId: 'partial-late-fee' } })).toBeNull();
    const retained = await prisma.portfolioSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(retained).toMatchObject({ totalValue: 86000, pnlTotal: -100, pnlDay: -4000,
      riskDataComplete: false, adjustedDailyPnl: null, riskRevision: before.revision });
  }, 25000);
  test('legacy raw NAV and recorded realized losses retain ownership and values without verified risk defaults', async () => {
    const snapshot = await prisma.portfolioSnapshot.create({ data: { totalValue: 90000, cashBalance: 90000, invested: 0, pnlDay: -10000, pnlDayPct: -10 } });
    const trade = await prisma.trade.create({ data: { asset: 'FIXTURE', market: 'stocks', type: 'BUY', quantity: 10, entryPrice: 100,
      status: 'CLOSED', pnl: -100, realizedPnl: -100 } });
    event('CSW', -10000); await getCashFlowRisk(scope, baseNow);
    expect(await prisma.portfolioSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).toMatchObject({ accountId: null, brokerMode: null, totalValue: 90000, pnlDay: -10000, riskDataComplete: false, adjustedDailyPnl: null });
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).toMatchObject({ accountId: null, quantity: 10, entryPrice: 100, pnl: -100 });
  }, 25000);
  test('failed initializer cannot invalidate another worker verified state or stored loss', async () => {
    let failInitializer!: (error: Error) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const initializer = jest.spyOn(prisma.capitalRiskState, 'createMany');
    initializer.mockImplementationOnce(() => {
      signalStarted();
      return new Promise((_, reject) => { failInitializer = reject; }) as any;
    });
    const failed = getCashFlowRisk(scope, baseNow);
    await started;
    try {
      equityChanges.push({ at: Date.parse('2026-10-16T11:00:00Z'), amount: -4000 });
      expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, dailyPnl: -4000 });
      const snapshot = await recordPortfolioObservation({ accountId: scope.accountId, brokerMode: scope.mode,
        totalValue: 96000, cashBalance: 96000, invested: 0, pnlTotal: -4000 } as PortfolioState, baseNow);
      const before = await prisma.capitalRiskState.findFirstOrThrow({ where: { accountId: scope.accountId } });
      failInitializer(Object.assign(new Error('fixture initializer failure'), { code: 'P2002' }));
      expect(await failed).toMatchObject({ complete: false, reason: 'CAPITAL_EVIDENCE_UNAVAILABLE', dailyPnl: null });
      expect(await prisma.capitalRiskState.findUniqueOrThrow({ where: { scopeKey: before.scopeKey } })).toEqual(before);
      expect(await prisma.portfolioSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).toEqual(snapshot);
      expect(await readCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, dailyPnl: -4000, revision: before.revision });
    } finally { initializer.mockRestore(); failInitializer(new Error('fixture cleanup')); }
  }, 25000);
  test('slow failed worker cannot invalidate a newer successful scoped revision', async () => {
    let rejectSlow!: (error: Error) => void;
    let signalStarted!: () => void; const started = new Promise<void>(resolve => { signalStarted = resolve; });
    broker.listActivitiesVerified.mockImplementationOnce(() => { signalStarted(); return new Promise((_, reject) => { rejectSlow = reject; }); });
    const slow = getCashFlowRisk(scope, baseNow);
    await started;
    expect((await getCashFlowRisk(scope, baseNow)).complete).toBe(true);
    rejectSlow(new Error('BROKER_ACTIVITY_SCAN_BOUND_EXCEEDED'));
    expect((await slow).complete).toBe(true);
    expect((await prisma.capitalRiskState.findFirstOrThrow({ where: { accountId: scope.accountId } })).status).toBe('VERIFIED');
  }, 25000);
  test('reader cannot combine verified r1 status with unknown-capital r2 points', async () => {
    event('CSW', -10000); await getCashFlowRisk(scope, baseNow);
    let stateRead!: () => void; const started = new Promise<void>(resolve => { stateRead = resolve; });
    let resume!: () => void; const paused = new Promise<void>(resolve => { resume = resolve; });
    const realTransaction = prisma.$transaction.bind(prisma);
    const spy = jest.spyOn(prisma, '$transaction');
    spy.mockImplementationOnce(((callback: any, options: any) => realTransaction(async tx => callback(new Proxy(tx, {
      get(target, property) {
        if (property !== 'capitalRiskState') return (target as any)[property];
        return new Proxy(target.capitalRiskState, { get(model, method) {
          if (method !== 'findUnique') return (model as any)[method];
          return async (args: any) => { const value = await model.findUnique(args); stateRead(); await paused; return value; };
        } });
      },
    })), options)) as any);
    const next = new Date(baseNow.getTime() + STEP);
    const reader = readCashFlowRisk(scope, next);
    await started;
    try {
      equityChanges.push({ at: Date.parse('2026-10-16T11:00:00Z'), amount: 20000 });
      activities.push({ id: 'concurrent-journal', activity_type: 'JNLC', net_amount: '20000', date: '2026-10-16' });
      expect(await getCashFlowRisk(scope, next)).toMatchObject({ complete: false, revision: 2, equity: 110000 });
    } finally { resume(); spy.mockRestore(); }
    expect(await reader).toMatchObject({ complete: true, revision: 1, equity: 90000 });
    expect(await readCashFlowRisk(scope, next)).toMatchObject({ complete: false, revision: 2, equity: 110000, dailyPnl: null });
  }, 30000);
});
