import axios from 'axios';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

interface MarketRegime {
  type: 'BULL_STRONG' | 'BULL_WEAK' | 'SIDEWAYS' | 'BEAR_WEAK' | 'BEAR_STRONG';
  volatility: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  characteristics: {
    name: string;
    description: string;
    expectedReturns: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  };
  indicators: {
    trend: number; // -100 to 100
    volatility: number; // 0-100
    momentum: number; // -100 to 100
    sentiment: number; // -100 to 100
    technicalHealth: number; // 0-100
  };
}

interface RegimeTransition {
  timestamp: Date;
  currentRegime: MarketRegime;
  transitionProbability: number; // 0-100
  likelyNextRegime: string;
  transitionStrength: number; // 0-100
  timeToTransition: {
    days: number;
    confidence: number; // 0-100
  };
  signals: Array<{
    signal: string;
    strength: number; // 0-100
    interpretation: string;
  }>;
  historicalContext: {
    daysInCurrentRegime: number;
    averageDaysPerRegime: number;
    previousRegimes: string[];
  };
  recommendations: string[];
}

interface RegimeIndicators {
  sma50: number;
  sma200: number;
  rsi14: number;
  macd: {value: number, signal: number, histogram: number};
  atr14: number;
  bbands: {upper: number, middle: number, lower: number};
  obv: number;
  adx: number;
}

class RegimeTransitionService {
  private readonly CACHE_TTL = 900; // 15 minutes
  private readonly REGIMES = {
    'BULL_STRONG': {
      name: 'Strong Bull',
      description: 'Robust uptrend with strong momentum',
      expectedReturns: '+15% to +30% annualized',
      riskLevel: 'LOW' as const
    },
    'BULL_WEAK': {
      name: 'Weak Bull',
      description: 'Uptrend losing momentum',
      expectedReturns: '+5% to +15% annualized',
      riskLevel: 'MEDIUM' as const
    },
    'SIDEWAYS': {
      name: 'Sideways/Range',
      description: 'Market trading in consolidation',
      expectedReturns: '0% to +8% annualized',
      riskLevel: 'MEDIUM' as const
    },
    'BEAR_WEAK': {
      name: 'Weak Bear',
      description: 'Downtrend with reduced pressure',
      expectedReturns: '-5% to -15% annualized',
      riskLevel: 'HIGH' as const
    },
    'BEAR_STRONG': {
      name: 'Strong Bear',
      description: 'Severe downtrend with high momentum',
      expectedReturns: '-15% to -30% annualized',
      riskLevel: 'EXTREME' as const
    }
  };

  /**
   * Get regime transition analysis
   */
  async getRegimeTransition(symbol: string = 'SPY'): Promise<RegimeTransition> {
    try {
      const cacheKey = `regime:${symbol}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const indicators = await this.fetchIndicators(symbol);
      const currentRegime = this.determineCurrentRegime(indicators);
      const signals = this.generateRegimeSignals(indicators, currentRegime);
      const transition = this.calculateTransitionProbability(indicators, currentRegime, signals);

      const analysis: RegimeTransition = {
        timestamp: new Date(),
        currentRegime,
        transitionProbability: transition.probability,
        likelyNextRegime: transition.nextRegime,
        transitionStrength: transition.strength,
        timeToTransition: transition.timing,
        signals,
        historicalContext: this.getHistoricalContext(symbol),
        recommendations: this.generateRecommendations(currentRegime, transition)
      };

      await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(analysis));
      return analysis;
    } catch (error) {
      logger.error('Error in getRegimeTransition:', error);
      return this.getDefaultTransition();
    }
  }

  /**
   * Get current market regime
   */
  async getCurrentRegime(symbol: string = 'SPY'): Promise<MarketRegime> {
    try {
      const indicators = await this.fetchIndicators(symbol);
      return this.determineCurrentRegime(indicators);
    } catch (error) {
      logger.error('Error in getCurrentRegime:', error);
      return this.getDefaultRegime();
    }
  }

  /**
   * Detect regime change
   */
  async detectRegimeChange(symbol: string = 'SPY'): Promise<{
    regimeChanged: boolean;
    previousRegime: string;
    currentRegime: string;
    changeStrength: number; // 0-100
    implications: string[];
  }> {
    try {
      const cacheKey = `regime_previous:${symbol}`;
      const previousRegimeStr = await redis.get(cacheKey);
      
      const transition = await this.getRegimeTransition(symbol);
      const currentRegimeStr = transition.currentRegime.type;

      const regimeChanged = previousRegimeStr && previousRegimeStr !== currentRegimeStr;

      // Update previous regime cache
      await redis.setex(cacheKey, 86400, currentRegimeStr); // 24 hour cache

      return {
        regimeChanged: regimeChanged || false,
        previousRegime: previousRegimeStr || 'UNKNOWN',
        currentRegime: currentRegimeStr,
        changeStrength: regimeChanged ? transition.transitionStrength : 0,
        implications: regimeChanged ? this.getRegimeChangeImplications(previousRegimeStr || '', currentRegimeStr) : []
      };
    } catch (error) {
      logger.error('Error in detectRegimeChange:', error);
      return {
        regimeChanged: false,
        previousRegime: 'UNKNOWN',
        currentRegime: 'UNKNOWN',
        changeStrength: 0,
        implications: []
      };
    }
  }

  /**
   * Compare regimes across multiple indices
   */
  async compareRegimes(symbols: string[]): Promise<Array<{symbol: string, regime: string, transitionRisk: number}>> {
    try {
      const regimes = await Promise.all(
        symbols.map(symbol => this.getRegimeTransition(symbol))
      );

      return symbols.map((symbol, index) => ({
        symbol,
        regime: regimes[index].currentRegime.type,
        transitionRisk: regimes[index].transitionProbability
      }));
    } catch (error) {
      logger.error('Error in compareRegimes:', error);
      return [];
    }
  }

  /**
   * Fetch technical indicators
   */
  private async fetchIndicators(symbol: string): Promise<RegimeIndicators> {
    try {
      const token = process.env.IEX_CLOUD_API_KEY;
      if (!token) throw new Error('Missing IEX Cloud API key');

      const [quoteRes, technicalRes] = await Promise.allSettled([
        axios.get(`https://cloud.iexapis.com/stable/stock/${symbol}/quote?token=${token}`, { timeout: 5000 }),
        axios.get(`https://cloud.iexapis.com/stable/stock/${symbol}/advanced_stats?token=${token}`, { timeout: 5000 })
      ]);

      const quote = quoteRes.status === 'fulfilled' ? quoteRes.value.data : {};
      const technical = technicalRes.status === 'fulfilled' ? technicalRes.value.data : {};

      return {
        sma50: technical.day50MovingAvg || quote.latestPrice || 0,
        sma200: technical.day200MovingAvg || quote.latestPrice || 0,
        rsi14: technical.rsi || 50,
        macd: {
          value: technical.macd?.value || 0,
          signal: technical.macd?.signal || 0,
          histogram: (technical.macd?.value || 0) - (technical.macd?.signal || 0)
        },
        atr14: technical.atrTrueRange || 0,
        bbands: {
          upper: (technical.day200MovingAvg || 0) + (technical.atrTrueRange || 0) * 2,
          middle: technical.day200MovingAvg || 0,
          lower: (technical.day200MovingAvg || 0) - (technical.atrTrueRange || 0) * 2
        },
        obv: technical.obv || 0,
        adx: technical.adx || 50
      };
    } catch (error) {
      logger.error('Error fetching indicators:', error);
      return this.getDefaultIndicators();
    }
  }

  /**
   * Determine current market regime
   */
  private determineCurrentRegime(indicators: RegimeIndicators): MarketRegime {
    // Trend score: 0-100 (higher = more bullish)
    const trendScore = this.calculateTrendScore(indicators);
    
    // Momentum score: -100 to 100
    const momentumScore = this.calculateMomentumScore(indicators);
    
    // Volatility assessment
    const volatilityLevel = this.assessVolatility(indicators);

    let regimeType: 'BULL_STRONG' | 'BULL_WEAK' | 'SIDEWAYS' | 'BEAR_WEAK' | 'BEAR_STRONG';

    if (trendScore > 70 && momentumScore > 30) {
      regimeType = 'BULL_STRONG';
    } else if (trendScore > 50 && momentumScore > 0) {
      regimeType = 'BULL_WEAK';
    } else if (trendScore > 30 && trendScore < 70) {
      regimeType = 'SIDEWAYS';
    } else if (trendScore < 50 && momentumScore < 0) {
      regimeType = 'BEAR_WEAK';
    } else {
      regimeType = 'BEAR_STRONG';
    }

    const regimeInfo = this.REGIMES[regimeType as keyof typeof this.REGIMES];

    return {
      type: regimeType,
      volatility: volatilityLevel,
      characteristics: {
        name: regimeInfo.name,
        description: regimeInfo.description,
        expectedReturns: regimeInfo.expectedReturns,
        riskLevel: regimeInfo.riskLevel
      },
      indicators: {
        trend: trendScore,
        volatility: this.volatilityToScore(volatilityLevel),
        momentum: momentumScore,
        sentiment: 0, // Would calculate from market data
        technicalHealth: this.calculateTechnicalHealth(indicators)
      }
    };
  }

  /**
   * Generate regime-based signals
   */
  private generateRegimeSignals(indicators: RegimeIndicators, regime: MarketRegime): Array<{signal: string, strength: number, interpretation: string}> {
    const signals = [];

    // Trend signal
    const trendStrength = Math.abs(indicators.sma50 - indicators.sma200) / indicators.sma200 * 100;
    if (trendStrength > 5) {
      signals.push({
        signal: `Strong trend (${trendStrength.toFixed(2)}%)`,
        strength: Math.min(100, trendStrength * 10),
        interpretation: indicators.sma50 > indicators.sma200 ? 'Bullish trend' : 'Bearish trend'
      });
    }

    // RSI signal
    if (indicators.rsi14 > 70) {
      signals.push({
        signal: 'RSI Overbought',
        strength: Math.min(100, (indicators.rsi14 - 70) * 6),
        interpretation: 'Potential pullback or consolidation'
      });
    } else if (indicators.rsi14 < 30) {
      signals.push({
        signal: 'RSI Oversold',
        strength: Math.min(100, (30 - indicators.rsi14) * 6),
        interpretation: 'Potential bounce or reversal'
      });
    }

    // MACD signal
    if (indicators.macd.histogram > 0 && indicators.macd.value > indicators.macd.signal) {
      signals.push({
        signal: 'MACD Bullish Crossover',
        strength: 75,
        interpretation: 'Momentum shifting to upside'
      });
    } else if (indicators.macd.histogram < 0 && indicators.macd.value < indicators.macd.signal) {
      signals.push({
        signal: 'MACD Bearish Crossover',
        strength: 75,
        interpretation: 'Momentum shifting to downside'
      });
    }

    // ADX signal (trend strength)
    if (indicators.adx > 25) {
      signals.push({
        signal: `Strong Directional Trend (ADX: ${indicators.adx.toFixed(1)})`,
        strength: Math.min(100, indicators.adx),
        interpretation: 'Established trend with continuation potential'
      });
    } else if (indicators.adx < 20) {
      signals.push({
        signal: 'Weak/No Trend',
        strength: 50,
        interpretation: 'Range-bound or choppy market'
      });
    }

    return signals;
  }

  /**
   * Calculate transition probability
   */
  private calculateTransitionProbability(
    indicators: RegimeIndicators,
    currentRegime: MarketRegime,
    signals: any[]
  ): {probability: number, nextRegime: string, strength: number, timing: {days: number, confidence: number}} {
    let probability = 0;
    let strength = 0;

    // Check for transition signals
    const overboughtCount = signals.filter(s => s.signal.includes('Overbought')).length;
    const oversoldCount = signals.filter(s => s.signal.includes('Oversold')).length;
    const crossoverCount = signals.filter(s => s.signal.includes('Crossover')).length;

    // Calculate transition probability
    if (overboughtCount > 0) probability += 25;
    if (oversoldCount > 0) probability += 20;
    if (crossoverCount > 0) probability += 15;

    // Volatility factor
    if (currentRegime.volatility === 'EXTREME') probability += 30;
    if (currentRegime.volatility === 'HIGH') probability += 15;

    // Determine likely next regime
    let nextRegime = currentRegime.type;
    if (currentRegime.type === 'BULL_STRONG' && overboughtCount > 0) {
      nextRegime = 'BULL_WEAK';
      strength = 60;
    } else if (currentRegime.type === 'BULL_WEAK' && oversoldCount > 0) {
      nextRegime = 'SIDEWAYS';
      strength = 50;
    } else if (currentRegime.type === 'SIDEWAYS') {
      nextRegime = overboughtCount > oversoldCount ? 'BEAR_WEAK' : 'BULL_WEAK';
      strength = 45;
    }

    // Calculate timing
    const daysToTransition = Math.max(1, Math.round(100 / Math.max(probability, 1)));

    return {
      probability: Math.min(100, probability),
      nextRegime,
      strength,
      timing: {
        days: daysToTransition,
        confidence: Math.min(100, probability + strength)
      }
    };
  }

  /**
   * Calculate trend score
   */
  private calculateTrendScore(indicators: RegimeIndicators): number {
    let score = 50;

    if (indicators.sma50 > indicators.sma200) {
      score += Math.min(50, (indicators.sma50 - indicators.sma200) / indicators.sma200 * 500);
    } else {
      score -= Math.min(50, (indicators.sma200 - indicators.sma50) / indicators.sma200 * 500);
    }

    // RSI contribution
    if (indicators.rsi14 > 50) score += (indicators.rsi14 - 50) * 0.4;
    if (indicators.rsi14 < 50) score -= (50 - indicators.rsi14) * 0.4;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate momentum score
   */
  private calculateMomentumScore(indicators: RegimeIndicators): number {
    let score = 0;

    // MACD momentum
    if (indicators.macd.histogram > 0) score += Math.min(50, indicators.macd.histogram * 100);
    if (indicators.macd.histogram < 0) score += Math.max(-50, indicators.macd.histogram * 100);

    // RSI momentum
    if (indicators.rsi14 > 50) score += (indicators.rsi14 - 50) * 0.8;
    if (indicators.rsi14 < 50) score -= (50 - indicators.rsi14) * 0.8;

    return Math.max(-100, Math.min(100, score));
  }

  /**
   * Assess volatility level
   */
  private assessVolatility(indicators: RegimeIndicators): 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' {
    const atrPercent = (indicators.atr14 / ((indicators.sma50 + indicators.sma200) / 2)) * 100;

    if (atrPercent > 4) return 'EXTREME';
    if (atrPercent > 2.5) return 'HIGH';
    if (atrPercent > 1) return 'NORMAL';
    return 'LOW';
  }

  /**
   * Convert volatility to score
   */
  private volatilityToScore(level: string): number {
    switch (level) {
      case 'LOW': return 20;
      case 'NORMAL': return 50;
      case 'HIGH': return 75;
      case 'EXTREME': return 95;
      default: return 50;
    }
  }

  /**
   * Calculate technical health
   */
  private calculateTechnicalHealth(indicators: RegimeIndicators): number {
    let health = 50;

    if (indicators.sma50 > indicators.sma200) health += 15;
    if (indicators.rsi14 > 30 && indicators.rsi14 < 70) health += 15;
    if (indicators.adx > 25) health += 20;
    if (indicators.macd.histogram > 0) health += 10;

    return Math.min(100, health);
  }

  /**
   * Get historical context
   */
  private getHistoricalContext(symbol: string): any {
    return {
      daysInCurrentRegime: 15, // Would query from database
      averageDaysPerRegime: 45,
      previousRegimes: ['BULL_STRONG', 'BULL_WEAK', 'SIDEWAYS']
    };
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(regime: MarketRegime, transition: any): string[] {
    const recommendations = [];

    if (regime.type === 'BULL_STRONG') {
      recommendations.push('Maintain bullish bias with selective profit-taking');
      recommendations.push('Focus on quality breakouts');
    } else if (regime.type === 'BULL_WEAK') {
      recommendations.push('Reduce risk exposure gradually');
      recommendations.push('Watch for support levels');
    } else if (regime.type === 'SIDEWAYS') {
      recommendations.push('Trade range boundaries');
      recommendations.push('Avoid major position sizing');
    } else if (regime.type === 'BEAR_WEAK') {
      recommendations.push('Favor defensive plays');
      recommendations.push('Use put hedges');
    } else if (regime.type === 'BEAR_STRONG') {
      recommendations.push('Minimize equity exposure');
      recommendations.push('Move to cash or hedged positions');
    }

    if (transition.probability > 60) {
      recommendations.push(`Monitor for transition to ${transition.nextRegime} (${transition.timing.days} days)`);
    }

    return recommendations;
  }

  /**
   * Get regime change implications
   */
  private getRegimeChangeImplications(fromRegime: string, toRegime: string): string[] {
    return [
      `Market transitioning from ${fromRegime} to ${toRegime}`,
      'Rebalance portfolio allocation accordingly',
      'Update risk management parameters',
      'Monitor key support and resistance levels'
    ];
  }

  /**
   * Default indicators
   */
  private getDefaultIndicators(): RegimeIndicators {
    return {
      sma50: 0,
      sma200: 0,
      rsi14: 50,
      macd: {value: 0, signal: 0, histogram: 0},
      atr14: 0,
      bbands: {upper: 0, middle: 0, lower: 0},
      obv: 0,
      adx: 20
    };
  }

  /**
   * Default regime
   */
  private getDefaultRegime(): MarketRegime {
    return {
      type: 'SIDEWAYS',
      volatility: 'NORMAL',
      characteristics: {
        name: 'Unknown Regime',
        description: 'Unable to determine regime',
        expectedReturns: 'N/A',
        riskLevel: 'MEDIUM'
      },
      indicators: {
        trend: 0,
        volatility: 50,
        momentum: 0,
        sentiment: 0,
        technicalHealth: 0
      }
    };
  }

  /**
   * Default transition
   */
  private getDefaultTransition(): RegimeTransition {
    return {
      timestamp: new Date(),
      currentRegime: this.getDefaultRegime(),
      transitionProbability: 0,
      likelyNextRegime: 'UNKNOWN',
      transitionStrength: 0,
      timeToTransition: {days: 0, confidence: 0},
      signals: [],
      historicalContext: {daysInCurrentRegime: 0, averageDaysPerRegime: 0, previousRegimes: []},
      recommendations: ['Awaiting data']
    };
  }
}

export const regimeTransitionService = new RegimeTransitionService();
