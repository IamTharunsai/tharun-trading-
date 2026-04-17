import axios from 'axios';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

interface SentimentScore {
  text: string;
  sentiment: 'VERY_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'VERY_NEGATIVE';
  score: number; // -1 to 1
  confidence: number; // 0-100
  source: 'NEWS' | 'TWITTER' | 'REDDIT' | 'EARNINGS_CALL' | 'ANALYST';
  timestamp: Date;
}

interface AggregatedSentiment {
  asset: string;
  currentSentiment: number; // -1 to 1
  weightedSentiment: number; // -1 to 1 (with time decay)
  sentiment24h: number;
  sentiment7d: number;
  sentiment30d: number;
  trendDirection: 'IMPROVING' | 'DETERIORATING' | 'STABLE';
  sentiment: 'VERY_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'VERY_NEGATIVE';
  confidence: number; // 0-100
  numberOfSources: number;
  lastUpdate: Date;
  volatilityOfSentiment: number; // 0-1 (higher = more volatile)
}

interface SentimentSignal {
  signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  strength: number; // 0-100
  reasoning: string;
}

class SentimentService {
  private readonly CACHE_TTL = 600; // 10 minutes
  private readonly TIME_DECAY_HALF_LIFE = 7; // 7 days
  private readonly HUGGINGFACE_API = 'https://api-inference.huggingface.co/models/ProsusAI/finBERT';

  /**
   * Analyze sentiment for an asset
   */
  async analyzeSentiment(asset: string): Promise<AggregatedSentiment> {
    try {
      const cacheKey = `sentiment:${asset}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const sentiments = await this.fetchSentiments(asset);
      const weighted = this.calculateWeightedSentiment(sentiments);
      const trend = this.determineTrend(sentiments);

      const aggregated: AggregatedSentiment = {
        asset,
        currentSentiment: sentiments.length > 0 ? sentiments[0].score : 0,
        weightedSentiment: weighted,
        sentiment24h: this.getSentimentForPeriod(sentiments, 1),
        sentiment7d: this.getSentimentForPeriod(sentiments, 7),
        sentiment30d: this.getSentimentForPeriod(sentiments, 30),
        trendDirection: trend,
        sentiment: this.scoreToSentiment(weighted),
        confidence: this.calculateConfidence(sentiments),
        numberOfSources: new Set(sentiments.map(s => s.source)).size,
        lastUpdate: new Date(),
        volatilityOfSentiment: this.calculateVolatility(sentiments)
      };

      await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(aggregated));
      return aggregated;
    } catch (error) {
      logger.error('Error in analyzeSentiment:', error);
      return this.getDefaultSentiment(asset);
    }
  }

  /**
   * Analyze news articles for sentiment
   */
  async analyzeNews(asset: string, newsTexts: string[]): Promise<SentimentScore[]> {
    try {
      const scores: SentimentScore[] = [];

      for (const text of newsTexts) {
        try {
          const sentiment = await this.scoreSentiment(text);
          scores.push({
            text: text.substring(0, 500),
            sentiment: sentiment.sentiment,
            score: sentiment.score,
            confidence: sentiment.confidence,
            source: 'NEWS',
            timestamp: new Date()
          });
        } catch (error) {
          logger.error('Error scoring individual article:', error);
        }
      }

      return scores;
    } catch (error) {
      logger.error('Error in analyzeNews:', error);
      return [];
    }
  }

  /**
   * Analyze social media sentiment
   */
  async analyzeSocialSentiment(asset: string, socialTexts: string[]): Promise<{
    averageSentiment: number;
    positiveSentiments: number;
    negativeSentiments: number;
    neutralSentiments: number;
    sentimentShift: 'IMPROVING' | 'DETERIORATING' | 'STABLE';
  }> {
    try {
      const scores = await this.analyzeNews(asset, socialTexts);
      
      const positive = scores.filter(s => s.score > 0.3).length;
      const negative = scores.filter(s => s.score < -0.3).length;
      const neutral = scores.filter(s => Math.abs(s.score) <= 0.3).length;

      const averageSentiment = scores.length > 0
        ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
        : 0;

      const shift = positive > negative ? 'IMPROVING' : negative > positive ? 'DETERIORATING' : 'STABLE';

      return {
        averageSentiment,
        positiveSentiments: positive,
        negativeSentiments: negative,
        neutralSentiments: neutral,
        sentimentShift: shift as any
      };
    } catch (error) {
      logger.error('Error in analyzeSocialSentiment:', error);
      return {
        averageSentiment: 0,
        positiveSentiments: 0,
        negativeSentiments: 0,
        neutralSentiments: 0,
        sentimentShift: 'STABLE'
      };
    }
  }

  /**
   * Get sentiment trading signal
   */
  async getSentimentSignal(asset: string): Promise<SentimentSignal> {
    try {
      const sentiment = await this.analyzeSentiment(asset);
      
      let signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH' = 'NEUTRAL';
      let strength = 0;
      let reasoning = '';

      if (sentiment.weightedSentiment > 0.5 && sentiment.confidence > 70) {
        signal = 'BULLISH';
        strength = Math.min(100, sentiment.weightedSentiment * 100);
        reasoning = 'Strong positive sentiment across multiple sources';
      } else if (sentiment.weightedSentiment > 0.2) {
        signal = 'BULLISH';
        strength = 50;
        reasoning = 'Moderately positive sentiment';
      } else if (sentiment.weightedSentiment < -0.5 && sentiment.confidence > 70) {
        signal = 'BEARISH';
        strength = Math.min(100, Math.abs(sentiment.weightedSentiment) * 100);
        reasoning = 'Strong negative sentiment across multiple sources';
      } else if (sentiment.weightedSentiment < -0.2) {
        signal = 'BEARISH';
        strength = 50;
        reasoning = 'Moderately negative sentiment';
      } else {
        reasoning = 'Sentiment is neutral or mixed';
      }

      return { signal, strength, reasoning };
    } catch (error) {
      logger.error('Error in getSentimentSignal:', error);
      return {
        signal: 'NEUTRAL',
        strength: 0,
        reasoning: 'Unable to calculate sentiment'
      };
    }
  }

  /**
   * Compare sentiment across multiple assets
   */
  async compareSentiments(assets: string[]): Promise<Array<{asset: string, sentiment: number, rank: number}>> {
    try {
      const sentiments = await Promise.all(
        assets.map(asset => this.analyzeSentiment(asset))
      );

      const comparisons = sentiments
        .map(s => ({ asset: s.asset, sentiment: s.weightedSentiment }))
        .sort((a, b) => b.sentiment - a.sentiment)
        .map((item, index) => ({ ...item, rank: index + 1 }));

      return comparisons;
    } catch (error) {
      logger.error('Error in compareSentiments:', error);
      return [];
    }
  }

  /**
   * Score sentiment using finBERT model
   */
  private async scoreSentiment(text: string): Promise<{
    sentiment: 'VERY_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'VERY_NEGATIVE';
    score: number;
    confidence: number;
  }> {
    try {
      const apiKey = process.env.HUGGINGFACE_API_KEY;
      if (!apiKey) {
        throw new Error('Missing HuggingFace API key');
      }

      const response = await axios.post(
        this.HUGGINGFACE_API,
        { inputs: text },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 5000
        }
      );

      // Parse finBERT output
      const results = response.data[0];
      const positive = results.find((r: any) => r.label === 'positive')?.score || 0;
      const negative = results.find((r: any) => r.label === 'negative')?.score || 0;
      const neutral = results.find((r: any) => r.label === 'neutral')?.score || 0;

      const score = positive - negative;
      const confidence = Math.max(positive, negative, neutral) * 100;

      return {
        sentiment: this.scoreToSentiment(score),
        score,
        confidence
      };
    } catch (error) {
      logger.error('Error in scoreSentiment:', error);
      return {
        sentiment: 'NEUTRAL',
        score: 0,
        confidence: 0
      };
    }
  }

  /**
   * Convert score to sentiment classification
   */
  private scoreToSentiment(score: number): 'VERY_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'VERY_NEGATIVE' {
    if (score > 0.6) return 'VERY_POSITIVE';
    if (score > 0.2) return 'POSITIVE';
    if (score < -0.6) return 'VERY_NEGATIVE';
    if (score < -0.2) return 'NEGATIVE';
    return 'NEUTRAL';
  }

  /**
   * Fetch sentiments with time decay applied
   */
  private async fetchSentiments(asset: string): Promise<SentimentScore[]> {
    try {
      // In production, this would fetch from database or news API
      // For now, return empty array (system will fetch and cache)
      return [];
    } catch (error) {
      logger.error('Error fetching sentiments:', error);
      return [];
    }
  }

  /**
   * Calculate weighted sentiment with time decay
   */
  private calculateWeightedSentiment(sentiments: SentimentScore[]): number {
    if (sentiments.length === 0) return 0;

    const now = new Date().getTime();
    let totalWeight = 0;
    let weightedSum = 0;

    for (const sentiment of sentiments) {
      const ageInDays = (now - sentiment.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      const decayFactor = Math.pow(0.5, ageInDays / this.TIME_DECAY_HALF_LIFE);
      const weight = sentiment.confidence / 100 * decayFactor;

      totalWeight += weight;
      weightedSum += sentiment.score * weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Calculate sentiment for specific period
   */
  private getSentimentForPeriod(sentiments: SentimentScore[], days: number): number {
    const now = new Date().getTime();
    const periodSentiments = sentiments.filter(s => {
      const ageInDays = (now - s.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      return ageInDays <= days;
    });

    if (periodSentiments.length === 0) return 0;
    return periodSentiments.reduce((sum, s) => sum + s.score, 0) / periodSentiments.length;
  }

  /**
   * Determine sentiment trend
   */
  private determineTrend(sentiments: SentimentScore[]): 'IMPROVING' | 'DETERIORATING' | 'STABLE' {
    if (sentiments.length < 2) return 'STABLE';

    const recent = sentiments.slice(0, 5).reduce((sum, s) => sum + s.score, 0) / Math.min(5, sentiments.length);
    const older = sentiments.slice(5, 10).reduce((sum, s) => sum + s.score, 0) / Math.min(5, sentiments.length - 5 || 1);

    if (recent > older + 0.1) return 'IMPROVING';
    if (recent < older - 0.1) return 'DETERIORATING';
    return 'STABLE';
  }

  /**
   * Calculate sentiment confidence
   */
  private calculateConfidence(sentiments: SentimentScore[]): number {
    if (sentiments.length === 0) return 0;
    
    const avgConfidence = sentiments.reduce((sum, s) => sum + s.confidence, 0) / sentiments.length;
    const sourceVariety = new Set(sentiments.map(s => s.source)).size;
    const varietyBoost = Math.min(20, sourceVariety * 5);

    return Math.min(100, avgConfidence + varietyBoost);
  }

  /**
   * Calculate sentiment volatility
   */
  private calculateVolatility(sentiments: SentimentScore[]): number {
    if (sentiments.length < 2) return 0;

    const mean = sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length;
    const variance = sentiments.reduce((sum, s) => sum + Math.pow(s.score - mean, 2), 0) / sentiments.length;
    
    return Math.sqrt(variance);
  }

  /**
   * Default sentiment on error
   */
  private getDefaultSentiment(asset: string): AggregatedSentiment {
    return {
      asset,
      currentSentiment: 0,
      weightedSentiment: 0,
      sentiment24h: 0,
      sentiment7d: 0,
      sentiment30d: 0,
      trendDirection: 'STABLE',
      sentiment: 'NEUTRAL',
      confidence: 0,
      numberOfSources: 0,
      lastUpdate: new Date(),
      volatilityOfSentiment: 0
    };
  }
}

export const sentimentService = new SentimentService();
