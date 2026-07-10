import axios from 'axios';
import { logger } from '../utils/logger';

export interface IpoEvent {
  symbol: string | null;
  name: string;
  date: string;
  exchange: string | null;
  priceRange: string | null;
  numberOfShares: number | null;
  status: string;
}

let cache: { data: IpoEvent[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // IPO calendars don't move minute to minute

export async function getIpoCalendar(): Promise<IpoEvent[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  try {
    const res = await axios.get('https://finnhub.io/api/v1/calendar/ipo', {
      params: { from, to, token: process.env.FINNHUB_API_KEY },
      timeout: 10000,
    });
    const events: IpoEvent[] = (res.data?.ipoCalendar || [])
      .filter((e: any) => e.symbol && e.status !== 'withdrawn')
      .map((e: any) => ({
        symbol: e.symbol,
        name: e.name,
        date: e.date,
        exchange: e.exchange,
        priceRange: e.price || null,
        numberOfShares: e.numberOfShares || null,
        status: e.status,
      }))
      .sort((a: IpoEvent, b: IpoEvent) => a.date.localeCompare(b.date));

    cache = { data: events, fetchedAt: Date.now() };
    return events;
  } catch (err) {
    logger.warn('IPO calendar fetch failed', { error: (err as Error).message });
    return cache?.data || [];
  }
}
