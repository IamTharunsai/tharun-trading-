import axios from 'axios';
import { logger } from '../utils/logger';

export interface ComprehensiveStockInfo {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  marketCapTier: 'Mega' | 'Large' | 'Mid' | 'High-Beta';
}

// The hardcoded COMPREHENSIVE_US_STOCK_UNIVERSE list was removed — names now come
// from the dynamic universe service (Nasdaq screener + Alpaca).


export interface DetailedCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePct: number;
  isBullish: boolean;
  bodySize: number;
  wickUpper: number;
  wickLower: number;
  pattern: string;
}

export interface ChartAnalysisResult {
  symbol: string;
  name: string;
  currentPrice: number;
  change24h: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timeframe: string;
  candles: DetailedCandle[];
  levels: {
    entryPrice: number;
    stopLoss: number;
    stopLossDistance: number;
    stopLossPct: number;
    takeProfit1: number;
    takeProfit1GainPct: number;
    takeProfit2: number;
    takeProfit2GainPct: number;
    riskRewardRatio: string;
    vwap: number;
    pivotPoint: number;
    resistance1: number;
    resistance2: number;
    support1: number;
    support2: number;
  };
  indicators: {
    ema9: number;
    ema21: number;
    ema50: number;
    ema200: number;
    rsi14: number;
    atr14: number;
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
    confluenceScore: number;
  };
  patternsDetected: string[];
}

export async function fetchLiveStockChart(
  symbol: string,
  timeframe: string = '1D',
  range: string = '3mo'
): Promise<ChartAnalysisResult> {
  const cleanSymbol = symbol.toUpperCase().trim();
  
  // Map friendly timeframe to Yahoo Finance params
  let interval = '1d';
  let queryRange = range;

  switch (timeframe) {
    case '1m':
      interval = '1m';
      queryRange = '1d';
      break;
    case '5m':
      interval = '5m';
      queryRange = '5d';
      break;
    case '15m':
      interval = '15m';
      queryRange = '5d';
      break;
    case '1h':
    case '60m':
      interval = '1h';
      queryRange = '1mo';
      break;
    case '4h':
      interval = '1h'; // will aggregate or use 1h
      queryRange = '3mo';
      break;
    case '1D':
    case '1d':
      interval = '1d';
      queryRange = '6mo';
      break;
    case '1W':
    case '1wk':
      interval = '1wk';
      queryRange = '2y';
      break;
    default:
      interval = '1d';
      queryRange = '6mo';
  }

  let candles: DetailedCandle[] = [];
  let currentPrice = 100;
  let change24h = 0;
  let changePct24h = 0;
  let high24h = 100;
  let low24h = 100;
  let volume24h = 1000000;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${cleanSymbol}?interval=${interval}&range=${queryRange}`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 8000,
    });

    const result = res.data?.chart?.result?.[0];
    if (result && result.timestamp && result.indicators?.quote?.[0]) {
      const timestamps = result.timestamp;
      const quote = result.indicators.quote[0];
      const opens = quote.open || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const closes = quote.close || [];
      const volumes = quote.volume || [];

      for (let i = 0; i < timestamps.length; i++) {
        const o = opens[i];
        const h = highs[i];
        const l = lows[i];
        const c = closes[i];
        const v = volumes[i] || 0;

        // filter null or unrecorded ticks
        if (o == null || h == null || l == null || c == null) continue;

        const isBullish = c >= o;
        const change = c - o;
        const changePct = o > 0 ? (change / o) * 100 : 0;
        const bodySize = Math.abs(c - o);
        const wickUpper = h - Math.max(o, c);
        const wickLower = Math.min(o, c) - l;

        // Classify candlestick pattern
        let pattern = 'Standard';
        const totalRange = h - l;
        if (totalRange > 0) {
          const bodyRatio = bodySize / totalRange;
          if (bodyRatio < 0.08) {
            pattern = 'Doji (Indecision)';
          } else if (wickLower > bodySize * 2 && wickUpper < bodySize * 0.5) {
            pattern = isBullish ? 'Hammer (Bullish Reversal)' : 'Hanging Man (Warning)';
          } else if (wickUpper > bodySize * 2 && wickLower < bodySize * 0.5) {
            pattern = 'Shooting Star (Bearish Rejection)';
          } else if (bodyRatio > 0.85) {
            pattern = isBullish ? 'Marubozu (Strong Momentum)' : 'Bearish Marubozu';
          }
        }

        candles.push({
          timestamp: timestamps[i] * 1000,
          open: Number(o.toFixed(2)),
          high: Number(h.toFixed(2)),
          low: Number(l.toFixed(2)),
          close: Number(c.toFixed(2)),
          volume: v,
          change: Number(change.toFixed(2)),
          changePct: Number(changePct.toFixed(2)),
          isBullish,
          bodySize: Number(bodySize.toFixed(2)),
          wickUpper: Number(wickUpper.toFixed(2)),
          wickLower: Number(wickLower.toFixed(2)),
          pattern,
        });
      }

      if (candles.length > 0) {
        const last = candles[candles.length - 1];
        const prev = candles.length > 1 ? candles[candles.length - 2] : last;
        currentPrice = last.close;
        change24h = Number((last.close - prev.close).toFixed(2));
        changePct24h = Number(((change24h / prev.close) * 100).toFixed(2));
        high24h = Math.max(...candles.slice(-20).map(c => c.high));
        low24h = Math.min(...candles.slice(-20).map(c => c.low));
        volume24h = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0);
      }
    }
  } catch (err: any) {
    logger.warn(`Live market chart query failed for ${cleanSymbol}: ${err.message}`);
  }

  // Pure zero-mock policy: never fabricate random financial candles
  if (candles.length === 0) {
    logger.warn(`⚠️ Insufficient authentic bar data retrieved for ${cleanSymbol}; returning empty candle series with 0-state indicators`);
  }

  // ── Calculate Quantitative Technical Indicators ──────────────────────────────
  const closes = candles.map(c => c.close);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, Math.min(50, closes.length));
  const ema200 = calculateEMA(closes, Math.min(200, closes.length));
  const rsi14 = calculateRSI(closes, 14);
  const atr14 = calculateATR(candles, 14);

  // VWAP Calculation
  let cumulativeVP = 0;
  let cumulativeV = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    cumulativeVP += typical * c.volume;
    cumulativeV += c.volume;
  }
  const vwap = cumulativeV > 0 ? Number((cumulativeVP / cumulativeV).toFixed(2)) : currentPrice;

  // Pivot Points (Classic Floor Pivots)
  const lastCandle = candles[candles.length - 1];
  const pp = Number(((lastCandle.high + lastCandle.low + lastCandle.close) / 3).toFixed(2));
  const r1 = Number(((2 * pp) - lastCandle.low).toFixed(2));
  const s1 = Number(((2 * pp) - lastCandle.high).toFixed(2));
  const r2 = Number((pp + (lastCandle.high - lastCandle.low)).toFixed(2));
  const s2 = Number((pp - (lastCandle.high - lastCandle.low)).toFixed(2));

  // Dynamic ATR Stop-Loss & Take-Profit Levels (LAW 3: 2:1 & 3:1 R:R)
  const stopDistance = Number((atr14 * 2.0).toFixed(2));
  const stopLoss = Number((currentPrice - stopDistance).toFixed(2));
  const stopLossPct = Number(((stopDistance / currentPrice) * 100).toFixed(2));

  const tp1Distance = Number((stopDistance * 2.0).toFixed(2));
  const takeProfit1 = Number((currentPrice + tp1Distance).toFixed(2));
  const takeProfit1GainPct = Number(((tp1Distance / currentPrice) * 100).toFixed(2));

  const tp2Distance = Number((stopDistance * 3.0).toFixed(2));
  const takeProfit2 = Number((currentPrice + tp2Distance).toFixed(2));
  const takeProfit2GainPct = Number(((tp2Distance / currentPrice) * 100).toFixed(2));

  // Confluence & Trend Scoring
  const trend = ema9 > ema21 && currentPrice > ema50 ? 'BULLISH' : (ema9 < ema21 && currentPrice < ema50 ? 'BEARISH' : 'NEUTRAL');
  let signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' = 'HOLD';
  let confluenceScore = 50;

  if (trend === 'BULLISH') {
    confluenceScore += 20;
    if (rsi14 > 45 && rsi14 < 70) confluenceScore += 15;
    if (currentPrice > vwap) confluenceScore += 15;
    signal = confluenceScore >= 80 ? 'STRONG_BUY' : 'BUY';
  } else if (trend === 'BEARISH') {
    confluenceScore -= 20;
    if (rsi14 < 55) confluenceScore -= 15;
    if (currentPrice < vwap) confluenceScore -= 15;
    signal = confluenceScore <= 20 ? 'STRONG_SELL' : 'SELL';
  }

  // Find info name from universe
  const { universe } = await import('./universeService');
  const info = universe.get(cleanSymbol);
  const name = info ? info.name : cleanSymbol;

  // Detect recent candlestick patterns in the last 5 candles
  const patternsDetected: string[] = [];
  const recent = candles.slice(-5);
  for (const c of recent) {
    if (c.pattern && c.pattern !== 'Standard' && !patternsDetected.includes(c.pattern)) {
      patternsDetected.push(c.pattern);
    }
  }

  return {
    symbol: cleanSymbol,
    name,
    currentPrice,
    change24h,
    changePct24h,
    high24h,
    low24h,
    volume24h,
    timeframe,
    candles,
    levels: {
      entryPrice: currentPrice,
      stopLoss,
      stopLossDistance: stopDistance,
      stopLossPct,
      takeProfit1,
      takeProfit1GainPct,
      takeProfit2,
      takeProfit2GainPct,
      riskRewardRatio: '2.0x / 3.0x',
      vwap,
      pivotPoint: pp,
      resistance1: r1,
      resistance2: r2,
      support1: s1,
      support2: s2,
    },
    indicators: {
      ema9: Number(ema9.toFixed(2)),
      ema21: Number(ema21.toFixed(2)),
      ema50: Number(ema50.toFixed(2)),
      ema200: Number(ema200.toFixed(2)),
      rsi14: Number(rsi14.toFixed(1)),
      atr14: Number(atr14.toFixed(2)),
      trend,
      signal,
      confluenceScore,
    },
    patternsDetected,
  };
}

// Technical math helpers
function calculateEMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  if (data.length < period) return data[data.length - 1];
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateRSI(data: number[], period: number = 14): number {
  if (data.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateATR(candles: DetailedCandle[], period: number = 14): number {
  if (candles.length < 2) return 2.0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
}
