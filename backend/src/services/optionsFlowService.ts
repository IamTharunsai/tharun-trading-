// ═══════════════════════════════════════════════════════════════════════════
// THARUN TRADING PLATFORM
// Options Flow Intelligence Service
// Analyzes call/put activity and identifies smart money positioning
// ═══════════════════════════════════════════════════════════════════════════

import axios from 'axios';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

export interface OptionsFlow {
  asset: string;
  timestamp: Date;
  callVolume: number;
  putVolume: number;
  callPutRatio: number; // >1.0 = bullish, <1.0 = bearish
  callOpenInterest: number;
  putOpenInterest: number;
  putCallOpenInterestRatio: number;
  impliedVolatility: {
    callsIV: number;
    putsIV: number;
    ivSkew: 'UPSIDE' | 'DOWNSIDE' | 'NEUTRAL';
    skewMagnitude: number; // how extreme the skew is
  };
  unusualActivity: UnusualOptionsBlock[];
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number; // 0-100
  interpretation: string;
}

export interface UnusualOptionsBlock {
  strikePrice: number;
  expirationDays: number;
  contractCount: number;
  notionalValue: number; // $ amount bet
  type: 'CALL' | 'PUT';
  moneyness: 'DEEP_ITM' | 'ITM' | 'ATM' | 'OTM' | 'DEEP_OTM';
  premium: number; // price per contract
  timeValue: number;
  impliedMove: number; // IV implied move
  interpretation: string; // what the bet likely means
  confidence: number; // 0-100 how confident this is unusual
}

export class OptionsFlowService {
  /**
   * Analyze options flow for an asset
   */
  async analyzeOptionsFlow(asset: string, price: number): Promise<OptionsFlow> {
    // Check cache first (15 minute TTL)
    const cacheKey = `options-flow:${asset}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    try {
      // Fetch options data from Polygon.io or Finnhub
      const optionsData = await this.fetchOptionsData(asset, price);
      
      // Analyze and enrich
      const flow = this.analyzeData(optionsData, asset, price);

      // Cache for 15 minutes
      await redis.setex(cacheKey, 900, JSON.stringify(flow));

      return flow;
    } catch (error) {
      logger.error(`Options flow analysis failed for ${asset}:`, error);
      return this.getSafeDefault(asset);
    }
  }

  /**
   * Fetch options data from external API
   */
  private async fetchOptionsData(asset: string, price: number): Promise<any> {
    try {
      // Would use Polygon.io or similar for real options data
      // For now, returning simulated structure
      const response = {
        callVolume: Math.floor(Math.random() * 1000000) + 100000,
        putVolume: Math.floor(Math.random() * 800000) + 50000,
        callOpenInterest: Math.floor(Math.random() * 5000000) + 1000000,
        putOpenInterest: Math.floor(Math.random() * 4000000) + 800000,
        unusualBlocks: [
          {
            strikePrice: price * 1.05,
            expirationDays: 7,
            contractCount: 500,
            notionalValue: 250000,
            type: 'CALL' as const,
            moneyness: 'OTM' as const,
            premium: 0.50,
            timeValue: 0.35,
            impliedMove: 2.5,
            interpretation: 'Bullish bet on upside move',
            confidence: 75
          }
        ]
      };

      return response;
    } catch (error) {
      logger.error(`Failed to fetch options data for ${asset}:`, error);
      throw error;
    }
  }

  /**
   * Analyze options data and identify patterns
   */
  private analyzeData(data: any, asset: string, price: number): OptionsFlow {
    const callVolume = data.callVolume;
    const putVolume = data.putVolume;
    const callPutRatio = callVolume / (putVolume > 0 ? putVolume : 1);
    const putCallOIRatio = data.putOpenInterest / (data.callOpenInterest > 0 ? data.callOpenInterest : 1);

    // Analyze IV skew
    let callsIV = 0;
    let putsIV = 0;
    let countCalls = 0;
    let countPuts = 0;

    for (const exp of data.expirations) {
      for (const call of exp.calls) {
        callsIV += call.impliedVolatility;
        countCalls++;
      }
      for (const put of exp.puts) {
        putsIV += put.impliedVolatility;
        countPuts++;
      }
    }

    callsIV = countCalls > 0 ? callsIV / countCalls : 0.25;
    putsIV = countPuts > 0 ? putsIV / countPuts : 0.25;

    const ivSkew = putsIV > callsIV ? 'DOWNSIDE' : callsIV > putsIV ? 'UPSIDE' : 'NEUTRAL';
    const skewMagnitude = Math.abs(putsIV - callsIV);

    // Detect unusual activity (simplified)
    const unusualActivity: UnusualOptionsBlock[] = [];
    
    // Find large volume blocks
    for (const exp of data.expirations) {
      for (const call of exp.calls) {
        if (call.volume > 10000) { // Large volume threshold
          const moneyness = this.calculateMoneyness(call.strike, price);
          unusualActivity.push({
            strikePrice: call.strike,
            expirationDays: exp.days,
            contractCount: call.volume,
            notionalValue: call.volume * 100 * ((call.bid + call.ask) / 2),
            type: 'CALL',
            moneyness,
            premium: (call.bid + call.ask) / 2,
            timeValue: (call.bid + call.ask) / 2 - Math.max(0, price - call.strike),
            impliedMove: price * call.impliedVolatility * Math.sqrt(exp.days / 365),
            interpretation: this.interpretOptionsBlock(call, price, 'CALL', exp.days),
            confidence: Math.min(100, (call.volume / 50000) * 100)
          });
        }
      }

      for (const put of exp.puts) {
        if (put.volume > 8000) { // Large put volume threshold
          const moneyness = this.calculateMoneyness(put.strike, price);
          unusualActivity.push({
            strikePrice: put.strike,
            expirationDays: exp.days,
            contractCount: put.volume,
            notionalValue: put.volume * 100 * ((put.bid + put.ask) / 2),
            type: 'PUT',
            moneyness,
            premium: (put.bid + put.ask) / 2,
            timeValue: (put.bid + put.ask) / 2 - Math.max(0, put.strike - price),
            impliedMove: price * put.impliedVolatility * Math.sqrt(exp.days / 365),
            interpretation: this.interpretOptionsBlock(put, price, 'PUT', exp.days),
            confidence: Math.min(100, (put.volume / 40000) * 100)
          });
        }
      }
    }

    // Sort by notional value (largest bets first)
    unusualActivity.sort((a, b) => b.notionalValue - a.notionalValue);

    // Determine sentiment
    let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 50;

    if (callPutRatio > 1.5) {
      sentiment = 'BULLISH';
      confidence = Math.min(100, (callPutRatio / 3) * 100);
    } else if (callPutRatio < 0.67) {
      sentiment = 'BEARISH';
      confidence = Math.min(100, ((1 / callPutRatio) / 3) * 100);
    }

    // Adjust based on IV skew
    if (ivSkew === 'UPSIDE' && sentiment !== 'BEARISH') {
      sentiment = 'BULLISH';
      confidence = Math.min(100, confidence + 10);
    } else if (ivSkew === 'DOWNSIDE' && sentiment !== 'BULLISH') {
      sentiment = 'BEARISH';
      confidence = Math.min(100, confidence + 10);
    }

    const interpretation = this.generateInterpretation(
      callPutRatio,
      ivSkew,
      sentiment,
      unusualActivity
    );

    return {
      asset,
      timestamp: new Date(),
      callVolume,
      putVolume,
      callPutRatio: Math.round(callPutRatio * 100) / 100,
      callOpenInterest: data.callOpenInterest,
      putOpenInterest: data.putOpenInterest,
      putCallOpenInterestRatio: Math.round(putCallOIRatio * 100) / 100,
      impliedVolatility: {
        callsIV,
        putsIV,
        ivSkew,
        skewMagnitude: Math.round(skewMagnitude * 10000) / 10000
      },
      unusualActivity,
      sentiment,
      confidence,
      interpretation
    };
  }

  /**
   * Calculate moneyness (ITM/OTM/ATM)
   */
  private calculateMoneyness(strike: number, price: number): 'DEEP_ITM' | 'ITM' | 'ATM' | 'OTM' | 'DEEP_OTM' {
    const percentOff = Math.abs(strike - price) / price;

    if (percentOff < 0.02) return 'ATM';
    if (percentOff < 0.05) return strike < price ? 'ITM' : 'OTM';
    if (percentOff < 0.15) return strike < price ? 'ITM' : 'OTM';
    return strike < price ? 'DEEP_ITM' : 'DEEP_OTM';
  }

  /**
   * Interpret what an options block bet likely means
   */
  private interpretOptionsBlock(
    option: any,
    price: number,
    type: 'CALL' | 'PUT',
    expirationDays: number
  ): string {
    const percentMove = Math.abs(option.strike - price) / price * 100;

    if (type === 'CALL') {
      if (option.strike > price * 1.05) {
        return `Bullish bet: Large call buyers expect ${percentMove.toFixed(1)}% upside in ${expirationDays} days`;
      } else {
        return `Bullish: Call buyers protecting short positions or speculating modest upside`;
      }
    } else {
      if (option.strike < price * 0.95) {
        return `Bearish bet: Large put buyers expect ${percentMove.toFixed(1)}% downside in ${expirationDays} days`;
      } else {
        return `Hedging: Put buyers protecting long positions against downside`;
      }
    }
  }

  /**
   * Generate human-readable interpretation
   */
  private generateInterpretation(
    ratio: number,
    ivSkew: string,
    sentiment: string,
    unusual: UnusualOptionsBlock[]
  ): string {
    let interpretation = `Call/Put Ratio: ${ratio.toFixed(2)}x - `;

    if (ratio > 2.5) {
      interpretation += 'EXTREME bullish sentiment (calls heavily outnumber puts). ';
    } else if (ratio > 1.5) {
      interpretation += 'Bullish sentiment (more calls than puts). ';
    } else if (ratio < 0.4) {
      interpretation += 'EXTREME bearish sentiment (puts heavily outnumber calls). ';
    } else if (ratio < 0.67) {
      interpretation += 'Bearish sentiment (more puts than calls). ';
    } else {
      interpretation += 'Neutral sentiment (balanced calls and puts). ';
    }

    interpretation += `IV Skew: ${ivSkew} (market pricing ${ivSkew === 'DOWNSIDE' ? 'downside' : 'upside'} risk). `;

    if (unusual.length > 0) {
      const topBet = unusual[0];
      interpretation += `Largest bet: $${(topBet.notionalValue / 1000000).toFixed(1)}M on `;
      interpretation += `${topBet.type === 'CALL' ? 'BULLISH' : 'BEARISH'} at $${topBet.strikePrice}`;
    }

    return interpretation;
  }

  /**
   * Get safe default on error
   */
  private getSafeDefault(asset: string): OptionsFlow {
    return {
      asset,
      timestamp: new Date(),
      callVolume: 500000,
      putVolume: 500000,
      callPutRatio: 1.0,
      callOpenInterest: 2000000,
      putOpenInterest: 2000000,
      putCallOpenInterestRatio: 1.0,
      impliedVolatility: {
        callsIV: 0.25,
        putsIV: 0.25,
        ivSkew: 'NEUTRAL',
        skewMagnitude: 0
      },
      unusualActivity: [],
      sentiment: 'NEUTRAL',
      confidence: 30,
      interpretation: 'Could not fetch live options data. Using default values.'
    };
  }
}

export const optionsFlowService = new OptionsFlowService();
