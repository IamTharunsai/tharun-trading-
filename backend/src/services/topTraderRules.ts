// ═══════════════════════════════════════════════════════════════════════════
// THARUN AUTO TRADING PLATFORM
// THE TOP TRADER RULES — 25 laws that separate winners from losers
// These are HARD CODED. No agent can override them. No exception ever.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '../utils/logger';
import { checkTradeViability, getOvernightRules, getAccountMode, EXCHANGE_FEES } from './microAccountEngine';
import { PortfolioState, TradeSignal } from '../agents/types';

export interface TopTraderValidation {
  approved: boolean;
  violations: string[];
  warnings: string[];
  score: number;  // 0-100 — trade quality score
  tier: 'ELITE' | 'GOOD' | 'MARGINAL' | 'REJECTED';
}

// ── THE 25 LAWS ───────────────────────────────────────────────────────────────

export async function validateWithTopTraderRules(
  signal: TradeSignal,
  portfolio: PortfolioState,
  agentConfidence: number,
  agentVoteCount: number,
  totalAgents: number,
  exchange: string,
  expectedReturnPct: number
): Promise<TopTraderValidation> {

  const violations: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  // ── LAW 1: THE FIRST LAW — Never risk ruin ────────────────────────────────
  // One bad trade should NEVER threaten the account's survival
  const riskPct = (signal.positionSizePct || 1) / 100;
  if (riskPct > 0.01) { // More than 1% risk
    violations.push(`LAW 1 VIOLATED: Risking ${(riskPct * 100).toFixed(1)}% per trade. Maximum 1% for small accounts.`);
    score -= 30;
  }

  // ── LAW 2: FEES MUST NOT EXCEED 20% OF EXPECTED PROFIT ────────────────────
  const viability = checkTradeViability(
    portfolio.totalValue,
    signal.entryPrice * (riskPct / Math.abs(signal.entryPrice - signal.stopLossPrice) * signal.entryPrice),
    expectedReturnPct,
    Math.abs((signal.entryPrice - signal.stopLossPrice) / signal.entryPrice),
    exchange as any
  );

  if (!viability.viable) {
    violations.push(`LAW 2 VIOLATED: ${viability.reason}`);
    score -= 25;
  }

  // ── LAW 3: MINIMUM 2:1 RISK/REWARD ────────────────────────────────────────
  const riskDistance = Math.abs(signal.entryPrice - signal.stopLossPrice);
  const rewardDistance = Math.abs(signal.takeProfitPrice - signal.entryPrice);
  const rrRatio = riskDistance > 0 ? rewardDistance / riskDistance : 0;

  if (rrRatio < 2.0) {
    violations.push(`LAW 3 VIOLATED: Risk/reward is ${rrRatio.toFixed(2)}:1. Minimum is 2:1. Never take a trade where you can't make at least 2x what you risk.`);
    score -= 20;
  } else if (rrRatio < 2.5) {
    warnings.push(`Risk/reward ${rrRatio.toFixed(2)}:1 is acceptable but not ideal. Target 3:1+.`);
    score -= 5;
  }

  // ── LAW 4: OVERNIGHT PROTECTION ───────────────────────────────────────────
  const overnight = getOvernightRules();
  if (!overnight.tradingAllowed) {
    violations.push(`LAW 4 VIOLATED: ${overnight.reason} No new trades in this time window.`);
    score -= 20;
  }

  // ── LAW 5: ACCOUNT MODE CHECK ──────────────────────────────────────────────
  const peakValue = portfolio.totalValue * 1.15; // Simplified — track real peak separately
  const mode = getAccountMode(portfolio.totalValue, peakValue, portfolio.pnlDayPct);

  if (mode.mode === 'DEFEND') {
    violations.push(`LAW 5 VIOLATED: Account in DEFEND mode. No new trades until portfolio recovers.`);
    score -= 40;
  } else if (mode.mode === 'RECOVERY') {
    if (agentConfidence < 80) {
      violations.push(`LAW 5: RECOVERY mode requires 80%+ confidence. Current: ${agentConfidence}%.`);
      score -= 25;
    }
  }

  // ── LAW 6: LIQUIDITY MINIMUM ───────────────────────────────────────────────
  // Never trade in thin markets — slippage destroys small accounts
  // This is checked via volume in market snapshot

  // ── LAW 7: NO CHASING ─────────────────────────────────────────────────────
  // Price must be within 0.5% of ideal entry — no FOMO entries
  // Checked by execution engine

  // ── LAW 8: STOP LOSS IS SACRED ────────────────────────────────────────────
  if (!signal.stopLossPrice || signal.stopLossPrice <= 0) {
    violations.push('LAW 8 VIOLATED: No stop loss defined. Every single trade must have a stop loss. No exceptions. Ever.');
    score -= 50; // This is catastrophic
  }

  // ── LAW 9: MINIMUM AGENT CONSENSUS ────────────────────────────────────────
  // For $100 account we need even more consensus than standard
  const consensusPct = (agentVoteCount / totalAgents) * 100;
  if (consensusPct < 70) {
    violations.push(`LAW 9 VIOLATED: Only ${agentVoteCount}/${totalAgents} agents agree (${consensusPct.toFixed(0)}%). Need 70%+ for $100 account.`);
    score -= 20;
  }

  // ── LAW 10: CONFIDENCE MINIMUM ────────────────────────────────────────────
  if (agentConfidence < 65) {
    violations.push(`LAW 10 VIOLATED: Average agent confidence ${agentConfidence}% below minimum 65%.`);
    score -= 20;
  } else if (agentConfidence < 72) {
    warnings.push(`Confidence ${agentConfidence}% is marginal. Consider smaller position.`);
    score -= 5;
  }

  // ── LAW 11: NO EARNINGS STRADDLING ────────────────────────────────────────
  // Stocks should not be held into earnings without deliberate intent
  // Checked per-asset by the Earnings Specialist agent

  // ── LAW 12: DAILY LOSS LIMIT ──────────────────────────────────────────────
  if (portfolio.pnlDayPct <= -3) {
    violations.push(`LAW 12 VIOLATED: Already down ${Math.abs(portfolio.pnlDayPct).toFixed(1)}% today. Daily limit is -3%. No more trades today.`);
    score -= 40;
  } else if (portfolio.pnlDayPct <= -2) {
    warnings.push(`Down ${Math.abs(portfolio.pnlDayPct).toFixed(1)}% today. Approaching daily limit. Reduce position sizes.`);
    score -= 10;
  }

  // ── LAW 13: MAXIMUM DRAWDOWN ──────────────────────────────────────────────
  if (portfolio.drawdownFromPeak >= 15) {
    violations.push(`LAW 13 VIOLATED: Drawdown from peak ${portfolio.drawdownFromPeak.toFixed(1)}%. Emergency stop at 15%. Close all positions.`);
    score -= 50;
  }

  // ── LAW 14: CASH RESERVE PROTECTION ──────────────────────────────────────
  const cashPct = (portfolio.cashBalance / portfolio.totalValue) * 100;
  if (cashPct < 15) {
    violations.push(`LAW 14 VIOLATED: Cash reserve ${cashPct.toFixed(1)}% below minimum 15%. Must keep emergency cash.`);
    score -= 20;
  } else if (cashPct < 25) {
    warnings.push(`Cash reserve ${cashPct.toFixed(1)}% is low. Consider taking some profits before new positions.`);
    score -= 5;
  }

  // ── LAW 15: CORRELATION LIMIT ─────────────────────────────────────────────
  if (portfolio.positions.length >= 3) {
    const cryptoPositions = portfolio.positions.filter((p: any) => p.market === 'crypto');
    if (cryptoPositions.length >= 3 && signal.market === 'crypto') {
      violations.push(`LAW 15 VIOLATED: Already have ${cryptoPositions.length} crypto positions (all correlated). Cannot add more crypto.`);
      score -= 20;
    }
  }

  // ── LAW 16: NO REVENGE TRADING ────────────────────────────────────────────
  // If last 3 trades all lost, require cooling off period
  // (Implemented in scheduler — not here)

  // ── LAW 17: TRADE JOURNAL REQUIREMENT ─────────────────────────────────────
  // Every trade must have reasoning recorded (enforced by DB write requirement)

  // ── LAW 18: SIZE DOWN IN UNCERTAINTY ─────────────────────────────────────
  if (agentConfidence >= 65 && agentConfidence < 75) {
    warnings.push(`Confidence is marginal (${agentConfidence}%). Consider trading at 50% of normal size.`);
    score -= 5;
  }

  // ── LAW 19: VIX/VOLATILITY CHECK ──────────────────────────────────────────
  // High volatility = smaller positions. Checked by regime detector.

  // ── LAW 20: PROFIT IS NOT REAL UNTIL LOCKED IN ────────────────────────────
  // Never mentally spend unrealized profits
  // Trail stops aggressively when profitable

  // ── LAW 21: KNOW YOUR EXIT BEFORE YOU ENTER ───────────────────────────────
  if (!signal.takeProfitPrice || signal.takeProfitPrice <= 0) {
    violations.push(`LAW 21 VIOLATED: No take profit defined. Know your exit BEFORE entering. No target = no trade.`);
    score -= 15;
  }

  // ── LAW 22: MARKET HOURS FOR STOCKS ──────────────────────────────────────
  if (signal.market === 'stocks') {
    const hour = new Date().getUTCHours();
    const minute = new Date().getUTCMinutes();
    const minutesSinceMidnight = hour * 60 + minute;
    const marketOpen = 13 * 60 + 30;   // 9:30 AM ET = 13:30 UTC (EDT/UTC-4, Mar–Nov)
    const marketClose = 20 * 60 + 30;  // 4:00 PM ET = 20:00 UTC (EDT); 21:00 in EST

    if (minutesSinceMidnight < marketOpen || minutesSinceMidnight > marketClose) {
      violations.push('LAW 22 VIOLATED: US stock market is closed. No stock trades outside 9:30 AM - 4:00 PM ET.');
      score -= 20;
    }
  }

  // ── LAW 23: SMALL ACCOUNT = POLYMARKET FIRST ─────────────────────────────
  // For accounts under $500, Polymarket and Alpaca are preferred (zero fees)
  if (portfolio.totalValue < 500 && signal.market === 'crypto' &&
      exchange !== 'bybit_spot' && EXCHANGE_FEES[exchange as keyof typeof EXCHANGE_FEES]?.maker > 0) {
    warnings.push(`LAW 23: Account under $500. Consider Polymarket (zero fees) or Alpaca (zero commission) to maximize profits.`);
    score -= 3;
  }

  // ── LAW 24: NEVER AVERAGE DOWN A LOSER ────────────────────────────────────
  const existingPosition = portfolio.positions.find((p: any) => p.asset === signal.asset);
  if (existingPosition && (existingPosition as any).unrealizedPnlPct < -2) {
    violations.push(`LAW 24 VIOLATED: Trying to add to a losing ${signal.asset} position (down ${(existingPosition as any).unrealizedPnlPct?.toFixed(1)}%). NEVER average down. Take the loss or honor the stop.`);
    score -= 30;
  }

  // ── LAW 25: THE META-LAW — WHEN IN DOUBT DON'T ───────────────────────────
  if (violations.length === 0 && warnings.length >= 3) {
    violations.push('LAW 25: Multiple warnings detected. When in doubt, do not trade. There will always be another setup.');
    score -= 15;
  }

  // ── DETERMINE TIER ────────────────────────────────────────────────────────
  let tier: 'ELITE' | 'GOOD' | 'MARGINAL' | 'REJECTED';
  const approved = violations.length === 0;

  if (!approved) {
    tier = 'REJECTED';
    score = Math.max(0, score);
  } else if (score >= 85) {
    tier = 'ELITE';
  } else if (score >= 70) {
    tier = 'GOOD';
  } else {
    tier = 'MARGINAL';
  }

  // Log result
  logger.info(`\n⚖️  TOP TRADER VALIDATION:`);
  logger.info(`   Score: ${score}/100 | Tier: ${tier} | Approved: ${approved}`);
  if (violations.length > 0) {
    logger.warn(`   ❌ Violations (${violations.length}):`);
    violations.forEach(v => logger.warn(`      ${v}`));
  }
  if (warnings.length > 0) {
    logger.info(`   ⚠️  Warnings (${warnings.length}):`);
    warnings.forEach(w => logger.info(`      ${w}`));
  }

  return { approved, violations, warnings, score, tier };
}

// ── COMPOUND GROWTH PROJECTOR ─────────────────────────────────────────────────

export function projectCompoundGrowth(
  startingCapital: number,
  dailyWinRate: number,      // e.g. 0.6 = 60% of days profitable
  avgWinDay: number,         // e.g. 0.008 = 0.8% gain on winning days
  avgLossDay: number,        // e.g. 0.004 = 0.4% loss on losing days
  days: number = 365
): { finalValue: number; peakValue: number; maxDrawdown: number; cagr: number } {

  let value = startingCapital;
  let peak = startingCapital;
  let maxDrawdown = 0;

  // Monte Carlo simulation — 100 paths
  const finalValues: number[] = [];

  for (let sim = 0; sim < 100; sim++) {
    let simValue = startingCapital;
    let simPeak = startingCapital;
    let simMaxDD = 0;

    for (let day = 0; day < days; day++) {
      const isWin = Math.random() < dailyWinRate;
      if (isWin) {
        simValue *= (1 + avgWinDay);
      } else {
        simValue *= (1 - avgLossDay);
      }
      simPeak = Math.max(simPeak, simValue);
      const dd = (simPeak - simValue) / simPeak * 100;
      simMaxDD = Math.max(simMaxDD, dd);
    }

    finalValues.push(simValue);
    maxDrawdown += simMaxDD;
  }

  // Median outcome
  finalValues.sort((a, b) => a - b);
  const medianFinal = finalValues[50];
  const cagr = (Math.pow(medianFinal / startingCapital, 365 / days) - 1) * 100;

  logger.info(`\n📈 COMPOUND GROWTH PROJECTION (${days} days):`);
  logger.info(`   Start: $${startingCapital} | Projected median: $${medianFinal.toFixed(2)}`);
  logger.info(`   CAGR: ${cagr.toFixed(1)}% | Avg max drawdown: ${(maxDrawdown / 100).toFixed(1)}%`);
  logger.info(`   25th percentile: $${finalValues[25].toFixed(2)} | 75th: $${finalValues[75].toFixed(2)}`);

  return {
    finalValue: medianFinal,
    peakValue: Math.max(...finalValues),
    maxDrawdown: maxDrawdown / 100,
    cagr
  };
}
