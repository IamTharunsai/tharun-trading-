import axios from 'axios';
import { isPlaceholderKey } from '../utils/apiKeys';

export interface HistoricalBar {
  /** Earliest availability of this completed bar, not its opening time. */
  timestamp: number;
  openTime: number;
  open: number; high: number; low: number; close: number; volume: number;
}
const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Input must be ordered by completed-bar availability, as enforced by the loader. */
export function latestCompletedBar<T extends { timestamp: number }>(bars: readonly T[], at: number): T | null {
  let low = 0, high = bars.length - 1, found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (bars[middle].timestamp <= at) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return found >= 0 ? bars[found] : null;
}

export function historicalRange(startDate: string, endDate: string): { start: number; end: number } {
  const parse = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Historical dates must use YYYY-MM-DD');
    const value = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Invalid historical date');
    return value;
  };
  const start = parse(startDate), end = parse(endDate) + DAY;
  if (end <= start || end - start > 366 * DAY) throw new Error('Historical range must contain 1–366 days');
  if (end > Date.now()) throw new Error('Historical end date must be a completed UTC day');
  return { start, end };
}

function validateBars(bars: HistoricalBar[], start: number, end: number): HistoricalBar[] {
  if (!bars.length) throw new Error('No completed historical bars in requested range');
  let previous = -Infinity;
  for (const bar of bars) {
    if (![bar.timestamp, bar.openTime, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      || bar.openTime < start || bar.timestamp > end || bar.timestamp <= bar.openTime
      || bar.openTime <= previous || bar.open <= 0 || bar.close <= 0 || bar.low <= 0
      || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)
      || bar.high < bar.low || bar.volume < 0) throw new Error('Malformed, duplicate or unordered historical bars');
    previous = bar.openTime;
  }
  return bars;
}

/** Bounded, dated provider reads. Missing/provider-error data never becomes invented prices. */
export async function fetchHistoricalBars(symbol: string, startDate: string, endDate: string): Promise<HistoricalBar[]> {
  const { start, end } = historicalRange(startDate, endDate);
  const bars: HistoricalBar[] = [];
  if (/^[A-Z0-9]{2,15}\/[A-Z0-9]{2,10}$/.test(symbol)) {
    let cursor = start;
    for (let page = 0; cursor < end && page < 10; page++) {
      const response = await axios.get('https://api.binance.com/api/v3/klines', {
        params: { symbol: symbol.replace('/', ''), interval: '1h', startTime: cursor, endTime: end - 1, limit: 1000 },
        timeout: 10000, maxContentLength: 2 * 1024 * 1024,
      });
      if (!Array.isArray(response.data)) throw new Error('Malformed Binance history response');
      if (!response.data.length) break;
      const pageBars = response.data.map((k: unknown) => {
        if (!Array.isArray(k) || k.length < 7) throw new Error('Malformed Binance kline');
        const openTime = Number(k[0]), completedAt = Number(k[6]) + 1;
        if (completedAt !== openTime + HOUR) throw new Error('Unexpected hourly Binance bar duration');
        return { openTime, timestamp: completedAt, open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) };
      });
      if (pageBars[0].openTime < cursor) throw new Error('Historical pagination failed to advance');
      bars.push(...pageBars);
      const next = pageBars[pageBars.length - 1].timestamp;
      if (!Number.isFinite(next) || next <= cursor) throw new Error('Historical pagination failed to advance');
      cursor = next;
      if (pageBars.length < 1000) break;
    }
    if (bars.length >= 10000 && bars[bars.length - 1].timestamp < end) throw new Error('Historical pagination limit exceeded');
  } else {
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new Error('Unsupported historical symbol');
    const apiKey = process.env.POLYGON_API_KEY;
    if (isPlaceholderKey(apiKey)) throw new Error('Stock history provider is not configured');
    // Monthly windows stay below the provider's 50,000 base-minute aggregate
    // limit for hour bars. Reject truncation rather than following arbitrary URLs.
    for (let cursor = start; cursor < end; cursor += 30 * DAY) {
      const chunkEnd = Math.min(end, cursor + 30 * DAY);
      const response = await axios.get(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/hour/${cursor}/${chunkEnd - 1}`, {
        params: { apiKey, adjusted: true, sort: 'asc', limit: 50000 }, timeout: 10000, maxContentLength: 2 * 1024 * 1024,
      });
      if (response.data?.next_url) throw new Error('Stock history response truncated');
      if (response.data?.status === 'ERROR' || response.data?.status === 'NOT_AUTHORIZED') throw new Error('Stock history provider rejected request');
      if (!Array.isArray(response.data?.results)) throw new Error('Stock history missing results');
      for (const b of response.data.results) {
        const openTime = Number(b.t);
        if (openTime < cursor || openTime + HOUR > chunkEnd) throw new Error('Stock provider returned bars outside requested window');
        bars.push({ openTime, timestamp: openTime + HOUR, open: Number(b.o), high: Number(b.h), low: Number(b.l), close: Number(b.c), volume: Number(b.v) });
      }
    }
  }
  return validateBars(bars, start, end);
}
