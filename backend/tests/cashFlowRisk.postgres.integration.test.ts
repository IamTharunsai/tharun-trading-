// Actual PG persistence/locking; broker responses below are fixtures only.
// No provider implementation, credential or live account is reachable in CI.
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import { prisma } from '../src/utils/prisma';
import { getCashFlowRisk, RISK_STEP_MS as STEP } from '../src/services/cashFlowRisk';
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
      equity.push(100000 + equityChanges.filter(change => change.at <= left + STEP).reduce((sum, change) => sum + change.amount, 0));
      for (const type of new Set(flows.map(flow => flow.type))) {
        (cashflow[type] ??= []).push(flows.filter(flow => flow.type === type && flow.at > left && flow.at <= left + STEP).reduce((sum, flow) => sum + flow.amount, 0));
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
    event('CSW', -10000);
    const values = await Promise.all([getCashFlowRisk(scope, baseNow), getCashFlowRisk(scope, baseNow)]);
    values.forEach(value => expect(value).toMatchObject({ complete: true, dailyPnl: 0, drawdownPct: 0, equity: 90000 }));
    expect(await prisma.capitalRiskObservation.count({ where: { accountId: scope.accountId } })).toBe(1);
    expect(await prisma.capitalRiskActivity.count({ where: { accountId: scope.accountId } })).toBe(1);
    expect((await getCashFlowRisk(scope, baseNow)).revision).toBe(1);
    expect(broker.getPortfolioHistoryVerified).toHaveBeenCalledTimes(2); // both fetched, one CAS committed
  }, 25000);
  test('deposit plus trading loss retains negative opening-equity results despite rising NAV', async () => {
    event('CSD', 10000); equityChanges.push({ at: Date.parse('2026-10-16T11:00:00Z'), amount: -4000 });
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, dailyPnl: -4000, dailyPnlPct: -4, weeklyPnlPct: -4, drawdownPct: 4, equity: 106000 });
  }, 25000);
  test('newly created old-effective flow refetches past bins and recomputes while retaining original response', async () => {
    const at = Date.parse('2026-10-12T10:00:00Z'); equityChanges.push({ at, amount: -10000 });
    expect(await getCashFlowRisk(scope, baseNow)).toMatchObject({ complete: true, weeklyPnlPct: -10, drawdownPct: 10 });
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
  test('legacy raw NAV and recorded realized losses retain ownership and values without verified risk defaults', async () => {
    const snapshot = await prisma.portfolioSnapshot.create({ data: { totalValue: 90000, cashBalance: 90000, invested: 0, pnlDay: -10000, pnlDayPct: -10 } });
    const trade = await prisma.trade.create({ data: { asset: 'FIXTURE', market: 'stocks', type: 'BUY', quantity: 10, entryPrice: 100,
      status: 'CLOSED', pnl: -100, realizedPnl: -100 } });
    event('CSW', -10000); await getCashFlowRisk(scope, baseNow);
    expect(await prisma.portfolioSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).toMatchObject({ accountId: null, brokerMode: null, totalValue: 90000, pnlDay: -10000, riskDataComplete: false, adjustedDailyPnl: null });
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).toMatchObject({ accountId: null, quantity: 10, entryPrice: 100, pnl: -100 });
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
});
