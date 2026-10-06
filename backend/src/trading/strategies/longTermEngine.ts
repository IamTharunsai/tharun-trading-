import { prisma } from '../../utils/prisma';
import { secEdgarService } from '../../services/secEdgarService';
import { logger } from '../../utils/logger';

export interface InvestmentThesisRecord {
  id: string;
  symbol: string;
  version: number;
  thesis: string;
  targetHorizonDays: number;
  reviewConditions: string[];
  invalidationConditions: string[];
  valuationMultiple: number;
  targetPrice: number;
  currentPrice: number;
  freeCashFlowYieldPct: number;
  debtToEquity: number;
  revenueGrowthPct: number;
  status: 'ACTIVE' | 'UNDER_REVIEW' | 'INVALIDATED' | 'CLOSED';
}

export class LongTermInvestmentEngine {
  /**
   * Generates or updates a versioned investment thesis for a long-term holding
   */
  async createThesis(params: {
    symbol: string;
    thesis: string;
    targetHorizonDays?: number;
    valuationMultiple: number;
    currentPrice: number;
    targetPrice: number;
    revenueGrowthPct: number;
    freeCashFlowYieldPct: number;
    debtToEquity: number;
    reviewConditions: string[];
    invalidationConditions: string[];
  }): Promise<InvestmentThesisRecord> {
    const cleanSym = params.symbol.toUpperCase().trim();

    // Fetch existing thesis version if any
    const existing = await prisma.investmentThesis.findFirst({
      where: { symbol: cleanSym },
      orderBy: { version: 'desc' }
    });

    const nextVersion = existing ? existing.version + 1 : 1;

    const record = await prisma.investmentThesis.create({
      data: {
        symbol: cleanSym,
        version: nextVersion,
        thesis: params.thesis,
        targetHorizonDays: params.targetHorizonDays || 365,
        reviewConditions: params.reviewConditions,
        invalidationConditions: params.invalidationConditions,
        valuationMultiple: params.valuationMultiple,
        targetPrice: params.targetPrice,
        status: 'ACTIVE'
      }
    });

    logger.info(`🏛️ Long-Term Investment Thesis v${nextVersion} established for ${cleanSym} (Target: $${params.targetPrice})`);

    return {
      id: record.id,
      symbol: cleanSym,
      version: nextVersion,
      thesis: params.thesis,
      targetHorizonDays: params.targetHorizonDays || 365,
      reviewConditions: params.reviewConditions,
      invalidationConditions: params.invalidationConditions,
      valuationMultiple: params.valuationMultiple,
      targetPrice: params.targetPrice,
      currentPrice: params.currentPrice,
      freeCashFlowYieldPct: params.freeCashFlowYieldPct,
      debtToEquity: params.debtToEquity,
      revenueGrowthPct: params.revenueGrowthPct,
      status: 'ACTIVE'
    };
  }

  /**
   * Audits active thesis against authentic fundamental conditions
   */
  async checkThesisHealth(symbol: string, currentPrice: number, revenueGrowthPct: number, debtToEquity: number): Promise<{
    status: 'HEALTHY' | 'REQUIRES_REVIEW' | 'INVALIDATED';
    violations: string[];
  }> {
    const cleanSym = symbol.toUpperCase().trim();
    const thesis = await prisma.investmentThesis.findFirst({
      where: { symbol: cleanSym, status: 'ACTIVE' }
    });

    if (!thesis) {
      return { status: 'INVALIDATED', violations: ['No active investment thesis on record'] };
    }

    const violations: string[] = [];
    const invalidations: string[] = typeof thesis.invalidationConditions === 'string' ? JSON.parse(thesis.invalidationConditions) : (thesis.invalidationConditions || []);

    if (revenueGrowthPct < 0) {
      violations.push('Negative revenue growth reported — contradicts secular growth thesis');
    }
    if (debtToEquity > 3.0) {
      violations.push('Debt/Equity exceeded 3.0x threshold');
    }

    if (violations.length > 0) {
      return { status: 'REQUIRES_REVIEW', violations };
    }

    return { status: 'HEALTHY', violations: [] };
  }
}

export const longTermEngine = new LongTermInvestmentEngine();
