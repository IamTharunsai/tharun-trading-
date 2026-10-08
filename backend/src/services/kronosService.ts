import axios from 'axios';
import { logger } from '../utils/logger';
import { z } from 'zod';

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
const candleSchema = z.object({
  open: z.number().finite().positive(), high: z.number().finite().positive(),
  low: z.number().finite().positive(), close: z.number().finite().positive(),
  volume: z.number().finite().nonnegative(), timestamp: z.number().finite().positive().max(8640000000000000),
}).refine(c => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.low <= c.high);
const forecastSchema = z.object({
  symbol: z.string(), predictedClose: z.array(z.number().finite().positive()),
  upperBand: z.array(z.number().finite().positive()), lowerBand: z.array(z.number().finite().positive()),
  meanReturn: z.number().finite(),
});

export function validateKronosForecast(raw: unknown, symbol: string, predLen: number, lastClose: number): KronosForecast | null {
  const result = forecastSchema.safeParse(raw);
  if (!result.success) return null;
  const forecast = result.data;
  if (forecast.symbol !== symbol || forecast.predictedClose.length !== predLen
    || forecast.upperBand.length !== predLen || forecast.lowerBand.length !== predLen) return null;
  for (let i = 0; i < predLen; i++) {
    if (forecast.lowerBand[i] > forecast.predictedClose[i] || forecast.predictedClose[i] > forecast.upperBand[i]) return null;
  }
  const actualReturn = (forecast.predictedClose[predLen - 1] - lastClose) / lastClose;
  if (!Number.isFinite(actualReturn) || Math.abs(actualReturn - forecast.meanReturn) > 1e-8) return null;
  return forecast;
}

export async function getForecast(symbol: string, candles: Candle[], predLen: number): Promise<KronosForecast | null> {
  // Source: https://github.com/colinhacks/zod/tree/v3.22.4#safeparse
  const input = candleSchema.array().min(3).max(512).safeParse(candles);
  if (!input.success || !/^[A-Za-z0-9.^$_/-]{1,32}$/.test(symbol)
    || !Number.isInteger(predLen) || predLen <= 0 || predLen > 256
    || input.data.some((c, i) => i > 0 && c.timestamp <= input.data[i - 1].timestamp)) {
    logger.warn('Kronos request rejected: invalid bars, symbol or horizon', { symbol });
    return null;
  }
  const baseUrl = process.env.KRONOS_SERVICE_URL;
  if (!baseUrl) {
    logger.warn('KRONOS_SERVICE_URL not set — skipping Kronos forecast');
    return null;
  }
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  } catch { return null; }

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
        const forecast = validateKronosForecast(response.data, symbol, predLen, input.data[input.data.length - 1].close);
        if (!forecast) logger.warn('Kronos response rejected: inconsistent symbol, bands, values or return', { symbol });
        return forecast;
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
