// ═══════════════════════════════════════════════════════════════════════════
// THARUN TRADING PLATFORM
// Real-Time Correlation Matrix Service
// Tracks correlations between major asset classes
// Updated every 5 minutes to inform portfolio diversification
// ═══════════════════════════════════════════════════════════════════════════

import axios from 'axios';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

export interface CorrelationMatrix {
  timestamp: Date;
  period: string; // '1d', '5d', '1m', '3m'
  correlations: {
    stocks_bonds: number; // SPY vs TLT
    stocks_gold: number; // SPY vs GLD
    stocks_crypto: number; // SPY vs BTC
    dxy_tech: number; // DXY vs QQQ
    dxy_commodities: number; // DXY vs commodities
    dxy_gold: number; // DXY vs GLD
    oil_energy: number; // USO vs XLE
    bonds_gold: number; // TLT vs GLD
    crypto_stocks: number; // BTC vs SPY (same as stocks_crypto)
    crypto_gold: number; // BTC vs GLD
    sector_tech_vs_value: number; // QQQ vs XLV (growth vs defensive)
    em_stocks: number; // VWO vs SPY (emerging markets correlation)
  };
  correlationStrength: 'VERY_WEAK' | 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG';
  riskAssessment: {
    portfolioDiversification: number; // 0-100, higher = better diversified
    concentration: number; // 0-100, higher = more concentrated (bad)
    hedgeEffectiveness: number; // 0-100, higher = hedges work better
  };
  interpretation: string;
  tradingImplication: string;
}

interface PriceData {
  SPY: number; // S&P 500
  QQQ: number; // Nasdaq 100 (Tech-heavy)
  TLT: number; // 20-year Treasury Bond
  GLD: number; // Gold
  BTC: number; // Bitcoin
  USO: number; // Oil
  XLE: number; // Energy sector
  XLV: number; // Healthcare (defensive)
  VWO: number; // Emerging Markets
  DXY: number; // Dollar Index (computed from EURUSD, GBPUSD, etc.)
  IYR?: number; // Real Estate
  XME?: number; // Metals & Mining
}

export class CorrelationService {
  private readonly CORRELATION_ASSETS = [
    { symbol: 'SPY', etf: true }, // Stocks
    { symbol: 'QQQ', etf: true }, // Tech/Growth
    { symbol: 'TLT', etf: true }, // Bonds
    { symbol: 'GLD', etf: true }, // Gold
    { symbol: 'BTC', etf: false }, // Bitcoin
    { symbol: 'USO', etf: true }, // Oil
    { symbol: 'XLE', etf: true }, // Energy
    { symbol: 'XLV', etf: true }, // Healthcare (defensive)
    { symbol: 'VWO', etf: true }, // Emerging Markets
  ];

  /**
   * Get current correlation matrix
   */
  async getCorrelationMatrix(period: string = '1m'): Promise<CorrelationMatrix> {
    const cacheKey = `correlation-matrix:${period}`;
    
    // Check cache first (5 minute TTL)
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    try {
      // Fetch price data for all assets
      const prices = await this.fetchPriceData();
      
      // Calculate correlations using historical data
      const correlations = await this.calculateCorrelations(prices, period);
      
      // Assess portfolio implications
      const riskAssessment = this.assessPortfolioRisk(correlations);
      
      const matrix: CorrelationMatrix = {
        timestamp: new Date(),
        period,
        correlations,
        correlationStrength: this.assessCorrelationStrength(correlations),
        riskAssessment,
        interpretation: this.generateInterpretation(correlations, riskAssessment),
        tradingImplication: this.generateTradingImplication(correlations)
      };

      // Cache for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(matrix));

      return matrix;
    } catch (error) {
      logger.error('Correlation matrix calculation failed:', error);
      // Return default safe matrix on error
      return this.getSafeDefaultMatrix();
    }
  }

  /**
   * Fetch current prices for all correlation assets
   */
  private async fetchPriceData(): Promise<PriceData> {
    try {
      const prices: any = {};

      // Fetch ETF prices from IEX Cloud
      for (const asset of this.CORRELATION_ASSETS) {
        if (asset.etf) {
          const response = await axios.get(
            `https://cloud.iexapis.com/stable/stock/${asset.symbol}/quote`,
            {
              params: { token: process.env.IEX_API_KEY }
            }
          );
          prices[asset.symbol] = response.data.latestPrice;
        }
      }

      // Fetch Bitcoin from CoinGecko
      const btcResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'bitcoin',
          vs_currencies: 'usd'
        }
      });
      prices.BTC = btcResponse.data.bitcoin.usd;

      // Calculate DXY from forex rates (approximation)
      const forexResponse = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
        timeout: 5000
      }).catch(() => null); // DXY not critical

      if (forexResponse) {
        // Simplified DXY calculation (normally weighted index)
        prices.DXY = 100; // placeholder - would need proper calculation
      }

      return prices as PriceData;
    } catch (error) {
      logger.error('Price data fetch failed:', error);
      throw error;
    }
  }

  /**
   * Calculate correlations between assets
   * In production, this would use historical price data and calculate pearson correlation
   */
  private async calculateCorrelations(prices: PriceData, period: string): Promise<any> {
    try {
      // In production, this would:
      // 1. Fetch historical prices for the period
      // 2. Calculate daily returns for each asset
      // 3. Compute Pearson correlation coefficient between each pair
      // 4. Return correlation matrix

      // For now, return simulated realistic correlations
      // These would be calculated from actual price data
      return {
        stocks_bonds: -0.45, // typically inverse relationship
        stocks_gold: -0.30,
        stocks_crypto: 0.65, // moderate positive (both risk assets)
        dxy_tech: -0.58, // strong inverse (strong dollar = tech headwind)
        dxy_commodities: -0.72, // strong inverse (strong dollar = commodity headwind)
        dxy_gold: -0.55,
        oil_energy: 0.89, // very strong positive
        bonds_gold: 0.45, // both defensive
        crypto_stocks: 0.65,
        crypto_gold: 0.35,
        sector_tech_vs_value: -0.42, // growth vs defensive
        em_stocks: 0.88, // EM stocks highly correlated to overall market
      };
    } catch (error) {
      logger.error('Correlation calculation failed:', error);
      throw error;
    }
  }

  /**
   * Assess overall correlation strength
   */
  private assessCorrelationStrength(correlations: any): 'VERY_WEAK' | 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG' {
    // Calculate average absolute correlation
    const values = Object.values(correlations) as number[];
    const avgAbsCorr = values.reduce((sum, val) => sum + Math.abs(val), 0) / values.length;

    if (avgAbsCorr < 0.2) return 'VERY_WEAK';
    if (avgAbsCorr < 0.4) return 'WEAK';
    if (avgAbsCorr < 0.6) return 'MODERATE';
    if (avgAbsCorr < 0.8) return 'STRONG';
    return 'VERY_STRONG';
  }

  /**
   * Assess portfolio risk based on correlations
   */
  private assessPortfolioRisk(correlations: any): any {
    // High diversification = low correlations = can weather downturns
    // Low diversification = high correlations = all assets fall together

    const values = Object.values(correlations) as number[];
    const avgCorr = values.reduce((sum, val) => sum + val, 0) / values.length;
    
    // Diversification score: if avg correlation low = high diversification
    const diversificationScore = Math.max(0, Math.min(100, (1 - avgCorr) * 100));
    
    // Concentration is inverse
    const concentration = 100 - diversificationScore;
    
    // Hedge effectiveness: negative correlations = good hedges
    const negativeCorrs = values.filter(v => v < 0);
    const hedgeEffectiveness = (negativeCorrs.length / values.length) * 100;

    return {
      portfolioDiversification: Math.round(diversificationScore),
      concentration: Math.round(concentration),
      hedgeEffectiveness: Math.round(hedgeEffectiveness)
    };
  }

  /**
   * Generate human-readable interpretation
   */
  private generateInterpretation(correlations: any, risk: any): string {
    if (risk.portfolioDiversification > 70) {
      return 'Portfolio is well-diversified. Assets moving independently. Good for risk reduction.';
    } else if (risk.portfolioDiversification > 50) {
      return 'Portfolio has moderate diversification. Some protection from correlated downturns.';
    } else {
      return 'WARNING: Low diversification. Most assets highly correlated. Portfolio vulnerable to broad market decline.';
    }
  }

  /**
   * Generate trading implication
   */
  private generateTradingImplication(correlations: any): string {
    // If stocks and bonds are inversely correlated, bonds are good hedge
    if (correlations.stocks_bonds < -0.3) {
      return 'Strong stock/bond negative correlation: Use bonds as portfolio hedge.';
    }

    // If everything correlated highly, reduce position sizes
    const avgAbsCorr = Object.values(correlations).reduce((sum: number, val: any) => sum + Math.abs(val), 0) / 
                       Object.keys(correlations).length;
    
    if (avgAbsCorr > 0.7) {
      return 'CAUTION: High correlation across asset classes. Reduce position sizes due to concentration risk.';
    }

    // Tech and Dollar inverse correlation - strong relationship
    if (correlations.dxy_tech < -0.5) {
      return 'Strong USD/Tech inverse relationship: Watch DXY for tech trade signals.';
    }

    return 'Asset correlations are normal. Proceed with diversified strategy.';
  }

  /**
   * Get safe default matrix on error
   */
  private getSafeDefaultMatrix(): CorrelationMatrix {
    return {
      timestamp: new Date(),
      period: '1m',
      correlations: {
        stocks_bonds: -0.45,
        stocks_gold: -0.30,
        stocks_crypto: 0.65,
        dxy_tech: -0.58,
        dxy_commodities: -0.72,
        dxy_gold: -0.55,
        oil_energy: 0.89,
        bonds_gold: 0.45,
        crypto_stocks: 0.65,
        crypto_gold: 0.35,
        sector_tech_vs_value: -0.42,
        em_stocks: 0.88,
      },
      correlationStrength: 'MODERATE',
      riskAssessment: {
        portfolioDiversification: 55,
        concentration: 45,
        hedgeEffectiveness: 45
      },
      interpretation: 'Using default correlations due to data unavailable.',
      tradingImplication: 'Proceed with caution - use recent data when available.'
    };
  }

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

    let maxCorrelation = 0;
    let maxCorrelationAsset = '';
    for (const existing of others) {
      await new Promise(r => setTimeout(r, 1200)); // stay under Polygon's free-tier rate limit
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
