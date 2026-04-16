import Anthropic from '@anthropic-ai/sdk';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type MarketRegime = 
  | 'TRENDING_BULL'
  | 'TRENDING_BEAR'
  | 'CHOPPY_RANGE'
  | 'HIGH_VOLATILITY'
  | 'COMPRESSION'
  | 'RECOVERY'
  | 'DISTRIBUTION'

export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number;
  description: string;
  allowedStrategies: string[];
  blockedStrategies: string[];
  positionSizeMultiplier: number;
  agentWeights: Record<number, number>;
  reasoning: string;
  detectedAt: number;
  validUntil: number;
}

const REGIME_RULES: Record<MarketRegime, {
  allowedStrategies: string[];
  blockedStrategies: string[];
  positionSizeMultiplier: number;
  agentWeights: Record<number, number>;
}> = {
  TRENDING_BULL: {
    allowedStrategies: ['momentum', 'breakout', 'trend_following', 'dip_buying'],
    blockedStrategies: ['short_selling', 'mean_reversion_short'],
    positionSizeMultiplier: 1.0,
    agentWeights: { 1: 1.2, 2: 0.8, 3: 0.9, 4: 1.0, 5: 0.9, 6: 1.3, 7: 1.2, 8: 1.1, 9: 1.0, 10: 0.8 }
  },
  TRENDING_BEAR: {
    allowedStrategies: ['short_selling', 'put_buying', 'cash_holding'],
    blockedStrategies: ['momentum_buying', 'dip_buying', 'breakout_long'],
    positionSizeMultiplier: 0.7,
    agentWeights: { 1: 1.1, 2: 1.2, 3: 1.1, 4: 0.8, 5: 1.3, 6: 1.0, 7: 1.1, 8: 1.2, 9: 1.2, 10: 1.0 }
  },
  CHOPPY_RANGE: {
    allowedStrategies: ['mean_reversion', 'range_trading', 'buy_support', 'sell_resistance'],
    blockedStrategies: ['momentum', 'breakout', 'trend_following'],
    positionSizeMultiplier: 0.5,
    agentWeights: { 1: 1.3, 2: 0.7, 3: 0.8, 4: 0.9, 5: 1.2, 6: 0.6, 7: 1.2, 8: 0.8, 9: 0.7, 10: 1.2 }
  },
  HIGH_VOLATILITY: {
    allowedStrategies: ['very_small_positions', 'options_premium_selling'],
    blockedStrategies: ['leverage', 'large_positions', 'scalping'],
    positionSizeMultiplier: 0.3,
    agentWeights: { 1: 0.8, 2: 1.0, 3: 0.9, 4: 0.7, 5: 1.5, 6: 0.6, 7: 1.0, 8: 1.1, 9: 1.2, 10: 1.3 }
  },
  COMPRESSION: {
    allowedStrategies: ['wait_for_breakout', 'small_probe_positions'],
    blockedStrategies: ['large_positions', 'range_trading'],
    positionSizeMultiplier: 0.4,
    agentWeights: { 1: 1.4, 2: 0.8, 3: 0.8, 4: 0.8, 5: 1.2, 6: 1.1, 7: 1.3, 8: 0.9, 9: 0.8, 10: 1.1 }
  },
  RECOVERY: {
    allowedStrategies: ['cautious_buying', 'quality_only', 'small_positions'],
    blockedStrategies: ['aggressive_buying', 'leverage'],
    positionSizeMultiplier: 0.6,
    agentWeights: { 1: 1.1, 2: 1.1, 3: 1.2, 4: 1.1, 5: 1.2, 6: 1.0, 7: 1.0, 8: 1.1, 9: 1.1, 10: 1.1 }
  },
  DISTRIBUTION: {
    allowedStrategies: ['profit_taking', 'reducing_longs', 'hedging'],
    blockedStrategies: ['new_longs', 'chasing_momentum'],
    positionSizeMultiplier: 0.4,
    agentWeights: { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.0, 5: 1.3, 6: 0.8, 7: 1.2, 8: 1.3, 9: 1.1, 10: 1.2 }
  }
};

export async function detectMarketRegime(
  asset: string,
  marketData: {
    price: number;
    priceChange24h: number;
    priceChange7d?: number;
    rsi: number;
    macdHistogram: number;
    bollingerWidth: number;
    ema9: number;
    ema21: number;
    ema200: number;
    volume24h: number;
    volumeAvg20: number;
    atr14: number;
  }
): Promise<RegimeAnalysis> {

  const cacheKey = `regime:${asset}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as RegimeAnalysis;
      if (parsed.validUntil > Date.now()) {
        logger.info(`📊 Regime (cached): ${asset} = ${parsed.regime}`);
        return parsed;
      }
    }
  } catch (_) {}

  const aboveEma9 = marketData.price > marketData.ema9;
  const aboveEma21 = marketData.price > marketData.ema21;
  const aboveEma200 = marketData.price > marketData.ema200;
  const ema9AboveEma21 = marketData.ema9 > marketData.ema21;
  const volRatio = marketData.volume24h / (marketData.volumeAvg20 || marketData.volume24h);
  const bBandSqueeze = marketData.bollingerWidth < 0.04;
  const isOversold = marketData.rsi < 35;
  const isOverbought = marketData.rsi > 65;
  const highVolatility = marketData.atr14 / marketData.price > 0.04;

  let regime: MarketRegime;
  let confidence: number;
  let description: string;

  if (highVolatility && Math.abs(marketData.priceChange24h) > 8) {
    regime = 'HIGH_VOLATILITY';
    confidence = 85;
    description = `Extreme volatility: ${marketData.priceChange24h.toFixed(1)}% 24h move`;
  } else if (bBandSqueeze && volRatio < 0.7) {
    regime = 'COMPRESSION';
    confidence = 80;
    description = `Bollinger Band squeeze detected`;
  } else if (aboveEma9 && aboveEma21 && aboveEma200 && ema9AboveEma21 && marketData.priceChange24h > 0) {
    regime = 'TRENDING_BULL';
    confidence = 82;
    description = `Strong bull trend`;
  } else if (!aboveEma9 && !aboveEma21 && !aboveEma200 && !ema9AboveEma21 && marketData.priceChange24h < 0) {
    regime = 'TRENDING_BEAR';
    confidence = 82;
    description = `Strong bear trend`;
  } else if (isOversold && aboveEma200) {
    regime = 'RECOVERY';
    confidence = 70;
    description = `Recovery phase`;
  } else if (isOverbought && aboveEma200 && volRatio > 1.5) {
    regime = 'DISTRIBUTION';
    confidence = 70;
    description = `Distribution signs`;
  } else {
    regime = 'CHOPPY_RANGE';
    confidence = 65;
    description = `Choppy market`;
  }

  const rules = REGIME_RULES[regime];
  const analysis: RegimeAnalysis = {
    regime,
    confidence,
    description,
    allowedStrategies: rules.allowedStrategies,
    blockedStrategies: rules.blockedStrategies,
    positionSizeMultiplier: rules.positionSizeMultiplier,
    agentWeights: rules.agentWeights,
    reasoning: description,
    detectedAt: Date.now(),
    validUntil: Date.now() + 60 * 60 * 1000
  };

  try {
    await redis.setex(cacheKey, 3600, JSON.stringify(analysis));
  } catch (_) {}

  logger.info(`📊 Regime: ${asset} = ${regime} (${confidence}%)`);

  return analysis;
}
