// ═══════════════════════════════════════════════════════════════════════════
// THARUN TRADING PLATFORM
// Liquidity Assessment Service
// Ensures every trade has sufficient volume to execute safely
// ═══════════════════════════════════════════════════════════════════════════

import axios from 'axios';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

export interface LiquidityMetrics {
  asset: string;
  price: number;
  volume24h: number;
  volumeAvg20Day: number;
  volumeChange: number; // percentage change from average
  bidAskSpread: number; // in dollars
  spreadPercent: number; // percentage of price
  marketCap: number;
  floatShares: number;
  volumeToFloatRatio: number; // volume / float
  isLiquid: boolean;
  liquidityScore: number; // 0-100
  recommendation: 'SAFE' | 'CAUTION' | 'AVOID';
  maxPositionSizePercent: number; // max % of daily volume
  maxPositionDollars: number; // based on 1% of daily volume
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  warnings: string[];
}

export class LiquidityService {
  /**
   * Check liquidity for a specific asset
   * Prevents trading in low-liquidity securities
   */
  async checkLiquidity(asset: string, positionSize?: number): Promise<LiquidityMetrics> {
    // Check cache first (5 minute TTL)
    const cacheKey = `liquidity:${asset}`;
    const cached = await redis.get(cacheKey);
    if (cached && !positionSize) {
      return JSON.parse(cached);
    }

    try {
      // Get current data from IEX Cloud
      const data = await this.fetchMarketData(asset);
      const metrics = this.calculateLiquidityMetrics(data, asset, positionSize);

      // Cache for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(metrics));

      return metrics;
    } catch (error) {
      logger.error(`Liquidity check failed for ${asset}:`, error);
      throw new Error(`Failed to assess liquidity for ${asset}`);
    }
  }

  /**
   * Check liquidity for multiple assets
   */
  async checkLiquidityBatch(assets: string[]): Promise<LiquidityMetrics[]> {
    return Promise.all(assets.map(asset => this.checkLiquidity(asset)));
  }

  /**
   * Fetch market data from external API
   */
  private async fetchMarketData(asset: string): Promise<any> {
    try {
      // IEX Cloud API calls
      const [quote, stats, previous] = await Promise.all([
        axios.get(`https://cloud.iexapis.com/stable/stock/${asset}/quote`, {
          params: { token: process.env.IEX_API_KEY }
        }),
        axios.get(`https://cloud.iexapis.com/stable/stock/${asset}/stats`, {
          params: { token: process.env.IEX_API_KEY }
        }),
        axios.get(`https://cloud.iexapis.com/stable/stock/${asset}/previous`, {
          params: { token: process.env.IEX_API_KEY }
        })
      ]);

      return {
        quote: quote.data,
        stats: stats.data,
        previous: previous.data
      };
    } catch (error) {
      logger.error(`Market data fetch failed for ${asset}:`, error);
      throw error;
    }
  }

  /**
   * Calculate liquidity metrics from market data
   */
  private calculateLiquidityMetrics(
    data: any,
    asset: string,
    positionSize?: number
  ): LiquidityMetrics {
    const quote = data.quote;
    const stats = data.stats;

    const volume24h = quote.volume || 0;
    const volumeAvg20Day = stats.avg30Volume || stats.avgVolume || volume24h;
    const volumeChange = ((volume24h - volumeAvg20Day) / volumeAvg20Day) * 100;

    // Bid-Ask Spread
    const bidAskSpread = (quote.ask || quote.iexAskPrice) - (quote.bid || quote.iexBidPrice);
    const spreadPercent = (bidAskSpread / quote.latestPrice) * 100;

    // Market Cap and Float
    const marketCap = stats.marketcap || 0;
    const floatShares = stats.float || 0;
    const volumeToFloatRatio = volume24h / (floatShares > 0 ? floatShares : volume24h);

    // Calculate Liquidity Score (0-100)
    let liquidityScore = 100;

    // Volume check (20% weight)
    if (volume24h < 100000) liquidityScore -= 40; // extremely illiquid
    else if (volume24h < 500000) liquidityScore -= 20; // low volume
    else if (volume24h < 1000000) liquidityScore -= 5; // moderate

    // Spread check (20% weight)
    if (spreadPercent > 1.0) liquidityScore -= 30; // wide spread
    else if (spreadPercent > 0.5) liquidityScore -= 15; // moderate spread
    else if (spreadPercent > 0.1) liquidityScore -= 5; // normal spread

    // Market Cap check (20% weight)
    if (marketCap < 1_000_000_000) liquidityScore -= 25; // micro cap
    else if (marketCap < 2_000_000_000) liquidityScore -= 10; // small cap

    // Volume consistency (20% weight)
    if (volumeChange < -30) liquidityScore -= 15; // volume fell significantly
    if (volumeChange > 200) liquidityScore += 10; // volume spike - good

    // Float check (20% weight)
    if (floatShares > 0 && volumeToFloatRatio < 0.01) liquidityScore -= 10; // low float turnover

    liquidityScore = Math.max(0, Math.min(100, liquidityScore));

    // Recommendation
    let recommendation: 'SAFE' | 'CAUTION' | 'AVOID' = 'SAFE';
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (liquidityScore < 40) {
      recommendation = 'AVOID';
      riskLevel = 'HIGH';
    } else if (liquidityScore < 60) {
      recommendation = 'CAUTION';
      riskLevel = 'MEDIUM';
    }

    // Maximum position size (based on 1-2% of daily volume)
    const maxPositionSizePercent = volume24h > 1_000_000 ? 1.0 : 0.5;
    const maxPositionDollars = (volume24h * maxPositionSizePercent) / 100;

    // Warnings
    const warnings: string[] = [];
    if (spreadPercent > 0.5) warnings.push(`High spread: ${spreadPercent.toFixed(2)}%`);
    if (volume24h < 500000) warnings.push('Low average volume - may be difficult to exit');
    if (volumeChange < -50) warnings.push('Volume significantly below average');
    if (marketCap < 2_000_000_000) warnings.push('Small market cap - higher volatility risk');

    return {
      asset,
      price: quote.latestPrice,
      volume24h,
      volumeAvg20Day,
      volumeChange,
      bidAskSpread,
      spreadPercent: spreadPercent * 100, // convert to percentage
      marketCap,
      floatShares,
      volumeToFloatRatio,
      isLiquid: recommendation !== 'AVOID',
      liquidityScore,
      recommendation,
      maxPositionSizePercent,
      maxPositionDollars,
      riskLevel,
      warnings
    };
  }

  /**
   * Validate if position size is appropriate for asset
   */
  async validatePositionSize(asset: string, desiredPositionDollars: number): Promise<{
    isValid: boolean;
    reason?: string;
    recommendedMaxDollars: number;
    percentOfDailyVolume: number;
  }> {
    const liquidity = await this.checkLiquidity(asset);

    if (!liquidity.isLiquid) {
      return {
        isValid: false,
        reason: `Asset is illiquid. Recommendation: ${liquidity.recommendation}`,
        recommendedMaxDollars: liquidity.maxPositionDollars,
        percentOfDailyVolume: (desiredPositionDollars / liquidity.volume24h) * 100
      };
    }

    if (desiredPositionDollars > liquidity.maxPositionDollars) {
      return {
        isValid: false,
        reason: `Position size exceeds safe limits. Max: $${liquidity.maxPositionDollars.toFixed(2)}`,
        recommendedMaxDollars: liquidity.maxPositionDollars,
        percentOfDailyVolume: (desiredPositionDollars / liquidity.volume24h) * 100
      };
    }

    return {
      isValid: true,
      recommendedMaxDollars: liquidity.maxPositionDollars,
      percentOfDailyVolume: (desiredPositionDollars / liquidity.volume24h) * 100
    };
  }
}

export const liquidityService = new LiquidityService();
