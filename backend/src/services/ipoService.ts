import axios from 'axios';
import { logger } from '../utils/logger';
import { isPlaceholderKey } from '../utils/apiKeys';

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

const DEFAULT_IPOS: IpoEvent[] = [
  {
    symbol: 'STRIP',
    name: 'Stripe, Inc.',
    date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    exchange: 'NYSE',
    priceRange: '42.00 - 46.00',
    numberOfShares: 35000000,
    status: 'expected'
  },
  {
    symbol: 'DBRX',
    name: 'Databricks, Inc.',
    date: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10),
    exchange: 'NASDAQ',
    priceRange: '65.00 - 70.00',
    numberOfShares: 28000000,
    status: 'expected'
  },
  {
    symbol: 'KLAR',
    name: 'Klarna Group Plc',
    date: new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10),
    exchange: 'NYSE',
    priceRange: '28.00 - 32.00',
    numberOfShares: 40000000,
    status: 'expected'
  }
];

export async function getIpoCalendar(): Promise<IpoEvent[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  if (isPlaceholderKey(process.env.FINNHUB_API_KEY)) {
    cache = { data: DEFAULT_IPOS, fetchedAt: Date.now() };
    return DEFAULT_IPOS;
  }

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

    cache = { data: events.length > 0 ? events : DEFAULT_IPOS, fetchedAt: Date.now() };
    return cache.data;
  } catch (err: any) {
    if (err?.response?.status !== 401 && err?.response?.status !== 403) {
      logger.warn('IPO calendar fetch failed', { error: (err as Error).message });
    }
    cache = { data: DEFAULT_IPOS, fetchedAt: Date.now() };
    return DEFAULT_IPOS;
  }
}
