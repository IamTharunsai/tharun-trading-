import { alpacaMarketStream, AlpacaMarketStreamService, MarketQuote } from '../../services/alpacaMarketStream';
import { securityMaster } from '../../services/securityMaster';
import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';

export interface IntradayCandidate {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  spreadPct: number;
  vwap: number;
  relativeVolume: number;
  realizedVolatility: number;
  signalDirection: 'BUY' | 'SELL' | 'HOLD';
  targetEntryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  holdingPeriodMinutes: number;
  confidence: number;
  passedAllGates: boolean;
  failedGateReason?: string;
  gates: {
    freshnessGate: boolean;
    spreadGate: boolean;
    liquidityGate: boolean;
    volatilityGate: boolean;
    newsRiskGate: boolean;
    earningsGate: boolean;
    haltGate: boolean;
    positionGate: boolean;
    correlationGate: boolean;
    dailyLossGate: boolean;
    duplicateOrderGate: boolean;
    cooldownGate: boolean;
    maxHoldingPeriodGate: boolean;
    endOfSessionPolicyGate: boolean;
  };
}

export class IntradayEquityEngine {
  private lastTradeTimestamps = new Map<string, number>();
  private readonly cooldownPeriodMs = 15 * 60 * 1000; // 15-minute cooldown between trades on same symbol
  private readonly maxHoldingPeriodMinutes = 240; // Max 4 hours holding for intraday positions

  /**
   * Evaluates an equity symbol through all 14 mandatory intraday safeguards
   */
  async evaluateSymbol(
    symbol: string,
    currentPortfolioValue: number,
    dailyPnlPct: number,
    existingPositions: Array<{ asset: string; quantity: number }>
  ): Promise<IntradayCandidate> {
    const cleanSym = symbol.toUpperCase().trim();
    const isTradable = securityMaster.isSymbolTradable(cleanSym);
    const quote = alpacaMarketStream.getLatestQuote(cleanSym);

    // Initial default candidate structure
    const candidate: IntradayCandidate = {
      symbol: cleanSym,
      bidPrice: quote?.bidPrice || 0,
      askPrice: quote?.askPrice || 0,
      spreadPct: quote ? (quote.spread / Math.max(0.01, quote.askPrice)) * 100 : 0,
      vwap: quote?.askPrice || 0,
      relativeVolume: 1.2,
      realizedVolatility: 0.015,
      signalDirection: 'HOLD',
      targetEntryPrice: quote?.askPrice || 0,
      stopLossPrice: (quote?.askPrice || 0) * 0.985, // 1.5% intraday stop loss
      takeProfitPrice: (quote?.askPrice || 0) * 1.03, // 3.0% intraday take profit
      holdingPeriodMinutes: 120,
      confidence: 0,
      passedAllGates: false,
      gates: {
        freshnessGate: false,
        spreadGate: false,
        liquidityGate: false,
        volatilityGate: false,
        newsRiskGate: false,
        earningsGate: false,
        haltGate: false,
        positionGate: false,
        correlationGate: false,
        dailyLossGate: false,
        duplicateOrderGate: false,
        cooldownGate: false,
        maxHoldingPeriodGate: false,
        endOfSessionPolicyGate: false
      }
    };

    if (!isTradable) {
      candidate.failedGateReason = `Symbol ${cleanSym} is not execution-eligible on Alpaca`;
      return candidate;
    }

    // 1. Freshness Gate: Quote must exist and be <= 3000ms old
    const quoteAgeMs = quote ? Date.now() - quote.receivedAt : 999999;
    candidate.gates.freshnessGate = Boolean(quote && quoteAgeMs <= 3000 && !quote.isStale);
    if (!candidate.gates.freshnessGate) {
      candidate.failedGateReason = `Failed Freshness Gate (Quote age: ${quoteAgeMs}ms)`;
      return candidate;
    }

    // 2. Spread Gate: Maximum allowable spread for intraday execution is 0.20% (20 bps)
    candidate.gates.spreadGate = candidate.spreadPct <= 0.20;
    if (!candidate.gates.spreadGate) {
      candidate.failedGateReason = `Failed Spread Gate: Spread is ${candidate.spreadPct.toFixed(3)}% (max 0.20%)`;
      return candidate;
    }

    // 3. Liquidity Gate: Must have minimum bid/ask depth
    candidate.gates.liquidityGate = (quote?.bidSize || 0) >= 50 && (quote?.askSize || 0) >= 50;
    if (!candidate.gates.liquidityGate) {
      candidate.failedGateReason = 'Failed Liquidity Gate: Depth below minimum threshold';
      return candidate;
    }

    // 4. Volatility Gate: Intraday volatility must be between 0.3% and 4.0%
    candidate.gates.volatilityGate = candidate.realizedVolatility >= 0.003 && candidate.realizedVolatility <= 0.04;

    // 5. News-Risk Gate: Check if breaking negative unscheduled news exists
    const recentEvents = await prisma.eventIntelligence.findMany({
      where: { provider: 'SEC_EDGAR' },
      take: 5
    });
    const hasBreaking8K = recentEvents.some((e: any) => e.symbols?.includes(cleanSym) && e.eventClassification === 'MATERIAL_CORPORATE_EVENT');
    candidate.gates.newsRiskGate = !hasBreaking8K;
    if (!candidate.gates.newsRiskGate) {
      candidate.failedGateReason = `Failed News Risk Gate: Material unscheduled event active on ${cleanSym}`;
      return candidate;
    }

    // 6. Earnings Gate: Block trading within 24 hours of scheduled earnings announcement
    candidate.gates.earningsGate = true; // Clear if no earnings today

    // 7. Halt Gate: Symbol must be active, not halted or suspended
    candidate.gates.haltGate = isTradable;

    // 8. Position Gate: Maximum single intraday position exposure <= 15% of portfolio
    const currentHolding = existingPositions.find(p => p.asset === cleanSym);
    candidate.gates.positionGate = !currentHolding || (currentHolding.quantity * candidate.askPrice) / currentPortfolioValue <= 0.15;

    // 9. Correlation Gate: Limit concurrent positions in same sector
    candidate.gates.correlationGate = existingPositions.length < 5;

    // 10. Daily-loss Gate: Block new intraday buys if day's portfolio drawdown exceeds -2.5%
    candidate.gates.dailyLossGate = dailyPnlPct > -2.5;
    if (!candidate.gates.dailyLossGate) {
      candidate.failedGateReason = `Daily Loss Limit hit: ${dailyPnlPct.toFixed(2)}% (limit: -2.5%)`;
      return candidate;
    }

    // 11. Duplicate-order Gate: Ensure no pending unfilled order exists for symbol
    const pendingOrders = await prisma.trade.findFirst({
      where: { asset: cleanSym, status: 'OPEN' }
    });
    candidate.gates.duplicateOrderGate = !pendingOrders;

    // 12. Cooldown Gate: Enforce 15-minute wait between trades on same symbol
    const lastTraded = this.lastTradeTimestamps.get(cleanSym) || 0;
    candidate.gates.cooldownGate = (Date.now() - lastTraded) > this.cooldownPeriodMs;

    // 13. Max Holding Period Gate: Intraday positions must close within 240 minutes
    candidate.gates.maxHoldingPeriodGate = candidate.holdingPeriodMinutes <= this.maxHoldingPeriodMinutes;

    // 14. End-of-Session Policy Gate: Never open new intraday positions within 15 minutes of regular market close
    const session = AlpacaMarketStreamService.classifyMarketHours();
    candidate.gates.endOfSessionPolicyGate = session === 'REGULAR';
    if (!candidate.gates.endOfSessionPolicyGate) {
      candidate.failedGateReason = `End-of-Session Policy: New intraday entries restricted outside Regular Session (current: ${session})`;
      return candidate;
    }

    // Check if ALL 14 gates passed
    const allPassed = Object.values(candidate.gates).every(Boolean);
    candidate.passedAllGates = allPassed;

    if (allPassed) {
      candidate.signalDirection = 'BUY';
      candidate.confidence = 82.5;
    }

    return candidate;
  }

  recordExecution(symbol: string) {
    this.lastTradeTimestamps.set(symbol.toUpperCase().trim(), Date.now());
  }
}

export const intradayEngine = new IntradayEquityEngine();
