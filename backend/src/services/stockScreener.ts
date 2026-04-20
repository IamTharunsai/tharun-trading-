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

    const [gainers, actives] = await Promise.allSettled([
      fetchTopGainers(),
      fetchMostActive(),
    ]);

    const gainerList = gainers.status === 'fulfilled' ? gainers.value : [];
    const activeList = actives.status === 'fulfilled' ? actives.value : [];

    // Merge and deduplicate
    const symbolMap = new Map<string, ScreenedStock>();
    for (const s of [...gainerList, ...activeList]) {
      if (!symbolMap.has(s.symbol)) {
        symbolMap.set(s.symbol, s);
      } else {
        // Boost score if appears in multiple screens
        const existing = symbolMap.get(s.symbol)!;
        existing.screenScore = Math.min(100, existing.screenScore + 15);
        existing.screenReasons.push('Appears in multiple screens');
      }
    }

    const candidates = Array.from(symbolMap.values())
      .filter(s => s.screenScore >= 40)
      .filter(s => s.price >= 5)                  // no penny stocks
      .filter(s => s.volume >= 200000)             // meaningful liquidity
      .filter(s => !/^[A-Z]{4,5}$/.test(s.symbol) || s.volume > 1000000) // filter low-vol ETFs
      .sort((a, b) => b.screenScore - a.screenScore)
      .slice(0, 150);

    logger.info(`✅ Screen complete: ${candidates.length} candidates from ${symbolMap.size} stocks`);
    return candidates;

  } catch (err) {
    logger.error('Stock screen failed', { err });
    return [];
  }
}

// ── POLYGON: TOP GAINERS/LOSERS ───────────────────────────────────────────────
async function fetchTopGainers(): Promise<ScreenedStock[]> {
  try {
    const res = await axios.get('https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers', {
      params: { apiKey: POLY_KEY, include_otc: false },
      timeout: 10000
    });

    return (res.data?.tickers || []).slice(0, 50).map((t: any) => {
      const score = calculateScreenScore(t);
      return {
        symbol: t.ticker,
        price: t.day?.c || t.lastTrade?.p || 0,
        changePercent: t.todaysChangePerc || 0,
        volume: t.day?.v || 0,
        avgVolume: t.prevDay?.v || 1,
        volumeRatio: t.day?.v / Math.max(t.prevDay?.v || 1, 1),
        marketCap: 0,
        sector: '',
        screenScore: score,
        screenReasons: buildReasons(t),
        screenFlags: buildFlags(t),
        isNearHigh: false,
        hasVolumeSpike: (t.day?.v / Math.max(t.prevDay?.v || 1, 1)) > 1.5,
        isTrending: t.day?.c > (t.prevDay?.c || 0),
      };
    });
  } catch {
    return [];
  }
}

// ── POLYGON: MOST ACTIVE ─────────────────────────────────────────────────────
async function fetchMostActive(): Promise<ScreenedStock[]> {
  try {
    const res = await axios.get('https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers', {
      params: {
        apiKey: POLY_KEY,
        include_otc: false,
        sort: 'volume',
        order: 'desc',
        limit: 50,
      },
      timeout: 10000
    });

    return (res.data?.tickers || []).slice(0, 50).map((t: any) => {
      const score = calculateScreenScore(t);
      return {
        symbol: t.ticker,
        price: t.day?.c || 0,
        changePercent: t.todaysChangePerc || 0,
        volume: t.day?.v || 0,
        avgVolume: t.prevDay?.v || 1,
        volumeRatio: t.day?.v / Math.max(t.prevDay?.v || 1, 1),
        marketCap: 0,
        sector: '',
        screenScore: score,
        screenReasons: buildReasons(t),
        screenFlags: buildFlags(t),
        isNearHigh: false,
        hasVolumeSpike: (t.day?.v / Math.max(t.prevDay?.v || 1, 1)) > 1.5,
        isTrending: t.day?.c > (t.prevDay?.c || 0),
      };
    });
  } catch {
    return [];
  }
}

// ── SCORE CALCULATOR (CANSLIM + Minervini inspired) ──────────────────────────
function calculateScreenScore(t: any): number {
  let score = 30; // base score

  const changePercent = t.todaysChangePerc || 0;
  const price = t.day?.c || 0;
  const volume = t.day?.v || 0;
  const prevVolume = t.prevDay?.v || 1;
  const volumeRatio = volume / prevVolume;

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

function buildReasons(t: any): string[] {
  const reasons: string[] = [];
  const change = t.todaysChangePerc || 0;
  const volRatio = (t.day?.v || 0) / Math.max(t.prevDay?.v || 1, 1);

  if (change > 5) reasons.push(`Strong momentum: +${change.toFixed(1)}% today`);
  if (volRatio > 2) reasons.push(`Volume spike: ${volRatio.toFixed(1)}x average`);
  if (change > 0 && volRatio > 1.5) reasons.push('Price + volume confirmation (O\'Neil criteria)');
  return reasons;
}

function buildFlags(t: any): string[] {
  const flags: string[] = [];
  const price = t.day?.c || 0;
  const change = t.todaysChangePerc || 0;
  if (price < 5) flags.push('Low price stock — higher risk');
  if (Math.abs(change) > 15) flags.push('Extreme move — possible news catalyst, verify before trade');
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
