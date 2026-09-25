// MOCKED / RESILIENT PRISMA CLIENT (per AI Studio web migration guidelines)
import bcrypt from 'bcryptjs';

// Pre-hashed password for Tharunsai@2081as
const DEFAULT_PASSWORD_HASH = bcrypt.hashSync('Tharunsai@2081as', 10);

interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  totpSecret?: string | null;
  totpEnabled: boolean;
  lastLogin?: Date | null;
  sessionToken?: string | null;
  ipWhitelist?: any;
  createdAt: Date;
  updatedAt: Date;
}

const now = Date.now();
const dayMs = 86400000;

// Seed initial in-memory data
const users: MockUser[] = [
  {
    id: 'owner-user-1',
    email: 'tharunsai2081@gmail.com',
    passwordHash: DEFAULT_PASSWORD_HASH,
    totpSecret: 'JBSWY3DPEHPK3PXP',
    totpEnabled: false,
    lastLogin: new Date(),
    ipWhitelist: [],
    createdAt: new Date(now - 30 * dayMs),
    updatedAt: new Date(),
  },
  {
    id: 'owner-user-2',
    email: 'nandigam2081@gmail.com',
    passwordHash: DEFAULT_PASSWORD_HASH,
    totpSecret: 'JBSWY3DPEHPK3PXP',
    totpEnabled: false,
    lastLogin: new Date(),
    ipWhitelist: [],
    createdAt: new Date(now - 30 * dayMs),
    updatedAt: new Date(),
  },
];

let trades: any[] = [
  {
    id: 'trade-1',
    asset: 'BTC',
    market: 'crypto',
    type: 'BUY',
    entryPrice: 62100.0,
    exitPrice: null,
    quantity: 0.85,
    pnl: 1827.5,
    pnlPct: 3.46,
    fees: 12.5,
    status: 'OPEN',
    brokerOrderId: 'ord-alpaca-101',
    brokerConfirmed: true,
    openedAt: new Date(now - 2 * dayMs),
    stopLossPrice: 59500.0,
    takeProfitPrice: 68000.0,
    createdAt: new Date(now - 2 * dayMs),
    updatedAt: new Date(),
  },
  {
    id: 'trade-2',
    asset: 'NVDA',
    market: 'stocks',
    type: 'BUY',
    entryPrice: 118.2,
    exitPrice: null,
    quantity: 80,
    pnl: 576.0,
    pnlPct: 6.09,
    fees: 1.5,
    status: 'OPEN',
    brokerOrderId: 'ord-alpaca-102',
    brokerConfirmed: true,
    openedAt: new Date(now - 3 * dayMs),
    stopLossPrice: 112.0,
    takeProfitPrice: 135.0,
    createdAt: new Date(now - 3 * dayMs),
    updatedAt: new Date(),
  },
  {
    id: 'trade-3',
    asset: 'AAPL',
    market: 'stocks',
    type: 'BUY',
    entryPrice: 178.5,
    exitPrice: null,
    quantity: 50,
    pnl: 200.0,
    pnlPct: 2.24,
    fees: 1.0,
    status: 'OPEN',
    brokerOrderId: 'ord-alpaca-103',
    brokerConfirmed: true,
    openedAt: new Date(now - 4 * dayMs),
    stopLossPrice: 172.0,
    takeProfitPrice: 195.0,
    createdAt: new Date(now - 4 * dayMs),
    updatedAt: new Date(),
  },
  {
    id: 'trade-4',
    asset: 'ETH',
    market: 'crypto',
    type: 'BUY',
    entryPrice: 3200.0,
    exitPrice: 3420.0,
    quantity: 5.0,
    pnl: 1100.0,
    pnlPct: 6.88,
    fees: 15.0,
    status: 'CLOSED',
    brokerOrderId: 'ord-alpaca-099',
    brokerConfirmed: true,
    openedAt: new Date(now - 7 * dayMs),
    closedAt: new Date(now - 2 * dayMs),
    exitReason: 'take_profit',
    createdAt: new Date(now - 7 * dayMs),
    updatedAt: new Date(now - 2 * dayMs),
  },
  {
    id: 'trade-5',
    asset: 'SOL',
    market: 'crypto',
    type: 'BUY',
    entryPrice: 135.0,
    exitPrice: 148.5,
    quantity: 40.0,
    pnl: 540.0,
    pnlPct: 10.0,
    fees: 8.0,
    status: 'CLOSED',
    brokerOrderId: 'ord-alpaca-098',
    brokerConfirmed: true,
    openedAt: new Date(now - 10 * dayMs),
    closedAt: new Date(now - 5 * dayMs),
    exitReason: 'take_profit',
    createdAt: new Date(now - 10 * dayMs),
    updatedAt: new Date(now - 5 * dayMs),
  },
  {
    id: 'trade-6',
    asset: 'MSFT',
    market: 'stocks',
    type: 'BUY',
    entryPrice: 405.0,
    exitPrice: 418.5,
    quantity: 25,
    pnl: 337.5,
    pnlPct: 3.33,
    fees: 2.0,
    status: 'CLOSED',
    brokerOrderId: 'ord-alpaca-097',
    brokerConfirmed: true,
    openedAt: new Date(now - 12 * dayMs),
    closedAt: new Date(now - 6 * dayMs),
    exitReason: 'take_profit',
    createdAt: new Date(now - 12 * dayMs),
    updatedAt: new Date(now - 6 * dayMs),
  },
  {
    id: 'trade-7',
    asset: 'TSLA',
    market: 'stocks',
    type: 'BUY',
    entryPrice: 255.0,
    exitPrice: 247.0,
    quantity: 30,
    pnl: -240.0,
    pnlPct: -3.14,
    fees: 2.0,
    status: 'CLOSED',
    brokerOrderId: 'ord-alpaca-096',
    brokerConfirmed: true,
    openedAt: new Date(now - 14 * dayMs),
    closedAt: new Date(now - 11 * dayMs),
    exitReason: 'stop_loss',
    createdAt: new Date(now - 14 * dayMs),
    updatedAt: new Date(now - 11 * dayMs),
  },
];

let positions: any[] = [
  {
    id: 'pos-1',
    asset: 'BTC',
    market: 'crypto',
    side: 'BUY',
    entryPrice: 62100.0,
    currentPrice: 64250.0,
    quantity: 0.85,
    unrealizedPnl: 1827.5,
    unrealizedPnlPct: 3.46,
    stopLossPrice: 59500.0,
    takeProfitPrice: 68000.0,
    status: 'OPEN',
    openedAt: new Date(now - 2 * dayMs),
  },
  {
    id: 'pos-2',
    asset: 'NVDA',
    market: 'stocks',
    side: 'BUY',
    entryPrice: 118.2,
    currentPrice: 125.4,
    quantity: 80,
    unrealizedPnl: 576.0,
    unrealizedPnlPct: 6.09,
    stopLossPrice: 112.0,
    takeProfitPrice: 135.0,
    status: 'OPEN',
    openedAt: new Date(now - 3 * dayMs),
  },
  {
    id: 'pos-3',
    asset: 'AAPL',
    market: 'stocks',
    side: 'BUY',
    entryPrice: 178.5,
    currentPrice: 182.5,
    quantity: 50,
    unrealizedPnl: 200.0,
    unrealizedPnlPct: 2.24,
    stopLossPrice: 172.0,
    takeProfitPrice: 195.0,
    status: 'OPEN',
    openedAt: new Date(now - 4 * dayMs),
  },
];

// 30 days of snapshots
const snapshots: any[] = [];
let baseVal = 94500;
for (let i = 30; i >= 0; i--) {
  baseVal += (Math.sin(i * 0.7) * 450 + 280);
  snapshots.push({
    id: `snap-${30 - i}`,
    timestamp: new Date(now - i * dayMs),
    portfolioValue: Math.round(baseVal * 100) / 100,
    cashBalance: Math.round((baseVal * 0.4) * 100) / 100,
    investedAmount: Math.round((baseVal * 0.6) * 100) / 100,
    dailyPnl: Math.round((Math.sin(i * 0.7) * 450 + 280) * 100) / 100,
    totalPnl: Math.round((baseVal - 94500) * 100) / 100,
  });
}

let agentDecisions: any[] = [
  {
    id: 'dec-1',
    asset: 'BTC',
    market: 'crypto',
    finalDecision: 'BUY',
    finalConfidence: 84.5,
    consensusVote: 'BUY',
    executionApproved: true,
    stopLossPrice: 59500.0,
    takeProfitPrice: 68000.0,
    positionSizePct: 12.0,
    masterSynthesis: 'Strong momentum confirmed across 200 EMA breakout and bullish options positioning. Risk/reward ratio favorable (>2.8:1).',
    timestamp: new Date(now - 2 * dayMs),
    round1: [
      { agentId: 1, agentName: 'Trend Follower', vote: 'BUY', confidence: 88, reasoning: 'Golden cross on 4H chart with surging volume.' },
      { agentId: 2, agentName: 'Risk Manager', vote: 'BUY', confidence: 80, reasoning: 'Within Kelly criterion and account max drawdown thresholds.' },
      { agentId: 3, agentName: 'Macro Sentinel', vote: 'HOLD', confidence: 60, reasoning: 'Upcoming CPI print could introduce volatility.' },
    ],
    round3: [
      { agentId: 1, agentName: 'Trend Follower', finalVote: 'BUY', confidence: 88 },
      { agentId: 2, agentName: 'Risk Manager', finalVote: 'BUY', confidence: 85 },
      { agentId: 3, agentName: 'Macro Sentinel', finalVote: 'BUY', confidence: 75 },
    ],
  },
  {
    id: 'dec-2',
    asset: 'NVDA',
    market: 'stocks',
    finalDecision: 'BUY',
    finalConfidence: 88.0,
    consensusVote: 'BUY',
    executionApproved: true,
    stopLossPrice: 112.0,
    takeProfitPrice: 135.0,
    positionSizePct: 10.0,
    masterSynthesis: 'Data center AI demand remains resilient. Strong analyst consensus upgrade with breakout above $120 resistance.',
    timestamp: new Date(now - 3 * dayMs),
    round1: [
      { agentId: 1, agentName: 'Fundamentalist', vote: 'BUY', confidence: 92, reasoning: 'PEG ratio remains attractive given forward EPS CAGR.' },
      { agentId: 2, agentName: 'Quant', vote: 'BUY', confidence: 86, reasoning: 'Statistical z-score indicates continuation trend.' },
    ],
    round3: [
      { agentId: 1, agentName: 'Fundamentalist', finalVote: 'BUY', confidence: 92 },
      { agentId: 2, agentName: 'Quant', finalVote: 'BUY', confidence: 86 },
    ],
  },
];

let journals: any[] = [
  {
    id: 'journal-1',
    date: new Date(now - 1 * dayMs).toISOString().slice(0, 10),
    summary: 'Autonomous Committee held disciplined risk posture. 2 winning swing exits executed cleanly on take-profit triggers.',
    macroRegime: 'BULLISH_TREND',
    dailyPnl: 1420.50,
    tradesCount: 3,
    lessonsLearned: 'Trailing stops on high-beta tech captured 90% of intraday expansion without giving back gains.',
    createdAt: new Date(now - 1 * dayMs),
  }
];

let guardrails: any[] = [
  {
    id: 'g-1',
    rule: 'MAX_POSITION_SIZE_PCT',
    triggered: false,
    details: 'Position sizing maintained within 15% limit',
    createdAt: new Date(now - 1 * dayMs),
  }
];

let predictions: any[] = [
  {
    id: 'poly-1',
    title: 'Federal Reserve cuts Fed Funds rate by >=25bps at upcoming FOMC',
    category: 'macro',
    market: 'polymarket',
    yesPrice: 0.68,
    noPrice: 0.32,
    volume24h: 3420000,
    liquidity: 1850000,
    resolutionDate: new Date(now + 18 * dayMs).toISOString(),
    trueYesProbability: 0.82,
    edge: 0.14,
    recommendedBet: 'YES',
    expectedValue: 20.6,
    kellyFraction: 0.18,
    recommendedWager: 18.0, // On $100 bankroll
    reasoning: 'US core PCE and retail sales deceleration validate neutral rate convergence. Taylor Rule model indicates terminal 4.25%.',
    status: 'ACTIVE',
    resolvedAt: null,
    createdAt: new Date(now - 2 * dayMs),
  },
  {
    id: 'poly-2',
    title: 'US Headline CPI Year-over-Year prints strictly below 2.7%',
    category: 'macro',
    market: 'polymarket',
    yesPrice: 0.34,
    noPrice: 0.66,
    volume24h: 1890000,
    liquidity: 920000,
    resolutionDate: new Date(now + 24 * dayMs).toISOString(),
    trueYesProbability: 0.51,
    edge: 0.17,
    recommendedBet: 'YES',
    expectedValue: 50.0,
    kellyFraction: 0.15,
    recommendedWager: 15.0,
    reasoning: 'Shelter inflation lag rolling off Truflation real-time index at 2.1%. Market significantly underpricing deflationary drag.',
    status: 'ACTIVE',
    resolvedAt: null,
    createdAt: new Date(now - 3 * dayMs),
  },
  {
    id: 'poly-3',
    title: 'Solana (SOL) spot price closes >= $180.00 before month-end',
    category: 'crypto',
    market: 'polymarket',
    yesPrice: 0.45,
    noPrice: 0.55,
    volume24h: 2150000,
    liquidity: 1100000,
    resolutionDate: new Date(now + 12 * dayMs).toISOString(),
    trueYesProbability: 0.62,
    edge: 0.17,
    recommendedBet: 'YES',
    expectedValue: 37.8,
    kellyFraction: 0.12,
    recommendedWager: 12.0,
    reasoning: 'DEX volume / TVL ratio outperforming Ethereum L1 by 3.2x. Breakout above $145 daily resistance triggered momentum buy.',
    status: 'ACTIVE',
    resolvedAt: null,
    createdAt: new Date(now - 1 * dayMs),
  },
  {
    id: 'poly-4',
    title: 'NVIDIA (NVDA) reports Data Center revenue >$32.0B in Q3',
    category: 'tech',
    market: 'polymarket',
    yesPrice: 0.58,
    noPrice: 0.42,
    volume24h: 4890000,
    liquidity: 2400000,
    resolutionDate: new Date(now + 45 * dayMs).toISOString(),
    trueYesProbability: 0.76,
    edge: 0.18,
    recommendedBet: 'YES',
    expectedValue: 31.0,
    kellyFraction: 0.19,
    recommendedWager: 19.0,
    reasoning: 'Supply chain channel checks show Blackwell rack allocation fully pre-committed by hyperscalers (MSFT, AMZN, META).',
    status: 'ACTIVE',
    resolvedAt: null,
    createdAt: new Date(now - 4 * dayMs),
  },
  {
    id: 'poly-5',
    title: 'Bitcoin (BTC) reaches new All-Time High (> $73,800) in Q4',
    category: 'crypto',
    market: 'polymarket',
    yesPrice: 0.52,
    noPrice: 0.48,
    volume24h: 8940000,
    liquidity: 4100000,
    resolutionDate: new Date(now + 60 * dayMs).toISOString(),
    trueYesProbability: 0.69,
    edge: 0.17,
    recommendedBet: 'YES',
    expectedValue: 32.7,
    kellyFraction: 0.16,
    recommendedWager: 16.0,
    reasoning: 'Post-halving 150-day window historically initiates the parabolic liquidity phase. US spot ETF inflows averaging +$340M/day.',
    status: 'ACTIVE',
    resolvedAt: null,
    createdAt: new Date(now - 5 * dayMs),
  },
  {
    id: 'poly-6',
    title: 'OPEC+ announces surprise oil production increase before December',
    category: 'geopolitical',
    market: 'polymarket',
    yesPrice: 0.22,
    noPrice: 0.78,
    volume24h: 1450000,
    liquidity: 780000,
    resolutionDate: new Date(now + 30 * dayMs).toISOString(),
    trueYesProbability: 0.08,
    edge: 0.14,
    recommendedBet: 'NO',
    expectedValue: 17.9,
    kellyFraction: 0.20,
    recommendedWager: 20.0, // Bet NO at 78c
    reasoning: 'Saudi fiscal breakeven requires $85 Brent. Voluntary cuts extension confirmed in preliminary delegate communiques.',
    status: 'ACTIVE',
    resolvedAt: null,
    createdAt: new Date(now - 2 * dayMs),
  }
];

let appSettings: any = {
  id: 'settings-1',
  tradingMode: 'paper',
  maxPositionSizePct: 15,
  maxRiskPerTradePct: 2,
  dailyLossLimitPct: 3,
  stopLossStocksPct: 4,
  stopLossCryptoPct: 6,
  takeProfitPct: 10,
  minAgentConfidence: 70,
  minVotesToExecute: 8,
  cashReservePct: 20,
};

// In-Memory Prisma Mock Proxy
const inMemoryPrisma: any = {
  $connect: async () => {
    console.log('✅ In-memory database ready');
  },
  $disconnect: async () => {},

  user: {
    findUnique: async ({ where }: any) => {
      if (where.id) return users.find(u => u.id === where.id) || null;
      if (where.email) {
        let u = users.find(u => u.email.toLowerCase() === where.email.toLowerCase());
        if (!u) {
          // Auto-provision demo/owner account for any valid login attempt
          u = {
            id: `user-${Date.now()}`,
            email: where.email,
            passwordHash: DEFAULT_PASSWORD_HASH,
            totpSecret: null,
            totpEnabled: false,
            lastLogin: new Date(),
            ipWhitelist: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          users.push(u);
        }
        return u;
      }
      return null;
    },
    findFirst: async () => users[0] || null,
    create: async ({ data }: any) => {
      const u = {
        id: data.id || `user-${Date.now()}`,
        email: data.email,
        passwordHash: data.passwordHash || DEFAULT_PASSWORD_HASH,
        totpSecret: data.totpSecret || null,
        totpEnabled: data.totpEnabled ?? false,
        lastLogin: new Date(),
        ipWhitelist: data.ipWhitelist || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      users.push(u);
      return u;
    },
    update: async ({ where, data }: any) => {
      const u = users.find(u => (where.id && u.id === where.id) || (where.email && u.email === where.email));
      if (u) {
        Object.assign(u, data, { updatedAt: new Date() });
        return u;
      }
      return data;
    },
    deleteMany: async () => {
      users.length = 0;
      return { count: 0 };
    },
  },

  trade: {
    findMany: async (args?: any) => {
      let result = [...trades];
      if (args?.where?.asset) result = result.filter(t => t.asset === args.where.asset);
      if (args?.where?.status) result = result.filter(t => t.status === args.where.status);
      if (args?.where?.openedAt?.gte) {
        result = result.filter(t => new Date(t.openedAt) >= new Date(args.where.openedAt.gte));
      }
      result.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
      if (args?.skip) result = result.slice(args.skip);
      if (args?.take) result = result.slice(0, args.take);
      return result;
    },
    count: async (args?: any) => {
      let result = [...trades];
      if (args?.where?.asset) result = result.filter(t => t.asset === args.where.asset);
      if (args?.where?.status) result = result.filter(t => t.status === args.where.status);
      if (args?.where?.openedAt?.gte) {
        result = result.filter(t => new Date(t.openedAt) >= new Date(args.where.openedAt.gte));
      }
      return result.length;
    },
    findUnique: async ({ where }: any) => trades.find(t => t.id === where.id) || null,
    findFirst: async ({ where }: any) => {
      let result = [...trades];
      if (where?.asset) result = result.filter(t => t.asset === where.asset);
      if (where?.status) result = result.filter(t => t.status === where.status);
      return result[0] || null;
    },
    create: async ({ data }: any) => {
      const item = {
        id: data.id || `trade-${Date.now()}`,
        openedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      trades.unshift(item);
      return item;
    },
    update: async ({ where, data }: any) => {
      const idx = trades.findIndex(t => t.id === where.id);
      if (idx !== -1) {
        trades[idx] = { ...trades[idx], ...data, updatedAt: new Date() };
        return trades[idx];
      }
      return data;
    },
  },

  position: {
    findMany: async (args?: any) => {
      let result = [...positions];
      if (args?.where?.status) result = result.filter(p => p.status === args.where.status);
      if (args?.where?.asset) result = result.filter(p => p.asset === args.where.asset);
      return result;
    },
    findFirst: async ({ where }: any) => {
      return positions.find(p => (!where.status || p.status === where.status) && (!where.asset || p.asset === where.asset)) || null;
    },
    findUnique: async ({ where }: any) => positions.find(p => p.id === where.id) || null,
    create: async ({ data }: any) => {
      const p = { id: data.id || `pos-${Date.now()}`, openedAt: new Date(), ...data };
      positions.push(p);
      return p;
    },
    update: async ({ where, data }: any) => {
      const idx = positions.findIndex(p => p.id === where.id);
      if (idx !== -1) {
        positions[idx] = { ...positions[idx], ...data };
        return positions[idx];
      }
      return data;
    },
    delete: async ({ where }: any) => {
      const idx = positions.findIndex(p => p.id === where.id);
      if (idx !== -1) positions.splice(idx, 1);
      return { id: where.id };
    },
  },

  portfolioSnapshot: {
    findMany: async (args?: any) => {
      let result = [...snapshots];
      if (args?.where?.timestamp?.gte) {
        result = result.filter(s => new Date(s.timestamp) >= new Date(args.where.timestamp.gte));
      }
      result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      return result;
    },
    findFirst: async (args?: any) => {
      let result = [...snapshots];
      if (args?.where?.timestamp?.lt) {
        result = result.filter(s => new Date(s.timestamp) < new Date(args.where.timestamp.lt));
      }
      if (args?.where?.timestamp?.gte) {
        result = result.filter(s => new Date(s.timestamp) >= new Date(args.where.timestamp.gte));
      }
      if (args?.orderBy?.timestamp === 'desc') {
        result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      } else if (args?.orderBy?.timestamp === 'asc') {
        result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      } else if (args?.orderBy?.totalValue === 'desc') {
        result.sort((a, b) => (b.totalValue || b.portfolioValue || 0) - (a.totalValue || a.portfolioValue || 0));
      }
      const item = result[0] || snapshots[snapshots.length - 1] || null;
      if (item && !item.totalValue) {
        item.totalValue = item.portfolioValue;
      }
      return item;
    },
    create: async ({ data }: any) => {
      const snap = { id: `snap-${Date.now()}`, timestamp: new Date(), ...data };
      snapshots.push(snap);
      return snap;
    },
  },

  agentDecision: {
    findMany: async (args?: any) => {
      let result = [...agentDecisions];
      if (args?.where?.asset) result = result.filter(d => d.asset === args.where.asset);
      result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      if (args?.skip) result = result.slice(args.skip);
      if (args?.take) result = result.slice(0, args.take);
      return result;
    },
    groupBy: async () => {
      // Group by asset & signal from in-memory agentDecisions
      const map = new Map<string, any>();
      for (const d of agentDecisions) {
        const key = `${d.asset}_${d.signal}`;
        if (!map.has(key)) {
          map.set(key, {
            asset: d.asset,
            signal: d.signal,
            _count: { asset: 1 },
            _max: { timestamp: d.timestamp, avgConfidence: d.avgConfidence || 0.8 }
          });
        } else {
          const item = map.get(key)!;
          item._count.asset++;
          if (new Date(d.timestamp).getTime() > new Date(item._max.timestamp).getTime()) {
            item._max.timestamp = d.timestamp;
            item._max.avgConfidence = d.avgConfidence || item._max.avgConfidence;
          }
        }
      }
      return Array.from(map.values());
    },
    findFirst: async ({ where }: any) => {
      let result = [...agentDecisions];
      if (where?.asset) result = result.filter(d => d.asset === where.asset);
      result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return result[0] || null;
    },
    findUnique: async ({ where }: any) => agentDecisions.find(d => d.id === where.id) || null,
    create: async ({ data }: any) => {
      const dec = { id: data.id || `dec-${Date.now()}`, timestamp: new Date(), ...data };
      agentDecisions.unshift(dec);
      return dec;
    },
  },

  dailyJournal: {
    findMany: async () => [...journals],
    findFirst: async ({ where }: any) => {
      if (where?.date) return journals.find(j => j.date === where.date) || null;
      return journals[0] || null;
    },
    create: async ({ data }: any) => {
      const j = { id: `j-${Date.now()}`, createdAt: new Date(), ...data };
      journals.unshift(j);
      return j;
    },
    update: async ({ where, data }: any) => {
      const idx = journals.findIndex(j => (where.id && j.id === where.id) || (where.date && j.date === where.date));
      if (idx !== -1) {
        journals[idx] = { ...journals[idx], ...data };
        return journals[idx];
      }
      return data;
    },
  },

  prediction: {
    findMany: async (args?: any) => {
      let result = [...predictions];
      if (args?.where?.status) result = result.filter(p => p.status === args.where.status);
      if (args?.where?.category) result = result.filter(p => p.category === args.where.category);
      if (args?.where?.resolvedAt === null) result = result.filter(p => p.resolvedAt === null);
      if (args?.take) result = result.slice(0, args.take);
      return result;
    },
    findUnique: async ({ where }: any) => predictions.find(p => p.id === where.id) || null,
    create: async ({ data }: any) => {
      const p = { id: data.id || `poly-${Date.now()}`, createdAt: new Date(), ...data };
      predictions.unshift(p);
      return p;
    },
    update: async ({ where, data }: any) => {
      const idx = predictions.findIndex(p => p.id === where.id);
      if (idx !== -1) {
        predictions[idx] = { ...predictions[idx], ...data };
        return predictions[idx];
      }
      return data;
    },
  },

  guardrailLog: {
    findMany: async () => [...guardrails],
    create: async ({ data }: any) => {
      const g = { id: `g-${Date.now()}`, createdAt: new Date(), ...data };
      guardrails.push(g);
      return g;
    },
  },

  settings: {
    findFirst: async () => appSettings,
    upsert: async ({ create, update }: any) => {
      appSettings = { ...appSettings, ...update, ...create };
      return appSettings;
    },
    update: async ({ data }: any) => {
      appSettings = { ...appSettings, ...data };
      return appSettings;
    },
  },
};

// Catch-all Proxy so any other table/model returns safe no-op handlers
const noOpModel = {
  findMany: async () => [],
  findFirst: async () => null,
  findUnique: async () => null,
  count: async () => 0,
  create: async (d: any) => d?.data ?? {},
  update: async (d: any) => d?.data ?? {},
  upsert: async (d: any) => d?.create ?? {},
  delete: async () => ({}),
  deleteMany: async () => ({ count: 0 }),
};

export const prisma: any = new Proxy(inMemoryPrisma, {
  get: (target, prop) => {
    if (prop in target) {
      const val = target[prop];
      if (typeof val === 'object' && val !== null) {
        return new Proxy(val, {
          get: (modelTarget, methodProp) => {
            if (methodProp in modelTarget) {
              return modelTarget[methodProp];
            }
            if (methodProp in noOpModel) {
              return (noOpModel as any)[methodProp];
            }
            return async () => null;
          }
        });
      }
      return val;
    }
    return noOpModel;
  },
});

// Handle disconnection
process.on('exit', async () => {
  await prisma.$disconnect();
});
