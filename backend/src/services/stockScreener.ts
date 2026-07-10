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
    logger.warn('Grouped-daily screen fetch failed', { error: (latestRes as PromiseRejectedResult).reason?.message });
    return [];
  }

  const prevBySymbol = new Map<string, number>();
  if (prevRes.status === 'fulfilled') {
    for (const bar of prevRes.value.data?.results || []) prevBySymbol.set(bar.T, bar.v);
  }

  return (latestRes.value.data?.results || []).map((bar: any) => {
    const prevBarVolume = prevBySymbol.get(bar.T);
    const prevVolume = prevBarVolume !== undefined ? prevBarVolume : bar.v;
    const changePercent = bar.o > 0 ? ((bar.c - bar.o) / bar.o) * 100 : 0;
    const volumeRatio = bar.v / Math.max(prevVolume, 1);
    const norm = { price: bar.c, changePercent, volume: bar.v, volumeRatio };
    return {
      symbol: bar.T,
      price: bar.c,
      changePercent,
      volume: bar.v,
      avgVolume: prevVolume,
      volumeRatio,
      marketCap: 0,
      sector: '',
      screenScore: calculateScreenScore(norm),
      screenReasons: buildReasons(norm),
      screenFlags: buildFlags(norm),
      isNearHigh: false,
      hasVolumeSpike: volumeRatio > 1.5,
      isTrending: bar.c > bar.o,
    };
  });
}

// ── SCORE CALCULATOR (CANSLIM + Minervini inspired) ──────────────────────────
interface NormalizedBar { price: number; changePercent: number; volume: number; volumeRatio: number; }

function calculateScreenScore(t: NormalizedBar): number {
  let score = 30; // base score

  const { changePercent, price, volume, volumeRatio } = t;

  // Price momentum (O'Neil: buy stocks making new highs)
  if (changePercent > 5) score += 20;
  else if (changePercent > 3) score += 15;
  else if (changePercent > 1) score += 8;
  else if (changePercent < -5) score += 15; // potential reversal / short

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

  return Math.min(100, Math.max(0, score));
}

function buildReasons(t: NormalizedBar): string[] {
  const reasons: string[] = [];
  if (t.changePercent > 5) reasons.push(`Strong momentum: +${t.changePercent.toFixed(1)}% today`);
  if (t.volumeRatio > 2) reasons.push(`Volume spike: ${t.volumeRatio.toFixed(1)}x average`);
  if (t.changePercent > 0 && t.volumeRatio > 1.5) reasons.push('Price + volume confirmation (O\'Neil criteria)');
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
  const lines = [
    `Screen Score: ${stock.screenScore}/100`,
    `Volume: ${(stock.volume / 1e6).toFixed(1)}M (${stock.volumeRatio.toFixed(1)}x avg)`,
    stock.screenReasons.length > 0 ? `Why selected: ${stock.screenReasons.join(', ')}` : '',
    stock.screenFlags.length > 0 ? `⚠️ Flags: ${stock.screenFlags.join(', ')}` : '',
  ];
  return lines.filter(Boolean).join(' | ');
}
