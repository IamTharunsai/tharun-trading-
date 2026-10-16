jest.mock('../src/utils/prisma', () => ({ prisma: {} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/agents/orchestrator', () => ({ activateKillSwitch: jest.fn() }));
jest.mock('../src/services/alertService', () => ({ alert: { tradeFailed: jest.fn(async () => {}), drawdownWarning: jest.fn(async () => {}) } }));
import { Prisma } from '@prisma/client';
import { RISK_STEP_MS as STEP, RiskPoint, parseRiskHistory, computeCashFlowRisk, capitalCoverage, activityEvidence } from '../src/services/cashFlowRisk';
import { validateTradeSignal } from '../src/trading/riskManager';
import type { PortfolioState, TradeSignal } from '../src/agents/types';
const D = Prisma.Decimal;
const reference = new Date('2026-10-08T00:00:00Z');
const asOf = new Date('2026-10-16T12:00:00Z');
const now = new Date(asOf.getTime() + 30_000);
const series = (flow: number, result = 0): RiskPoint[] => Array.from({ length: (asOf.getTime() - reference.getTime()) / STEP + 1 }, (_, i) => {
  const endAt = new Date(reference.getTime() + i * STEP);
  const changed = endAt.getTime() >= Date.parse('2026-10-16T10:00:00Z');
  return { endAt, equity: new D(100000 + (changed ? flow + result : 0)), externalCapital: new D(endAt.toISOString() === '2026-10-16T10:00:00.000Z' ? flow : 0),
    cashflows: endAt.toISOString() === '2026-10-16T10:00:00.000Z' ? { [flow < 0 ? 'CSW' : 'CSD']: flow } : {}, complete: true };
});
test('withdrawal 100k to 90k is zero trading loss and zero adjusted drawdown', () => {
  expect(computeCashFlowRisk(series(-10000), now, reference)).toMatchObject({ complete: true, dailyPnl: 0, dailyPnlPct: 0, weeklyPnlPct: 0, weeklyDrawdownPct: 0, drawdownPct: 0, equity: 90000 });
});
test('10k deposit cannot hide a 4k trading loss; percentage uses 100k opening NAV', () => {
  expect(computeCashFlowRisk(series(10000, -4000), now, reference)).toMatchObject({ complete: true, dailyPnl: -4000, dailyPnlPct: -4, weeklyPnl: -4000, drawdownPct: 4, equity: 106000 });
});
test('fees, interest and dividends remain investment results, not capital', () => {
  const history = { timeframe: '5Min', timestamp: [0, 300], equity: [100, 97], cashflow: { FEE: [0, -5], DIV: [0, 1], INT: [0, 1] } };
  const points = parseRiskHistory(history, new Date(0), new Date(600000));
  expect(points[1].externalCapital.toNumber()).toBe(0); expect(points[1].complete).toBe(true);
  expect(activityEvidence({ id: 'fee', activity_type: 'FEE', net_amount: '-5', date: '2026-10-16' }).classification).toBe('INVESTMENT_RESULT');
});
test('late-posted flow recomputes subsequent normalized peaks; it is not an additive replay', () => {
  const before = series(-10000); before.forEach(p => { p.externalCapital = new D(0); p.cashflows = {}; });
  expect(computeCashFlowRisk(before, now, reference).drawdownPct).toBe(10);
  const after = series(-10000);
  expect(computeCashFlowRisk(after, now, reference).drawdownPct).toBe(0);
  expect(computeCashFlowRisk(after, now, reference).dailyPnl).toBe(0);
});
test('date-only evidence needs broker bucket corroboration; two transfers cannot claim one flow', () => {
  const points = series(-10000);
  const activity = { id: 'withdraw', activity_type: 'CSW', net_amount: '-10000', date: '2026-10-16' };
  expect(capitalCoverage(points, [activity], reference)).toBeNull();
  expect(capitalCoverage(points, [activity, { ...activity, id: 'second' }], reference)).toBe('CAPITAL_ACTIVITY_HISTORY_MISMATCH');
  expect(capitalCoverage(series(0), [activity], reference)).toBe('CAPITAL_ACTIVITY_HISTORY_MISMATCH');
  expect(capitalCoverage(points, [], reference)).toBe('CAPITAL_ACTIVITY_COVERAGE_UNAVAILABLE');
});
test('ACATC uses signed cash dollars; securities quantity and journals are unknown', () => {
  expect(activityEvidence({ id: 'cash', activity_type: 'ACATC', net_amount: '-500', date: '2026-10-16' }).amount?.toNumber()).toBe(-500);
  expect(() => activityEvidence({ id: 'cash', activity_type: 'ACATC', qty: '500' })).toThrow('EXTERNAL_CAPITAL_AMOUNT_UNAVAILABLE');
  for (const type of ['ACATS', 'JNLC', 'JNLS', 'JNL', 'UNRECOGNIZED']) expect(activityEvidence({ id: type, activity_type: type, qty: '100' }).classification).toBe('UNKNOWN_CAPITAL_EFFECT');
});
test('reversed cash signs, omitted arrays and missing internal bins never become zero flows', () => {
  expect(() => parseRiskHistory({ timeframe: '5Min', timestamp: [0], equity: [100], cashflow: { CSW: [10] } }, new Date(0), new Date(STEP))).toThrow('INVALID_EXTERNAL_CAPITAL_SIGN');
  expect(() => parseRiskHistory({ timeframe: '5Min', timestamp: [0, 600], equity: [100, 100], cashflow: {} }, new Date(0), new Date(3 * STEP))).toThrow('RISK_HISTORY_COVERAGE_GAP');
  expect(() => parseRiskHistory({ timeframe: '5Min', timestamp: [0], equity: [100] } as any, new Date(0), new Date(STEP))).toThrow('INVALID_RISK_HISTORY');
});
test('completed-window end labels, stale values and unsupported capital never imply live zero loss', () => {
  const parsed = parseRiskHistory({ timeframe: '5Min', timestamp: [0, 300], equity: [100, 100], cashflow: { JNLC: [0, 50] } }, new Date(0), new Date(600000));
  expect(parsed[0].endAt.getTime()).toBe(STEP); expect(parsed[1].complete).toBe(false);
  expect(computeCashFlowRisk(series(-10000), new Date(asOf.getTime() + 400000), reference)).toMatchObject({ complete: false, dailyPnl: null, reason: 'RISK_VALUATION_STALE', equity: 90000 });
});
test('missing week/day openings remain explicit, including newly funded accounts', () => {
  const short = series(0).slice(-10);
  expect(computeCashFlowRisk(short, now, short[0].endAt)).toMatchObject({ complete: false, dailyPnl: null, weeklyPnlPct: null, reason: 'OPENING_EQUITY_UNAVAILABLE' });
});
test('actual risk gates consume adjusted losses and reject cross-account/stale evidence', async () => {
  jest.useFakeTimers().setSystemTime(now);
  const signal = { asset: 'FIXTURE', direction: 'BUY', confidence: 80, entryPrice: 100, stopLossPrice: 95,
    takeProfitPrice: 110, positionSizePct: 1, voteCounts: { supporting: 10, opposing: 0, abstaining: 0 } } as TradeSignal;
  const evidence = { ...computeCashFlowRisk(series(-10000), now, reference), accountId: 'fixture', brokerMode: 'paper' };
  const portfolio = { accountId: 'fixture', brokerMode: 'paper', totalValue: 90000, cashBalance: 90000, pnlDayPct: 0,
    pnlWeekPct: 0, drawdownFromPeak: 0, riskDataComplete: true, capitalRisk: evidence, positions: [], tradesExecutedToday: 0 } as unknown as PortfolioState;
  try {
    expect((await validateTradeSignal(signal, portfolio)).approved).toBe(true);
    expect((await validateTradeSignal(signal, { ...portfolio, pnlDayPct: -4 })).reason).toContain('DAILY_LOSS_LIMIT');
    expect((await validateTradeSignal(signal, { ...portfolio, capitalRisk: { ...evidence, weeklyDrawdownPct: 7 } })).reason).toContain('WEEKLY_DRAWDOWN_GATE');
    expect((await validateTradeSignal(signal, { ...portfolio, brokerMode: 'live' })).approved).toBe(false);
    expect((await validateTradeSignal(signal, { ...portfolio, capitalRisk: { ...evidence, asOf: 'invalid' } })).approved).toBe(false);
    expect((await validateTradeSignal(signal, { ...portfolio, riskDataComplete: false, pnlDayPct: null })).approved).toBe(false);
  } finally { jest.useRealTimers(); }
});
