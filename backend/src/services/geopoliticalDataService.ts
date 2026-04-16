import axios from 'axios';
import { logger } from '../utils/logger';
import { redis } from '../utils/redis';

/**
 * GEOPOLITICAL & NEWS DATA SERVICE
 * Fetches real-time news, geopolitical events, and market-moving information
 * Provides data that agents learn from
 */

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url?: string;
  timestamp: number;
  category: 'GEOPOLITICS' | 'CRYPTO' | 'STOCKS' | 'MACROECONOMICS' | 'EMERGENCY';
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  tags: string[];
  summary: string;
}

export interface GeopoliticalEvent {
  id: string;
  region: string;
  event: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  affectedAssets: string[]; // BTC, stocks, etc.
  timestamp: number;
  source: string;
}

export interface EconomicIndicator {
  name: string;
  region: string;
  value: number;
  previousValue?: number;
  forecast?: number;
  timestamp: number;
  impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

class GeopoliticalDataService {
  private newsCache: NewsItem[] = [];
  private geopoliticalEvents: GeopoliticalEvent[] = [];
  private economicIndicators: EconomicIndicator[] = [];
  private cacheTTL = 300; // 5 minutes

  async initialize() {
    // Start fetching news/events in background
    this.fetchNewsLoop();
    this.fetchGeopoliticalEventsLoop();
    logger.info('✅ Geopolitical data service initialized');
  }

  /**
   * Fetch real-time news from multiple sources
   */
  private async fetchNewsLoop() {
    setInterval(async () => {
      try {
        await this.fetchCryptoNews();
        await this.fetchMarketNews();
        await this.fetchGeopoliticalNews();
      } catch (err) {
        logger.warn('News fetch failed', { error: String(err) });
      }
    }, 60000); // Every minute
  }

  private async fetchCryptoNews() {
    try {
      // Example data - in production, call real API (Coindesk, CryptoSlate, etc.)
      const mockNews = this.generateMockCryptoNews();
      this.newsCache = [...this.newsCache, ...mockNews].slice(-50);
    } catch (err) {
      logger.warn('Failed to fetch crypto news', { error: String(err) });
    }
  }

  private async fetchMarketNews() {
    try {
      const mockNews = this.generateMockMarketNews();
      this.newsCache = [...this.newsCache, ...mockNews].slice(-50);
    } catch (err) {
      logger.warn('Failed to fetch market news', { error: String(err) });
    }
  }

  private async fetchGeopoliticalNews() {
    try {
      const mockNews = this.generateMockGeopoliticalNews();
      this.newsCache = [...this.newsCache, ...mockNews].slice(-50);
    } catch (err) {
      logger.warn('Failed to fetch geopolitical news', { error: String(err) });
    }
  }

  /**
   * Fetch geopolitical events
   */
  private async fetchGeopoliticalEventsLoop() {
    setInterval(async () => {
      try {
        const events = await this.fetchActivGeopoliticalEvents();
        this.geopoliticalEvents = events;
      } catch (err) {
        logger.warn('Geopolitical events fetch failed', { error: String(err) });
      }
    }, 120000); // Every 2 minutes
  }

  private async fetchActivGeopoliticalEvents(): Promise<GeopoliticalEvent[]> {
    // Mock data - in production, integrate with news API, GDELT, etc.
    const mockEvents = [
      {
        id: 'event-1',
        region: 'Middle East',
        event: 'Oil supply disruption concerns',
        severity: 'HIGH' as const,
        affectedAssets: ['BTC', 'GOLD', 'Oil'],
        timestamp: Date.now(),
        source: 'Reuters'
      },
      {
        id: 'event-2',
        region: 'US-China',
        event: 'Trade agreement negotiations',
        severity: 'MEDIUM' as const,
        affectedAssets: ['STOCKS', 'USD', 'TECH'],
        timestamp: Date.now() - 3600000,
        source: 'AP News'
      }
    ];

    return mockEvents;
  }

  /**
   * Mock data generators (replace with real APIs)
   */
  private generateMockCryptoNews(): NewsItem[] {
    const titles = [
      'Bitcoin ETF sees record inflows',
      'Ethereum upgrade improves scalability',
      'Regulatory clarity in Europe',
      'Major exchange security update',
      'DeFi TVL reaches new milestone'
    ];

    return [{
      id: `crypto-${Date.now()}`,
      title: titles[Math.floor(Math.random() * titles.length)],
      source: 'CryptoSlate',
      timestamp: Date.now(),
      category: 'CRYPTO',
      sentiment: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'][Math.floor(Math.random() * 3)] as any,
      impact: ['HIGH', 'MEDIUM', 'LOW'][Math.floor(Math.random() * 3)] as any,
      tags: ['bitcoin', 'ethereum', 'crypto'],
      summary: 'Important crypto market update affecting trading decisions'
    }];
  }

  private generateMockMarketNews(): NewsItem[] {
    const titles = [
      'Fed signals inflation control',
      'Corporate earnings beat expectations',
      'Market volatility increases',
      'Tech sector rallies on AI news',
      'Treasury yields rise again'
    ];

    return [{
      id: `market-${Date.now()}`,
      title: titles[Math.floor(Math.random() * titles.length)],
      source: 'Bloomberg',
      timestamp: Date.now(),
      category: 'MACROECONOMICS',
      sentiment: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'][Math.floor(Math.random() * 3)] as any,
      impact: ['HIGH', 'MEDIUM', 'LOW'][Math.floor(Math.random() * 3)] as any,
      tags: ['markets', 'economy', 'stocks'],
      summary: 'Market-moving economic data for traders to monitor'
    }];
  }

  private generateMockGeopoliticalNews(): NewsItem[] {
    const titles = [
      'Geopolitical tensions affect oil prices',
      'Trade war concerns resurface',
      'Central bank policy divergence',
      'Sanctions impact commodity markets',
      'Regional conflict escalates'
    ];

    return [{
      id: `geo-${Date.now()}`,
      title: titles[Math.floor(Math.random() * titles.length)],
      source: 'Reuters',
      timestamp: Date.now(),
      category: 'GEOPOLITICS',
      sentiment: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'][Math.floor(Math.random() * 3)] as any,
      impact: ['HIGH', 'MEDIUM', 'LOW'][Math.floor(Math.random() * 3)] as any,
      tags: ['geopolitics', 'markets', 'risk'],
      summary: 'Geopolitical developments affecting global markets'
    }];
  }

  /**
   * Get recent news
   */
  getRecentNews(minutes: number = 60, category?: string): NewsItem[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    let filtered = this.newsCache.filter(n => n.timestamp > cutoff);

    if (category) {
      filtered = filtered.filter(n => n.category === category);
    }

    return filtered.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get high-impact news only
   */
  getHighImpactNews(minutes: number = 60): NewsItem[] {
    return this.getRecentNews(minutes).filter(n => n.impact === 'HIGH');
  }

  /**
   * Get active geopolitical events
   */
  getActiveGeopoliticalEvents(hours: number = 24): GeopoliticalEvent[] {
    const cutoff = Date.now() - hours * 3600000;
    return this.geopoliticalEvents
      .filter(e => e.timestamp > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get critical events (for alert system)
   */
  getCriticalEvents(): GeopoliticalEvent[] {
    return this.geopoliticalEvents
      .filter(e => e.severity === 'CRITICAL' || e.severity === 'HIGH')
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get news by sentiment
   */
  getNewsBySentiment(sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL', minutes: number = 60): NewsItem[] {
    return this.getRecentNews(minutes).filter(n => n.sentiment === sentiment);
  }

  /**
   * Get summary of market conditions based on news/events
   */
  generateMarketSentimentSummary(): any {
    const recentNews = this.getRecentNews(120);
    const positiveCount = recentNews.filter(n => n.sentiment === 'POSITIVE').length;
    const negativeCount = recentNews.filter(n => n.sentiment === 'NEGATIVE').length;
    const total = recentNews.length;

    const sentiment = positiveCount > negativeCount ? 'BULLISH' : 
                     negativeCount > positiveCount ? 'BEARISH' : 'NEUTRAL';

    return {
      overallSentiment: sentiment,
      positiveNews: positiveCount,
      negativeNews: negativeCount,
      totalNews: total,
      sentimentRatio: total > 0 ? (positiveCount / total).toFixed(2) : 0,
      criticalEvents: this.getCriticalEvents().length,
      analyzedAt: new Date().toISOString()
    };
  }

  /**
   * Get context for agent learning
   */
  getLearningContext() {
    return {
      recentNews: this.getRecentNews(120),
      highImpactNews: this.getHighImpactNews(60),
      geopoliticalEvents: this.getActiveGeopoliticalEvents(24),
      marketSentiment: this.generateMarketSentimentSummary(),
      urgentAlerts: this.getCriticalEvents()
    };
  }
}

export const geopoliticalDataService = new GeopoliticalDataService();
