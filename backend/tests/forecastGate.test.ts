// Forecast gate: pure evaluation, env flag, and the DB-backed check.
// Prisma is a jest fixture; no database is touched.
jest.mock('../src/utils/prisma', () => ({ prisma: { forecastRecord: { findMany: jest.fn() } } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
import { prisma } from '../src/utils/prisma';
import {
  isForecastGateEnabled, forecastOpposesTrade, evaluateForecastGate, checkForecastGate,
} from '../src/trading/forecastGate';

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const row = (over: any = {}) => ({
  source: 'KRONOS', asset: 'AAPL', direction: 'DOWN', decisionId: null,
  createdAt: new Date(NOW - 60_000), maturesAt: new Date(NOW + 3_600_000), ...over,
});
const findMany = (prisma as any).forecastRecord.findMany as jest.Mock;
const ORIGINAL_FLAG = process.env.FORECAST_GATE_ENABLED;
beforeEach(() => { jest.clearAllMocks(); delete process.env.FORECAST_GATE_ENABLED; findMany.mockResolvedValue([]); });
afterAll(() => { if (ORIGINAL_FLAG === undefined) delete process.env.FORECAST_GATE_ENABLED; else process.env.FORECAST_GATE_ENABLED = ORIGINAL_FLAG; });

test('flag defaults ON and only an explicit off value disables it', () => {
  expect(isForecastGateEnabled({})).toBe(true);
  expect(isForecastGateEnabled({ FORECAST_GATE_ENABLED: 'true' })).toBe(true);
  expect(isForecastGateEnabled({ FORECAST_GATE_ENABLED: '1' })).toBe(true);
  expect(isForecastGateEnabled({ FORECAST_GATE_ENABLED: 'false' })).toBe(false);
  expect(isForecastGateEnabled({ FORECAST_GATE_ENABLED: ' OFF ' })).toBe(false);
  expect(isForecastGateEnabled({ FORECAST_GATE_ENABLED: '0' })).toBe(false);
  expect(isForecastGateEnabled({ FORECAST_GATE_ENABLED: 'no' })).toBe(false);
});

test('opposition is strictly directional: FLAT never opposes, UP/DOWN mirror the side', () => {
  expect(forecastOpposesTrade('DOWN', 'BUY')).toBe(true);
  expect(forecastOpposesTrade('UP', 'SELL')).toBe(true);
  expect(forecastOpposesTrade('UP', 'BUY')).toBe(false);
  expect(forecastOpposesTrade('DOWN', 'SELL')).toBe(false);
  expect(forecastOpposesTrade('FLAT', 'BUY')).toBe(false);
  expect(forecastOpposesTrade('FLAT', 'SELL')).toBe(false);
});

test('an unexpired opposing forecast blocks; an aligned one allows', () => {
  expect(evaluateForecastGate([row()], 'BUY', { now: NOW })).toMatchObject({ allowed: false, reason: expect.stringContaining('FORECAST_GATE_OPPOSED') });
  expect(evaluateForecastGate([row({ direction: 'UP' })], 'BUY', { now: NOW }).allowed).toBe(true);
  expect(evaluateForecastGate([row()], 'SELL', { now: NOW }).allowed).toBe(true);
  expect(evaluateForecastGate([row({ direction: 'UP' })], 'SELL', { now: NOW }).allowed).toBe(false);
});

test('expired and future-dated forecasts are not evidence', () => {
  expect(evaluateForecastGate([row({ maturesAt: new Date(NOW - 1) })], 'BUY', { now: NOW }).allowed).toBe(true);
  expect(evaluateForecastGate([row({ createdAt: new Date(NOW + 60_000), maturesAt: new Date(NOW + 7_200_000) })], 'BUY', { now: NOW }).allowed).toBe(true);
  expect(evaluateForecastGate([], 'BUY', { now: NOW }).allowed).toBe(true);
});

test('the latest forecast per source wins', () => {
  const stale = row({ createdAt: new Date(NOW - 3_600_000), maturesAt: new Date(NOW + 3_600_000) }); // DOWN, older
  const fresh = row({ direction: 'UP', createdAt: new Date(NOW - 60_000), maturesAt: new Date(NOW + 3_600_000) });
  expect(evaluateForecastGate([stale, fresh], 'BUY', { now: NOW }).allowed).toBe(true);
  expect(evaluateForecastGate([fresh, stale], 'BUY', { now: NOW }).allowed).toBe(true); // order-independent
  // …but a fresh opposing forecast from ANOTHER source still blocks.
  const councilDown = row({ source: 'COUNCIL', createdAt: new Date(NOW - 30_000), maturesAt: new Date(NOW + 3_600_000) });
  expect(evaluateForecastGate([fresh, councilDown], 'BUY', { now: NOW }).allowed).toBe(false);
});

test("a trade's own council call is excluded — it is the decision, not independent evidence", () => {
  const own = row({ source: 'COUNCIL', direction: 'DOWN', decisionId: 'decision-1' });
  expect(evaluateForecastGate([own], 'BUY', { now: NOW }).allowed).toBe(false); // sanity: it would oppose
  expect(evaluateForecastGate([own], 'BUY', { now: NOW, excludeDecisionId: 'decision-1' }).allowed).toBe(true);
  const other = row({ source: 'COUNCIL', direction: 'DOWN', decisionId: 'decision-2' });
  expect(evaluateForecastGate([other], 'BUY', { now: NOW, excludeDecisionId: 'decision-1' }).allowed).toBe(false);
});

test('checkForecastGate reads recorded forecasts and blocks on opposition', async () => {
  findMany.mockResolvedValue([row()]);
  const verdict = await checkForecastGate({ asset: 'AAPL', direction: 'BUY', decisionId: 'decision-9', now: NOW });
  expect(verdict.allowed).toBe(false);
  expect(verdict.reason).toContain('FORECAST_GATE_OPPOSED');
  expect(verdict.opposing?.[0]).toMatchObject({ source: 'KRONOS', direction: 'DOWN' });
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ asset: 'AAPL' }) }));
});

test('checkForecastGate allows when nothing recorded opposes', async () => {
  findMany.mockResolvedValue([row({ direction: 'UP' })]);
  expect((await checkForecastGate({ asset: 'AAPL', direction: 'BUY', now: NOW })).allowed).toBe(true);
  findMany.mockResolvedValue([]);
  expect((await checkForecastGate({ asset: 'AAPL', direction: 'BUY', now: NOW })).allowed).toBe(true);
});

test('flag OFF restores pre-gate behaviour without touching the database', async () => {
  process.env.FORECAST_GATE_ENABLED = 'false';
  findMany.mockResolvedValue([row()]); // an opposing forecast exists…
  const verdict = await checkForecastGate({ asset: 'AAPL', direction: 'BUY', now: NOW });
  expect(verdict).toMatchObject({ allowed: true, reason: 'FORECAST_GATE_DISABLED' }); // …and is not even consulted
  expect(findMany).not.toHaveBeenCalled();
});

test('a lookup failure is loud and fails open — auxiliary evidence must not halt trading', async () => {
  findMany.mockRejectedValue(new Error('relation "ForecastRecord" does not exist'));
  const verdict = await checkForecastGate({ asset: 'AAPL', direction: 'BUY', now: NOW });
  expect(verdict).toMatchObject({ allowed: true, reason: 'FORECAST_GATE_LOOKUP_FAILED' });
});
