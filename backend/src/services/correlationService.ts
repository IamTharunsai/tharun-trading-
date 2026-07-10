// ═══════════════════════════════════════════════════════════════════════════
// THARUN TRADING PLATFORM
// Portfolio Concentration / Correlation Check
// Real Pearson correlation (Polygon for stocks, CoinGecko for crypto) between
// a candidate trade and each currently-held position — used by riskManager
// to block over-concentrated portfolios.
// ═══════════════════════════════════════════════════════════════════════════

import axios from 'axios';
import { logger } from '../utils/logger';

export class CorrelationService {
  // Common crypto tickers -> CoinGecko coin IDs (CoinGecko's API is keyed by
  // full name, not ticker). Symbols outside this map skip the crypto path —
  // correlation check degrades to "insufficient data" rather than guessing.
  private static readonly COINGECKO_IDS: Record<string, string> = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', ADA: 'cardano',
    AVAX: 'avalanche-2', LINK: 'chainlink', DOT: 'polkadot', UNI: 'uniswap', MATIC: 'matic-network',
    XRP: 'ripple', DOGE: 'dogecoin', LTC: 'litecoin', BCH: 'bitcoin-cash', ATOM: 'cosmos',
  };

  private async fetchDailyReturns(symbol: string, days = 21): Promise<number[] | null> {
    try {
      const closes: number[] = [];
      const coingeckoId = CorrelationService.COINGECKO_IDS[symbol.toUpperCase()];
      if (coingeckoId) {
        const res = await axios.get(`https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart`, {
          params: { vs_currency: 'usd', days, interval: 'daily' }, timeout: 10000
        });
        for (const [, price] of res.data?.prices || []) closes.push(price);
      } else {
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - (days + 5) * 86400000).toISOString().slice(0, 10);
        const res = await axios.get(`https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}`, {
          params: { apiKey: process.env.POLYGON_API_KEY, adjusted: true, sort: 'asc' }, timeout: 10000
        });
        for (const bar of res.data?.results || []) closes.push(bar.c);
      }
      if (closes.length < 5) return null;
      const returns: number[] = [];
      for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      return returns;
    } catch (err) {
      logger.warn(`Failed to fetch return series for ${symbol}`, { err: (err as Error)?.message });
      return null;
    }
  }

  private pearsonCorrelation(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n < 3) return 0;
    const x = a.slice(-n), y = b.slice(-n);
    const meanX = x.reduce((s, v) => s + v, 0) / n;
    const meanY = y.reduce((s, v) => s + v, 0) / n;
    let cov = 0, varX = 0, varY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX, dy = y[i] - meanY;
      cov += dx * dy; varX += dx * dx; varY += dy * dy;
    }
    if (varX === 0 || varY === 0) return 0;
    return cov / Math.sqrt(varX * varY);
  }

  /**
   * Check if adding an asset would over-concentrate the portfolio — computes
   * real Pearson correlation (daily returns, ~21d window) against each
   * currently-held asset instead of the previous always-true stub. Alpaca/
   * Polygon/CoinGecko are queried per-symbol with a small delay between calls
   * to stay under free-tier rate limits (this runs once per trade decision,
   * not on a hot path).
   */
  async shouldAddAssetToPortfolio(
    newAsset: string,
    currentAssets: string[],
    correlationThreshold: number = 0.7
  ): Promise<{ shouldAdd: boolean; reason: string; maxCorrelation: number }> {
    const others = currentAssets.filter(a => a !== newAsset);
    if (others.length === 0) {
      return { shouldAdd: true, reason: 'No existing positions to conflict with', maxCorrelation: 0 };
    }

    const newReturns = await this.fetchDailyReturns(newAsset);
    if (!newReturns) {
      return { shouldAdd: true, reason: `Insufficient return-history data for ${newAsset} — correlation check skipped, not blocking`, maxCorrelation: 0 };
    }

    // This runs synchronously on the pre-execution risk-check path — every
    // 1.2s here is real slippage risk on a live order. The delay only exists
    // to respect Polygon's rate limit, which only applies to the stock-fetch
    // path; crypto assets go through CoinGecko and don't need it. Skipping
    // the wait for crypto-mapped symbols cuts latency for the common case of
    // an all-crypto or mixed portfolio without touching Polygon's limit.
    let maxCorrelation = 0;
    let maxCorrelationAsset = '';
    for (const existing of others) {
      const isStockFetch = !CorrelationService.COINGECKO_IDS[existing.toUpperCase()];
      if (isStockFetch) await new Promise(r => setTimeout(r, 1200));
      const existingReturns = await this.fetchDailyReturns(existing);
      if (!existingReturns) continue;
      const corr = Math.abs(this.pearsonCorrelation(newReturns, existingReturns));
      if (corr > maxCorrelation) { maxCorrelation = corr; maxCorrelationAsset = existing; }
    }

    const shouldAdd = maxCorrelation < correlationThreshold;
    return {
      shouldAdd,
      reason: shouldAdd
        ? `Max correlation with existing positions: ${maxCorrelation.toFixed(2)} (${maxCorrelationAsset || 'n/a'})`
        : `LAW 15 (concentration): ${(maxCorrelation * 100).toFixed(0)}% correlated with existing ${maxCorrelationAsset} position — exceeds ${(correlationThreshold * 100).toFixed(0)}% threshold`,
      maxCorrelation,
    };
  }
}

export const correlationService = new CorrelationService();
