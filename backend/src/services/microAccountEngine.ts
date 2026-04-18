// ═══════════════════════════════════════════════════════════════════════════
// THARUN AUTO TRADING PLATFORM
// MICRO-ACCOUNT ENGINE — Built specifically for $100 starting capital
// Every cent matters. Every fee matters. Every compound matters.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { getIO } from '../websocket/server';

// ── EXCHANGE FEE TABLE ────────────────────────────────────────────────────────
// These fees eat your account alive at $100 if ignored

export const EXCHANGE_FEES = {
  binance_spot: {
    maker: 0.001,    // 0.10% — you place a limit order
    taker: 0.001,    // 0.10% — you take from order book
    minOrderUSD: 10, // minimum $10 per order
    bnbDiscount: 0.00075, // 0.075% if paying fees in BNB (25% discount)
  },
  binance_futures: {
    maker: 0.0002,   // 0.02% — much cheaper for futures
    taker: 0.0005,   // 0.05%
    minOrderUSD: 5,  // minimum $5
    funding_rate_avg: 0.0001, // 0.01% every 8 hours = 0.03% per day extra cost
  },
  bybit_spot: {
    maker: 0.001,
    taker: 0.001,
    minOrderUSD: 1,  // $1 minimum — BEST for small accounts
  },
  bybit_futures: {
    maker: 0.0001,   // 0.01% maker
    taker: 0.0006,   // 0.06% taker
    minOrderUSD: 1,
  },
  alpaca_stocks: {
    maker: 0,        // FREE — Alpaca is commission-free for stocks
    taker: 0,
    minOrderUSD: 1,  // Fractional shares = $1 minimum
  },
  polymarket: {
    maker: 0,        // FREE — Polymarket has no trading fees
    taker: 0,
    minOrderUSD: 1,  // $1 minimum bet
    gasFeeMATIC: 0.001, // Polygon gas fee in MATIC ≈ $0.001 = basically free
  }
};

// ── MINIMUM VIABLE TRADE CALCULATOR ──────────────────────────────────────────

export interface TradeViabilityCheck {
  viable: boolean;
  expectedProfitUSD: number;
  totalFeesUSD: number;
  netProfitUSD: number;
  feeAsPercentOfProfit: number;
  minimumProfitRequired: number;
  reason: string;
  recommendation: string;
}

export function checkTradeViability(
  portfolioValue: number,
  positionSizeUSD: number,
  expectedReturnPct: number,  // e.g. 0.06 for 6%
  stopLossPct: number,        // e.g. 0.03 for 3%
  exchange: keyof typeof EXCHANGE_FEES,
  isMaker: boolean = true
): TradeViabilityCheck {

  const fees = EXCHANGE_FEES[exchange];
  const feeRate = isMaker ? fees.maker : fees.taker;

  // Calculate gross expected profit
  const expectedProfitGross = positionSizeUSD * expectedReturnPct;

  // Calculate total fees (entry fee + exit fee)
  const entryFee = positionSizeUSD * feeRate;
  const exitFee = positionSizeUSD * (1 + expectedReturnPct) * feeRate;
  const totalFees = entryFee + exitFee;

  // Net profit after fees
  const netProfit = expectedProfitGross - totalFees;

  // Fee as % of expected profit
  const feeAsPercentOfProfit = (totalFees / expectedProfitGross) * 100;

  // RULES:
  // 1. Fees must be less than 20% of expected profit (otherwise not worth it)
  // 2. Net profit must be at least $0.05 (5 cents minimum — below this is noise)
  // 3. Position must meet exchange minimum
  // 4. If Polymarket or Alpaca: fees are free so any positive EV is worth it

  const minOrderUSD = fees.minOrderUSD || 1;
  const minimumProfitRequired = exchange === 'polymarket' || exchange === 'alpaca_stocks' ? 0.01 : 0.05;

  let viable = true;
  let reason = '';

  if (positionSizeUSD < minOrderUSD) {
    viable = false;
    reason = `Position size $${positionSizeUSD.toFixed(2)} is below ${exchange} minimum of $${minOrderUSD}. Need larger portfolio first.`;
  } else if (netProfit < minimumProfitRequired) {
    viable = false;
    reason = `Net profit after fees ($${netProfit.toFixed(4)}) is below minimum $${minimumProfitRequired}. Fees eat the entire profit.`;
  } else if (feeAsPercentOfProfit > 25 && exchange !== 'polymarket' && exchange !== 'alpaca_stocks') {
    viable = false;
    reason = `Fees are ${feeAsPercentOfProfit.toFixed(1)}% of expected profit. Maximum allowed is 25%. Use a smaller stop loss or larger target.`;
  }

  if (viable) {
    reason = `Trade is viable. Net profit: $${netProfit.toFixed(4)} (fees: ${feeAsPercentOfProfit.toFixed(1)}% of gross profit)`;
  }

  logger.info(`  💰 Viability Check [${exchange}]: ${viable ? '✅ VIABLE' : '❌ NOT VIABLE'}`);
  logger.info(`     Position: $${positionSizeUSD.toFixed(2)} | Expected: +${(expectedReturnPct*100).toFixed(1)}% | Fees: $${totalFees.toFixed(4)}`);
  logger.info(`     Net profit: $${netProfit.toFixed(4)} | ${reason}`);

  return {
    viable,
    expectedProfitUSD: expectedProfitGross,
    totalFeesUSD: totalFees,
    netProfitUSD: netProfit,
    feeAsPercentOfProfit,
    minimumProfitRequired,
    reason,
    recommendation: viable
      ? `Execute trade on ${exchange}`
      : exchange !== 'polymarket' ? `Consider Polymarket instead (zero fees) or wait for larger portfolio` : reason
  };
}

// ── COMPOUNDING ENGINE ────────────────────────────────────────────────────────

export interface CompoundState {
  startingCapital: number;
  currentValue: number;
  totalGainUSD: number;
  totalGainPct: number;
  riskPerTrade: number;      // Always 0.5% of current value
  maxPositionSize: number;   // Always 10% of current value
  dailyCompoundRate: number; // Actual daily average growth rate
  projectedTo200: string;    // Days to double
  projectedTo500: string;
  projectedTo1000: string;
  milestone: string;         // Current milestone status
  extractionAmount: number;  // How much to extract to safe account
}

const STARTING_CAPITAL = parseFloat(process.env.STARTING_CAPITAL || '100');
const RISK_PCT = 0.005;      // 0.5% risk per trade for small accounts
const MAX_POSITION_PCT = 0.10; // 10% max position

export async function getCompoundState(): Promise<CompoundState> {
  // Get current portfolio value from DB
  const latest = await prisma.portfolioSnapshot.findFirst({ orderBy: { timestamp: 'desc' } });
  const currentValue = latest?.totalValue || STARTING_CAPITAL;

  // Get 7-day history to calculate actual compound rate
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const oldSnapshot = await prisma.portfolioSnapshot.findFirst({
    where: { timestamp: { gte: weekAgo } },
    orderBy: { timestamp: 'asc' }
  });
  const weekOldValue = oldSnapshot?.totalValue || STARTING_CAPITAL;
  const weekGainPct = ((currentValue - weekOldValue) / weekOldValue) * 100;
  const dailyCompoundRate = weekGainPct / 7;

  // Risk calculations — ALWAYS based on CURRENT value, never starting value
  const riskPerTrade = currentValue * RISK_PCT;
  const maxPositionSize = currentValue * MAX_POSITION_PCT;

  // Project future milestones based on actual performance
  const dailyGrowthRate = 1 + (dailyCompoundRate / 100);
  const daysTo200 = dailyCompoundRate > 0 ? Math.ceil(Math.log(200 / currentValue) / Math.log(dailyGrowthRate)) : 0;
  const daysTo500 = dailyCompoundRate > 0 ? Math.ceil(Math.log(500 / currentValue) / Math.log(dailyGrowthRate)) : 0;
  const daysTo1000 = dailyCompoundRate > 0 ? Math.ceil(Math.log(1000 / currentValue) / Math.log(dailyGrowthRate)) : 0;

  // Profit extraction rule — lock in profits at milestones
  let milestone = 'Building base';
  let extractionAmount = 0;

  if (currentValue >= 1000 && currentValue < 2000) {
    milestone = '🎯 $1000 reached!';
    extractionAmount = 200; // Extract $200 to safe account
  } else if (currentValue >= 500 && currentValue < 1000) {
    milestone = '🎯 $500 reached!';
    extractionAmount = 100;
  } else if (currentValue >= 200 && currentValue < 500) {
    milestone = '🎯 $200 reached!';
    extractionAmount = 40;
  } else if (currentValue > STARTING_CAPITAL * 1.2) {
    milestone = `📈 +${((currentValue / STARTING_CAPITAL - 1) * 100).toFixed(1)}% from start`;
  }

  logger.info(`\n📊 COMPOUND STATE:`);
  logger.info(`   Portfolio: $${currentValue.toFixed(2)} | Started: $${STARTING_CAPITAL}`);
  logger.info(`   Risk per trade: $${riskPerTrade.toFixed(2)} | Max position: $${maxPositionSize.toFixed(2)}`);
  logger.info(`   Daily compound rate: ${dailyCompoundRate.toFixed(2)}%`);
  if (dailyCompoundRate > 0) {
    logger.info(`   Days to $200: ${daysTo200} | $500: ${daysTo500} | $1000: ${daysTo1000}`);
  }

  return {
    startingCapital: STARTING_CAPITAL,
    currentValue,
    totalGainUSD: currentValue - STARTING_CAPITAL,
    totalGainPct: ((currentValue - STARTING_CAPITAL) / STARTING_CAPITAL) * 100,
    riskPerTrade,
    maxPositionSize,
    dailyCompoundRate,
    projectedTo200: daysTo200 > 0 ? `${daysTo200} days` : 'N/A',
    projectedTo500: daysTo500 > 0 ? `${daysTo500} days` : 'N/A',
    projectedTo1000: daysTo1000 > 0 ? `${daysTo1000} days` : 'N/A',
    milestone,
    extractionAmount
  };
}

// ── $100 POSITION SIZE CALCULATOR ─────────────────────────────────────────────
// Replaces the old 1% Kelly system — specifically tuned for micro accounts

export function calculateMicroPosition(
  currentPortfolio: number,
  entryPrice: number,
  stopLossPrice: number,
  exchange: keyof typeof EXCHANGE_FEES,
  confidence: number // 0-100 from agent council
): {
  shares: number;
  positionValue: number;
  dollarRisk: number;
  adjustedRiskPct: number;
  isAboveMinimum: boolean;
  recommendation: string;
} {
  // Scale risk with confidence — lower confidence = smaller bet
  const confidenceMultiplier = Math.max(0.3, (confidence - 55) / 45); // 0.3 to 1.0
  const riskPct = RISK_PCT * confidenceMultiplier;
  const dollarRisk = currentPortfolio * riskPct;

  // Distance to stop loss
  const stopDistance = Math.abs(entryPrice - stopLossPrice);
  const stopDistancePct = stopDistance / entryPrice;

  // Calculate shares
  const shares = stopDistance > 0 ? dollarRisk / stopDistance : 0;
  const positionValue = shares * entryPrice;

  // Cap at max position size
  const cappedValue = Math.min(positionValue, currentPortfolio * MAX_POSITION_PCT);
  const cappedShares = cappedValue / entryPrice;

  const minOrder = EXCHANGE_FEES[exchange].minOrderUSD || 1;
  const isAboveMinimum = cappedValue >= minOrder;

  let recommendation = '';
  if (!isAboveMinimum) {
    recommendation = `Position too small ($${cappedValue.toFixed(2)}) for ${exchange} minimum ($${minOrder}). Consider Polymarket or Alpaca fractional shares instead.`;
  } else {
    recommendation = `Buy ${cappedShares.toFixed(6)} units @ $${entryPrice} | Risk: $${dollarRisk.toFixed(2)} | Position: $${cappedValue.toFixed(2)}`;
  }

  return {
    shares: cappedShares,
    positionValue: cappedValue,
    dollarRisk,
    adjustedRiskPct: riskPct * 100,
    isAboveMinimum,
    recommendation
  };
}

// ── BEST PLATFORM SELECTOR ────────────────────────────────────────────────────
// Given a signal, determines the BEST platform to trade it on considering fees

export function selectBestPlatform(
  signal: 'BUY' | 'SELL',
  asset: string,
  market: 'crypto' | 'stocks' | 'prediction',
  positionSizeUSD: number,
  expectedReturnPct: number,
  isEventDriven: boolean // true = consider Polymarket
): { platform: string; reason: string; feeAdvantage: string } {

  if (isEventDriven && positionSizeUSD >= 1) {
    return {
      platform: 'polymarket',
      reason: 'Event-driven signal + zero fees on Polymarket = maximum profit retention',
      feeAdvantage: '0% fees vs 0.1-0.2% on crypto exchanges'
    };
  }

  if (market === 'stocks') {
    return {
      platform: 'alpaca_stocks',
      reason: 'Zero commission on Alpaca + fractional shares = perfect for small capital',
      feeAdvantage: '0% vs 0.1% on other platforms'
    };
  }

  if (market === 'crypto') {
    if (positionSizeUSD < 10) {
      return {
        platform: 'bybit_spot',
        reason: 'Bybit allows $1 minimum orders — Binance requires $10+',
        feeAdvantage: 'Same 0.1% fee but allows smaller positions'
      };
    }
    return {
      platform: 'binance_spot',
      reason: 'Best liquidity for crypto, use BNB for 25% fee discount',
      feeAdvantage: '0.075% with BNB discount vs 0.1% standard'
    };
  }

  return { platform: 'polymarket', reason: 'Default to zero-fee platform', feeAdvantage: '0% fees' };
}

// ── OVERNIGHT PROTECTION ──────────────────────────────────────────────────────

export function getOvernightRules(): {
  tradingAllowed: boolean;
  maxNewPositions: number;
  stopLossMultiplier: number;
  reason: string;
} {
  const hour = new Date().getUTCHours();

  // US market hours: 14:30-21:00 UTC (9:30 AM - 4:00 PM ET)
  // Best liquidity window: 14:30-17:00 UTC
  // Worst hours: 02:00-07:00 UTC (3 AM - 7 AM ET) — thin markets

  if (hour >= 2 && hour < 7) {
    // Dead of night — very thin liquidity, manipulation common
    return {
      tradingAllowed: false,
      maxNewPositions: 0,
      stopLossMultiplier: 1.5, // Wider stops on existing positions
      reason: 'Low liquidity hours (2-7 AM UTC). No new trades. Existing stops widened 50% to survive manipulation.'
    };
  }

  if (hour >= 22 || hour < 2) {
    // Late night / very early — reduced liquidity
    return {
      tradingAllowed: true,
      maxNewPositions: 1,
      stopLossMultiplier: 1.3,
      reason: 'Reduced liquidity hours. Max 1 new position. Stops widened 30%.'
    };
  }

  // Normal hours
  return {
    tradingAllowed: true,
    maxNewPositions: 3,
    stopLossMultiplier: 1.0,
    reason: 'Normal trading hours. Full operation.'
  };
}

// ── RECOVERY MODE SYSTEM ──────────────────────────────────────────────────────

export type AccountMode = 'NORMAL' | 'CAUTION' | 'RECOVERY' | 'DEFEND';

export function getAccountMode(
  currentValue: number,
  peakValue: number,
  dailyLossPct: number
): { mode: AccountMode; riskMultiplier: number; rules: string[] } {

  const drawdownFromPeak = ((peakValue - currentValue) / peakValue) * 100;

  if (drawdownFromPeak >= 20 || dailyLossPct <= -5) {
    return {
      mode: 'DEFEND',
      riskMultiplier: 0.2, // Trade at 20% of normal size
      rules: [
        'DEFEND MODE: Portfolio down 20%+ from peak',
        'Only highest conviction setups (90%+ confidence)',
        'Risk reduced to 0.1% per trade',
        'Only Polymarket trades allowed (zero fees)',
        'No crypto or stock trading until portfolio recovers',
        'Goal: stop bleeding, do not risk more capital'
      ]
    };
  }

  if (drawdownFromPeak >= 12 || dailyLossPct <= -3) {
    return {
      mode: 'RECOVERY',
      riskMultiplier: 0.4,
      rules: [
        'RECOVERY MODE: Portfolio down 12-20%',
        'Risk reduced to 0.2% per trade',
        'Minimum 80% agent confidence required',
        'Prefer zero-fee platforms (Polymarket, Alpaca)',
        'No aggressive day trading — swing trades only',
        'One trade at a time maximum'
      ]
    };
  }

  if (drawdownFromPeak >= 6 || dailyLossPct <= -1.5) {
    return {
      mode: 'CAUTION',
      riskMultiplier: 0.6,
      rules: [
        'CAUTION MODE: Portfolio down 6-12%',
        'Risk reduced to 0.3% per trade',
        'Minimum 70% agent confidence required',
        'Avoid scalping — swing trades only'
      ]
    };
  }

  return {
    mode: 'NORMAL',
    riskMultiplier: 1.0,
    rules: ['NORMAL: Full operation. Standard 0.5% risk per trade.']
  };
}

// ── TAX EVENT TRACKER ─────────────────────────────────────────────────────────

export interface TaxEvent {
  date: string;
  asset: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  priceUSD: number;
  totalUSD: number;
  costBasis?: number;  // For SELL events
  gainLoss?: number;   // For SELL events
  isShortTerm: boolean; // Held < 1 year = short-term (higher tax)
  exchangeFeeUSD: number;
}

export async function recordTaxEvent(
  tradeId: string,
  asset: string,
  type: 'BUY' | 'SELL',
  quantity: number,
  priceUSD: number,
  exchangeFeeUSD: number,
  costBasisUSD?: number
): Promise<void> {
  const totalUSD = quantity * priceUSD;
  const gainLoss = type === 'SELL' && costBasisUSD ? totalUSD - costBasisUSD - exchangeFeeUSD : undefined;

  await prisma.systemLog.create({
    data: {
      level: 'INFO',
      service: 'tax-tracker',
      message: `TAX EVENT: ${type} ${quantity} ${asset} @ $${priceUSD}`,
      metadata: {
        tradeId,
        date: new Date().toISOString(),
        asset,
        type,
        quantity,
        priceUSD,
        totalUSD,
        costBasis: costBasisUSD || null,
        gainLoss: gainLoss || null,
        isShortTerm: true, // Default — track holding period separately
        exchangeFeeUSD
      } as any
    }
  });

  if (gainLoss) {
    logger.info(`💸 TAX EVENT: ${gainLoss >= 0 ? 'GAIN' : 'LOSS'} $${Math.abs(gainLoss).toFixed(2)} on ${asset}`);
  }
}
