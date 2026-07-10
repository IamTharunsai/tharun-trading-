import axios from 'axios';
import { logger } from '../utils/logger';
import { redis } from '../utils/redis';

const FH_KEY = process.env.FINNHUB_API_KEY;

const GEO_KEYWORDS = ['war', 'sanction', 'tariff', 'election', 'conflict', 'military', 'invasion', 'geopolit', 'opec', 'ceasefire'];
const NEGATIVE_KEYWORDS = ['crash', 'plunge', 'recession', 'layoff', 'default', 'lawsuit', 'sanction', 'war', 'conflict', 'crisis', 'inflation', 'slump', 'fall', 'drop', 'cut'];
const POSITIVE_KEYWORDS = ['surge', 'rally', 'record', 'beat', 'growth', 'gain', 'soar', 'upgrade', 'boom', 'recovery'];
const HIGH_IMPACT_KEYWORDS = ['fed', 'rate', 'war', 'recession', 'inflation', 'crash', 'sanction', 'default'];

// Which real-world sectors a headline actually touches — was previously
// hardcoded to ['STOCKS', 'USD'] for every single geopolitical event
// regardless of content, so two completely different Middle East headlines
// both showed "Affects: STOCKS, USD". ponytail: keyword heuristics, not a
// real event->impact model — upgrade if segment accuracy matters more.
const SECTOR_KEYWORDS: [string, string[]][] = [
  ['Energy', ['oil', 'opec', 'crude', 'gas price', 'pipeline', 'refinery', 'petroleum']],
  ['Financials', ['fed', 'federal reserve', 'interest rate', 'rate hike', 'rate cut', 'treasury yield', 'bank ', 'banking']],
  ['Technology', ['chip', 'semiconductor', 'nvidia', ' ai ', 'artificial intelligence', 'software', 'tech stocks']],
  ['Industrials', ['tariff', 'trade war', 'supply chain', 'manufacturing', 'shipping', 'export', 'import']],
  ['Airlines & Travel', ['airline', 'flight', 'travel ban', 'airspace', 'tourism']],
  ['Defense', ['military', 'missile', 'defense contractor', 'weapons', 'pentagon']],
  ['Consumer', ['retail', 'consumer spending', 'inflation', 'cpi']],
  ['Crypto', ['bitcoin', 'crypto', 'blockchain', 'ethereum']],
  ['Healthcare', ['fda', 'drug price', 'pharma', 'vaccine', 'biotech']],
];

export function classifySectors(text: string): string[] {
  const lower = text.toLowerCase();
  const sectors = SECTOR_KEYWORDS.filter(([, kws]) => kws.some(k => lower.includes(k))).map(([sector]) => sector);
  return sectors.length > 0 ? sectors : ['Broad Market'];
}

// ponytail: keyword heuristics for sentiment/category/impact, not real NLP — upgrade to a sentiment model if headline-level classification proves too noisy
function classifyHeadline(text: string): { sentiment: NewsItem['sentiment']; impact: NewsItem['impact']; category: NewsItem['category']; sectorsAffected: string[] } {
  const lower = text.toLowerCase();
  const isGeo = GEO_KEYWORDS.some(k => lower.includes(k));
  const isNeg = NEGATIVE_KEYWORDS.some(k => lower.includes(k));
  const isPos = POSITIVE_KEYWORDS.some(k => lower.includes(k));
  const isHighImpact = HIGH_IMPACT_KEYWORDS.some(k => lower.includes(k));

  return {
    sentiment: isNeg && !isPos ? 'NEGATIVE' : isPos && !isNeg ? 'POSITIVE' : 'NEUTRAL',
    impact: isHighImpact ? 'HIGH' : 'MEDIUM',
    category: isGeo ? 'GEOPOLITICS' : 'MACROECONOMICS',
    sectorsAffected: classifySectors(text),
  };
}

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
  sectorsAffected: string[];
}

export interface GeopoliticalEvent {
  id: string;
  region: string;
  event: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  affectedAssets: string[]; // real sectors touched (Energy, Financials, etc.) — see classifySectors
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
    // Fetch once synchronously before serving any requests — setInterval's
    // first tick doesn't fire until 60s/120s later, so every request in that
    // window (e.g. right after a restart) got an empty cache and rendered as
    // "No news analyzed yet" even though the feeds were fine.
    await Promise.all([
      this.fetchNewsOnce().catch(err => logger.warn('Initial news fetch failed', { error: String(err) })),
      this.fetchActivGeopoliticalEvents().then(events => { this.geopoliticalEvents = events; }).catch(err => logger.warn('Initial geopolitical fetch failed', { error: String(err) })),
    ]);
    this.fetchNewsLoop();
    this.fetchGeopoliticalEventsLoop();
    logger.info('✅ Geopolitical data service initialized');
  }

  private async fetchNewsOnce() {
    await this.fetchCryptoNews();
    await this.fetchMarketNews(); // also populates geopolitics-tagged items from the same feed
  }

  /**
   * Fetch real-time news from multiple sources
   */
  private fetchNewsLoop() {
    setInterval(async () => {
      try {
        await this.fetchNewsOnce();
      } catch (err) {
        logger.warn('News fetch failed', { error: String(err) });
      }
    }, 60000); // Every minute
  }

  private async fetchFinnhubNews(category: 'general' | 'crypto', tag: string): Promise<NewsItem[]> {
    const res = await axios.get('https://finnhub.io/api/v1/news', {
      params: { category, token: FH_KEY },
      timeout: 10000,
    });
    return (res.data || []).slice(0, 15).map((n: any) => {
      const cls = classifyHeadline(`${n.headline} ${n.summary || ''}`);
      return {
        id: `${category}-${n.id}`,
        title: n.headline,
        source: n.source,
        url: n.url,
        timestamp: (n.datetime || Date.now() / 1000) * 1000,
        category: category === 'crypto' ? 'CRYPTO' : cls.category,
        sentiment: cls.sentiment,
        impact: cls.impact,
        tags: [tag],
        summary: n.summary || n.headline,
        sectorsAffected: cls.sectorsAffected,
      } as NewsItem;
    });
  }

  private async fetchCryptoNews() {
    try {
      const news = await this.fetchFinnhubNews('crypto', 'crypto');
      this.newsCache = [...this.newsCache, ...news].slice(-50);
    } catch (err) {
      logger.warn('Failed to fetch crypto news', { error: String(err) });
    }
  }

  private async fetchMarketNews() {
    try {
      const news = await this.fetchFinnhubNews('general', 'markets');
      for (const n of news) {
        if (n.category === 'GEOPOLITICS') n.tags.push('geopolitics');
      }
      this.newsCache = [...this.newsCache, ...news].slice(-50);
    } catch (err) {
      logger.warn('Failed to fetch market news', { error: String(err) });
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

  // ponytail: region tagged by keyword match against real headlines, not a geocoding model — upgrade if region accuracy matters
  private static REGION_KEYWORDS: [string, string[]][] = [
    ['Middle East', ['israel', 'gaza', 'iran', 'saudi', 'qatar', 'oman', 'opec', 'houthi']],
    ['US-China', ['china', 'taiwan', 'beijing', 'tariff']],
    ['Russia-Ukraine', ['russia', 'ukraine', 'moscow', 'kremlin']],
    ['Europe', ['eu ', 'europe', 'ecb', 'brexit']],
  ];

  private async fetchActivGeopoliticalEvents(): Promise<GeopoliticalEvent[]> {
    const geoNews = this.newsCache
      .filter(n => n.category === 'GEOPOLITICS' && n.impact === 'HIGH')
      .slice(0, 10);

    return geoNews.map(n => {
      const lower = n.title.toLowerCase();
      const region = GeopoliticalDataService.REGION_KEYWORDS.find(([, kws]) => kws.some(k => lower.includes(k)))?.[0] || 'Global';
      return {
        id: n.id,
        region,
        event: n.title,
        severity: 'HIGH' as const,
        affectedAssets: n.sectorsAffected,
        timestamp: n.timestamp,
        source: n.source,
      };
    });
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
