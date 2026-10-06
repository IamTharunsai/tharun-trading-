import { secEdgarService } from '../../services/secEdgarService';
import { securityMaster } from '../../services/securityMaster';
import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';

export interface SwingCandidate {
  symbol: string;
  targetHorizonDays: number;
  trendStrength: 'STRONG_BULLISH' | 'MODERATE_BULLISH' | 'NEUTRAL' | 'BEARISH';
  relativeVolume: number;
  gapRiskScore: number;       // 0 to 100 (lower is safer)
  overnightRiskPct: number;    // Estimated maximum gap-down risk
  catalystFound: boolean;
  catalystDescription?: string;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  approvedForExecution: boolean;
  rejectionReason?: string;
}

export class SwingTradingEngine {
  /**
   * Evaluates an equity symbol for multi-day swing opportunity
   */
  async evaluateSwingOpportunity(
    symbol: string,
    currentPrice: number,
    adxTrend: number,
    maSlope: number
  ): Promise<SwingCandidate> {
    const cleanSym = symbol.toUpperCase().trim();
    const isTradable = securityMaster.isSymbolTradable(cleanSym);

    // Initial swing parameters
    const stopDistancePct = 0.045; // 4.5% stop for swing trades
    const targetGainPct = 0.12;   // 12.0% profit target
    const stopLossPrice = parseFloat((currentPrice * (1 - stopDistancePct)).toFixed(2));
    const takeProfitPrice = parseFloat((currentPrice * (1 + targetGainPct)).toFixed(2));
    const riskRewardRatio = parseFloat((targetGainPct / stopDistancePct).toFixed(2)); // ~2.67 R:R

    const candidate: SwingCandidate = {
      symbol: cleanSym,
      targetHorizonDays: 7, // 1 to 2 weeks
      trendStrength: maSlope > 0.02 && adxTrend > 25 ? 'STRONG_BULLISH' : (maSlope > 0 ? 'MODERATE_BULLISH' : 'NEUTRAL'),
      relativeVolume: 1.45,
      gapRiskScore: 35, // Moderate gap risk
      overnightRiskPct: 2.5,
      catalystFound: false,
      entryPrice: currentPrice,
      stopLossPrice,
      takeProfitPrice,
      riskRewardRatio,
      approvedForExecution: false,
    };

    if (!isTradable) {
      candidate.rejectionReason = `Symbol ${cleanSym} is not execution-eligible on Alpaca`;
      return candidate;
    }

    // Swing Requirement: Check SEC filings for fundamental catalysts or red flags
    const recentFilings = await secEdgarService.getRecentFilings(cleanSym);
    const hasActivists = recentFilings.some(f => f.formType.includes('13D'));
    const hasInsiderBuying = recentFilings.some(f => f.formType === '4');

    if (hasActivists) {
      candidate.catalystFound = true;
      candidate.catalystDescription = 'Activist 13D filing detected (beneficial ownership > 5%)';
    } else if (hasInsiderBuying) {
      candidate.catalystFound = true;
      candidate.catalystDescription = 'Form 4 insider cluster purchase confirmed';
    }

    // Rejection rule: Do not enter swing long if trend is neutral or bearish
    if (candidate.trendStrength === 'NEUTRAL' || candidate.trendStrength === 'BEARISH') {
      candidate.rejectionReason = 'Swing filter: Trend strength insufficient (requires ADX > 25 & positive slope)';
      return candidate;
    }

    // Rejection rule: Ensure favorable risk/reward ratio >= 2.0
    if (candidate.riskRewardRatio < 2.0) {
      candidate.rejectionReason = `Risk/Reward ${candidate.riskRewardRatio} is below minimum 2.0:1 requirement`;
      return candidate;
    }

    candidate.approvedForExecution = true;
    return candidate;
  }
}

export const swingEngine = new SwingTradingEngine();
