// ═══════════════════════════════════════════════════════════════════════════
// THARUN TRADING PLATFORM
// Earnings Calendar & Blocker Service
// Prevents trades near earnings dates to avoid gap risk
// ═══════════════════════════════════════════════════════════════════════════

import axios from 'axios';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

export interface EarningsData {
  asset: string;
  earningsDate: Date | null;
  earningsTime: 'PRE_MARKET' | 'AFTER_HOURS' | 'DURING' | 'TBD' | 'UNKNOWN';
  daysUntilEarnings: number | null;
  daysSinceEarnings: number | null;
  isInDangerZone: boolean; // Cannot trade
  lastEarningsResults: {
    date: Date;
    epsEstimate: number;
    epsActual: number;
    epsBeatsEstimate: boolean;
    revenueEstimate: number;
    revenueActual: number;
    revenueBeatsEstimate: boolean;
  } | null;
  nextEarningsExpectation: {
    epsEstimate: number;
    revenueEstimate: number;
  } | null;
  reason?: string;
}

export class EarningsService {
  // DANGER ZONE: Cannot trade 5 days BEFORE and 3 days AFTER earnings
  private readonly DAYS_BEFORE_EARNINGS_BLOCKED = 5;
  private readonly DAYS_AFTER_EARNINGS_BLOCKED = 3;

  /**
   * Check if asset is in earnings danger zone
   */
  async checkEarnings(asset: string): Promise<EarningsData> {
    // Check cache first (daily TTL)
    const cacheKey = `earnings:${asset}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    try {
      // Try database first (faster)
      let earningsInfo = await this.getEarningsFromDatabase(asset);

      // If not in database or stale, fetch from API
      if (!earningsInfo || this.isStale(earningsInfo.earningsDate)) {
        earningsInfo = await this.fetchEarningsFromAPI(asset);
        
        // Store in database for future lookups
        if (earningsInfo && earningsInfo.earningsDate) {
          await this.saveEarningsToDatabase(asset, earningsInfo);
        }
      }

      const result = this.enrichEarningsData(earningsInfo, asset);

      // Cache for 24 hours
      await redis.setex(cacheKey, 86400, JSON.stringify(result));

      return result;
    } catch (error) {
      logger.error(`Earnings check failed for ${asset}:`, error);
      // Return safe default (block trading)
      return {
        asset,
        earningsDate: null,
        earningsTime: 'UNKNOWN',
        daysUntilEarnings: null,
        daysSinceEarnings: null,
        isInDangerZone: true,
        lastEarningsResults: null,
        nextEarningsExpectation: null,
        reason: 'Could not verify earnings date - blocking trade to be safe'
      };
    }
  }

  /**
   * Get earnings from database
   */
  private async getEarningsFromDatabase(asset: string): Promise<any> {
    try {
      // This would query your earnings table if you have one
      // For now, return null to fetch from API
      return null;
    } catch (error) {
      logger.error(`Database earnings lookup failed for ${asset}:`, error);
      return null;
    }
  }

  /**
   * Fetch earnings from external API (Finnhub)
   */
  private async fetchEarningsFromAPI(asset: string): Promise<any> {
    try {
      const response = await axios.get('https://finnhub.io/api/v1/calendar/earnings', {
        params: {
          token: process.env.FINNHUB_API_KEY,
          symbol: asset
        }
      });

      if (!response.data.earningsCalendar || response.data.earningsCalendar.length === 0) {
        return null;
      }

      const earningsEvents = response.data.earningsCalendar;

      // Find next earnings
      const now = new Date();
      const nextEarnings = earningsEvents.find((e: any) => new Date(e.date) > now);
      const lastEarnings = earningsEvents.reverse().find((e: any) => new Date(e.date) <= now);

      return {
        asset,
        nextEarnings: nextEarnings ? {
          date: new Date(nextEarnings.date),
          epsEstimate: nextEarnings.epsEstimate,
          revenueEstimate: nextEarnings.revenueEstimate
        } : null,
        lastEarnings: lastEarnings ? {
          date: new Date(lastEarnings.date),
          epsEstimate: lastEarnings.epsEstimate,
          epsActual: lastEarnings.epsActual,
          revenueEstimate: lastEarnings.revenueEstimate,
          revenueActual: lastEarnings.revenueActual
        } : null
      };
    } catch (error) {
      logger.error(`API earnings fetch failed for ${asset}:`, error);
      throw error;
    }
  }

  /**
   * Check if earnings data is stale
   */
  private isStale(date: Date | null | undefined): boolean {
    if (!date) return true;
    // Consider stale if older than 24 hours
    const dayInMs = 24 * 60 * 60 * 1000;
    return Date.now() - date.getTime() > dayInMs;
  }

  /**
   * Save earnings to database for faster future lookups
   */
  private async saveEarningsToDatabase(asset: string, data: any): Promise<void> {
    try {
      if (data.nextEarnings) {
        // This would insert into your earnings_calendar table
        // For now, just log
        logger.info(`Saved earnings for ${asset}: ${data.nextEarnings.date}`);
      }
    } catch (error) {
      logger.error(`Failed to save earnings for ${asset}:`, error);
    }
  }

  /**
   * Enrich earnings data with danger zone calculation
   */
  private enrichEarningsData(data: any, asset: string): EarningsData {
    if (!data || !data.nextEarnings) {
      return {
        asset,
        earningsDate: null,
        earningsTime: 'UNKNOWN',
        daysUntilEarnings: null,
        daysSinceEarnings: null,
        isInDangerZone: false, // No earnings known - safe to trade
        lastEarningsResults: null,
        nextEarningsExpectation: null,
        reason: 'No earnings date found'
      };
    }

    const earningsDate = data.nextEarnings.date;
    const now = new Date();
    const daysUntilEarnings = Math.ceil((earningsDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // Check if in danger zone
    const isInDangerZone = daysUntilEarnings >= -this.DAYS_AFTER_EARNINGS_BLOCKED && 
                          daysUntilEarnings <= this.DAYS_BEFORE_EARNINGS_BLOCKED;

    // Enrich with last earnings results if available
    let lastEarningsResults = null;
    if (data.lastEarnings) {
      lastEarningsResults = {
        date: data.lastEarnings.date,
        epsEstimate: data.lastEarnings.epsEstimate,
        epsActual: data.lastEarnings.epsActual,
        epsBeatsEstimate: data.lastEarnings.epsActual > data.lastEarnings.epsEstimate,
        revenueEstimate: data.lastEarnings.revenueEstimate,
        revenueActual: data.lastEarnings.revenueActual,
        revenueBeatsEstimate: data.lastEarnings.revenueActual > data.lastEarnings.revenueEstimate
      };
    }

    const reason = isInDangerZone ? 
      `Earnings ${daysUntilEarnings < 0 ? 'just passed' : 'in ' + daysUntilEarnings + ' days'} - HIGH RISK zone` :
      'Safe to trade - not in earnings danger zone';

    return {
      asset,
      earningsDate,
      earningsTime: 'TBD', // Would need more data to determine
      daysUntilEarnings,
      daysSinceEarnings: daysUntilEarnings < 0 ? Math.abs(daysUntilEarnings) : null,
      isInDangerZone,
      lastEarningsResults,
      nextEarningsExpectation: {
        epsEstimate: data.nextEarnings.epsEstimate,
        revenueEstimate: data.nextEarnings.revenueEstimate
      },
      reason
    };
  }

  /**
   * Get earnings calendar for multiple assets
   */
  async getEarningsCalendar(assets: string[]): Promise<EarningsData[]> {
    return Promise.all(assets.map(asset => this.checkEarnings(asset)));
  }

  /**
   * Get assets with upcoming earnings (next 30 days)
   */
  async getUpcomingEarnings(days: number = 30): Promise<EarningsData[]> {
    // This would query a comprehensive earnings calendar API
    // For now, return empty array
    logger.info(`Fetching earnings for next ${days} days`);
    return [];
  }

  /**
   * Get assets in danger zone right now
   */
  async getAssetsInDangerZone(assets: string[]): Promise<string[]> {
    const earnings = await this.getEarningsCalendar(assets);
    return earnings
      .filter(e => e.isInDangerZone)
      .map(e => e.asset);
  }
}

export const earningsService = new EarningsService();
