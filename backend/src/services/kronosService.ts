import axios from 'axios';
import { logger } from '../utils/logger';

interface Candle {
  open: number; high: number; low: number; close: number; volume: number; timestamp: number;
}

export interface KronosForecast {
  symbol: string;
  predictedClose: number[];
  upperBand: number[];
  lowerBand: number[];
  meanReturn: number;
}

const MAX_RETRIES = 2;

export async function getForecast(symbol: string, candles: Candle[], predLen: number): Promise<KronosForecast | null> {
  const baseUrl = process.env.KRONOS_SERVICE_URL;
  if (!baseUrl) {
    logger.warn('KRONOS_SERVICE_URL not set — skipping Kronos forecast');
    return null;
  }

  const ohlcv = candles.map(c => ({
    open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    timestamp: new Date(c.timestamp).toISOString(),
  }));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        `${baseUrl}/forecast`,
        { symbol, ohlcv, predLen },
        // Railway's private network resolves kronos-service.railway.internal
        // to both an IPv6 and an IPv4 address, but the IPv6 route gets
        // ECONNREFUSED (confirmed live via curl -v) while IPv4 works —
        // axios/Node's http client doesn't retry the other family on its own
        // the way curl's Happy Eyeballs fallback does, so force IPv4 directly.
        { timeout: 10000, family: 4 },
      );
      if (response.status === 200) {
        return response.data as KronosForecast;
      }
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        logger.error('Kronos forecast failed after retries', { symbol, err: (err as Error)?.message || err });
        return null;
      }
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}
