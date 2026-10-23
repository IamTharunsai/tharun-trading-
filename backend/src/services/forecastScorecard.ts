import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { brier as brierScore, calibrationBuckets } from '../trading/predictionMath';
import type { CalibrationBucket } from '../trading/predictionMath';
import type { KronosForecast } from './kronosService';

/**
 * Forecast measurement loop (AUDIT.md BUILD item 1; 03-trading-quant.md §5.2).
 *
 * Until now Kronos forecasts and the council's own final calls were produced,
 * consumed as prose by one LLM agent, and then thrown away — accuracy was
 * structurally unmeasurable. This module persists every such forecast in
 * scoreable form (ForecastRecord), scores matured rows against the first
 * price observed at or after maturity, and aggregates the scorecard
 * (direction hit rate + probability calibration) that the forecast gate and
 * any future qualification evidence producer read from.
 *
 * Honesty rules carried over from the rest of the codebase:
 *  - Kronos publishes no probability, so KRONOS rows store probabilityUp=null
 *    and are scored on direction only. No probability is invented for them.
 *  - COUNCIL probabilityUp is the council's stated confidence mapped to
 *    P(up). Stated confidence is NOT a calibrated probability (see
 *    predictionAssessment.ts); the calibration buckets below are precisely
 *    the measurement of that gap.
 *  - Nothing here writes StrategyQualification rows or touches the live
 *    qualification gate. This is evidence accrual, not authorization.
 */

const db = prisma as any;

export type ForecastSource = 'KRONOS' | 'COUNCIL';
export type ForecastDirection = 'UP' | 'DOWN' | 'FLAT';

/** A realized/forecast move within ±0.1% is FLAT, for recording and scoring alike. */
export const FLAT_TOLERANCE = 0.001;

export function directionFromReturn(value: number): ForecastDirection {
  if (!Number.isFinite(value)) return 'FLAT';
  return value > FLAT_TOLERANCE ? 'UP' : value < -FLAT_TOLERANCE ? 'DOWN' : 'FLAT';
}

/** Bar spacing of a snapshot's candles, falling back to the market's known
 * candle timeframe (crypto snapshots are 1h Binance bars; stock snapshots are
 * 1Day Alpaca bars — see services/marketData.ts). */
export function barDurationMsFromCandles(candles: Array<{ timestamp: number }> | undefined, market: string): number {
  if (candles && candles.length >= 2) {
    const diff = candles[candles.length - 1].timestamp - candles[candles.length - 2].timestamp;
    if (Number.isFinite(diff) && diff > 0) return diff;
  }
  return market === 'crypto' ? 3_600_000 : 86_400_000;
}

export interface RecordForecastInput {
  source: ForecastSource;
  asset: string;
  market: string;
  direction: ForecastDirection;
  probabilityUp?: number | null;
  referencePrice: number;
  predictedPrice?: number | null;
  expectedReturn?: number | null;
  horizonBars: number;
  barDurationMs: number;
  decisionId?: string | null;
  at?: number;
  metadata?: Record<string, unknown> | null;
}

const validProbability = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Best-effort persistence: a recording failure must never break the debate
 * or execution path that produced the forecast, so this never throws. */
export async function recordForecast(input: RecordForecastInput): Promise<any | null> {
  try {
    if (!input.asset || !['KRONOS', 'COUNCIL'].includes(input.source)
      || !['UP', 'DOWN', 'FLAT'].includes(input.direction)
      || !Number.isFinite(input.referencePrice) || input.referencePrice <= 0
      || !Number.isInteger(input.horizonBars) || input.horizonBars <= 0
      || !Number.isFinite(input.barDurationMs) || input.barDurationMs <= 0
      || typeof db.forecastRecord?.create !== 'function') {
      logger.warn('forecast_record_rejected', { asset: input?.asset, source: input?.source });
      return null;
    }
    const createdAt = new Date(Number.isFinite(input.at) ? (input.at as number) : Date.now());
    return await db.forecastRecord.create({
      data: {
        source: input.source,
        asset: input.asset,
        market: input.market,
        direction: input.direction,
        probabilityUp: validProbability(input.probabilityUp) ? input.probabilityUp : null,
        referencePrice: input.referencePrice,
        predictedPrice: Number.isFinite(input.predictedPrice as number) && (input.predictedPrice as number) > 0 ? input.predictedPrice : null,
        expectedReturn: Number.isFinite(input.expectedReturn as number) ? input.expectedReturn : null,
        horizonBars: input.horizonBars,
        barDurationMs: input.barDurationMs,
        maturesAt: new Date(createdAt.getTime() + input.horizonBars * input.barDurationMs),
        decisionId: input.decisionId ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (err: any) {
    logger.warn('forecast_record_failed', { asset: input?.asset, source: input?.source, error: err?.message || 'unknown' });
    return null;
  }
}

/** Persist one Kronos model forecast exactly as produced (direction from the
 * validated meanReturn; no probability is fabricated for Kronos). */
export async function recordKronosForecast(args: {
  asset: string; market: string; forecast: KronosForecast; referencePrice: number;
  barDurationMs: number; at?: number;
}): Promise<any | null> {
  const { forecast } = args;
  if (!forecast || !Array.isArray(forecast.predictedClose) || forecast.predictedClose.length === 0) return null;
  const last = forecast.predictedClose.length - 1;
  return recordForecast({
    source: 'KRONOS',
    asset: args.asset,
    market: args.market,
    direction: directionFromReturn(forecast.meanReturn),
    probabilityUp: null,
    referencePrice: args.referencePrice,
    predictedPrice: forecast.predictedClose[last],
    expectedReturn: forecast.meanReturn,
    horizonBars: forecast.predictedClose.length,
    barDurationMs: args.barDurationMs,
    at: args.at,
    metadata: { lowerBand: forecast.lowerBand?.[last] ?? null, upperBand: forecast.upperBand?.[last] ?? null },
  });
}

/** Persist the council's final call. BUY/SELL map stated confidence to
 * P(up); HOLD is FLAT with no directional probability. */
export async function recordCouncilForecast(args: {
  asset: string; market: string; decision: string; confidence: number;
  referencePrice: number; predictedPrice?: number | null; horizonBars: number;
  barDurationMs: number; decisionId?: string | null; at?: number;
  metadata?: Record<string, unknown> | null;
}): Promise<any | null> {
  const direction: ForecastDirection = args.decision === 'BUY' ? 'UP' : args.decision === 'SELL' ? 'DOWN' : 'FLAT';
  const confidence = Number.isFinite(args.confidence) ? Math.min(100, Math.max(0, args.confidence)) : null;
  const probabilityUp = confidence === null || direction === 'FLAT'
    ? null
    : direction === 'UP' ? confidence / 100 : 1 - confidence / 100;
  return recordForecast({
    source: 'COUNCIL',
    asset: args.asset,
    market: args.market,
    direction,
    probabilityUp,
    referencePrice: args.referencePrice,
    predictedPrice: args.predictedPrice ?? null,
    expectedReturn: null,
    horizonBars: args.horizonBars,
    barDurationMs: args.barDurationMs,
    decisionId: args.decisionId ?? null,
    at: args.at,
    metadata: { decision: args.decision, statedConfidence: confidence, ...(args.metadata ?? {}) },
  });
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export type RealizedPriceFetcher = (asset: string, market: string) => Promise<number | null>;

/** First price observed at or after maturity: the in-memory live price cache,
 * falling back to a fresh market snapshot. A missing price leaves the row
 * unscored — it is never replaced with an invented one. */
export const defaultRealizedPriceFetcher: RealizedPriceFetcher = async (asset, market) => {
  try {
    const marketData = await import('./marketData');
    const cached = marketData.getCurrentPrice(asset);
    if (cached && Number.isFinite(cached) && cached > 0) return cached;
    const snapshot = await marketData.buildMarketSnapshot(asset, market as 'crypto' | 'stocks');
    return snapshot?.price && Number.isFinite(snapshot.price) && snapshot.price > 0 ? snapshot.price : null;
  } catch { return null; }
};

export function scoreForecastRow(row: any, realizedPrice: number): {
  realizedPrice: number; realizedReturn: number; directionHit: boolean; brier: number | null;
} | null {
  const reference = Number(row?.referencePrice);
  if (!Number.isFinite(reference) || reference <= 0 || !Number.isFinite(realizedPrice) || realizedPrice <= 0) return null;
  const realizedReturn = (realizedPrice - reference) / reference;
  return {
    realizedPrice,
    realizedReturn,
    directionHit: directionFromReturn(realizedReturn) === row.direction,
    brier: validProbability(row.probabilityUp) ? brierScore(row.probabilityUp, realizedReturn > 0 ? 1 : 0) : null,
  };
}

/** Score every forecast whose horizon has matured and that has not been
 * scored yet. Idempotent: the update is guarded on scoredAt still being null. */
export async function scoreMaturedForecasts(
  fetchPrice: RealizedPriceFetcher = defaultRealizedPriceFetcher,
  now = Date.now(),
  limit = 200,
): Promise<{ scored: number; pending: number }> {
  if (typeof db.forecastRecord?.findMany !== 'function') return { scored: 0, pending: 0 };
  const rows: any[] = await db.forecastRecord.findMany({
    where: { maturesAt: { lte: new Date(now) }, scoredAt: null },
    orderBy: { maturesAt: 'asc' },
    take: limit,
  }).catch(() => []);
  let scored = 0;
  for (const row of rows) {
    const price = await fetchPrice(row.asset, row.market).catch(() => null);
    if (price === null) continue;
    const result = scoreForecastRow(row, price);
    if (!result) continue;
    const updated = await db.forecastRecord.updateMany({
      where: { id: row.id, scoredAt: null },
      data: { ...result, scoredAt: new Date(now) },
    }).catch(() => ({ count: 0 }));
    if (updated?.count) scored++;
  }
  return { scored, pending: rows.length - scored };
}

// ── Scorecard ────────────────────────────────────────────────────────────────

export interface ForecastScorecardGroup {
  recorded: number;
  scored: number;
  pending: number;
  hits: number;
  hitRate: number | null;
  brier: { n: number; mean: number | null };
  calibration: CalibrationBucket[];
}

export interface ForecastScorecard {
  generatedAt: string;
  windowDays: number | null;
  overall: ForecastScorecardGroup;
  bySource: Record<ForecastSource, ForecastScorecardGroup>;
}

const emptyGroup = (): ForecastScorecardGroup => ({
  recorded: 0, scored: 0, pending: 0, hits: 0, hitRate: null,
  brier: { n: 0, mean: null }, calibration: calibrationBuckets([]),
});

function summarize(rows: any[]): ForecastScorecardGroup {
  const scoredRows = rows.filter(r => r.scoredAt != null || r.directionHit != null);
  const hits = scoredRows.filter(r => r.directionHit === true).length;
  const brierValues = scoredRows.map(r => r.brier).filter((v: any) => typeof v === 'number' && Number.isFinite(v));
  const points = scoredRows
    .filter(r => validProbability(r.probabilityUp) && Number.isFinite(Number(r.realizedReturn)))
    .map(r => ({ p: Number(r.probabilityUp), outcome: Number(r.realizedReturn) > 0 ? 1 : 0 }));
  return {
    recorded: rows.length,
    scored: scoredRows.length,
    pending: rows.length - scoredRows.length,
    hits,
    hitRate: scoredRows.length ? hits / scoredRows.length : null,
    brier: {
      n: brierValues.length,
      mean: brierValues.length ? brierValues.reduce((a: number, b: number) => a + b, 0) / brierValues.length : null,
    },
    calibration: calibrationBuckets(points),
  };
}

/** Pure aggregation over ForecastRecord-shaped rows (fixtures welcome). */
export function computeForecastScorecard(rows: any[], opts: { days?: number; now?: number } = {}): ForecastScorecard {
  const bySource: Record<ForecastSource, ForecastScorecardGroup> = {
    KRONOS: summarize(rows.filter(r => r.source === 'KRONOS')),
    COUNCIL: summarize(rows.filter(r => r.source === 'COUNCIL')),
  };
  const overall = summarize(rows);
  // An empty source still reports its (empty) group so the shape is stable,
  // but groups with no rows collapse to the shared empty summary.
  if (!rows.some(r => r.source === 'KRONOS')) bySource.KRONOS = emptyGroup();
  if (!rows.some(r => r.source === 'COUNCIL')) bySource.COUNCIL = emptyGroup();
  return {
    generatedAt: new Date(opts.now ?? Date.now()).toISOString(),
    windowDays: opts.days ?? null,
    overall,
    bySource,
  };
}

export async function getForecastScorecard(opts: { days?: number; source?: string; asset?: string } = {}): Promise<ForecastScorecard> {
  const where: any = {};
  if (opts.days) where.createdAt = { gte: new Date(Date.now() - opts.days * 86_400_000) };
  if (opts.source) where.source = opts.source;
  if (opts.asset) where.asset = opts.asset;
  const rows: any[] = typeof db.forecastRecord?.findMany === 'function'
    ? await db.forecastRecord.findMany({ where, orderBy: { createdAt: 'asc' }, take: 20000 }).catch(() => [])
    : [];
  return computeForecastScorecard(rows || [], { days: opts.days });
}
