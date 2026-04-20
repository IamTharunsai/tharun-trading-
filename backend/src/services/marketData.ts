import WebSocket from 'ws';
import axios from 'axios';
import { logger } from '../utils/logger';
import { redis } from '../utils/redis';
import { getIO } from '../websocket/server';
import { MarketSnapshot, Candle, TechnicalIndicators } from '../agents/types';

// Base crypto assets (Binance WebSocket streams)
export const CRYPTO_ASSETS = [
  'BTC','ETH','SOL','BNB','ADA','AVAX','LINK','DOT','UNI','MATIC',
  'XRP','DOGE','SHIB','LTC','BCH','ATOM','FIL','NEAR','APT','ARB',
  'OP','INJ','SUI','SEI','TIA','PYTH','JTO','BONK','WIF','PEPE'
];

// Fallback stock list — replaced at runtime by fetchAllAlpacaAssets()
export let STOCK_ASSETS: string[] = [
  'AAPL','MSFT','NVDA','TSLA','GOOGL','AMZN','META','SPY','QQQ',
  'AMD','INTC','NFLX','DIS','BABA','JPM','BAC','GS','V','MA',
  'PYPL','SQ','COIN','HOOD','PLTR','SOFI','RIVN','LCID','NIO','XPEV'
];

// Full list fetched from Alpaca — all active tradeable US equities
let allAlpacaAssets: string[] = [];
let assetRotationIndex = 0;

export async function fetchAllAlpacaAssets(): Promise<string[]> {
  if (!process.env.ALPACA_API_KEY) return STOCK_ASSETS;
  try {
    const res = await axios.get(`${process.env.ALPACA_BASE_URL}/v2/assets`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
      },
      params: { status: 'active', asset_class: 'us_equity', tradable: true },
      timeout: 15000
    });
    const symbols: string[] = res.data
      .filter((a: any) => a.tradable && a.fractionable !== false && !a.symbol.includes('/'))
      .map((a: any) => a.symbol);
    allAlpacaAssets = symbols;
    logger.info(`📋 Loaded ${symbols.length} tradeable US stocks from Alpaca`);
    return symbols;
  } catch (err) {
    logger.warn('Could not fetch Alpaca asset list — using default stocks', { err });
    return STOCK_ASSETS;
  }
}

// Returns next batch of stocks to analyze (rotates through ALL listed stocks)
export function getNextStockBatch(batchSize = 5): string[] {
  const list = allAlpacaAssets.length > 0 ? allAlpacaAssets : STOCK_ASSETS;
  const batch: string[] = [];
  for (let i = 0; i < batchSize; i++) {
    batch.push(list[assetRotationIndex % list.length]);
    assetRotationIndex++;
  }
  return batch;
}

export function getTotalStockCount(): number {
  return allAlpacaAssets.length || STOCK_ASSETS.length;
}

const latestPrices: Record<string, number> = {};
let binanceWs: WebSocket | null = null;

export async function initMarketData() {
  await connectBinanceWebSocket();
  await fetchInitialStockPrices();
  await fetchAllAlpacaAssets();
  logger.info('✅ Market data service initialized');
}

function connectBinanceWebSocket() {
  return new Promise<void>((resolve) => {
    const streams = CRYPTO_ASSETS.map(a => `${a.toLowerCase()}usdt@ticker`).join('/');
    const wsUrl = `wss://stream.binance.us:9443/stream?streams=${streams}`;

    // Always resolve after 10s — never block boot if Binance is unreachable
    const bootTimer = setTimeout(() => {
      logger.warn('⚠️ Binance WS did not connect within 10s — continuing without live crypto prices');
      resolve();
    }, 10000);

    binanceWs = new WebSocket(wsUrl);

    binanceWs.on('open', () => {
      clearTimeout(bootTimer);
      logger.info('📡 Binance WebSocket connected');
      resolve();
    });

    binanceWs.on('message', async (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        const ticker = msg.data;
        if (!ticker) return;

        const symbol = ticker.s.replace('USDT', '');
        const price = parseFloat(ticker.c);
        latestPrices[symbol] = price;

        const priceUpdate = {
          asset: symbol,
          price,
          change24h: parseFloat(ticker.P),
          volume24h: parseFloat(ticker.v),
          high24h: parseFloat(ticker.h),
          low24h: parseFloat(ticker.l),
          timestamp: Date.now()
        };

        await redis.setex(`price:${symbol}`, 60, JSON.stringify(priceUpdate));
        getIO()?.emit('price:update', priceUpdate);
      } catch (_) {}
    });

    binanceWs.on('error', (error) => {
      clearTimeout(bootTimer);
      logger.warn('Binance WS error — continuing without live crypto prices', { error: error.message });
      resolve(); // never crash boot on WS error
    });

    binanceWs.on('close', () => {
      logger.warn('Binance WS closed — reconnecting in 5s');
      setTimeout(connectBinanceWebSocket, 5000);
    });
  });
}

async function fetchInitialStockPrices() {
  if (!process.env.POLYGON_API_KEY) return;
  const today = new Date();
  // Use previous trading day (skip weekends)
  const day = today.getDay();
  const offset = day === 0 ? 2 : day === 1 ? 3 : 1;
  const prev = new Date(today);
  prev.setDate(prev.getDate() - offset);
  const dateStr = prev.toISOString().slice(0, 10);
  try {
    for (const symbol of STOCK_ASSETS) {
      try {
        const res = await axios.get(
          `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${dateStr}/${dateStr}`,
          { params: { apiKey: process.env.POLYGON_API_KEY, adjusted: true }, timeout: 5000 }
        );
        const bar = res.data?.results?.[0];
        if (bar?.c) latestPrices[symbol] = bar.c;
        await new Promise(r => setTimeout(r, 200)); // free tier: 5 req/min
      } catch { /* skip individual failures */ }
    }
    logger.info(`📈 Initial stock prices loaded for ${Object.keys(latestPrices).length} symbols`);
  } catch (error) { logger.warn('Stock price fetch failed', { error }); }
}

export function getCurrentPrices(): Record<string, number> {
  return { ...latestPrices };
}

export function getCurrentPrice(asset: string): number | null {
  return latestPrices[asset] || null;
}

// Alias for backward compatibility
export async function getMarketSnapshot(asset: string, market: 'crypto' | 'stocks' | 'forex'): Promise<MarketSnapshot | null> {
  return buildMarketSnapshot(asset, market);
}

export async function buildMarketSnapshot(asset: string, market: 'crypto' | 'stocks' | 'forex'): Promise<MarketSnapshot | null> {
  try {
    let candles: Candle[] = [];
    let priceData: any = {};

    if (market === 'crypto') {
      // Fetch candles from Binance
      const res = await axios.get(`https://api.binance.us/api/v3/klines`, {
        params: { symbol: `${asset}USDT`, interval: '1h', limit: 50 },
        timeout: 8000
      });
      candles = res.data.map((k: any[]) => ({
        open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]),
        volume: parseFloat(k[5]), timestamp: k[0]
      }));

      const tickerRes = await axios.get(`https://api.binance.us/api/v3/ticker/24hr`, {
        params: { symbol: `${asset}USDT` }, timeout: 5000
      });
      priceData = {
        price: parseFloat(tickerRes.data.lastPrice),
        priceChange24h: parseFloat(tickerRes.data.priceChange),
        priceChangePct24h: parseFloat(tickerRes.data.priceChangePercent),
        volume24h: parseFloat(tickerRes.data.volume),
        high24h: parseFloat(tickerRes.data.highPrice),
        low24h: parseFloat(tickerRes.data.lowPrice),
        bidPrice: parseFloat(tickerRes.data.bidPrice || tickerRes.data.lastPrice),
        askPrice: parseFloat(tickerRes.data.askPrice || tickerRes.data.lastPrice),
      };
    } else {
      // Fetch real stock candles from Polygon (daily, last 60 days)
      const toDate = new Date().toISOString().slice(0, 10);
      const fromDate = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const candleRes = await axios.get(
        `https://api.polygon.io/v2/aggs/ticker/${asset}/range/1/day/${fromDate}/${toDate}`,
        { params: { adjusted: true, sort: 'asc', limit: 60, apiKey: process.env.POLYGON_API_KEY }, timeout: 10000 }
      );
      if (candleRes.data?.results?.length > 5) {
        candles = candleRes.data.results.map((r: any) => ({
          open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v, timestamp: r.t
        }));
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const change = last.close - prev.close;
        priceData = {
          price: last.close,
          priceChange24h: change,
          priceChangePct24h: (change / prev.close) * 100,
          volume24h: last.volume,
          high24h: last.high,
          low24h: last.low,
          bidPrice: last.close,
          askPrice: last.close,
        };
        latestPrices[asset] = last.close;
      } else {
        // Fallback to cached price if candles unavailable
        const cached = await redis.get(`price:${asset}`);
        if (!cached && !latestPrices[asset]) return null;
        const p = cached ? JSON.parse(cached) : { price: latestPrices[asset], change24h: 0 };
        priceData = { price: p.price, priceChange24h: 0, priceChangePct24h: p.change24h || 0, volume24h: p.volume24h || 0, high24h: p.price, low24h: p.price, bidPrice: p.price, askPrice: p.price };
        candles = generateMockCandles(priceData.price, 50);
      }
    }

    const indicators = calculateIndicators(candles, priceData.volume24h);

    return {
      asset, market,
      ...priceData,
      volumeChange: 0,
      spread: Math.abs(priceData.askPrice - priceData.bidPrice),
      candles,
      indicators,
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error(`Failed to build snapshot for ${asset}`, { error });
    return null;
  }
}

function calculateIndicators(candles: Candle[], volume24h: number): TechnicalIndicators {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const sma50 = calculateSMA(closes, Math.min(50, closes.length));
  const sma200 = calculateSMA(closes, Math.min(200, closes.length));
  const volumeAvg20 = calculateSMA(volumes, Math.min(20, volumes.length));
  const currentPrice = closes[closes.length - 1];
  const currentVol = volumes[volumes.length - 1];

  // 52-week high/low (use all available candles)
  const week52High = Math.max(...highs);
  const week52Low = Math.min(...lows);

  // VWAP (volume weighted average price — last 20 candles)
  const vwapCandles = candles.slice(-20);
  const vwap = vwapCandles.reduce((sum, c) => sum + ((c.high + c.low + c.close) / 3) * c.volume, 0) /
    Math.max(vwapCandles.reduce((s, c) => s + c.volume, 0), 1);

  // Fibonacci retracements from 52-week range
  const range = week52High - week52Low;
  const fibonacci = {
    r236: week52High - range * 0.236,
    r382: week52High - range * 0.382,
    r500: week52High - range * 0.500,
    r618: week52High - range * 0.618,
    r786: week52High - range * 0.786,
  };

  return {
    rsi14: calculateRSI(closes, 14),
    macd: calculateMACD(closes),
    bollingerBands: calculateBollinger(closes, 20),
    ema9: calculateEMA(closes, 9),
    ema21: calculateEMA(closes, 21),
    ema200: calculateEMA(closes, Math.min(200, closes.length)),
    sma50,
    sma200,
    atr14: calculateATR(candles, 14),
    obv: calculateOBV(closes, volumes),
    stochasticK: calculateStochastic(candles, 14).k,
    stochasticD: calculateStochastic(candles, 14).d,
    volumeAvg20,
    vwap,
    fibonacci,
    week52High,
    week52Low,
    distanceFrom52wHigh: ((week52High - currentPrice) / week52High) * 100,
    isAboveSma50: currentPrice > sma50,
    isAboveSma200: currentPrice > sma200,
    isSma50AboveSma200: sma50 > sma200,
    volumeRatio: volumeAvg20 > 0 ? currentVol / volumeAvg20 : 1,
  };
}

function calculateRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateMACD(closes: number[]): { value: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const value = ema12 - ema26;
  const signal = value * 0.2; // simplified
  return { value, signal, histogram: value - signal };
}

function calculateBollinger(closes: number[], period: number): { upper: number; middle: number; lower: number } {
  const middle = calculateSMA(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return { upper: middle + 2 * stdDev, middle, lower: middle - 2 * stdDev };
}

function calculateATR(candles: Candle[], period: number): number {
  const trs = candles.slice(-period).map((c, i, arr) => {
    if (i === 0) return c.high - c.low;
    const prevClose = arr[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function calculateOBV(closes: number[], volumes: number[]): number {
  return closes.reduce((obv, close, i) => {
    if (i === 0) return obv;
    return close > closes[i - 1] ? obv + volumes[i] : close < closes[i - 1] ? obv - volumes[i] : obv;
  }, 0);
}

function calculateStochastic(candles: Candle[], period: number): { k: number; d: number } {
  const slice = candles.slice(-period);
  const highestHigh = Math.max(...slice.map(c => c.high));
  const lowestLow = Math.min(...slice.map(c => c.low));
  const currentClose = slice[slice.length - 1].close;
  const k = highestHigh !== lowestLow ? ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100 : 50;
  return { k, d: k * 0.9 };
}

function generateMockCandles(basePrice: number, count: number): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * price * 0.02;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.005);
    const low = Math.min(open, close) * (1 - Math.random() * 0.005);
    candles.push({ open, high, low, close, volume: Math.random() * 1000000, timestamp: Date.now() - (count - i) * 3600000 });
    price = close;
  }
  return candles;
}
