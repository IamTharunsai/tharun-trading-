// Forecast scorecard: recording, maturity scoring and aggregation math.
// Prisma is an in-memory fixture; no database or price provider is touched.
const rows: any[] = [];
const matches = (row: any, where: any): boolean => Object.entries(where || {}).every(([k, v]: any) => {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('lte' in v) return new Date(row[k]).getTime() <= new Date(v.lte).getTime();
    if ('gte' in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
    if ('gt' in v) return new Date(row[k]).getTime() > new Date(v.gt).getTime();
    return true;
  }
  return row[k] === v;
});
const db: any = {
  forecastRecord: {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `f-${rows.length + 1}`, realizedPrice: null, realizedReturn: null,
        directionHit: null, brier: null, scoredAt: null, createdAt: new Date(), ...data };
      rows.push(row); return row;
    }),
    findMany: jest.fn(async ({ where }: any) => rows.filter(r => matches(r, where))),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter(r => matches(r, where)); hit.forEach(r => Object.assign(r, data));
      return { count: hit.length };
    }),
  },
};
jest.mock('../src/utils/prisma', () => ({ prisma: db }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import {
  directionFromReturn, recordForecast, recordKronosForecast, recordCouncilForecast,
  scoreForecastRow, scoreMaturedForecasts, computeForecastScorecard, barDurationMsFromCandles,
} from '../src/services/forecastScorecard';

const HOUR = 3_600_000;
beforeEach(() => { jest.clearAllMocks(); rows.length = 0; });

test('direction uses one symmetric flat tolerance for recording and scoring', () => {
  expect(directionFromReturn(0.02)).toBe('UP');
  expect(directionFromReturn(-0.02)).toBe('DOWN');
  expect(directionFromReturn(0.0005)).toBe('FLAT');
  expect(directionFromReturn(-0.0005)).toBe('FLAT');
  expect(directionFromReturn(Number.NaN)).toBe('FLAT');
});

test('bar duration comes from candle spacing, with the market timeframe as fallback', () => {
  expect(barDurationMsFromCandles([{ timestamp: 0 }, { timestamp: HOUR }, { timestamp: 2 * HOUR }], 'crypto')).toBe(HOUR);
  expect(barDurationMsFromCandles([], 'crypto')).toBe(HOUR);
  expect(barDurationMsFromCandles([], 'stocks')).toBe(86_400_000);
  expect(barDurationMsFromCandles([{ timestamp: 5 }], 'stocks')).toBe(86_400_000);
});

test('Kronos forecasts persist with direction and horizon, and no invented probability', async () => {
  const at = Date.UTC(2026, 9, 20, 12, 0, 0);
  const row = await recordKronosForecast({
    asset: 'BTC', market: 'crypto', referencePrice: 100, barDurationMs: HOUR, at,
    forecast: { symbol: 'BTC', predictedClose: [99, 98, 97, 96, 97], upperBand: [101, 100, 99, 98, 99], lowerBand: [97, 96, 95, 94, 95], meanReturn: -0.03 },
  });
  expect(row).toMatchObject({ source: 'KRONOS', asset: 'BTC', direction: 'DOWN', probabilityUp: null, predictedPrice: 97, expectedReturn: -0.03, horizonBars: 5, referencePrice: 100 });
  expect(new Date(row.maturesAt).getTime()).toBe(at + 5 * HOUR);
  expect(row.metadata).toMatchObject({ lowerBand: 95, upperBand: 99 });
});

test('council calls persist with stated confidence mapped to P(up)', async () => {
  const buy = await recordCouncilForecast({ asset: 'AAPL', market: 'stocks', decision: 'BUY', confidence: 70, referencePrice: 100, horizonBars: 5, barDurationMs: 86_400_000, decisionId: 'd-1' });
  expect(buy).toMatchObject({ source: 'COUNCIL', direction: 'UP', probabilityUp: 0.7, decisionId: 'd-1' });
  const sell = await recordCouncilForecast({ asset: 'AAPL', market: 'stocks', decision: 'SELL', confidence: 70, referencePrice: 100, horizonBars: 5, barDurationMs: 86_400_000, decisionId: 'd-2' });
  expect(sell.direction).toBe('DOWN');
  expect(sell.probabilityUp).toBeCloseTo(0.3, 10); // P(up) = 1 − stated confidence in the DOWN call
  const hold = await recordCouncilForecast({ asset: 'AAPL', market: 'stocks', decision: 'HOLD', confidence: 90, referencePrice: 100, horizonBars: 5, barDurationMs: 86_400_000, decisionId: 'd-3' });
  expect(hold).toMatchObject({ direction: 'FLAT', probabilityUp: null });
});

test('invalid forecasts are refused, never persisted', async () => {
  expect(await recordForecast({ source: 'KRONOS', asset: 'BTC', market: 'crypto', direction: 'UP', referencePrice: 0, horizonBars: 5, barDurationMs: HOUR })).toBeNull();
  expect(await recordForecast({ source: 'KRONOS', asset: 'BTC', market: 'crypto', direction: 'UP', referencePrice: 100, horizonBars: 0, barDurationMs: HOUR })).toBeNull();
  expect(await recordForecast({ source: 'KRONOS', asset: 'BTC', market: 'crypto', direction: 'UP', probabilityUp: 1.4, referencePrice: 100, horizonBars: 5, barDurationMs: HOUR }))
    .toMatchObject({ probabilityUp: null }); // out-of-range probability is dropped, not clamped into existence
  expect(db.forecastRecord.create).toHaveBeenCalledTimes(1);
});

test('scoring one row: hit/miss by realized direction, Brier only when a probability exists', () => {
  const base = { referencePrice: 100, direction: 'UP', probabilityUp: 0.8 };
  const hit = scoreForecastRow(base, 110)!;
  expect(hit).toMatchObject({ realizedReturn: 0.1, directionHit: true });
  expect(hit.brier).toBeCloseTo(0.04, 10); // (0.8 − 1)² — confident and right
  const miss = scoreForecastRow(base, 90)!;
  expect(miss).toMatchObject({ realizedReturn: -0.1, directionHit: false });
  expect(miss.brier).toBeCloseTo(0.64, 10); // (0.8 − 0)² — confident and wrong, heavily penalized
  expect(scoreForecastRow({ ...base, direction: 'FLAT', probabilityUp: null }, 100.05)).toMatchObject({ directionHit: true, brier: null });
  expect(scoreForecastRow(base, 0)).toBeNull();
  expect(scoreForecastRow({ ...base, referencePrice: -1 }, 100)).toBeNull();
});

test('matured forecasts are scored once; immature and unpriced rows stay pending', async () => {
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);
  await recordKronosForecast({ asset: 'BTC', market: 'crypto', referencePrice: 100, barDurationMs: HOUR, at: now - 6 * HOUR,
    forecast: { symbol: 'BTC', predictedClose: [101, 102, 103, 104, 105], upperBand: [102, 103, 104, 105, 106], lowerBand: [100, 101, 102, 103, 104], meanReturn: 0.05 } });
  await recordKronosForecast({ asset: 'ETH', market: 'crypto', referencePrice: 50, barDurationMs: HOUR, at: now - 6 * HOUR,
    forecast: { symbol: 'ETH', predictedClose: [49, 48, 47, 46, 45], upperBand: [50, 49, 48, 47, 46], lowerBand: [48, 47, 46, 45, 44], meanReturn: -0.1 } });
  await recordKronosForecast({ asset: 'SOL', market: 'crypto', referencePrice: 10, barDurationMs: HOUR, at: now - HOUR,
    forecast: { symbol: 'SOL', predictedClose: [11, 11, 11, 11, 11], upperBand: [12, 12, 12, 12, 12], lowerBand: [10, 10, 10, 10, 10], meanReturn: 0.1 } });

  const prices: Record<string, number | null> = { BTC: 108, ETH: null };
  const fetcher = jest.fn(async (asset: string) => prices[asset] ?? null);
  const first = await scoreMaturedForecasts(fetcher as any, now);
  expect(first).toEqual({ scored: 1, pending: 1 }); // ETH has no observed price; SOL has not matured
  expect(rows.find(r => r.asset === 'BTC')).toMatchObject({ realizedPrice: 108, directionHit: true, scoredAt: new Date(now) });
  expect(rows.find(r => r.asset === 'ETH')?.scoredAt).toBeNull();
  expect(rows.find(r => r.asset === 'SOL')?.scoredAt).toBeNull();

  const second = await scoreMaturedForecasts(fetcher as any, now);
  expect(second.scored).toBe(0); // already-scored rows are never rescored
  expect(fetcher).toHaveBeenCalledTimes(3); // BTC once, ETH twice (still unpriced), SOL never
});

// Fixed-fixture scorecard math: hit rate, Brier mean, calibration buckets.
const fixtureRow = (over: any) => ({
  source: 'KRONOS', direction: 'UP', probabilityUp: null, realizedReturn: null,
  directionHit: null, brier: null, scoredAt: null, createdAt: new Date(), ...over,
});
const scoredFixture = (over: any) => fixtureRow({ scoredAt: new Date(), ...over });

test('scorecard math on fixed fixtures: hit rate, Brier and calibration buckets', () => {
  const rowsIn = [
    // KRONOS — direction only, no probabilities anywhere.
    scoredFixture({ direction: 'UP', realizedReturn: 0.02, directionHit: true }),
    scoredFixture({ direction: 'UP', realizedReturn: -0.01, directionHit: false }),
    scoredFixture({ direction: 'DOWN', realizedReturn: -0.03, directionHit: true }),
    scoredFixture({ direction: 'FLAT', realizedReturn: 0.0004, directionHit: true }),
    // COUNCIL — stated probabilities, scored against realized direction.
    scoredFixture({ source: 'COUNCIL', direction: 'UP', probabilityUp: 0.75, realizedReturn: 0.02, directionHit: true, brier: 0.0625 }),
    scoredFixture({ source: 'COUNCIL', direction: 'UP', probabilityUp: 0.75, realizedReturn: 0.01, directionHit: true, brier: 0.0625 }),
    scoredFixture({ source: 'COUNCIL', direction: 'UP', probabilityUp: 0.75, realizedReturn: -0.01, directionHit: false, brier: 0.5625 }),
    scoredFixture({ source: 'COUNCIL', direction: 'DOWN', probabilityUp: 0.25, realizedReturn: -0.03, directionHit: true, brier: 0.0625 }),
    // One recorded-but-unscored council forecast.
    fixtureRow({ source: 'COUNCIL', direction: 'UP', probabilityUp: 0.6 }),
  ];
  const card = computeForecastScorecard(rowsIn, { days: 30, now: Date.UTC(2026, 9, 23) });

  expect(card.windowDays).toBe(30);
  expect(card.overall).toMatchObject({ recorded: 9, scored: 8, pending: 1, hits: 6, hitRate: 0.75 });
  expect(card.bySource.KRONOS).toMatchObject({ recorded: 4, scored: 4, hits: 3, hitRate: 0.75 });
  expect(card.bySource.KRONOS.brier).toEqual({ n: 0, mean: null }); // no probabilities → no Brier, honestly empty
  expect(card.bySource.KRONOS.calibration.every(b => b.count === 0)).toBe(true);

  expect(card.bySource.COUNCIL).toMatchObject({ recorded: 5, scored: 4, pending: 1, hits: 3, hitRate: 0.75 });
  expect(card.bySource.COUNCIL.brier.n).toBe(4);
  expect(card.bySource.COUNCIL.brier.mean).toBeCloseTo(0.1875, 10);
  const bucket70 = card.bySource.COUNCIL.calibration.find(b => b.lo === 0.7)!;
  expect(bucket70.count).toBe(3);
  expect(bucket70.avgPredicted).toBeCloseTo(0.75, 10);
  expect(bucket70.observedFreq).toBeCloseTo(2 / 3, 10); // stated 75% vs realized 67% — the calibration gap, measured
  const bucket20 = card.bySource.COUNCIL.calibration.find(b => b.lo === 0.2)!;
  expect(bucket20).toMatchObject({ count: 1, avgPredicted: 0.25, observedFreq: 0 });
});

test('empty scorecard is honestly zero, not a fabricated baseline', () => {
  const card = computeForecastScorecard([]);
  expect(card.overall).toMatchObject({ recorded: 0, scored: 0, pending: 0, hits: 0, hitRate: null });
  expect(card.bySource.KRONOS.brier).toEqual({ n: 0, mean: null });
});
