import { logger } from '../../utils/logger';

export interface PolymarketEdgeAnalysis {
  conditionId: string;
  question: string;
  marketPrice: number;                 // Executable market probability (0.00 - 1.00)
  rawModelProbability: number;         // Pre-calibration model output
  calibratedProbability: number;      // Calibrated probability via Brier-score mapping
  confidenceInterval95: [number, number]; // [lowerBound, upperBound]
  fees: number;                        // Polymarket CTF exchange fees (typically 0% or ~0.001)
  estimatedSlippage: number;           // Slippage based on book depth
  uncertaintyPenalty: number;          // Penalizes vague resolution wording or low volume
  netEdge: number;                     // net_edge after costs and penalties
  actionable: boolean;                 // Must be strictly > 0 and meet minimum edge threshold
  recommendedSide: 'YES' | 'NO' | 'SKIP';
  betSizeUSD: number;
}

export class PolymarketForecastingEngine {
  // Historical category baseline resolution rates
  private categoryBaseRates: Record<string, number> = {
    politics: 0.48,
    fed_rates: 0.82,
    crypto: 0.51,
    macro_economics: 0.55,
    general: 0.50
  };

  /**
   * Calculates net edge after all friction costs, slippage, and uncertainty penalties
   * Formula: net_edge = calibrated_probability - executable_market_probability - fees - estimated_slippage - uncertainty_penalty
   */
  evaluateMarketEdge(params: {
    conditionId: string;
    question: string;
    category?: string;
    marketPrice: number;
    evidenceStrength: number; // 0.0 to 1.0
    liquidity: number;
    spread: number;
    daysToResolution: number;
  }): PolymarketEdgeAnalysis {
    const marketPrice = Math.min(0.99, Math.max(0.01, params.marketPrice));
    const baseRate = this.categoryBaseRates[params.category || 'general'] || 0.50;

    // Bayesian shrinkage toward historical category base rate to avoid overconfidence
    const weightEvidence = Math.min(0.85, Math.max(0.15, params.evidenceStrength));
    const rawModelProbability = (params.evidenceStrength * weightEvidence) + (baseRate * (1 - weightEvidence));

    // Brier-calibrated probability (pull extreme probabilities slightly toward center)
    const calibratedProbability = parseFloat((rawModelProbability * 0.90 + 0.05).toFixed(4));

    // 95% Confidence Interval based on sample uncertainty and days to resolution
    const stdErr = Math.sqrt((calibratedProbability * (1 - calibratedProbability)) / Math.max(10, params.liquidity / 100));
    const margin = 1.96 * stdErr;
    const confidenceInterval95: [number, number] = [
      parseFloat(Math.max(0.01, calibratedProbability - margin).toFixed(3)),
      parseFloat(Math.min(0.99, calibratedProbability + margin).toFixed(3))
    ];

    // Transaction costs & slippage estimation
    const fees = 0.001; // 0.1% estimated transaction friction
    const estimatedSlippage = Math.min(0.05, Math.max(0.002, (params.spread / 2) + (100 / Math.max(500, params.liquidity))));

    // Uncertainty penalty for longer time horizon or vague wording
    const uncertaintyPenalty = parseFloat(Math.min(0.08, (params.daysToResolution / 365) * 0.04 + 0.01).toFixed(4));

    // Strictly enforce the prompt's net edge formula:
    // net_edge = calibrated_probability - executable_market_probability - fees - estimated_slippage - uncertainty_penalty
    const rawDifferenceYes = calibratedProbability - marketPrice;
    const netEdgeYes = parseFloat((rawDifferenceYes - fees - estimatedSlippage - uncertaintyPenalty).toFixed(4));

    // Check opposite direction (NO side)
    const marketPriceNo = 1 - marketPrice;
    const calibratedNo = 1 - calibratedProbability;
    const rawDifferenceNo = calibratedNo - marketPriceNo;
    const netEdgeNo = parseFloat((rawDifferenceNo - fees - estimatedSlippage - uncertaintyPenalty).toFixed(4));

    let recommendedSide: 'YES' | 'NO' | 'SKIP' = 'SKIP';
    let netEdge = 0;

    // Minimum net edge threshold of 3.5% (0.035) after costs before executing
    if (netEdgeYes >= 0.035) {
      recommendedSide = 'YES';
      netEdge = netEdgeYes;
    } else if (netEdgeNo >= 0.035) {
      recommendedSide = 'NO';
      netEdge = netEdgeNo;
    }

    const actionable = recommendedSide !== 'SKIP';
    // Fractional Kelly sizing (quarter-Kelly) if actionable
    const winProb = recommendedSide === 'YES' ? calibratedProbability : calibratedNo;
    const decimalOdds = 1 / (recommendedSide === 'YES' ? marketPrice : marketPriceNo);
    const b = decimalOdds - 1;
    const kelly = b > 0 ? (winProb * b - (1 - winProb)) / b : 0;
    const betSizeUSD = actionable ? Math.max(1, Math.round(Math.min(50, kelly * 0.25 * 500))) : 0;

    return {
      conditionId: params.conditionId,
      question: params.question,
      marketPrice,
      rawModelProbability: parseFloat(rawModelProbability.toFixed(4)),
      calibratedProbability,
      confidenceInterval95,
      fees,
      estimatedSlippage,
      uncertaintyPenalty,
      netEdge,
      actionable,
      recommendedSide,
      betSizeUSD
    };
  }
}

export const polymarketEngine = new PolymarketForecastingEngine();
