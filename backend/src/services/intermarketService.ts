import axios from 'axios';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

interface IntermarketData {
  timestamp: Date;
  assets: {
    dxy: number; // Dollar Index
    sp500: number;
    nasdaq: number;
    russell2000: number;
    dxyCrypto: number; // Inverse correlation
    dxyBonds: number; // Treasury yields
    oilEnergy: number; // Correlation
    stocksBonds: number; // Correlation
    stocksGold: number; // Correlation
    vix: number;
    treasuryYield10Y: number;
    treasuryYield2Y: number;
    treasuryYield5Y: number;
    yield_curve: number; // 10Y - 2Y spread
  };
  relationships: {
    dxyVsCrypto: 'STRONG_INVERSE' | 'MODERATE_INVERSE' | 'NEUTRAL' | 'WEAK_POSITIVE' | 'STRONG_POSITIVE';
    dxyVsBonds: 'STRONG_INVERSE' | 'MODERATE_INVERSE' | 'NEUTRAL' | 'WEAK_POSITIVE' | 'STRONG_POSITIVE';
    oilVsEnergy: 'STRONG_POSITIVE' | 'MODERATE_POSITIVE' | 'NEUTRAL' | 'WEAK_NEGATIVE' | 'STRONG_NEGATIVE';
    stocksVsGold: 'STRONG_INVERSE' | 'MODERATE_INVERSE' | 'NEUTRAL' | 'WEAK_POSITIVE' | 'STRONG_POSITIVE';
    yieldCurveSlope: 'STEEP' | 'NORMAL' | 'FLAT' | 'INVERTED';
  };
  signals: {
    name: string;
    signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
    strength: number; // 0-100
  }[];
  marketPhase: 'EXPANSION' | 'PEAK' | 'CONTRACTION' | 'TROUGH';
  marketHealth: number; // 0-100, higher = healthier
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  recommendations: string[];
}

interface MacroIndicators {
  dxy: number;
  sp500: number;
  nasdaq: number;
  bitcoin: number;
  ethereum: number;
  oil: number;
  gold: number;
  treasurys10Y: number;
  vix: number;
}

class IntermarketService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly CORRELATION_THRESHOLD = 0.3;

  /**
   * Get comprehensive intermarket analysis
   */
  async getIntermarketAnalysis(): Promise<IntermarketData> {
    try {
      const cacheKey = 'intermarket:analysis';
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const macroData = await this.fetchMacroIndicators();
      const relationships = this.analyzeRelationships(macroData);
      const signals = this.generateSignals(macroData, relationships);
      const marketPhase = this.determineMarketPhase(macroData);
      const marketHealth = this.calculateMarketHealth(macroData, relationships);
      const riskLevel = this.assessRiskLevel(marketHealth, macroData.vix);

      const analysis: IntermarketData = {
        timestamp: new Date(),
        assets: {
          dxy: macroData.dxy,
          sp500: macroData.sp500,
          nasdaq: macroData.nasdaq,
          russell2000: 0, // Would fetch from API
          dxyCrypto: macroData.bitcoin,
          dxyBonds: macroData.treasurys10Y,
          oilEnergy: macroData.oil,
          stocksBonds: macroData.sp500,
          stocksGold: macroData.gold,
          vix: macroData.vix,
          treasuryYield10Y: macroData.treasurys10Y,
          treasuryYield2Y: 0, // Would fetch from API
          treasuryYield5Y: 0, // Would fetch from API
          yield_curve: macroData.treasurys10Y - 0 // 10Y - 2Y
        },
        relationships,
        signals,
        marketPhase,
        marketHealth,
        riskLevel,
        recommendations: this.generateRecommendations(marketPhase, riskLevel, relationships)
      };

      await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(analysis));
      return analysis;
    } catch (error) {
      logger.error('Error in getIntermarketAnalysis:', error);
      return this.getDefaultAnalysis();
    }
  }

  /**
   * Analyze relationship between DXY and other assets
   */
  async analyzeDxyRelationship(asset: string): Promise<{
    correlation: number;
    inverseCorrelation: number;
    trend: string;
    implications: string[];
  }> {
    try {
      const macroData = await this.fetchMacroIndicators();
      const dxyChange = macroData.dxy;
      
      let assetChange = 0;
      if (asset === 'BTC') assetChange = macroData.bitcoin;
      if (asset === 'ETH') assetChange = macroData.ethereum;
      if (asset === 'SPX') assetChange = macroData.sp500;
      if (asset === 'GOLD') assetChange = macroData.gold;

      const correlation = this.calculateCorrelation(dxyChange, assetChange);
      const inverseCorrelation = correlation * -1;

      return {
        correlation,
        inverseCorrelation,
        trend: correlation > 0 ? 'POSITIVE' : 'NEGATIVE',
        implications: this.getDxyImplications(asset, correlation)
      };
    } catch (error) {
      logger.error('Error in analyzeDxyRelationship:', error);
      return {
        correlation: 0,
        inverseCorrelation: 0,
        trend: 'UNKNOWN',
        implications: []
      };
    }
  }

  /**
   * Analyze yield curve implications
   */
  async analyzeYieldCurve(): Promise<{
    slope: number;
    status: 'STEEP' | 'NORMAL' | 'FLAT' | 'INVERTED';
    implications: string[];
    recessonRisk: number; // 0-100
  }> {
    try {
      const cacheKey = 'intermarket:yield_curve';
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const slopes = await this.fetchYieldCurveSlopeData();
      const slope = slopes.y10 - slopes.y2;

      let status: 'STEEP' | 'NORMAL' | 'FLAT' | 'INVERTED' = 'NORMAL';
      if (slope > 1.5) status = 'STEEP';
      if (slope < 0.5 && slope > 0) status = 'FLAT';
      if (slope < 0) status = 'INVERTED';

      const recessonRisk = this.calculateRecessionRisk(slope);

      const result = {
        slope,
        status,
        implications: this.getYieldCurveImplications(status),
        recessonRisk
      };

      await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
      return result;
    } catch (error) {
      logger.error('Error in analyzeYieldCurve:', error);
      return {
        slope: 0,
        status: 'NORMAL',
        implications: [],
        recessonRisk: 0
      };
    }
  }

  /**
   * Get intermarket signals for trading
   */
  async getIntermarketSignals(): Promise<{
    signals: Array<{name: string, signal: string, strength: number}>;
    consensusSignal: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
    conviction: number; // 0-100
  }> {
    try {
      const analysis = await this.getIntermarketAnalysis();
      
      const bullishSignals = analysis.signals.filter(s => s.signal === 'BULLISH').length;
      const bearishSignals = analysis.signals.filter(s => s.signal === 'BEARISH').length;
      const neutralSignals = analysis.signals.filter(s => s.signal === 'NEUTRAL').length;

      let consensusSignal: 'BULLISH' | 'NEUTRAL' | 'BEARISH' = 'NEUTRAL';
      if (bullishSignals > bearishSignals) consensusSignal = 'BULLISH';
      if (bearishSignals > bullishSignals) consensusSignal = 'BEARISH';

      const conviction = Math.max(bullishSignals, bearishSignals, neutralSignals) / analysis.signals.length * 100;

      return {
        signals: analysis.signals,
        consensusSignal,
        conviction
      };
    } catch (error) {
      logger.error('Error in getIntermarketSignals:', error);
      return {
        signals: [],
        consensusSignal: 'NEUTRAL',
        conviction: 0
      };
    }
  }

  /**
   * Fetch macro indicator data
   */
  private async fetchMacroIndicators(): Promise<MacroIndicators> {
    try {
      const token = process.env.IEX_CLOUD_API_KEY;
      
      const [spxRes, dxyRes, btcRes, oilRes, goldRes, tsyRes] = await Promise.allSettled([
        axios.get(`https://cloud.iexapis.com/stable/stock/SPY/quote?token=${token}`, { timeout: 5000 }),
        axios.get(`https://cloud.iexapis.com/stable/stock/UUP/quote?token=${token}`, { timeout: 5000 }),
        axios.get(`https://cloud.iexapis.com/stable/crypto/BTC/quote?token=${token}`, { timeout: 5000 }),
        axios.get(`https://cloud.iexapis.com/stable/stock/USO/quote?token=${token}`, { timeout: 5000 }),
        axios.get(`https://cloud.iexapis.com/stable/stock/GLD/quote?token=${token}`, { timeout: 5000 }),
        axios.get(`https://cloud.iexapis.com/stable/stock/TLT/quote?token=${token}`, { timeout: 5000 })
      ]);

      return {
        sp500: spxRes.status === 'fulfilled' ? spxRes.value.data.changePercent : 0,
        nasdaq: 0,
        dxy: dxyRes.status === 'fulfilled' ? dxyRes.value.data.changePercent : 0,
        bitcoin: btcRes.status === 'fulfilled' ? btcRes.value.data.changePercent : 0,
        ethereum: 0,
        oil: oilRes.status === 'fulfilled' ? oilRes.value.data.changePercent : 0,
        gold: goldRes.status === 'fulfilled' ? goldRes.value.data.changePercent : 0,
        treasurys10Y: tsyRes.status === 'fulfilled' ? tsyRes.value.data.changePercent : 0,
        vix: 0 // Would fetch from separate source
      };
    } catch (error) {
      logger.error('Error fetching macro indicators:', error);
      return {
        sp500: 0,
        nasdaq: 0,
        dxy: 0,
        bitcoin: 0,
        ethereum: 0,
        oil: 0,
        gold: 0,
        treasurys10Y: 0,
        vix: 0
      };
    }
  }

  /**
   * Analyze asset relationships
   */
  private analyzeRelationships(macroData: MacroIndicators) {
    return {
      dxyVsCrypto: this.getRelationshipType(macroData.dxy, macroData.bitcoin),
      dxyVsBonds: this.getRelationshipType(macroData.dxy, macroData.treasurys10Y),
      oilVsEnergy: this.getRelationshipType(macroData.oil, macroData.sp500 * 0.1),
      stocksVsGold: this.getRelationshipType(macroData.sp500, macroData.gold),
      yieldCurveSlope: (macroData.treasurys10Y > 1.5) ? 'STEEP' : 'NORMAL' as 'STEEP' | 'NORMAL' | 'FLAT' | 'INVERTED'
    };
  }

  /**
   * Generate trading signals
   */
  private generateSignals(macroData: MacroIndicators, relationships: any): Array<{name: string, signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH', strength: number}> {
    const signals: Array<{name: string, signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH', strength: number}> = [];

    // DXY weakness signals crypto strength
    if (macroData.dxy < -0.5) {
      signals.push({ name: 'DXY Weakness', signal: 'BULLISH', strength: 75 });
    }

    // Rising yields can be bearish for stocks
    if (macroData.treasurys10Y > 1) {
      signals.push({ name: 'Rising Yields', signal: 'BEARISH', strength: 60 });
    }

    // Oil strength can signal risk appetite
    if (macroData.oil > 0.5) {
      signals.push({ name: 'Oil Strength', signal: 'BULLISH', strength: 50 });
    }

    // VIX elevation signals caution
    if (macroData.vix > 20) {
      signals.push({ name: 'Elevated VIX', signal: 'BEARISH', strength: 70 });
    }

    return signals.length > 0 ? signals : [{ name: 'Awaiting Data', signal: 'NEUTRAL', strength: 0 }];
  }

  /**
   * Determine market phase
   */
  private determineMarketPhase(macroData: MacroIndicators): 'EXPANSION' | 'PEAK' | 'CONTRACTION' | 'TROUGH' {
    if (macroData.sp500 > 1 && macroData.dxy < 0) return 'EXPANSION';
    if (macroData.vix > 25) return 'CONTRACTION';
    if (macroData.sp500 < -1) return 'TROUGH';
    return 'PEAK';
  }

  /**
   * Calculate overall market health score
   */
  private calculateMarketHealth(macroData: MacroIndicators, relationships: any): number {
    let health = 50;
    
    if (macroData.sp500 > 0) health += 15;
    if (macroData.vix < 15) health += 15;
    if (macroData.treasurys10Y < 1) health += 10;
    if (macroData.dxy > -0.5) health += 10;

    return Math.min(100, health);
  }

  /**
   * Assess market risk level
   */
  private assessRiskLevel(health: number, vix: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
    if (vix > 40) return 'EXTREME';
    if (vix > 25 || health < 40) return 'HIGH';
    if (vix > 15 || health < 60) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Get relationship type
   */
  private getRelationshipType(asset1Change: number, asset2Change: number): any {
    const correlation = this.calculateCorrelation(asset1Change, asset2Change);
    
    if (correlation > 0.7) return 'STRONG_POSITIVE';
    if (correlation > 0.3) return 'WEAK_POSITIVE';
    if (correlation < -0.7) return 'STRONG_INVERSE';
    if (correlation < -0.3) return 'MODERATE_INVERSE';
    return 'NEUTRAL';
  }

  /**
   * Calculate correlation between two assets
   */
  private calculateCorrelation(asset1: number, asset2: number): number {
    if (asset1 === 0 || asset2 === 0) return 0;
    return (asset1 * asset2) / (Math.abs(asset1) * Math.abs(asset2));
  }

  /**
   * Fetch yield curve slope data
   */
  private async fetchYieldCurveSlopeData(): Promise<{y2: number, y5: number, y10: number}> {
    try {
      // Would fetch from Fed API or market data provider
      return { y2: 0, y5: 0, y10: 0 };
    } catch (error) {
      logger.error('Error fetching yield curve data:', error);
      return { y2: 0, y5: 0, y10: 0 };
    }
  }

  /**
   * Get DXY implications
   */
  private getDxyImplications(asset: string, correlation: number): string[] {
    const implications: string[] = [];
    
    if (asset === 'BTC') {
      if (correlation < -0.5) {
        implications.push('Strong inverse relationship with DXY');
        implications.push('Weaker DXY should support Bitcoin');
      }
    }
    
    return implications;
  }

  /**
   * Get yield curve implications
   */
  private getYieldCurveImplications(status: string): string[] {
    if (status === 'INVERTED') {
      return ['Historically signals recession', 'Consider defensive positioning', 'Reduce equity exposure'];
    }
    if (status === 'STEEP') {
      return ['Strong economic growth signal', 'Favorable for equities', 'Consider cyclical exposure'];
    }
    return ['Normal economic conditions', 'Balanced approach appropriate'];
  }

  /**
   * Calculate recession risk from yield curve slope
   */
  private calculateRecessionRisk(slope: number): number {
    if (slope < -0.5) return 90;
    if (slope < 0) return 70;
    if (slope < 0.5) return 40;
    if (slope > 1.5) return 10;
    return 25;
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(phase: string, risk: string, relationships: any): string[] {
    const recommendations: string[] = [];

    if (risk === 'EXTREME') {
      recommendations.push('Reduce equity exposure significantly');
      recommendations.push('Move to defensive assets');
      recommendations.push('Consider cash positions');
    } else if (risk === 'HIGH') {
      recommendations.push('Reduce cyclical exposure');
      recommendations.push('Increase hedges');
    } else if (risk === 'LOW') {
      recommendations.push('Maintain equity exposure');
      recommendations.push('Consider cyclical opportunities');
    }

    return recommendations;
  }

  /**
   * Default analysis on error
   */
  private getDefaultAnalysis(): IntermarketData {
    return {
      timestamp: new Date(),
      assets: {
        dxy: 0,
        sp500: 0,
        nasdaq: 0,
        russell2000: 0,
        dxyCrypto: 0,
        dxyBonds: 0,
        oilEnergy: 0,
        stocksBonds: 0,
        stocksGold: 0,
        vix: 0,
        treasuryYield10Y: 0,
        treasuryYield2Y: 0,
        treasuryYield5Y: 0,
        yield_curve: 0
      },
      relationships: {
        dxyVsCrypto: 'NEUTRAL',
        dxyVsBonds: 'NEUTRAL',
        oilVsEnergy: 'NEUTRAL',
        stocksVsGold: 'NEUTRAL',
        yieldCurveSlope: 'NORMAL'
      },
      signals: [],
      marketPhase: 'EXPANSION',
      marketHealth: 50,
      riskLevel: 'MEDIUM',
      recommendations: ['Awaiting data refresh']
    };
  }
}

export const intermarketService = new IntermarketService();
