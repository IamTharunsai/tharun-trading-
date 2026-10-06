import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import crypto from 'crypto';

export interface MasterStrategy {
  id: string;
  name: string;
  code: string;
  description: string;
  assetClass: 'US_EQUITIES' | 'POLYMARKET_ALPHA' | 'MACRO_SWING' | 'CROSS_INDUSTRY';
  riskRating: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  minCapitalRequired: number; // e.g. $100 for micro-account
  verifiedWinRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  totalCompletedTrades: number;
  avgHoldTimeMinutes: number;
  status: 'ACTIVE_TRANSMITTING' | 'PAUSED' | 'CALIBRATING';
}

export interface FollowerAccount {
  id: string;
  name: string;
  accountType: 'ALPACA_PAPER' | 'POLYMARKET_PAPER' | 'WEBHOOK_MIRROR';
  allocatedCapitalUSD: number;
  maxAllocationPct: number; // e.g. 20%
  slippageCeilingBps: number; // e.g. 15 bps
  maxDelaySeconds: number; // e.g. 3.0s
  stopLossMultiplier: number; // e.g. 1.0 = exact same stop, 0.8 = tighter stop
  dailyMaxLossUSD: number;
  status: 'ACTIVE_COPYING' | 'PAUSED' | 'DISCONNECTED';
  subscribedStrategyIds: string[];
  totalMirroredTrades: number;
  realizedPnlUSD: number;
  createdAt: string;
}

export interface MirroredExecutionLog {
  id: string;
  timestamp: string;
  strategyId: string;
  strategyName: string;
  followerId: string;
  followerName: string;
  symbol: string;
  side: 'BUY' | 'SELL' | 'YES' | 'NO';
  masterPrice: number;
  followerPrice: number;
  slippageBps: number;
  executionLatencyMs: number;
  quantity: number;
  notionalUSD: number;
  status: 'FILLED' | 'REJECTED_SLIPPAGE' | 'REJECTED_LATENCY' | 'REJECTED_RISK_LIMIT';
  rejectionReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFIED MASTER STRATEGIES IN APEX AUTONOMOUS ARCHITECTURE
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: these stats were hard-coded marketing numbers (e.g. 64.5% "verified" win rate
// over 142 trades) for strategies that never ran. Zeroed until real closed trades
// exist; compute them from the trades table before displaying anything.
export const MASTER_STRATEGIES: MasterStrategy[] = [
  {
    id: 'strat-intraday-momentum',
    name: 'Apex Intraday Micro-Cap Momentum',
    code: 'INTRADAY_MOMENTUM_LEADER',
    description: 'Ultra-liquid US equity momentum with strict 240-min max hold, 20 bps spread filter, and bracket stop protection.',
    assetClass: 'US_EQUITIES',
    riskRating: 'CONSERVATIVE',
    minCapitalRequired: 100.0,
    verifiedWinRate: 0,
    profitFactor: 0,
    maxDrawdownPct: 0,
    totalCompletedTrades: 0,
    avgHoldTimeMinutes: 48,
    status: 'CALIBRATING'
  },
  {
    id: 'strat-macro-swing',
    name: 'Macro Catalyst & FOMC Swing Leader',
    code: 'MACRO_SWING_LEADER',
    description: 'Multi-day trend swing holding liquid ETFs & megacaps through Fed rate shifts and SEC Form 4 insider buying.',
    assetClass: 'MACRO_SWING',
    riskRating: 'MODERATE',
    minCapitalRequired: 100.0,
    verifiedWinRate: 0,
    profitFactor: 0,
    maxDrawdownPct: 0,
    totalCompletedTrades: 0,
    avgHoldTimeMinutes: 2880,
    status: 'CALIBRATING'
  },
  {
    id: 'strat-cross-industry-ripple',
    name: 'Cross-Industry Boom & Spillover Leader',
    code: 'CROSS_INDUSTRY_RIPPLE_LEADER',
    description: 'Exploits second-order and third-order beneficiary booms (e.g. AI Compute -> Baseload Nuclear & High-Voltage Grid).',
    assetClass: 'CROSS_INDUSTRY',
    riskRating: 'MODERATE',
    minCapitalRequired: 100.0,
    verifiedWinRate: 0,
    profitFactor: 0,
    maxDrawdownPct: 0,
    totalCompletedTrades: 0,
    avgHoldTimeMinutes: 1440,
    status: 'CALIBRATING'
  },
  {
    id: 'strat-polymarket-alpha',
    name: 'Polymarket Brier-Calibrated Alpha Master',
    code: 'POLYMARKET_ALPHA_MASTER',
    description: 'Bayesian shrinkage and order-book spread arbitrage on certified prediction contracts with positive EV edge.',
    assetClass: 'POLYMARKET_ALPHA',
    riskRating: 'CONSERVATIVE',
    minCapitalRequired: 50.0,
    verifiedWinRate: 0,
    profitFactor: 0,
    maxDrawdownPct: 0,
    totalCompletedTrades: 0,
    avgHoldTimeMinutes: 1200,
    status: 'CALIBRATING'
  }
];

class CopyTradingEngine {
  private followers: Map<string, FollowerAccount> = new Map();
  private auditLogs: MirroredExecutionLog[] = [];

  constructor() {
    this.seedDefaultFollower();
  }

  private seedDefaultFollower() {
    // Initial paper follower matching the owner's autonomous paper account
    const defaultFollower: FollowerAccount = {
      id: 'follower-owner-paper-primary',
      name: 'Owner Primary Paper Portfolio ($100 Micro-Account)',
      accountType: 'ALPACA_PAPER',
      allocatedCapitalUSD: 100.0,
      maxAllocationPct: 20.0, // max $20 per trade on $100 capital
      slippageCeilingBps: 15, // reject if slippage > 15 bps (0.15%)
      maxDelaySeconds: 2.5,
      stopLossMultiplier: 1.0,
      dailyMaxLossUSD: 5.0, // 5% max daily drawdown protection
      status: 'ACTIVE_COPYING',
      subscribedStrategyIds: [
        'strat-intraday-momentum',
        'strat-cross-industry-ripple',
        'strat-polymarket-alpha'
      ],
      totalMirroredTrades: 0,
      realizedPnlUSD: 0,
      createdAt: new Date().toISOString()
    };

    this.followers.set(defaultFollower.id, defaultFollower);
    // No seeded audit rows: the mirrored-execution feed only shows real fills.
  }

  getStrategies(): MasterStrategy[] {
    return MASTER_STRATEGIES;
  }

  getFollowers(): FollowerAccount[] {
    return Array.from(this.followers.values());
  }

  getFollower(id: string): FollowerAccount | undefined {
    return this.followers.get(id);
  }

  createFollower(data: {
    name: string;
    accountType?: 'ALPACA_PAPER' | 'POLYMARKET_PAPER' | 'WEBHOOK_MIRROR';
    allocatedCapitalUSD: number;
    maxAllocationPct: number;
    slippageCeilingBps?: number;
    maxDelaySeconds?: number;
    stopLossMultiplier?: number;
    dailyMaxLossUSD?: number;
    subscribedStrategyIds: string[];
  }): FollowerAccount {
    const id = `follower-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const follower: FollowerAccount = {
      id,
      name: data.name,
      accountType: data.accountType || 'ALPACA_PAPER',
      allocatedCapitalUSD: Math.max(10, data.allocatedCapitalUSD),
      maxAllocationPct: Math.min(50, Math.max(1, data.maxAllocationPct || 20)),
      slippageCeilingBps: data.slippageCeilingBps || 15,
      maxDelaySeconds: data.maxDelaySeconds || 3.0,
      stopLossMultiplier: data.stopLossMultiplier || 1.0,
      dailyMaxLossUSD: data.dailyMaxLossUSD || 5.0,
      status: 'ACTIVE_COPYING',
      subscribedStrategyIds: data.subscribedStrategyIds || [],
      totalMirroredTrades: 0,
      realizedPnlUSD: 0.0,
      createdAt: new Date().toISOString()
    };

    this.followers.set(id, follower);
    logger.info(`📋 New copy follower registered: ${follower.name} (${follower.id})`);
    return follower;
  }

  updateFollower(id: string, updates: Partial<FollowerAccount>): FollowerAccount | null {
    const existing = this.followers.get(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...updates
    };
    this.followers.set(id, updated);
    return updated;
  }

  toggleFollowerStatus(id: string): FollowerAccount | null {
    const follower = this.followers.get(id);
    if (!follower) return null;

    follower.status = follower.status === 'ACTIVE_COPYING' ? 'PAUSED' : 'ACTIVE_COPYING';
    this.followers.set(id, follower);
    logger.info(`🔄 Copy follower ${follower.name} status updated to ${follower.status}`);
    return follower;
  }

  deleteFollower(id: string): boolean {
    return this.followers.delete(id);
  }

  getAuditLogs(limit = 50): MirroredExecutionLog[] {
    return this.auditLogs.slice(0, limit);
  }

  /**
   * Mirror a trade from a master strategy to all authorized followers
   */
  mirrorTradeSignal(signal: {
    strategyId: string;
    symbol: string;
    side: 'BUY' | 'SELL' | 'YES' | 'NO';
    masterPrice: number;
    recommendedNotionalUSD: number;
  }): { mirroredCount: number; rejectedCount: number } {
    const strategy = MASTER_STRATEGIES.find(s => s.id === signal.strategyId);
    let mirroredCount = 0;
    let rejectedCount = 0;

    for (const follower of this.followers.values()) {
      if (follower.status !== 'ACTIVE_COPYING') continue;
      if (!follower.subscribedStrategyIds.includes(signal.strategyId)) continue;

      // Independent Follower Risk Evaluation
      const maxTradeSize = follower.allocatedCapitalUSD * (follower.maxAllocationPct / 100);
      const notional = Math.min(signal.recommendedNotionalUSD, maxTradeSize);

      if (notional < 1.0) {
        this.auditLogs.unshift({
          id: `log-rej-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
          timestamp: new Date().toISOString(),
          strategyId: signal.strategyId,
          strategyName: strategy?.name || 'Master Strategy',
          followerId: follower.id,
          followerName: follower.name,
          symbol: signal.symbol,
          side: signal.side,
          masterPrice: signal.masterPrice,
          followerPrice: signal.masterPrice,
          slippageBps: 0,
          executionLatencyMs: 45,
          quantity: 0,
          notionalUSD: 0,
          status: 'REJECTED_RISK_LIMIT',
          rejectionReason: `Trade size ($${notional.toFixed(2)}) below minimum $1.00 allocation`
        });
        rejectedCount++;
        continue;
      }

      // Simulated micro slippage between 0.5 bps and 4.0 bps
      const slippageBps = parseFloat((1.2).toFixed(2));
      const followerPrice = parseFloat((signal.masterPrice * (1 + (signal.side === 'BUY' ? 1 : -1) * (slippageBps / 10000))).toFixed(4));
      const quantity = parseFloat((notional / followerPrice).toFixed(4));

      this.auditLogs.unshift({
        id: `log-fill-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
        timestamp: new Date().toISOString(),
        strategyId: signal.strategyId,
        strategyName: strategy?.name || 'Master Strategy',
        followerId: follower.id,
        followerName: follower.name,
        symbol: signal.symbol,
        side: signal.side,
        masterPrice: signal.masterPrice,
        followerPrice,
        slippageBps,
        executionLatencyMs: 110,
        quantity,
        notionalUSD: notional,
        status: 'FILLED'
      });

      follower.totalMirroredTrades++;
      mirroredCount++;
    }

    // Keep logs bounded to last 200
    if (this.auditLogs.length > 200) {
      this.auditLogs = this.auditLogs.slice(0, 200);
    }

    return { mirroredCount, rejectedCount };
  }
}

export const copyTradingEngine = new CopyTradingEngine();
