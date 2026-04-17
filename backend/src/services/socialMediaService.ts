import axios from 'axios';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

interface SocialMediaMetrics {
  asset: string;
  timestamp: Date;
  twitter: {
    volume24h: number;
    volumeChange: number; // % change from baseline
    sentiment: number; // -1 to 1
    engagementRate: number; // 0-1
    mentionsTrending: boolean;
    topMention: string;
    influencerMentions: number;
  };
  reddit: {
    postCount24h: number;
    postCountChange: number; // % change from baseline
    upvoteRatio: number; // 0-1
    sentiment: number; // -1 to 1
    subredditsTrending: string[];
    communityGrowth: number; // % change
  };
  stocktwits: {
    sentimentScore: number; // 0-100
    bullishCount: number;
    bearishCount: number;
    messages24h: number;
    messagesChange: number;
  };
  aggregated: {
    totalVolume: number;
    volumeAnomaly: number; // Standard deviations from baseline
    isAnomaly: boolean;
    anomalyType: 'PUMP' | 'FUD' | 'INSTITUTIONAL' | 'RETAIL_FOMO' | 'NORMAL';
    anomalyStrength: number; // 0-100
  };
}

interface AnomalyDetection {
  asset: string;
  anomalyDetected: boolean;
  anomalyType: 'PUMP' | 'FUD' | 'INSTITUTIONAL' | 'RETAIL_FOMO' | 'NORMAL';
  anomalyScore: number; // 0-100
  confidence: number; // 0-100
  timeframeHours: number;
  recommendation: string;
  details: {
    source: string;
    reason: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }[];
}

class SocialMediaService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly BASELINE_PERIOD_DAYS = 30;
  private readonly ANOMALY_THRESHOLD = 2; // 2 standard deviations

  /**
   * Get comprehensive social media metrics
   */
  async getSocialMediaMetrics(asset: string): Promise<SocialMediaMetrics> {
    try {
      const cacheKey = `social_media:${asset}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const [twitterData, redditData, stocktwitsData] = await Promise.allSettled([
        this.getTwitterMetrics(asset),
        this.getRedditMetrics(asset),
        this.getStocktwitsMetrics(asset)
      ]);

      const twitter = twitterData.status === 'fulfilled' ? twitterData.value : this.getDefaultTwitter();
      const reddit = redditData.status === 'fulfilled' ? redditData.value : this.getDefaultReddit();
      const stocktwits = stocktwitsData.status === 'fulfilled' ? stocktwitsData.value : this.getDefaultStocktwits();

      const metrics: SocialMediaMetrics = {
        asset,
        timestamp: new Date(),
        twitter,
        reddit,
        stocktwits,
        aggregated: this.aggregateSocialMetrics(twitter, reddit, stocktwits)
      };

      await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(metrics));
      return metrics;
    } catch (error) {
      logger.error('Error in getSocialMediaMetrics:', error);
      return this.getDefaultMetrics(asset);
    }
  }

  /**
   * Detect social media anomalies
   */
  async detectAnomalies(asset: string): Promise<AnomalyDetection> {
    try {
      const metrics = await this.getSocialMediaMetrics(asset);
      const baseline = await this.getBaseline(asset);

      const volumeAnomaly = metrics.aggregated.volumeAnomaly;
      const isAnomaly = Math.abs(volumeAnomaly) > this.ANOMALY_THRESHOLD;

      let anomalyType: 'PUMP' | 'FUD' | 'INSTITUTIONAL' | 'RETAIL_FOMO' | 'NORMAL' = 'NORMAL';
      let confidence = 0;
      let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';

      if (isAnomaly) {
        const result = this.classifyAnomaly(metrics);
        anomalyType = result.type;
        confidence = result.confidence;
        severity = result.severity;
      }

      const details = this.generateAnomalyDetails(metrics, baseline, anomalyType);

      return {
        asset,
        anomalyDetected: isAnomaly,
        anomalyType,
        anomalyScore: metrics.aggregated.anomalyStrength,
        confidence,
        timeframeHours: 24,
        recommendation: this.getAnomalyRecommendation(anomalyType, confidence),
        details
      };
    } catch (error) {
      logger.error('Error in detectAnomalies:', error);
      return {
        asset,
        anomalyDetected: false,
        anomalyType: 'NORMAL',
        anomalyScore: 0,
        confidence: 0,
        timeframeHours: 24,
        recommendation: 'Unable to detect anomalies',
        details: []
      };
    }
  }

  /**
   * Get trending stocks on social media
   */
  async getTrendingStocks(): Promise<Array<{symbol: string, mentions: number, sentiment: number, trend: string}>> {
    try {
      const cacheKey = 'social_trending:all';
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const [twitterTrending, redditTrending] = await Promise.allSettled([
        this.getTwitterTrending(),
        this.getRedditTrending()
      ]);

      const allTrending = [
        ...(twitterTrending.status === 'fulfilled' ? twitterTrending.value : []),
        ...(redditTrending.status === 'fulfilled' ? redditTrending.value : [])
      ];

      // Aggregate and sort by mentions
      const aggregated = allTrending.reduce((acc: Record<string, any>, item: any) => {
        if (!acc[item.symbol]) {
          acc[item.symbol] = { symbol: item.symbol, mentions: 0, sentiment: 0, sentimentCount: 0, trend: '' };
        }
        acc[item.symbol].mentions += item.mentions;
        acc[item.symbol].sentiment += item.sentiment;
        acc[item.symbol].sentimentCount += 1;
        acc[item.symbol].trend = item.trend;
        return acc;
      }, {});

      const trending = Object.values(aggregated)
        .map((item: any) => ({
          symbol: item.symbol,
          mentions: item.mentions,
          sentiment: item.sentimentCount > 0 ? item.sentiment / item.sentimentCount : 0,
          trend: item.trend
        }))
        .sort((a: any, b: any) => b.mentions - a.mentions)
        .slice(0, 20);

      await redis.setex(cacheKey, 120, JSON.stringify(trending)); // 2 min cache for trending
      return trending;
    } catch (error) {
      logger.error('Error in getTrendingStocks:', error);
      return [];
    }
  }

  /**
   * Get Twitter metrics for asset
   */
  private async getTwitterMetrics(asset: string): Promise<any> {
    try {
      const apiKey = process.env.TWITTER_API_KEY;
      if (!apiKey) throw new Error('Missing Twitter API key');

      // Twitter API v2 search
      const response = await axios.get(
        `https://api.twitter.com/2/tweets/search/recent?query=${asset}%20-is%3Aretweet&max_results=100&tweet.fields=created_at,public_metrics`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 5000
        }
      );

      const tweets = response.data.data || [];
      const totalEngagement = tweets.reduce((sum: number, t: any) => 
        sum + (t.public_metrics.like_count + t.public_metrics.retweet_count), 0);

      return {
        volume24h: tweets.length,
        volumeChange: 0, // Would calculate from baseline
        sentiment: 0, // Would calculate from sentiment analysis
        engagementRate: tweets.length > 0 ? totalEngagement / tweets.length / 1000 : 0,
        mentionsTrending: tweets.length > 50,
        topMention: tweets[0]?.text || '',
        influencerMentions: 0 // Would filter by follower count
      };
    } catch (error) {
      logger.error('Error getting Twitter metrics:', error);
      return this.getDefaultTwitter();
    }
  }

  /**
   * Get Reddit metrics for asset
   */
  private async getRedditMetrics(asset: string): Promise<any> {
    try {
      const clientId = process.env.REDDIT_CLIENT_ID;
      const clientSecret = process.env.REDDIT_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) throw new Error('Missing Reddit credentials');

      // Reddit API authentication and search
      const authResponse = await axios.post(
        'https://www.reddit.com/api/v1/access_token',
        { grant_type: 'client_credentials' },
        {
          auth: { username: clientId, password: clientSecret },
          timeout: 5000
        }
      );

      const token = authResponse.data.access_token;

      const searchResponse = await axios.get(
        `https://oauth.reddit.com/r/wallstreetbets/search?q=${asset}&sort=new&limit=100`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000
        }
      );

      const posts = searchResponse.data.data?.children || [];
      const totalUpvotes = posts.reduce((sum: number, p: any) => sum + p.data.ups, 0);

      return {
        postCount24h: posts.length,
        postCountChange: 0,
        upvoteRatio: posts.length > 0 ? totalUpvotes / (posts.length * 100) : 0,
        sentiment: 0,
        subredditsTrending: ['r/wallstreetbets', 'r/stocks'],
        communityGrowth: 0
      };
    } catch (error) {
      logger.error('Error getting Reddit metrics:', error);
      return this.getDefaultReddit();
    }
  }

  /**
   * Get Stocktwits metrics for asset
   */
  private async getStocktwitsMetrics(asset: string): Promise<any> {
    try {
      const response = await axios.get(
        `https://api.stocktwits.com/api/2/streams/symbol/${asset}.json?limit=100`,
        { timeout: 5000 }
      );

      const messages = response.data.messages || [];
      const sentiment = response.data.symbol?.sentiment || 0;

      const bullish = messages.filter((m: any) => m.entities?.sentiment?.basic === 'Bullish').length;
      const bearish = messages.filter((m: any) => m.entities?.sentiment?.basic === 'Bearish').length;

      return {
        sentimentScore: sentiment,
        bullishCount: bullish,
        bearishCount: bearish,
        messages24h: messages.length,
        messagesChange: 0
      };
    } catch (error) {
      logger.error('Error getting Stocktwits metrics:', error);
      return this.getDefaultStocktwits();
    }
  }

  /**
   * Aggregate social media metrics
   */
  private aggregateSocialMetrics(twitter: any, reddit: any, stocktwits: any): any {
    const totalVolume = twitter.volume24h + reddit.postCount24h + stocktwits.messages24h;
    const baselineVolume = 100; // Would come from historical baseline
    
    const volumeAnomaly = totalVolume > 0 
      ? (totalVolume - baselineVolume) / baselineVolume 
      : 0;

    const anomalyStrength = Math.min(100, Math.abs(volumeAnomaly) * 50);

    return {
      totalVolume,
      volumeAnomaly,
      isAnomaly: Math.abs(volumeAnomaly) > this.ANOMALY_THRESHOLD,
      anomalyType: 'NORMAL',
      anomalyStrength
    };
  }

  /**
   * Get historical baseline for asset
   */
  private async getBaseline(asset: string): Promise<any> {
    try {
      const cacheKey = `baseline:${asset}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // In production, would fetch from database
      const baseline = {
        avgDailyVolume: 100,
        avgTwitterMentions: 50,
        avgRedditPosts: 20,
        avgSentiment: 0
      };

      // Cache for 24 hours
      await redis.setex(cacheKey, 86400, JSON.stringify(baseline));
      return baseline;
    } catch (error) {
      logger.error('Error getting baseline:', error);
      return { avgDailyVolume: 100, avgTwitterMentions: 50, avgRedditPosts: 20, avgSentiment: 0 };
    }
  }

  /**
   * Classify anomaly type
   */
  private classifyAnomaly(metrics: SocialMediaMetrics): {type: 'PUMP' | 'FUD' | 'INSTITUTIONAL' | 'RETAIL_FOMO', confidence: number, severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'} {
    const twitterSentiment = metrics.twitter.sentiment;
    const redditSentiment = metrics.reddit.sentiment;
    const stocktwitsSentiment = metrics.stocktwits.sentimentScore > 50 ? 0.5 : -0.5;

    const avgSentiment = (twitterSentiment + redditSentiment + stocktwitsSentiment) / 3;

    // PUMP: High volume + high sentiment
    if (metrics.aggregated.volumeAnomaly > 3 && avgSentiment > 0.5) {
      return { type: 'PUMP', confidence: 85, severity: 'HIGH' };
    }

    // FUD: High volume + low sentiment
    if (metrics.aggregated.volumeAnomaly > 3 && avgSentiment < -0.5) {
      return { type: 'FUD', confidence: 85, severity: 'HIGH' };
    }

    // RETAIL_FOMO: Twitter/Reddit spike
    if (metrics.twitter.volume24h > 200 || metrics.reddit.postCount24h > 50) {
      return { type: 'RETAIL_FOMO', confidence: 70, severity: 'MEDIUM' };
    }

    // INSTITUTIONAL: Large single transaction mentions
    if (metrics.twitter.influencerMentions > 5) {
      return { type: 'INSTITUTIONAL', confidence: 60, severity: 'MEDIUM' };
    }

    // Default: No anomaly detected, return as low-confidence PUMP
    return { type: 'PUMP', confidence: 10, severity: 'LOW' };
  }

  /**
   * Generate anomaly details
   */
  private generateAnomalyDetails(metrics: SocialMediaMetrics, baseline: any, anomalyType: string): any[] {
    const details = [];

    if (metrics.twitter.volume24h > baseline.avgTwitterMentions * 2) {
      details.push({
        source: 'Twitter',
        reason: `Mentions up ${Math.round((metrics.twitter.volume24h / baseline.avgTwitterMentions - 1) * 100)}%`,
        severity: metrics.twitter.volume24h > baseline.avgTwitterMentions * 5 ? 'CRITICAL' : 'HIGH'
      });
    }

    if (metrics.reddit.postCount24h > baseline.avgRedditPosts * 2) {
      details.push({
        source: 'Reddit',
        reason: `Posts up ${Math.round((metrics.reddit.postCount24h / baseline.avgRedditPosts - 1) * 100)}%`,
        severity: metrics.reddit.postCount24h > baseline.avgRedditPosts * 5 ? 'CRITICAL' : 'HIGH'
      });
    }

    if (metrics.stocktwits.messages24h > 200) {
      details.push({
        source: 'Stocktwits',
        reason: `Messages surge to ${metrics.stocktwits.messages24h}`,
        severity: 'MEDIUM'
      });
    }

    return details.length > 0 ? details : [{ source: 'General', reason: 'Elevated social media activity', severity: 'LOW' }];
  }

  /**
   * Get anomaly recommendation
   */
  private getAnomalyRecommendation(type: string, confidence: number): string {
    if (type === 'PUMP' && confidence > 80) {
      return 'CAUTION: Potential pump detected - verify fundamentals before trading';
    }
    if (type === 'FUD' && confidence > 80) {
      return 'CAUTION: Fear mongering detected - check sources';
    }
    if (type === 'RETAIL_FOMO') {
      return 'NOTE: Retail attention spike - watch for volatility';
    }
    if (type === 'INSTITUTIONAL') {
      return 'NOTE: Institutional activity detected - potential significant move';
    }
    return 'Social media activity appears normal';
  }

  /**
   * Get Twitter trending
   */
  private async getTwitterTrending(): Promise<any[]> {
    return [];
  }

  /**
   * Get Reddit trending
   */
  private async getRedditTrending(): Promise<any[]> {
    return [];
  }

  /**
   * Default Twitter metrics
   */
  private getDefaultTwitter(): any {
    return { volume24h: 0, volumeChange: 0, sentiment: 0, engagementRate: 0, mentionsTrending: false, topMention: '', influencerMentions: 0 };
  }

  /**
   * Default Reddit metrics
   */
  private getDefaultReddit(): any {
    return { postCount24h: 0, postCountChange: 0, upvoteRatio: 0, sentiment: 0, subredditsTrending: [], communityGrowth: 0 };
  }

  /**
   * Default Stocktwits metrics
   */
  private getDefaultStocktwits(): any {
    return { sentimentScore: 0, bullishCount: 0, bearishCount: 0, messages24h: 0, messagesChange: 0 };
  }

  /**
   * Default metrics on error
   */
  private getDefaultMetrics(asset: string): SocialMediaMetrics {
    return {
      asset,
      timestamp: new Date(),
      twitter: this.getDefaultTwitter(),
      reddit: this.getDefaultReddit(),
      stocktwits: this.getDefaultStocktwits(),
      aggregated: { totalVolume: 0, volumeAnomaly: 0, isAnomaly: false, anomalyType: 'NORMAL', anomalyStrength: 0 }
    };
  }
}

export const socialMediaService = new SocialMediaService();
