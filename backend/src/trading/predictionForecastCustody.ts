import type { Prisma } from '@prisma/client';

/** Market-only publishers never acquire an account lock. A financial writer
 * acquires its account lock first, then this market lock, in one transaction.
 * The two-int advisory namespace is distinct from existing bigint account
 * locks. No provider I/O runs while holding either transaction lock. */
export async function lockPredictionForecastMarket(tx: any, venue: string, marketSlug: string) {
  if (venue !== 'polymarket_us' || !marketSlug || marketSlug.length > 256) throw new Error('FORECAST_MARKET_CUSTODY_INVALID');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(1347571526, hashtext(${venue + ':' + marketSlug}))`;
}

export async function publishPredictionForecast(db: any, data: Prisma.PolymarketPredictionUncheckedCreateInput) {
  return db.$transaction(async (tx: any) => {
    await lockPredictionForecastMarket(tx, data.venue, data.marketSlug);
    return tx.polymarketPrediction.create({ data });
  });
}

export async function resolvePredictionForecastMarket(db: any, venue: string, marketSlug: string, outcome: number) {
  if (!Number.isFinite(outcome) || outcome < 0 || outcome > 1) throw new Error('FORECAST_RESOLUTION_INVALID');
  return db.$transaction(async (tx: any) => {
    await lockPredictionForecastMarket(tx, venue, marketSlug);
    return tx.polymarketPrediction.updateMany({ where: { venue, marketSlug, outcome: null }, data: { outcome, resolvedAt: new Date() } });
  });
}
