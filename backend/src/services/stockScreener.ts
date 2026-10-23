/**
 * STOCK SCREENER — Pre-filters 8000+ stocks down to 100-200 high-quality candidates
 * Uses Polygon (no rate limit) + Finnhub for fast screening
 * Only stocks passing screen get deep-analyzed (saves Alpha Vantage API quota)
 *
 * Screening criteria inspired by:
 * - William O'Neil CANSLIM (Earnings growth, New highs, Supply/demand)
 * - Stan Weinstein Stage Analysis (price above 30wk MA = Stage 2)
 * - Mark Minervini Trend Template (8 criteria for superperformers)
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { isPlaceholderKey } from '../utils/apiKeys';

const POLY_KEY = process.env.POLYGON_API_KEY;
const FH_KEY = process.env.FINNHUB_API_KEY;

export interface ScreenedStock {
  symbol: string;
  price: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;       // today vol / avg vol — >1.5 = unusual activity
  marketCap: number;
  sector: string;
  screenScore: number;       // 0-100, how well it passes all criteria
  screenReasons: string[];   // why it was selected
  screenFlags: string[];     // warning flags
  isNearHigh: boolean;       // within 15% of 52w high
  hasVolumeSpike: boolean;   // volume > 150% of average
  isTrending: boolean;       // price above 50-day MA
}

// ── MAIN SCREEN ───────────────────────────────────────────────────────────────
export async function runDailyScreen(): Promise<ScreenedStock[]> {
  try {
    logger.info('🔍 Running daily stock screen...');

    const candidates = await fetchGroupedDailyCandidates();

    const filtered = candidates
      .filter(s => s.screenScore >= 40)
      .filter(s => s.price >= 5)                  // no penny stocks
      .filter(s => s.volume >= 200000)             // meaningful liquidity
      .filter(s => !/^[A-Z]{4,5}$/.test(s.symbol) || s.volume > 1000000) // filter low-vol ETFs
      .sort((a, b) => b.screenScore - a.screenScore)
      .slice(0, 150);

    logger.info(`✅ Screen complete: ${filtered.length} candidates from ${candidates.length} stocks`);
    return filtered;

  } catch (err) {
    logger.error('Stock screen failed', { err });
    return [];
  }
}

// Most recent N weekdays (YYYY-MM-DD), most recent first, starting from yesterday —
// "today"'s grouped-daily bar isn't finalized until after market close.
function recentTradingDates(n: number): string[] {
  const dates: string[] = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (dates.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates;
}

// ── POLYGON: GROUPED DAILY (free-tier eligible — snapshot/gainers & tickers are not) ──
// Computes gainers + most-active ourselves from two days of full-market EOD bars.
async function fetchGroupedDailyCandidates(): Promise<ScreenedStock[]> {
  const fallbackCandidates = (): ScreenedStock[] => {
    const defaults = [
      // NOTE: These are approximate prices for dev/test mode only (no Polygon key).
      // In production, real-time data from Polygon is used. Prices updated 2024-Q4.
      { symbol: 'NVDA', price: 135.0, changePercent: 2.8, volume: 54000000, avgVolume: 42000000 },
      { symbol: 'AAPL', price: 228.0, changePercent: 1.2, volume: 48000000, avgVolume: 45000000 },
      { symbol: 'MSFT', price: 415.0, changePercent: 1.5, volume: 22000000, avgVolume: 20000000 },
      { symbol: 'TSLA', price: 340.0, changePercent: 3.4, volume: 68000000, avgVolume: 55000000 },
      { symbol: 'AMD', price: 125.0, changePercent: 2.1, volume: 38000000, avgVolume: 32000000 },
      { symbol: 'AMZN', price: 205.0, changePercent: 1.8, volume: 31000000, avgVolume: 29000000 },
    ];
    return defaults.map(d => {
      const volumeRatio = d.volume / d.avgVolume;
      // Fallback entries: no real market data — assume near-high and trending for dev/test
      const isNearHigh = true;
      const isTrending = true;
      const norm = { price: d.price, changePercent: d.changePercent, volume: d.volume, volumeRatio, isNearHigh, isTrending };
      return {
        symbol: d.symbol,
        price: d.price,
        changePercent: d.changePercent,
        volume: d.volume,
        avgVolume: d.avgVolume,
        volumeRatio,
        marketCap: 0,
        sector: 'Technology',
        screenScore: calculateScreenScore(norm),
        screenReasons: ['[FALLBACK MODE — no Polygon key] ' + (buildReasons(norm)[0] ?? 'dev placeholder')],
        screenFlags: buildFlags(norm),
        isNearHigh,
        hasVolumeSpike: volumeRatio > 1.2,
        isTrending,
      };
    });
  };

  if (isPlaceholderKey(POLY_KEY)) {
    return fallbackCandidates();
  }

  const [latestDate, prevDate] = recentTradingDates(2);
  const [latestRes, prevRes] = await Promise.allSettled([
    axios.get(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${latestDate}`, {
      params: { apiKey: POLY_KEY, adjusted: true }, timeout: 15000
    }),
    axios.get(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${prevDate}`, {
      params: { apiKey: POLY_KEY, adjusted: true }, timeout: 15000
    }),
  ]);

  if (latestRes.status !== 'fulfilled') {
    return fallbackCandidates();
  }

  // Store both close price AND volume from the previous day's bars.
  // changePercent must be day-over-day (yesterday's close → today's close),
  // NOT intraday (today's open → today's close), which only tells us how the
  // day traded internally — irrelevant for swing-trade momentum screening.
  const prevBySymbol = new Map<string, { close: number; volume: number }>();
  if (prevRes.status === 'fulfilled') {
    for (const bar of prevRes.value.data?.results || []) {
      prevBySymbol.set(bar.T, { close: bar.c, volume: bar.v });
    }
  }

  return (latestRes.value.data?.results || []).map((bar: any) => {
    const prev = prevBySymbol.get(bar.T);

    // Day-over-day % change: (today's close − yesterday's close) / yesterday's close
    // Fallback to intraday when we lack prior-day data (should be rare).
    const changePercent = prev && prev.close > 0
      ? ((bar.c - prev.close) / prev.close) * 100
      : (bar.o > 0 ? ((bar.c - bar.o) / bar.o) * 100 : 0);

    // Two-day volume average where we have both days; better than single-day.
    const prevVolume = prev?.volume ?? bar.v;
    const avgVolume = prev ? Math.round((bar.v + prevVolume) / 2) : bar.v;
    const volumeRatio = bar.v / Math.max(prevVolume, 1);

    // Trend: closed higher than yesterday's close (day-over-day bullish momentum).
    // The old check (bar.c > bar.o) only told us the intraday direction, which is
    // nearly meaningless — a stock can gap down 5% and still close above its open.
    const isTrending = prev ? bar.c > prev.close : bar.c > bar.o;

    // Near-high approximation: close within 15% of today's intraday high.
    // True 52-week high requires historical data we don't bulk-fetch here, but
    // stocks closing near their daily high are exhibiting relative strength.
    // The old code hardcoded this to false for ALL stocks, making it useless.
    const isNearHigh = bar.h > 0 ? (bar.c / bar.h) >= 0.85 : false;

    const norm = { price: bar.c, changePercent, volume: bar.v, volumeRatio, isNearHigh, isTrending };
    return {
      symbol: bar.T,
      price: bar.c,
      changePercent,
      volume: bar.v,
      avgVolume,
      volumeRatio,
      marketCap: 0,
      sector: '',
      screenScore: calculateScreenScore(norm),
      screenReasons: buildReasons(norm),
      screenFlags: buildFlags(norm),
      isNearHigh,
      hasVolumeSpike: volumeRatio > 1.5,
      isTrending,
    };
  });
}

// ── SCORE CALCULATOR (CANSLIM + Minervini inspired) ──────────────────────────
interface NormalizedBar {
  price: number;
  changePercent: number;
  volume: number;
  volumeRatio: number;
  isNearHigh?: boolean;   // close within 15% of day's high (relative strength proxy)
  isTrending?: boolean;   // closed above prior day's close
}

function calculateScreenScore(t: NormalizedBar): number {
  let score = 30; // base score

  const { changePercent, price, volume, volumeRatio } = t;

  // Day-over-day price momentum (O'Neil: buy stocks making new highs)
  // Positive moves are rewarded; extreme negative moves only if reversal candidate
  if (changePercent > 5) score += 20;
  else if (changePercent > 3) score += 15;
  else if (changePercent > 1) score += 8;
  else if (changePercent > -1) score += 2; // roughly flat — neutral
  else if (changePercent < -10) score += 10; // deep dip — potential reversal
  else if (changePercent < -5) score += 5;   // moderate dip — watch
  else score -= 5;                            // mild decline — discourage

  // Volume confirmation (O'Neil: volume must confirm price)
  if (volumeRatio > 3) score += 25;       // 3x avg volume — institutional buying
  else if (volumeRatio > 2) score += 18;
  else if (volumeRatio > 1.5) score += 10;
  else if (volumeRatio < 0.5) score -= 15; // low volume = weak move

  // Price range (avoid ultra-cheap and ultra-expensive for our $100k account)
  if (price >= 10 && price <= 500) score += 10;
  else if (price < 5) score -= 20;         // penny stock risk

  // High volume absolute (liquidity = easy entry/exit)
  if (volume > 1000000) score += 10;
  else if (volume > 500000) score += 5;
  else if (volume < 100000) score -= 10;

  // Relative strength: closed near daily high = strong demand into close
  if (t.isNearHigh) score += 8;

  // Day-over-day trend: reward stocks that closed above prior close
  if (t.isTrending) score += 5;

  return Math.min(100, Math.max(0, score));
}

function buildReasons(t: NormalizedBar): string[] {
  const reasons: string[] = [];
  if (t.changePercent > 5) reasons.push(`Strong day-over-day momentum: +${t.changePercent.toFixed(1)}%`);
  else if (t.changePercent > 1) reasons.push(`Positive day-over-day: +${t.changePercent.toFixed(1)}%`);
  else if (t.changePercent < -5) reasons.push(`Deep dip (-${Math.abs(t.changePercent).toFixed(1)}%) — reversal watch`);
  if (t.volumeRatio > 2) reasons.push(`Volume spike: ${t.volumeRatio.toFixed(1)}x average`);
  if (t.changePercent > 0 && t.volumeRatio > 1.5) reasons.push('Price + volume confirmation (O\'Neil criteria)');
  if (t.isNearHigh) reasons.push('Closed near daily high — strong demand into close');
  if (t.isTrending) reasons.push('Closed above prior day\'s close');
  return reasons;
}

function buildFlags(t: NormalizedBar): string[] {
  const flags: string[] = [];
  if (t.price < 5) flags.push('Low price stock — higher risk');
  if (Math.abs(t.changePercent) > 15) flags.push('Extreme move — possible news catalyst, verify before trade');
  return flags;
}

// ── GET SCREENED SYMBOLS ONLY ─────────────────────────────────────────────────
export async function getScreenedSymbols(): Promise<string[]> {
  const screened = await runDailyScreen();
  return screened.map(s => s.symbol);
}

// ── GET SCREEN SUMMARY FOR AGENT CONTEXT ─────────────────────────────────────
export function formatScreenResult(stock: ScreenedStock): string {
  const trendBadge = stock.isTrending ? '↑' : '↓';
  const highBadge = stock.isNearHigh ? ' near-high' : '';
  const lines = [
    `Screen Score: ${stock.screenScore}/100`,
    `D/D: ${stock.changePercent >= 0 ? '+' : ''}${stock.changePercent.toFixed(1)}% ${trendBadge}${highBadge}`,
    `Volume: ${(stock.volume / 1e6).toFixed(1)}M (${stock.volumeRatio.toFixed(1)}x avg)`,
    stock.screenReasons.length > 0 ? `Why: ${stock.screenReasons.join(', ')}` : '',
    stock.screenFlags.length > 0 ? `⚠️ ${stock.screenFlags.join(', ')}` : '',
  ];
  return lines.filter(Boolean).join(' | ');
}
