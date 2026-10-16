import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import type { AccountScope } from '../trading/accountScope';
import type { AlpacaActivity, AlpacaPortfolioHistory } from './alpacaBroker';

export const RISK_STEP_MS = 300_000;
const DAY = 86_400_000;
const D = Prisma.Decimal;
const externalTypes = new Set(['CSD', 'CSW', 'ACATC']);
// Only documented investment results are excluded from capital. Securities,
// generic cash journals and unknown activity types cannot be valued as capital.
const resultTypes = new Set(['FILL', 'CFEE', 'CGD', 'DIV', 'DIVCGL', 'DIVCGS', 'DIVFEE',
  'DIVFT', 'DIVNRA', 'DIVROC', 'DIVTW', 'DIVTXEX', 'FEE', 'INT', 'INTNRA', 'INTTW', 'PTC', 'PTR']);

export interface RiskPoint {
  endAt: Date;
  equity: Prisma.Decimal;
  externalCapital: Prisma.Decimal;
  cashflows: Record<string, number>;
  complete: boolean;
}
export interface CashFlowRiskMetrics {
  accountId: string | null;
  brokerMode: string | null;
  complete: boolean;
  reason: string | null;
  asOf: string | null;
  referenceAt: string | null;
  revision: number;
  valuationAgeMs: number | null;
  equity: number | null;
  dailyPnl: number | null;
  dailyPnlPct: number | null;
  weeklyPnl: number | null;
  weeklyPnlPct: number | null;
  weeklyDrawdownPct: number | null;
  drawdownPct: number | null;
  returnMethod: 'EXTERNAL_CAPITAL_ADJUSTED_OPENING_NAV';
}
const empty = (reason: string): CashFlowRiskMetrics => ({ accountId: null, brokerMode: null, complete: false, reason, asOf: null,
  referenceAt: null, revision: 0, valuationAgeMs: null, equity: null, dailyPnl: null,
  dailyPnlPct: null, weeklyPnl: null, weeklyPnlPct: null, weeklyDrawdownPct: null,
  drawdownPct: null, returnMethod: 'EXTERNAL_CAPITAL_ADJUSTED_OPENING_NAV' });

/** Broker timestamps LEFT-label windows; equity is at their END. Cashflow
 * arrays share those windows, including date-only transfers the broker placed.
 * Sources: https://docs.alpaca.markets/us/reference/getaccountportfoliohistory-1
 * https://alpaca.markets/sdks/python/api_reference/trading/models.html#alpaca.trading.models.PortfolioHistory
 * Never consume profit_loss/base_value as flow-adjusted evidence. */
export function parseRiskHistory(history: AlpacaPortfolioHistory, start: Date, end: Date, allowLeadingUnfundedGap = false): RiskPoint[] {
  if (history?.timeframe !== '5Min' || !Array.isArray(history.timestamp) || !Array.isArray(history.equity)
    || history.timestamp.length !== history.equity.length || !history.cashflow
    || typeof history.cashflow !== 'object' || Array.isArray(history.cashflow)) throw new Error('INVALID_RISK_HISTORY');
  const entries = Object.entries(history.cashflow);
  if (entries.some(([, values]) => !Array.isArray(values) || values.length !== history.timestamp.length
    || values.some(value => typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('INVALID_CASHFLOW_ARRAYS');
  const points: RiskPoint[] = [];
  for (let i = 0; i < history.timestamp.length; i++) {
    const left = history.timestamp[i] * 1000;
    if (!Number.isSafeInteger(left) || left % RISK_STEP_MS !== 0 || (i && history.timestamp[i] <= history.timestamp[i - 1])) throw new Error('INVALID_RISK_TIMESTAMPS');
    // Requests can include the unfinished final bucket. It is never a valuation.
    if (left >= end.getTime()) continue;
    if (left < start.getTime() || typeof history.equity[i] !== 'number' || !Number.isFinite(history.equity[i]) || history.equity[i] < 0) throw new Error('INVALID_RISK_EQUITY');
    let capital = new D(0); let complete = true;
    const cashflows: Record<string, number> = {};
    for (const [type, values] of entries) {
      const value = values[i]; cashflows[type] = value;
      if (externalTypes.has(type)) {
        if ((type === 'CSD' && value < 0) || (type === 'CSW' && value > 0)) throw new Error('INVALID_EXTERNAL_CAPITAL_SIGN');
        capital = capital.plus(value);
      } else if (value !== 0 && !resultTypes.has(type)) complete = false;
    }
    points.push({ endAt: new Date(left + RISK_STEP_MS), equity: new D(history.equity[i]), externalCapital: capital, cashflows, complete });
  }
  const actualStart = allowLeadingUnfundedGap && points.length ? points[0].endAt.getTime() - RISK_STEP_MS : start.getTime();
  if (!points.length || points.length !== (end.getTime() - actualStart) / RISK_STEP_MS
    || points.some((point, i) => point.endAt.getTime() !== actualStart + (i + 1) * RISK_STEP_MS)) throw new Error('RISK_HISTORY_COVERAGE_GAP');
  return points;
}

/** Activities are discovery/provenance, not placement authority. Never derive
 * capital from securities quantity or order a date-only flow at midnight.
 * https://docs.alpaca.markets/us/docs/account-activities */
export function activityEvidence(activity: AlpacaActivity) {
  if (!activity?.id || !activity.activity_type) throw new Error('INVALID_CAPITAL_ACTIVITY');
  const external = externalTypes.has(activity.activity_type);
  const knownResult = resultTypes.has(activity.activity_type);
  let amount: Prisma.Decimal | null = null;
  if (external) {
    if (typeof activity.net_amount !== 'string' || !/^[+-]?\d+(\.\d+)?$/.test(activity.net_amount)) throw new Error('EXTERNAL_CAPITAL_AMOUNT_UNAVAILABLE');
    amount = new D(activity.net_amount);
    if ((activity.activity_type === 'CSD' && amount.isNegative()) || (activity.activity_type === 'CSW' && amount.isPositive())) throw new Error('INVALID_EXTERNAL_CAPITAL_SIGN');
    if (activity.currency && activity.currency !== 'USD') throw new Error('UNSUPPORTED_CAPITAL_CURRENCY');
  }
  const effective = activity.transaction_time ?? activity.date;
  const dateOnly = !!effective && /^\d{4}-\d{2}-\d{2}$/.test(effective);
  const timestamp = effective ? Date.parse(effective) : NaN;
  // A date may mean occurrence OR settlement, timezone unspecified. These are
  // conservative REFETCH bounds only; no monetary allocation uses this range.
  const effectiveFrom = Number.isFinite(timestamp) ? new Date(timestamp - (dateOnly ? DAY : 0)) : null;
  const effectiveTo = Number.isFinite(timestamp) ? new Date(timestamp + (dateOnly ? 2 * DAY : RISK_STEP_MS)) : null;
  return { external, knownResult, amount, dateOnly, effectiveFrom, effectiveTo,
    classification: external ? 'EXTERNAL_CASH' : knownResult ? 'INVESTMENT_RESULT' : 'UNKNOWN_CAPITAL_EFFECT' };
}

/** Endpoints and reference are broker equity observations. This is a simple
 * opening-NAV-denominated return, NOT a time/money-weighted investment return. */
export function computeCashFlowRisk(points: RiskPoint[], now: Date, referenceAt: Date, revision = 0): CashFlowRiskMetrics {
  const unavailable = empty('RISK_HISTORY_COVERAGE_GAP');
  if (!points.length) return unavailable;
  const last = points[points.length - 1];
  const age = now.getTime() - last.endAt.getTime();
  const result = { ...unavailable, asOf: last.endAt.toISOString(), referenceAt: referenceAt.toISOString(),
    revision, valuationAgeMs: age, equity: last.equity.toNumber() };
  if (points[0].endAt.getTime() !== referenceAt.getTime() || points.some((p, i) =>
    p.endAt.getTime() !== referenceAt.getTime() + i * RISK_STEP_MS || (i > 0 && !p.complete))) return result;
  if (age < 0 || age >= RISK_STEP_MS + 90_000) return { ...result, reason: 'RISK_VALUATION_STALE' };
  const normalized: Prisma.Decimal[] = []; let capital = new D(0);
  for (let i = 0; i < points.length; i++) {
    if (i) capital = capital.plus(points[i].externalCapital);
    normalized.push(points[i].equity.minus(capital));
  }
  const dayStart = new Date(last.endAt); dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = last.endAt.getTime() - 7 * DAY;
  const dayIndex = points.findIndex(p => p.endAt.getTime() === dayStart.getTime());
  const weekIndex = points.findIndex(p => p.endAt.getTime() === weekStart);
  if (dayIndex < 0 || weekIndex < 0 || !points[dayIndex].equity.greaterThan(0) || !points[weekIndex].equity.greaterThan(0)) return { ...result, reason: 'OPENING_EQUITY_UNAVAILABLE' };
  const current = normalized[normalized.length - 1];
  const peak = normalized.reduce((a, b) => D.max(a, b));
  const weeklyPeak = normalized.slice(weekIndex).reduce((a, b) => D.max(a, b));
  if (!peak.greaterThan(0) || !weeklyPeak.greaterThan(0)) return { ...result, reason: 'NORMALIZED_PEAK_UNAVAILABLE' };
  const dayPnl = current.minus(normalized[dayIndex]);
  const weekPnl = current.minus(normalized[weekIndex]);
  return { ...result, complete: true, reason: null, dailyPnl: dayPnl.toNumber(),
    dailyPnlPct: dayPnl.div(points[dayIndex].equity).mul(100).toNumber(), weeklyPnl: weekPnl.toNumber(),
    weeklyPnlPct: weekPnl.div(points[weekIndex].equity).mul(100).toNumber(),
    drawdownPct: D.max(0, peak.minus(current).div(peak).mul(100)).toNumber(),
    weeklyDrawdownPct: D.max(0, weeklyPeak.minus(current).div(weeklyPeak).mul(100)).toNumber() };
}

/** Account-level aggregate corroboration only. The history supplies placement;
 * NTA dates supply conservative matching intervals. Merge overlapping intervals
 * before summing so two equal transfers cannot both claim the same bucket.
 * A missing/mismatched or boundary-ambiguous transfer remains unverified. */
export function capitalCoverage(points: RiskPoint[], activities: AlpacaActivity[], referenceAt: Date): string | null {
  const last = points[points.length - 1]?.endAt.getTime() ?? referenceAt.getTime();
  for (const type of externalTypes) {
    const intervals: { from: number; to: number; amount: Prisma.Decimal }[] = [];
    for (const activity of activities.filter(a => a.activity_type === type)) {
      const evidence = activityEvidence(activity);
      if (!evidence.effectiveFrom || !evidence.effectiveTo || !evidence.amount) return 'CAPITAL_EFFECTIVE_DATE_UNAVAILABLE';
      if (evidence.effectiveTo.getTime() <= referenceAt.getTime() || evidence.effectiveFrom.getTime() >= last) continue;
      intervals.push({ from: Math.max(referenceAt.getTime(), Math.floor(evidence.effectiveFrom.getTime() / RISK_STEP_MS) * RISK_STEP_MS),
        to: Math.min(last, evidence.effectiveTo.getTime()), amount: evidence.amount });
    }
    intervals.sort((a, b) => a.from - b.from);
    const groups: typeof intervals = [];
    for (const interval of intervals) {
      const previous = groups[groups.length - 1];
      if (previous && interval.from <= previous.to) { previous.to = Math.max(previous.to, interval.to); previous.amount = previous.amount.plus(interval.amount); }
      else groups.push({ ...interval });
    }
    for (const group of groups) {
      const actual = points.filter(p => p.endAt.getTime() > group.from && p.endAt.getTime() <= group.to)
        .reduce((sum, p) => sum.plus(p.cashflows[type] ?? 0), new D(0));
      if (!actual.equals(group.amount)) return 'CAPITAL_ACTIVITY_HISTORY_MISMATCH';
    }
    if (points.some(p => p.endAt > referenceAt && (p.cashflows[type] ?? 0) !== 0
      && !groups.some(g => p.endAt.getTime() > g.from && p.endAt.getTime() <= g.to))) return 'CAPITAL_ACTIVITY_COVERAGE_UNAVAILABLE';
  }
  return null;
}

type Scope = Pick<AccountScope, 'accountId' | 'mode'>;
const whereScope = (scope: Scope) => ({ accountId: scope.accountId, brokerMode: scope.mode });
const keyFor = (scope: Scope) => ['alpaca-risk', scope.mode, scope.accountId].map(encodeURIComponent).join(':');

async function readMetrics(scope: Scope, now: Date): Promise<CashFlowRiskMetrics> {
  const state = await prisma.capitalRiskState.findUnique({ where: { scopeKey: keyFor(scope) } });
  if (!state) return empty('RISK_HISTORY_UNAVAILABLE');
  const rows = await prisma.capitalRiskPoint.findMany({ where: { ...whereScope(scope), endAt: { gte: state.referenceAt } }, orderBy: { endAt: 'asc' } });
  const metrics = { ...computeCashFlowRisk(rows.map(row => ({ ...row, cashflows: row.cashflows as Record<string, number> })), now, state.referenceAt, state.revision),
    accountId: scope.accountId, brokerMode: scope.mode };
  // Retain the last evidenced risk valuation/as-of while explicitly invalidating
  // returns after a failed scan. Raw NAV/position/recorded losses stay available.
  return state.status === 'VERIFIED' ? metrics : { ...metrics, complete: false, reason: state.error ?? 'CAPITAL_COVERAGE_UNAVAILABLE',
    dailyPnl: null, dailyPnlPct: null, weeklyPnl: null, weeklyPnlPct: null, weeklyDrawdownPct: null, drawdownPct: null };
}

/** Runs bounded HTTP reads outside PG transactions, then uses a scoped lock and
 * revision CAS to prevent a slow worker from overwriting newer broker evidence.
 * Absolute bucket amounts replace projections; immutable observations retain
 * earlier responses so a late-posted transfer never silently rewrites evidence. */
export async function getCashFlowRisk(scope: AccountScope, now = new Date()): Promise<CashFlowRiskMetrics> {
  const scopeKey = keyFor(scope); const where = whereScope(scope);
  const end = new Date(Math.floor(now.getTime() / RISK_STEP_MS) * RISK_STEP_MS);
  const initialReference = new Date(end); initialReference.setUTCHours(0, 0, 0, 0); initialReference.setUTCDate(initialReference.getUTCDate() - 8);
  let expectedRevision: number | undefined;
  try {
    await prisma.capitalRiskState.upsert({ where: { scopeKey }, create: { scopeKey, ...where, referenceAt: initialReference }, update: {} });
    const before = await prisma.capitalRiskState.findUniqueOrThrow({ where: { scopeKey } });
    expectedRevision = before.revision;
    if (before.coveredThrough && before.coveredThrough >= end && before.status === 'VERIFIED') return readMetrics(scope, now);
    if (before.lastAttemptAt && now.getTime() - before.lastAttemptAt.getTime() < 30_000 && before.status !== 'VERIFIED') return readMetrics(scope, now);
    const activityAfter = new Date((before.activityThrough?.getTime() ?? before.referenceAt.getTime()) - 2 * DAY);
    // Filters are creation time, NOT effective/settlement time. Inclusive
    // overlap + stable IDs + complete pagination discovers newly posted old flows.
    const activities = await scope.broker.listActivitiesVerified(activityAfter.toISOString(), now.toISOString(), 100);
    const previous = await prisma.capitalRiskActivity.findMany({ where });
    const prior = new Map(previous.map(activity => [activity.brokerActivityId, JSON.stringify(activity.evidence)]));
    let historyStart = new Date((before.coveredThrough?.getTime() ?? before.referenceAt.getTime()) - 2 * DAY);
    historyStart = new Date(Math.max(before.referenceAt.getTime() - RISK_STEP_MS, historyStart.getTime()));
    const requests = [{ from: historyStart.getTime(), to: end.getTime() }];
    for (const activity of activities) {
      const evidence = activityEvidence(activity);
      if ((evidence.external || !evidence.knownResult) && prior.get(activity.id) !== JSON.stringify(activity)) {
        // Re-fetch old EFFECTIVE bins even when the event was just CREATED.
        // Recompute all subsequent normalized values from retained absolute bins.
        const affected = evidence.effectiveFrom?.getTime() ?? before.referenceAt.getTime() - RISK_STEP_MS;
        const from = Math.max(before.referenceAt.getTime() - RISK_STEP_MS, Math.floor(affected / RISK_STEP_MS) * RISK_STEP_MS);
        const to = Math.min(end.getTime(), Math.ceil((evidence.effectiveTo?.getTime() ?? end.getTime()) / RISK_STEP_MS) * RISK_STEP_MS);
        if (from < to) requests.push({ from, to });
      }
    }
    // A daily rotating full-reference audit also discovers broker corrections
    // without new activity IDs. Retain its cursor so older accounts do not hit
    // a permanent history-length cap. Each refresh audits at most 29 old days.
    let auditEnd: number | null = null;
    if (before.backfillCursor || !before.fullBackfillAt || now.getTime() - before.fullBackfillAt.getTime() >= DAY) {
      const from = before.backfillCursor?.getTime() ?? before.referenceAt.getTime() - RISK_STEP_MS;
      auditEnd = Math.min(from + 29 * DAY, end.getTime());
      requests.push({ from, to: auditEnd });
    }
    requests.sort((a, b) => a.from - b.from);
    const ranges: typeof requests = [];
    for (const request of requests) {
      const previous = ranges[ranges.length - 1];
      if (previous && request.from <= previous.to) previous.to = Math.max(previous.to, request.to);
      else ranges.push({ ...request });
    }
    const history: { start: string; end: string; response: AlpacaPortfolioHistory }[] = [];
    const points: RiskPoint[] = [];
    for (const range of ranges) for (let start = range.from; start < range.to;) {
      if (history.length >= 16) throw new Error('RISK_BACKFILL_BOUND_EXCEEDED');
      const until = Math.min(start + 29 * DAY, range.to);
      const response = await scope.broker.getPortfolioHistoryVerified(new Date(start).toISOString(), new Date(until).toISOString());
      points.push(...parseRiskHistory(response, new Date(start), new Date(until), before.revision === 0 && history.length === 0));
      history.push({ start: new Date(start).toISOString(), end: new Date(until).toISOString(), response });
      start = until;
    }
    const account = await scope.broker.getPortfolioSummary();
    if (!account || account.account_id !== scope.accountId || account.currency !== 'USD') throw new Error('RISK_ACCOUNT_AUTHORITY_UNAVAILABLE');
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeKey}))`;
      const state = await tx.capitalRiskState.findUniqueOrThrow({ where: { scopeKey } });
      if (state.revision !== before.revision) return; // A newer observation won.
      const revision = state.revision + 1;
      // Establish the reference once from actual funded broker equity. A new
      // account cannot inherit eight days of fictitious zero-return history.
      const referenceAt = state.revision === 0 ? points.find(p => p.equity.greaterThan(0))?.endAt : state.referenceAt;
      if (!referenceAt) throw new Error('FUNDED_RISK_REFERENCE_UNAVAILABLE');
      const observation = await tx.capitalRiskObservation.create({ data: { ...where, revision, observedAt: now,
        activityAfter, activityUntil: now, history: history as unknown as Prisma.InputJsonValue,
        activities: activities as unknown as Prisma.InputJsonValue } });
      for (const activity of activities) {
        const evidence = activityEvidence(activity);
        const data = { ...where, brokerActivityId: activity.id, activityType: activity.activity_type,
          classification: evidence.classification, amount: evidence.amount, dateOnly: evidence.dateOnly,
          effectiveFrom: evidence.effectiveFrom, effectiveTo: evidence.effectiveTo,
          evidence: activity as unknown as Prisma.InputJsonValue, observationId: observation.id };
        await tx.capitalRiskActivity.upsert({ where: { accountId_brokerMode_brokerActivityId: { ...where, brokerActivityId: activity.id } }, create: data, update: data });
      }
      const unknown = (await tx.capitalRiskActivity.count({ where: { ...where, classification: 'UNKNOWN_CAPITAL_EFFECT', OR: [
        { effectiveTo: null }, { effectiveTo: { gt: referenceAt } } ] } })) > 0;
      const existingPoints = await tx.capitalRiskPoint.findMany({ where });
      const existingByTime = new Map(existingPoints.map(p => [p.endAt.getTime(), p]));
      const newPoints = points.filter(p => !existingByTime.has(p.endAt.getTime()));
      for (let i = 0; i < newPoints.length; i += 1000) {
        await tx.capitalRiskPoint.createMany({ data: newPoints.slice(i, i + 1000).map(point => ({ ...where, ...point,
          cashflows: point.cashflows as Prisma.InputJsonValue, revision, observationId: observation.id })) });
      }
      for (const point of points.filter(p => existingByTime.has(p.endAt.getTime()))) {
        const previous = existingByTime.get(point.endAt.getTime())!;
        if (previous.equity.equals(point.equity) && previous.externalCapital.equals(point.externalCapital)
          && JSON.stringify(previous.cashflows) === JSON.stringify(point.cashflows) && previous.complete === point.complete) continue;
        await tx.capitalRiskPoint.update({ where: { id: previous.id }, data: { ...point,
          cashflows: point.cashflows as Prisma.InputJsonValue, revision, observationId: observation.id } });
      }
      const allPoints = await tx.capitalRiskPoint.findMany({ where, orderBy: { endAt: 'asc' } });
      const allActivities = await tx.capitalRiskActivity.findMany({ where });
      const coverageError = capitalCoverage(allPoints.filter(p => p.endAt >= referenceAt).map(p => ({ ...p, cashflows: p.cashflows as Record<string, number> })),
        allActivities.map(a => a.evidence as unknown as AlpacaActivity), referenceAt);
      await tx.capitalRiskState.update({ where: { scopeKey }, data: { revision, referenceAt, coveredThrough: end,
        activityThrough: now, lastAttemptAt: now, status: unknown || coverageError ? 'UNVERIFIED' : 'VERIFIED',
        error: unknown ? 'UNKNOWN_JOURNAL_OR_SECURITY_CAPITAL_EFFECT' : coverageError,
        ...(auditEnd !== null ? auditEnd >= end.getTime() ? { fullBackfillAt: now, backfillCursor: null }
          : { backfillCursor: new Date(auditEnd) } : {}) } });
    }, { timeout: 120_000 });
    return readMetrics(scope, now);
  } catch (error) {
    const reason = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'CAPITAL_EVIDENCE_UNAVAILABLE';
    // A scan failure must not replace the entire portfolio with an exception.
    // Its accounting/position evidence can still monitor existing exposure.
    await prisma.capitalRiskState.updateMany({ where: { scopeKey, ...(expectedRevision !== undefined ? { revision: expectedRevision } : {}) },
      data: { status: 'UNVERIFIED', error: reason, lastAttemptAt: now } }).catch(() => {});
    return readMetrics(scope, now).catch(() => empty(reason));
  }
}
