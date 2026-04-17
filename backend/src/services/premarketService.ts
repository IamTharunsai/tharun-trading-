import axios from 'axios';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

interface PremarketAnalysis {
  timestamp: Date;
  marketOpen: Date;
  hoursUntilOpen: number;
  premarketMovers: {
    gainers: Array<{symbol: string, price: number, change: number, changePercent: number, volume: number}>;
    losers: Array<{symbol: string, price: number, change: number, changePercent: number, volume: number}>;
    mostActive: Array<{symbol: string, price: number, volume: number, volumeChange: number}>;
  };
  economicCalendar: {
    events: Array<{
      time: string;
      currency: string;
      event: string;
      forecast: string;
      previous: string;
      importance: 'LOW' | 'MEDIUM' | 'HIGH';
    }>;
    highImpactEvents: string[];
    marketExpectations: string[];
  };
  futuresAnalysis: {
    es: {symbol: string, price: number, change: number, changePercent: number, sentiment: string};
    nq: {symbol: string, price: number, change: number, changePercent: number, sentiment: string};
    ym: {symbol: string, price: number, change: number, changePercent: number, sentiment: string};
    generalSentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  };
  technicalSetup: {
    key: string;
    levels: {resistance: number[], support: number[]};
    pivots: {r1: number, pp: number, s1: number};
    signals: string[];
  }[];
  keyThemes: string[];
  riskFactors: string[];
  tradingRecommendations: Array<{symbol: string, action: string, rationale: string}>;
}

interface PremarketStock {
  symbol: string;
  name: string;
  premarketPrice: number;
  premarketChange: number;
  premarketChangePercent: number;
  regularSessionPrice: number;
  regularSessionChange: number;
  afterHoursPrice?: number;
  afterHoursChange?: number;
  premarketVolume: number;
  premarketAverageVolume: number;
  volumeRatio: number;
  highlightReasons: string[];
}

interface EconomicEvent {
  time: string; // UTC
  country: string;
  event: string;
  forecast: string;
  previous: string;
  actual?: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  volatilityExpected: boolean;
}

class PremarketService {
  private readonly CACHE_TTL = 600; // 10 minutes
  private readonly MARKET_OPEN_HOUR = 9; // 9 AM EST
  private readonly MARKET_OPEN_MINUTE = 30;
  private readonly KEY_INDICES = ['SPY', 'QQQ', 'IWM', 'VIX'];
  private readonly FUTURES = ['ES', 'NQ', 'YM'];

  /**
   * Get comprehensive pre-market analysis
   */
  async getPremarketAnalysis(): Promise<PremarketAnalysis> {
    try {
      const cacheKey = 'premarket:analysis';
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const now = new Date();
      const nextOpen = this.getNextMarketOpen(now);
      const hoursUntilOpen = (nextOpen.getTime() - now.getTime()) / (1000 * 60 * 60);

      const [movers, calendar, futures, technicals] = await Promise.allSettled([
        this.getPremarketMovers(),
        this.getEconomicCalendar(),
        this.getFuturesAnalysis(),
        this.getTechnicalSetup()
      ]);

      const analysis: PremarketAnalysis = {
        timestamp: now,
        marketOpen: nextOpen,
        hoursUntilOpen,
        premarketMovers: movers.status === 'fulfilled' ? movers.value : this.getDefaultMovers(),
        economicCalendar: calendar.status === 'fulfilled' ? calendar.value : this.getDefaultCalendar(),
        futuresAnalysis: futures.status === 'fulfilled' ? futures.value : this.getDefaultFutures(),
        technicalSetup: technicals.status === 'fulfilled' ? technicals.value : [],
        keyThemes: this.generateKeyThemes(movers.status === 'fulfilled' ? movers.value : this.getDefaultMovers()),
        riskFactors: this.identifyRiskFactors(calendar.status === 'fulfilled' ? calendar.value : this.getDefaultCalendar()),
        tradingRecommendations: this.generateRecommendations(
          movers.status === 'fulfilled' ? movers.value : this.getDefaultMovers(),
          calendar.status === 'fulfilled' ? calendar.value : this.getDefaultCalendar()
        )
      };

      await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(analysis));
      return analysis;
    } catch (error) {
      logger.error('Error in getPremarketAnalysis:', error);
      return this.getDefaultPremarketAnalysis();
    }
  }

  /**
   * Get pre-market gainers and losers
   */
  async getPremarketMovers(): Promise<any> {
    try {
      const token = process.env.IEX_CLOUD_API_KEY;
      if (!token) throw new Error('Missing IEX Cloud API key');

      // Get pre-market data for key indices and top movers
      const response = await axios.get(
        `https://cloud.iexapis.com/stable/stock/market/list/mostactive?token=${token}`,
        { timeout: 5000 }
      );

      const stocks = response.data || [];
      
      const gainers = stocks
        .filter((s: any) => s.changePercent > 0)
        .sort((a: any, b: any) => b.changePercent - a.changePercent)
        .slice(0, 5)
        .map((s: any) => ({
          symbol: s.symbol,
          price: s.latestPrice,
          change: s.latestPrice - s.open,
          changePercent: s.changePercent,
          volume: s.latestVolume
        }));

      const losers = stocks
        .filter((s: any) => s.changePercent < 0)
        .sort((a: any, b: any) => a.changePercent - b.changePercent)
        .slice(0, 5)
        .map((s: any) => ({
          symbol: s.symbol,
          price: s.latestPrice,
          change: s.latestPrice - s.open,
          changePercent: s.changePercent,
          volume: s.latestVolume
        }));

      const mostActive = stocks
        .sort((a: any, b: any) => b.latestVolume - a.latestVolume)
        .slice(0, 5)
        .map((s: any) => ({
          symbol: s.symbol,
          price: s.latestPrice,
          volume: s.latestVolume,
          volumeChange: ((s.latestVolume - s.avgTotalVolume) / s.avgTotalVolume) * 100
        }));

      return { gainers, losers, mostActive };
    } catch (error) {
      logger.error('Error getting pre-market movers:', error);
      return this.getDefaultMovers();
    }
  }

  /**
   * Get economic calendar for today
   */
  async getEconomicCalendar(): Promise<any> {
    try {
      const token = process.env.FINNHUB_API_KEY;
      if (!token) throw new Error('Missing Finnhub API key');

      const response = await axios.get(
        `https://finnhub.io/api/v1/economic-calendar?token=${token}`,
        { timeout: 5000 }
      );

      const events = response.data || [];
      const today = new Date().toISOString().split('T')[0];

      const todayEvents = events
        .filter((e: any) => e.date?.startsWith(today))
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const highImpactEvents = todayEvents
        .filter((e: any) => e.importance === 'HIGH')
        .map((e: any) => `${e.country}: ${e.event}`);

      return {
        events: todayEvents.slice(0, 10).map((e: any) => ({
          time: e.date,
          currency: e.country,
          event: e.event,
          forecast: e.forecast || 'N/A',
          previous: e.previous || 'N/A',
          importance: e.importance || 'LOW'
        })),
        highImpactEvents,
        marketExpectations: this.generateMarketExpectations(todayEvents)
      };
    } catch (error) {
      logger.error('Error getting economic calendar:', error);
      return this.getDefaultCalendar();
    }
  }

  /**
   * Analyze futures sentiment
   */
  async getFuturesAnalysis(): Promise<any> {
    try {
      const token = process.env.IEX_CLOUD_API_KEY;
      if (!token) throw new Error('Missing IEX Cloud API key');

      const [esData, nqData, ymData] = await Promise.allSettled([
        axios.get(`https://cloud.iexapis.com/stable/stock/ES/quote?token=${token}`, { timeout: 5000 }),
        axios.get(`https://cloud.iexapis.com/stable/stock/NQ/quote?token=${token}`, { timeout: 5000 }),
        axios.get(`https://cloud.iexapis.com/stable/stock/YM/quote?token=${token}`, { timeout: 5000 })
      ]);

      const createFutureAnalysis = (data: any, name: string) => ({
        symbol: name,
        price: data?.latestPrice || 0,
        change: (data?.latestPrice || 0) - (data?.open || 0),
        changePercent: data?.changePercent || 0,
        sentiment: (data?.changePercent || 0) > 0 ? 'BULLISH' : (data?.changePercent || 0) < 0 ? 'BEARISH' : 'NEUTRAL'
      });

      const es = esData.status === 'fulfilled' ? createFutureAnalysis(esData.value.data, 'ES') : { symbol: 'ES', price: 0, change: 0, changePercent: 0, sentiment: 'NEUTRAL' };
      const nq = nqData.status === 'fulfilled' ? createFutureAnalysis(nqData.value.data, 'NQ') : { symbol: 'NQ', price: 0, change: 0, changePercent: 0, sentiment: 'NEUTRAL' };
      const ym = ymData.status === 'fulfilled' ? createFutureAnalysis(ymData.value.data, 'YM') : { symbol: 'YM', price: 0, change: 0, changePercent: 0, sentiment: 'NEUTRAL' };

      const bullishCount = [es, nq, ym].filter(f => f.sentiment === 'BULLISH').length;
      const bearishCount = [es, nq, ym].filter(f => f.sentiment === 'BEARISH').length;
      
      let generalSentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH' = 'NEUTRAL';
      if (bullishCount > bearishCount) generalSentiment = 'BULLISH';
      if (bearishCount > bullishCount) generalSentiment = 'BEARISH';

      return { es, nq, ym, generalSentiment };
    } catch (error) {
      logger.error('Error analyzing futures:', error);
      return this.getDefaultFutures();
    }
  }

  /**
   * Get technical setup for key indices
   */
  private async getTechnicalSetup(): Promise<any[]> {
    try {
      const setups = [];

      for (const symbol of this.KEY_INDICES) {
        try {
          const token = process.env.IEX_CLOUD_API_KEY;
          const response = await axios.get(
            `https://cloud.iexapis.com/stable/stock/${symbol}/quote?token=${token}`,
            { timeout: 5000 }
          );

          const data = response.data;
          const week52High = data.week52High || 0;
          const week52Low = data.week52Low || 0;
          const current = data.latestPrice || 0;

          // Calculate pivot points
          const pp = (week52High + week52Low + current) / 3;
          const r1 = (2 * pp) - week52Low;
          const s1 = (2 * pp) - week52High;

          setups.push({
            key: symbol,
            levels: {
              resistance: [r1, r1 * 1.05],
              support: [s1, s1 * 0.95]
            },
            pivots: { r1, pp, s1 },
            signals: this.generateTechnicalSignals(current, pp, r1, s1)
          });
        } catch (error) {
          logger.error(`Error getting technical setup for ${symbol}:`, error);
        }
      }

      return setups;
    } catch (error) {
      logger.error('Error in getTechnicalSetup:', error);
      return [];
    }
  }

  /**
   * Generate trading recommendations
   */
  private generateRecommendations(movers: any, calendar: any): any[] {
    const recommendations = [];

    // Recommend trading the biggest gainers with caution
    if (movers.gainers && movers.gainers.length > 0) {
      recommendations.push({
        symbol: movers.gainers[0].symbol,
        action: 'WATCH',
        rationale: `Strong pre-market gainer up ${movers.gainers[0].changePercent.toFixed(2)}%`
      });
    }

    // Flag high-impact economic events
    if (calendar.highImpactEvents && calendar.highImpactEvents.length > 0) {
      recommendations.push({
        symbol: 'INDICES',
        action: 'CAUTION',
        rationale: `High-impact economic events: ${calendar.highImpactEvents.join(', ')}`
      });
    }

    return recommendations;
  }

  /**
   * Generate key themes
   */
  private generateKeyThemes(movers: any): string[] {
    const themes = [];

    if (movers.gainers && movers.gainers.length > 0) {
      const topGainer = movers.gainers[0];
      themes.push(`Tech strength: ${topGainer.symbol} leads gainers`);
    }

    if (movers.mostActive && movers.mostActive.length > 0) {
      const topActive = movers.mostActive[0];
      themes.push(`High volume in ${topActive.symbol}`);
    }

    themes.push('Market awaiting economic data');

    return themes;
  }

  /**
   * Identify risk factors
   */
  private identifyRiskFactors(calendar: any): string[] {
    const risks = [];

    if (calendar.highImpactEvents && calendar.highImpactEvents.length > 0) {
      risks.push('High-impact economic events scheduled');
    }

    risks.push('Pre-market volatility possible');
    risks.push('Overnight gap risk from international markets');

    return risks;
  }

  /**
   * Generate market expectations
   */
  private generateMarketExpectations(events: any[]): string[] {
    const expectations = [];

    for (const event of events.slice(0, 3)) {
      if (event.importance === 'HIGH') {
        expectations.push(`Market focusing on ${event.event}`);
      }
    }

    return expectations.length > 0 ? expectations : ['Market awaiting economic releases'];
  }

  /**
   * Generate technical signals
   */
  private generateTechnicalSignals(current: number, pp: number, r1: number, s1: number): string[] {
    const signals = [];

    if (current > r1) {
      signals.push('Trading above resistance');
    } else if (current > pp) {
      signals.push('Above pivot point');
    } else if (current < s1) {
      signals.push('Trading below support');
    } else if (current < pp) {
      signals.push('Below pivot point');
    }

    return signals;
  }

  /**
   * Get next market open time
   */
  private getNextMarketOpen(now: Date): Date {
    const marketOpen = new Date(now);
    marketOpen.setHours(this.MARKET_OPEN_HOUR, this.MARKET_OPEN_MINUTE, 0, 0);

    // EST timezone (adjust as needed)
    const estOffset = -5 * 60 * 60 * 1000; // EST
    const marketOpenEst = new Date(marketOpen.getTime() + estOffset);

    if (marketOpenEst.getTime() <= now.getTime()) {
      marketOpen.setDate(marketOpen.getDate() + 1);
    }

    return marketOpen;
  }

  /**
   * Default movers
   */
  private getDefaultMovers(): any {
    return {
      gainers: [],
      losers: [],
      mostActive: []
    };
  }

  /**
   * Default calendar
   */
  private getDefaultCalendar(): any {
    return {
      events: [],
      highImpactEvents: [],
      marketExpectations: ['Market awaiting data']
    };
  }

  /**
   * Default futures
   */
  private getDefaultFutures(): any {
    return {
      es: { symbol: 'ES', price: 0, change: 0, changePercent: 0, sentiment: 'NEUTRAL' },
      nq: { symbol: 'NQ', price: 0, change: 0, changePercent: 0, sentiment: 'NEUTRAL' },
      ym: { symbol: 'YM', price: 0, change: 0, changePercent: 0, sentiment: 'NEUTRAL' },
      generalSentiment: 'NEUTRAL' as any
    };
  }

  /**
   * Default pre-market analysis
   */
  private getDefaultPremarketAnalysis(): PremarketAnalysis {
    return {
      timestamp: new Date(),
      marketOpen: this.getNextMarketOpen(new Date()),
      hoursUntilOpen: 0,
      premarketMovers: this.getDefaultMovers(),
      economicCalendar: this.getDefaultCalendar(),
      futuresAnalysis: this.getDefaultFutures(),
      technicalSetup: [],
      keyThemes: [],
      riskFactors: [],
      tradingRecommendations: []
    };
  }
}

export const premarketService = new PremarketService();
