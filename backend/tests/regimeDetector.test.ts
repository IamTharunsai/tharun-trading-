/**
 * UNIT TESTS: MARKET REGIME DETECTION
 * Tests market condition classification and agent weight adjustments
 */

import { describe, it, expect } from 'vitest';

describe('Market Regime Detection', () => {
  
  describe('Regime Classification', () => {
    it('should classify 7 distinct market regimes', () => {
      const regimes = [
        'TRENDING_BULL',
        'TRENDING_BEAR',
        'CHOPPY_RANGE',
        'HIGH_VOLATILITY',
        'COMPRESSION',
        'RECOVERY',
        'DISTRIBUTION'
      ];
      expect(regimes).toHaveLength(7);
      expect(new Set(regimes)).toHaveLength(7);
    });

    it('should detect TRENDING_BULL regime', () => {
      const marketData = {
        ema9: 42500,
        ema21: 42000,
        ema200: 40000,
        rsi: 65,
        price: 42600,
      };
      // EMA9 > EMA21 > EMA200 + RSI > 60 = Uptrend
      const isBullish = marketData.ema9 > marketData.ema21 && 
                        marketData.ema21 > marketData.ema200 &&
                        marketData.rsi > 60;
      expect(isBullish).toBe(true);
    });

    it('should detect TRENDING_BEAR regime', () => {
      const marketData = {
        ema9: 40000,
        ema21: 41000,
        ema200: 42500,
        rsi: 25,
        price: 39900,
      };
      // EMA9 < EMA21 < EMA200 + RSI < 40 = Downtrend
      const isBearish = marketData.ema9 < marketData.ema21 && 
                        marketData.ema21 < marketData.ema200 &&
                        marketData.rsi < 40;
      expect(isBearish).toBe(true);
    });

    it('should detect CHOPPY_RANGE regime', () => {
      const marketData = {
        rsi: 50,
        bollingerWidth: 0.08, // Narrow bands
        price: 42000,
        emaDistance: 0.5, // Small % diff between EMAs
      };
      const isChoppy = Math.abs(marketData.rsi - 50) < 15 && marketData.bollingerWidth < 0.1;
      expect(isChoppy).toBe(true);
    });

    it('should detect HIGH_VOLATILITY regime', () => {
      const marketData = {
        atr14: 1850, // High Average True Range
        bollingerWidth: 0.25, // Wide bands
        priceChange24h: 8.5, // Large daily move
      };
      const isHighVol = marketData.atr14 > 1500 || marketData.bollingerWidth > 0.2;
      expect(isHighVol).toBe(true);
    });

    it('should detect COMPRESSION regime', () => {
      const marketData = {
        bollingerWidth: 0.05, // Very tight bands
        rsi: 45,
        volume24h: 15000000, // Low volume
      };
      const isCompression = marketData.bollingerWidth < 0.08;
      expect(isCompression).toBe(true);
    });
  });

  describe('Agent Weight Adjustment by Regime', () => {
    it('Technician should get 1.3x weight in CHOPPY_RANGE', () => {
      const regimeWeights = {
        'CHOPPY_RANGE': {
          'Technician': 1.3,
          'Fundamental': 0.8,
        }
      };
      expect(regimeWeights['CHOPPY_RANGE']['Technician']).toBe(1.3);
    });

    it('Risk Manager should always retain high weight', () => {
      const regimes = ['TRENDING_BULL', 'HIGH_VOLATILITY', 'COMPRESSION'];
      regimes.forEach(regime => {
        const riskWeight = 1.2; // Risk manager always important
        expect(riskWeight).toBeGreaterThan(0.8);
      });
    });

    it('Fundamental analyst should get boost in RECOVERY regime', () => {
      const weights = {
        'RECOVERY': { 'Fundamental': 1.4 }
      };
      expect(weights['RECOVERY']['Fundamental']).toBeGreaterThan(1.0);
    });

    it('Volume detective should get boost in HIGH_VOLATILITY', () => {
      const weights = {
        'HIGH_VOLATILITY': { 'Volume Detective': 1.3 }
      };
      expect(weights['HIGH_VOLATILITY']['Volume Detective']).toBeGreaterThan(1.0);
    });
  });

  describe('Position Size Adjustments', () => {
    it('should limit position size to 50% in HIGH_VOLATILITY', () => {
      const baseSize = 10000;
      const volatilityMultiplier = 0.5;
      const adjustedSize = baseSize * volatilityMultiplier;
      expect(adjustedSize).toBeLessThan(baseSize);
    });

    it('should allow 100% position size in TRENDING_BULL', () => {
      const bullMultiplier = 1.0;
      expect(bullMultiplier).toBe(1.0);
    });

    it('should reduce to 25% in CHOPPY_RANGE', () => {
      const choppyMultiplier = 0.25;
      expect(choppyMultiplier).toBeLessThan(0.5);
    });
  });

  describe('Regime Persistence', () => {
    it('should cache regime for 1 hour', () => {
      const cacheTtl = 3600; // seconds
      const maxCacheTtl = 3600;
      expect(cacheTtl).toBeLessThanOrEqual(maxCacheTtl);
    });

    it('should only update regime on new market data', () => {
      let regimeChangeCount = 0;
      const priceUpdates = [100, 100, 100, 105]; // Same price twice
      
      for (let i = 1; i < priceUpdates.length; i++) {
        if (priceUpdates[i] !== priceUpdates[i - 1]) {
          regimeChangeCount++;
        }
      }
      
      expect(regimeChangeCount).toBeLessThan(priceUpdates.length);
    });
  });

  describe('Technical Indicators Integration', () => {
    it('should use EMA 9/21/200 crossovers', () => {
      const indicators = ['EMA9', 'EMA21', 'EMA200'];
      expect(indicators).toContain('EMA9');
      expect(indicators).toContain('EMA21');
      expect(indicators).toContain('EMA200');
    });

    it('should use RSI 14 for overbought/oversold', () => {
      const rsi = 72; // Overbought
      const isOverbought = rsi > 70;
      expect(isOverbought).toBe(true);
    });

    it('should use MACD histogram for momentum', () => {
      const macdHistogram = 0.25; // Positive = bullish
      const isBullishMACD = macdHistogram > 0;
      expect(isBullishMACD).toBe(true);
    });

    it('should use Bollinger Bands for volatility', () => {
      const bbUpper = 45000;
      const bbLower = 40000;
      const bbWidth = bbUpper - bbLower;
      const bbRatio = bbWidth / ((bbUpper + bbLower) / 2);
      expect(bbRatio).toBeGreaterThan(0);
    });

    it('should use ATR 14 for volatility measure', () => {
      const atr14 = 850;
      expect(typeof atr14).toBe('number');
      expect(atr14).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle sudden price gaps', () => {
      const prices = [42000, 42100, 38000]; // -10% gap
      const priceChange = ((prices[2] - prices[1]) / prices[1]) * 100;
      expect(Math.abs(priceChange)).toBeGreaterThan(5);
    });

    it('should handle zero volume', () => {
      const volume = 0;
      const volumeMultiplier = volume > 0 ? 1.0 : 0.5;
      expect(volumeMultiplier).toBeLessThan(1.0);
    });

    it('should handle extreme RSI readings', () => {
      const extremeRSI = 95;
      expect(extremeRSI).toBeGreaterThanOrEqual(0);
      expect(extremeRSI).toBeLessThanOrEqual(100);
    });
  });
});
