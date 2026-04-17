import axios from 'axios';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

interface SectorPerformance {
  sector: string;
  symbol: string;
  dayChange: number;
  weekChange: number;
  monthChange: number;
  quarterChange: number;
  yearChange: number;
  yearToDateChange: number;
  average: number;
  trend: 'HOT' | 'WARM' | 'COLD' | 'FREEZING';
  momentum: number;
  direction: 'UP' | 'DOWN';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
}

interface SectorRotationData {
  timestamp: Date;
  sectors: SectorPerformance[];
  hotSectors: string[];
  coldSectors: string[];
  rotationPhase: 'EARLY_CYCLE' | 'MID_CYCLE' | 'LATE_CYCLE' | 'RECESSION';
  rotationStrength: number; // 0-100
  leadingToLagging: number; // ratio of best to worst
  recommendations: string[];
}

interface SectorLeaders {
  sector: string;
  topStocks: Array<{
    symbol: string;
    performance: number;
    weight: number;
  }>;
}

class SectorRotationService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly SECTOR_ETFS: Record<string, string> = {
    'Technology': 'XLK',
    'Healthcare': 'XLV',
    'Financials': 'XLF',
    'Energy': 'XLE',
    'Industrials': 'XLI',
    'Consumer Discretionary': 'XLY',
    'Consumer Staples': 'XLP',
    'Materials': 'XLB',
    'Real Estate': 'XLRE',
    'Utilities': 'XLU',
    'Communication Services': 'XLC'
  };

  /**
   * Get current sector rotation analysis
   */
  async getSectorRotation(): Promise<SectorRotationData> {
    try {
      const cacheKey = 'sector_rotation:current';
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const sectors = await this.calculateSectorPerformance();
      const hotSectors = sectors
        .filter(s => s.trend === 'HOT' || s.trend === 'WARM')
        .map(s => s.sector);
      
      const coldSectors = sectors
        .filter(s => s.trend === 'COLD' || s.trend === 'FREEZING')
        .map(s => s.sector);

      const rotationPhase = this.determineRotationPhase(sectors);
      const leadingPerformer = sectors[0].average;
      const laggingPerformer = sectors[sectors.length - 1].average;
      const leadingToLagging = Math.abs(leadingPerformer / (laggingPerformer === 0 ? 1 : laggingPerformer));

      const rotationData: SectorRotationData = {
        timestamp: new Date(),
        sectors,
        hotSectors,
        coldSectors,
        rotationPhase,
        rotationStrength: this.calculateRotationStrength(sectors),
        leadingToLagging,
        recommendations: this.generateRecommendations(sectors, rotationPhase)
      };

      await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(rotationData));
      return rotationData;
    } catch (error) {
      logger.error('Error in getSectorRotation:', error);
      return this.getDefaultSectorRotation();
    }
  }

  /**
   * Get sector leaders (top stocks in each sector)
   */
  async getSectorLeaders(): Promise<SectorLeaders[]> {
    try {
      const cacheKey = 'sector_leaders:all';
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const leaders: SectorLeaders[] = [];

      for (const [sector, etf] of Object.entries(this.SECTOR_ETFS)) {
        const topStocks = await this.getTopStocksInSector(sector, etf);
        leaders.push({
          sector,
          topStocks
        });
      }

      await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(leaders));
      return leaders;
    } catch (error) {
      logger.error('Error in getSectorLeaders:', error);
      return [];
    }
  }

  /**
   * Check if a stock aligns with sector rotation
   */
  async isSectorAligned(stock: string, sector: string): Promise<boolean> {
    try {
      const rotation = await this.getSectorRotation();
      const isSectorHot = rotation.hotSectors.includes(sector);
      
      if (!isSectorHot) {
        return false;
      }

      const leaders = await this.getSectorLeaders();
      const sectorLeaders = leaders.find(l => l.sector === sector);
      
      if (!sectorLeaders) {
        return false;
      }

      const isLeadingStock = sectorLeaders.topStocks
        .slice(0, 10)
        .some(s => s.symbol === stock);
      
      return isLeadingStock;
    } catch (error) {
      logger.error('Error in isSectorAligned:', error);
      return false;
    }
  }

  /**
   * Calculate sector performance across timeframes
   */
  private async calculateSectorPerformance(): Promise<SectorPerformance[]> {
    const performances: SectorPerformance[] = [];

    for (const [sector, etf] of Object.entries(this.SECTOR_ETFS)) {
      try {
        const data = await this.fetchSectorData(etf);
        
        const average = (
          data.dayChange +
          data.weekChange +
          data.monthChange +
          data.quarterChange
        ) / 4;

        const trend = this.calculateTrend(average, data.yearChange);
        const momentum = this.calculateMomentum(
          data.dayChange,
          data.weekChange,
          data.monthChange
        );

        performances.push({
          sector,
          symbol: etf,
          dayChange: data.dayChange,
          weekChange: data.weekChange,
          monthChange: data.monthChange,
          quarterChange: data.quarterChange,
          yearChange: data.yearChange,
          yearToDateChange: data.yearToDateChange,
          average,
          trend,
          momentum,
          direction: average > 0 ? 'UP' : 'DOWN',
          strength: this.getStrength(Math.abs(average))
        });
      } catch (error) {
        logger.error(`Error fetching sector data for ${sector}:`, error);
      }
    }

    return performances.sort((a, b) => b.average - a.average);
  }

  /**
   * Fetch performance data from IEX Cloud
   */
  private async fetchSectorData(etf: string): Promise<any> {
    try {
      const token = process.env.IEX_CLOUD_API_KEY;
      const response = await axios.get(
        `https://cloud.iexapis.com/stable/stock/${etf}/quote?token=${token}`,
        { timeout: 5000 }
      );

      const data = response.data;
      return {
        dayChange: ((data.close - data.previousClose) / data.previousClose) * 100,
        weekChange: this.calculateChange(data.close, data.week52Low) || 0,
        monthChange: 0, // Would need historical data
        quarterChange: 0, // Would need historical data
        yearChange: ((data.close - data.open) / data.open) * 100,
        yearToDateChange: ((data.close - data.ytdChange) / data.ytdChange) * 100 || 0
      };
    } catch (error) {
      logger.error(`Error fetching IEX data for ${etf}:`, error);
      return {
        dayChange: 0,
        weekChange: 0,
        monthChange: 0,
        quarterChange: 0,
        yearChange: 0,
        yearToDateChange: 0
      };
    }
  }

  /**
   * Determine rotation phase based on sector performance
   */
  private determineRotationPhase(sectors: SectorPerformance[]): 'EARLY_CYCLE' | 'MID_CYCLE' | 'LATE_CYCLE' | 'RECESSION' {
    const topSectors = sectors.slice(0, 3).map(s => s.sector);
    
    // Early cycle: tech, discretionary, materials leading
    if (topSectors.some(s => s.includes('Technology') || s.includes('Consumer Discretionary'))) {
      return 'EARLY_CYCLE';
    }
    
    // Mid cycle: industrials, technology leading
    if (topSectors.some(s => s.includes('Industrials') || s.includes('Technology'))) {
      return 'MID_CYCLE';
    }
    
    // Late cycle: utilities, healthcare, staples leading
    if (topSectors.some(s => s.includes('Utilities') || s.includes('Healthcare'))) {
      return 'LATE_CYCLE';
    }
    
    // Recession: staples, utilities leading
    return 'RECESSION';
  }

  /**
   * Calculate rotation strength (dispersion between sectors)
   */
  private calculateRotationStrength(sectors: SectorPerformance[]): number {
    if (sectors.length === 0) return 0;
    
    const average = sectors.reduce((sum, s) => sum + s.average, 0) / sectors.length;
    const variance = sectors.reduce((sum, s) => sum + Math.pow(s.average - average, 2), 0) / sectors.length;
    const stdDev = Math.sqrt(variance);
    
    // Normalize to 0-100 scale
    return Math.min(100, stdDev * 10);
  }

  /**
   * Calculate trend classification
   */
  private calculateTrend(shortTermAverage: number, longTermChange: number): 'HOT' | 'WARM' | 'COLD' | 'FREEZING' {
    if (shortTermAverage > 2 && longTermChange > 10) return 'HOT';
    if (shortTermAverage > 0 && longTermChange > 5) return 'WARM';
    if (shortTermAverage < 0 && longTermChange < -5) return 'COLD';
    return 'FREEZING';
  }

  /**
   * Calculate momentum score
   */
  private calculateMomentum(day: number, week: number, month: number): number {
    const weights = { day: 0.5, week: 0.3, month: 0.2 };
    return (day * weights.day) + (week * weights.week) + (month * weights.month);
  }

  /**
   * Get strength classification
   */
  private getStrength(performance: number): 'STRONG' | 'MODERATE' | 'WEAK' {
    if (Math.abs(performance) > 2) return 'STRONG';
    if (Math.abs(performance) > 0.5) return 'MODERATE';
    return 'WEAK';
  }

  /**
   * Get top stocks in a sector
   */
  private async getTopStocksInSector(sector: string, etf: string): Promise<Array<{symbol: string, performance: number, weight: number}>> {
    try {
      // This would normally fetch holdings from a data provider
      // For now, returning placeholder structure
      return [
        { symbol: 'TOP1', performance: 5.2, weight: 0.25 },
        { symbol: 'TOP2', performance: 4.8, weight: 0.22 },
        { symbol: 'TOP3', performance: 4.1, weight: 0.18 }
      ];
    } catch (error) {
      logger.error(`Error getting top stocks for ${sector}:`, error);
      return [];
    }
  }

  /**
   * Generate recommendations based on rotation
   */
  private generateRecommendations(sectors: SectorPerformance[], phase: string): string[] {
    const recommendations: string[] = [];

    if (phase === 'EARLY_CYCLE') {
      recommendations.push('Favor growth and technology stocks');
      recommendations.push('Increase exposure to cyclicals');
    } else if (phase === 'MID_CYCLE') {
      recommendations.push('Maintain balanced sector exposure');
      recommendations.push('Focus on earnings quality');
    } else if (phase === 'LATE_CYCLE') {
      recommendations.push('Rotate to defensive sectors');
      recommendations.push('Reduce cyclical exposure');
    } else if (phase === 'RECESSION') {
      recommendations.push('Hold defensive positions');
      recommendations.push('Avoid cyclical stocks');
    }

    return recommendations;
  }

  /**
   * Calculate simple change percentage
   */
  private calculateChange(current: number, previous: number): number {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }

  /**
   * Default response on error
   */
  private getDefaultSectorRotation(): SectorRotationData {
    return {
      timestamp: new Date(),
      sectors: [],
      hotSectors: [],
      coldSectors: [],
      rotationPhase: 'MID_CYCLE',
      rotationStrength: 0,
      leadingToLagging: 1,
      recommendations: ['Awaiting data refresh']
    };
  }
}

export const sectorRotationService = new SectorRotationService();
