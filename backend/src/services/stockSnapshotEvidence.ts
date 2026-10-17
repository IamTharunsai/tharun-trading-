import axios from 'axios';
import { appConfig } from '../utils/config';
import { isPlaceholderKey } from '../utils/apiKeys';
import type { Candle } from '../agents/types';

const DAY = 86_400_000;
const record = (value: unknown): Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, any> : {};
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nyDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit' });
const nyDate = (time: number) => nyDayFormatter.format(time);
const observed = (value: unknown, now: number) => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || time > now || time < now - 8 * DAY) throw new Error('STOCK_OBSERVATION_UNAVAILABLE');
  return time;
};

/** Provider daily-bar timestamps are period starts, never a fabricated receipt time. */
export function parseCompletedStockBars(raw: unknown, now: number): Candle[] {
  if (!Array.isArray(raw) || raw.length > 2000) throw new Error('STOCK_HISTORY_INVALID');
  const today = nyDate(now);
  const bars: Candle[] = [];
  let previous = -Infinity;
  for (const value of raw) {
    const row = record(value), time = typeof row.t === 'string' ? Date.parse(row.t) : NaN;
    if (!Number.isFinite(time) || time <= previous || time > now || ![row.o, row.h, row.l, row.c].every(positive)
      || typeof row.v !== 'number' || !Number.isFinite(row.v) || row.v < 0
      || row.l > Math.min(row.o, row.c) || row.h < Math.max(row.o, row.c) || row.l > row.h) throw new Error('STOCK_HISTORY_INVALID');
    previous = time;
    // Never use today's still-changing daily aggregate as a completed indicator bar.
    if (nyDate(time) === today) continue;
    bars.push({ open: row.o, high: row.h, low: row.l, close: row.c, volume: row.v, timestamp: time });
  }
  if (bars.length < 200 || bars[bars.length - 1].timestamp < now - 8 * DAY) throw new Error('STOCK_HISTORY_INSUFFICIENT');
  return bars;
}

export function parseStockSnapshot(raw: unknown, now: number) {
  const snapshot = record(raw), trade = record(snapshot.latestTrade), quote = record(snapshot.latestQuote);
  const daily = record(snapshot.dailyBar), prior = record(snapshot.prevDailyBar);
  const priceObservedAt = observed(trade.t, now), quoteObservedAt = observed(quote.t, now);
  const dailyAt = observed(daily.t, now), priorAt = observed(prior.t, now);
  if (![trade.p, quote.bp, quote.ap, daily.h, daily.l, prior.c].every(positive)
    || quote.bp > quote.ap || daily.l > daily.h || dailyAt <= priorAt
    || typeof daily.v !== 'number' || !Number.isFinite(daily.v) || daily.v < 0) throw new Error('STOCK_SNAPSHOT_INVALID');
  const change = trade.p - prior.c;
  return { price: trade.p, priceChange24h: change, priceChangePct24h: change / prior.c * 100,
    volume24h: daily.v, high24h: daily.h, low24h: daily.l, bidPrice: quote.bp, askPrice: quote.ap,
    priceObservedAt, quoteObservedAt, dailyPeriodStartedAt: dailyAt, previousDailyPeriodStartedAt: priorAt };
}

/** Exact-symbol read from the active account's market-data credentials. No orders or cached-price substitute. */
export async function fetchAlpacaStockSnapshotEvidence(symbol: string, now = Date.now()) {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new Error('STOCK_SYMBOL_INVALID');
  const live = appConfig.ALPACA.activeMode === 'live';
  const key = live ? appConfig.ALPACA.liveApiKey : appConfig.ALPACA.paperApiKey;
  const secret = live ? appConfig.ALPACA.liveSecretKey : appConfig.ALPACA.paperSecretKey;
  if (isPlaceholderKey(key) || isPlaceholderKey(secret)) throw new Error('STOCK_DATA_NOT_CONFIGURED');
  const headers = { 'APCA-API-KEY-ID': key!, 'APCA-API-SECRET-KEY': secret! };
  const signal = AbortSignal.timeout(20_000);
  const request = { headers, timeout: 8000, signal, maxRedirects: 0, maxContentLength: 512_000 };
  const params = { symbols: symbol, timeframe: '1Day', start: new Date(now - 450 * DAY).toISOString(),
    end: new Date(now).toISOString(), adjustment: 'all', feed: 'iex', sort: 'asc', limit: 1000 };
  const [history, snapshot] = await Promise.all([
    axios.get('https://data.alpaca.markets/v2/stocks/bars', { ...request, params }),
    axios.get(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/snapshot`, { ...request, params: { feed: 'iex' } }),
  ]);
  const allBars: unknown[] = [];
  let page = record(history.data);
  const tokens = new Set<string>();
  for (let pages = 0; ; pages++) {
    const rows = record(page.bars)[symbol];
    if (!Array.isArray(rows)) throw new Error('STOCK_HISTORY_UNAVAILABLE');
    allBars.push(...rows);
    if (allBars.length > 2000) throw new Error('STOCK_HISTORY_TRUNCATED');
    const token = page.next_page_token;
    if (token == null) break;
    if (typeof token !== 'string' || !token || token.length > 4096 || tokens.has(token) || pages >= 1) throw new Error('STOCK_HISTORY_TRUNCATED');
    tokens.add(token);
    page = record((await axios.get('https://data.alpaca.markets/v2/stocks/bars', { ...request, params: { ...params, page_token: token } })).data);
  }
  const candles = parseCompletedStockBars(allBars, now);
  return { candles, ...parseStockSnapshot(snapshot.data, now), source: 'Alpaca IEX' as const,
    timeframe: '1Day' as const, receivedAt: Date.now(), requestedAt: now };
}
