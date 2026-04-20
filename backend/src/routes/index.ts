// ── AUTH ROUTES ───────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import { prisma } from '../utils/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getPortfolioState } from '../services/portfolio';
import { activateKillSwitch, deactivateKillSwitch, isKillSwitchActive } from '../agents/orchestrator';
import backtestRoutes from './backtest';
import { chatRouter } from './chat';
import intelligenceRouter from './intelligence';

// ── /api/auth ─────────────────────────────────────────────────────────────────
export const authRouter = Router();

authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, totpCode } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.totpEnabled && user.totpSecret) {
      if (!totpCode) return res.status(401).json({ error: 'TOTP code required', requireTotp: true });
      const verified = speakeasy.totp.verify({ secret: user.totpSecret, encoding: 'base32', token: totpCode, window: 1 });
      if (!verified) return res.status(401).json({ error: 'Invalid TOTP code' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '8h' });
    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    res.json({ token, user: { id: user.id, email: user.email, totpEnabled: user.totpEnabled } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

authRouter.post('/setup', async (req: Request, res: Response) => {
  // One-time setup endpoint — creates the owner account
  try {
    const { email, password, setupKey } = req.body;
    if (setupKey !== process.env.ENCRYPTION_KEY) return res.status(403).json({ error: 'Invalid setup key' });

    const existing = await prisma.user.findFirst();
    if (existing) return res.status(400).json({ error: 'Owner account already exists' });

    const passwordHash = await bcrypt.hash(password, 12);
    const secret = speakeasy.generateSecret({ name: 'APEX TRADER', issuer: 'ApexTrader' });

    const user = await prisma.user.create({ data: { email, passwordHash, totpSecret: secret.base32 } });
    res.json({ message: 'Account created', totpSecret: secret.base32, totpQR: secret.otpauth_url, userId: user.id });
  } catch (err) {
    res.status(500).json({ error: 'Setup failed' });
  }
});

authRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, email: true, totpEnabled: true, lastLogin: true } });
  res.json(user);
});

// ── /api/trades ───────────────────────────────────────────────────────────────
export const tradesRouter = Router();
tradesRouter.use(requireAuth);

tradesRouter.get('/', async (req: Request, res: Response) => {
  const { page = '1', limit = '50', asset, status } = req.query;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
  const where: any = {};
  if (asset) where.asset = asset;
  if (status) where.status = status;

  const [trades, total] = await Promise.all([
    prisma.trade.findMany({ where, skip, take: parseInt(limit as string), orderBy: { openedAt: 'desc' }, include: { agentDecision: true } }),
    prisma.trade.count({ where })
  ]);
  res.json({ trades, total, page: parseInt(page as string), pages: Math.ceil(total / parseInt(limit as string)) });
});

tradesRouter.get('/stats', async (_req: Request, res: Response) => {
  const all = await prisma.trade.findMany({ where: { status: 'CLOSED' } });
  const winners = all.filter(t => (t.pnl || 0) > 0);
  const losers = all.filter(t => (t.pnl || 0) < 0);
  const totalPnl = all.reduce((s, t) => s + (t.pnl || 0), 0);
  const avgWin = winners.length ? winners.reduce((s, t) => s + (t.pnl || 0), 0) / winners.length : 0;
  const avgLoss = losers.length ? losers.reduce((s, t) => s + (t.pnl || 0), 0) / losers.length : 0;

  res.json({
    totalTrades: all.length,
    winRate: all.length ? (winners.length / all.length * 100).toFixed(1) : 0,
    totalPnl: totalPnl.toFixed(2),
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    bestTrade: all.sort((a, b) => (b.pnl || 0) - (a.pnl || 0))[0],
    worstTrade: all.sort((a, b) => (a.pnl || 0) - (b.pnl || 0))[0],
    profitFactor: Math.abs(avgLoss) > 0 ? (avgWin / Math.abs(avgLoss)).toFixed(2) : '∞'
  });
});

// ── /api/portfolio ────────────────────────────────────────────────────────────
export const portfolioRouter = Router();
portfolioRouter.use(requireAuth);

portfolioRouter.get('/', async (_req: Request, res: Response) => {
  const state = await getPortfolioState();
  res.json(state);
});

portfolioRouter.get('/snapshots', async (req: Request, res: Response) => {
  const { days = '30' } = req.query;
  const since = new Date(Date.now() - parseInt(days as string) * 86400000);
  const snapshots = await prisma.portfolioSnapshot.findMany({ where: { timestamp: { gte: since } }, orderBy: { timestamp: 'asc' } });
  res.json(snapshots);
});

portfolioRouter.get('/positions', async (_req: Request, res: Response) => {
  const positions = await prisma.position.findMany({ where: { status: 'OPEN' } });
  res.json(positions);
});

// ── /api/agents ───────────────────────────────────────────────────────────────
export const agentsRouter = Router();
agentsRouter.use(requireAuth);

agentsRouter.post('/trigger-debate', async (req: Request, res: Response) => {
  try {
    const { asset = 'BTC', market = 'crypto' } = req.body;
    const { runDebateForAsset } = await import('../jobs/scheduler');
    res.json({ message: `Debate triggered for ${asset}`, asset, status: 'running' });
    runDebateForAsset(asset, market as 'crypto' | 'stocks' | 'forex').catch(() => {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger debate' });
  }
});

// Force a paper trade immediately — bypasses debate, tests execution pipeline
agentsRouter.post('/force-trade', async (req: Request, res: Response) => {
  try {
    const { asset = 'AAPL', market = 'stocks', direction = 'BUY' } = req.body;
    const { buildMarketSnapshot } = await import('../services/marketData');
    const { executeTradeSignal } = await import('../trading/executionEngine');
    const { validateTradeSignal } = await import('../trading/riskManager');
    const { getPortfolioState } = await import('../services/portfolio');

    const snapshot = await buildMarketSnapshot(asset, market);
    if (!snapshot) return res.status(400).json({ error: `No price data for ${asset}` });

    const portfolio = await getPortfolioState();
    const stopLoss = direction === 'BUY' ? snapshot.price * 0.98 : snapshot.price * 1.02;
    const takeProfit = direction === 'BUY' ? snapshot.price * 1.06 : snapshot.price * 0.94;

    const signal = {
      asset, market: market as 'stocks' | 'crypto' | 'forex', direction: direction as 'BUY' | 'SELL',
      confidence: 80, entryPrice: snapshot.price, stopLossPrice: stopLoss,
      takeProfitPrice: takeProfit, positionSizePct: 5,
      reasoning: `Manual test trade — forced execution to verify pipeline`,
      agentDecisionId: ''
    };

    const risk = await validateTradeSignal(signal, portfolio);
    if (!risk.approved) return res.status(400).json({ error: `Risk check failed: ${risk.reason}` });

    const trade = await executeTradeSignal(signal, portfolio);
    res.json({ success: true, trade, message: `✅ Paper trade executed: ${direction} ${asset} @ $${snapshot.price}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Execution failed' });
  }
});

agentsRouter.get('/decisions', async (req: Request, res: Response) => {
  const { page = '1', limit = '20' } = req.query;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
  const decisions = await prisma.agentDecision.findMany({ skip, take: parseInt(limit as string), orderBy: { timestamp: 'desc' } });
  res.json(decisions);
});

agentsRouter.get('/decisions/:id', async (req: Request, res: Response) => {
  const decision = await prisma.agentDecision.findUnique({ where: { id: req.params.id } });
  if (!decision) return res.status(404).json({ error: 'Not found' });
  res.json(decision);
});

// ── /api/market ───────────────────────────────────────────────────────────────
export const marketRouter = Router();
marketRouter.use(requireAuth);

marketRouter.get('/prices', async (_req: Request, res: Response) => {
  const { getCurrentPrices } = await import('../services/marketData');
  res.json(getCurrentPrices());
});

marketRouter.get('/news', async (req: Request, res: Response) => {
  const { limit = '20' } = req.query;
  const news = await prisma.newsItem.findMany({ take: parseInt(limit as string), orderBy: { publishedAt: 'desc' } });
  res.json(news);
});

marketRouter.get('/predictions', async (req: Request, res: Response) => {
  const predictions = await prisma.prediction.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' } });
  res.json(predictions);
});

// ── Stock Universe — every asset agents have analyzed ─────────────────────────
marketRouter.get('/stocks-universe', async (_req: Request, res: Response) => {
  try {
    const [decisions, allFundamentals, allTrades, openPositions, memories] = await Promise.all([
      prisma.agentDecision.groupBy({
        by: ['asset', 'signal'],
        _count: { asset: true },
        _max: { timestamp: true, avgConfidence: true },
        orderBy: { _max: { timestamp: 'desc' } }
      }),
      prisma.companyFundamentals.findMany(),
      prisma.trade.findMany({ where: { status: 'CLOSED' }, select: { asset: true, pnl: true, pnlPct: true, type: true } }),
      prisma.position.findMany({ where: { status: 'OPEN' } }),
      prisma.stockMemory.findMany(),
    ]);

    const fundMap = Object.fromEntries(allFundamentals.map(f => [f.symbol, f]));
    const posMap = Object.fromEntries(openPositions.map(p => [p.asset, p]));
    const memMap = Object.fromEntries(memories.map(m => [m.symbol, m]));

    // Aggregate trade stats per asset
    const tradeStats: Record<string, { count: number; pnl: number; wins: number; losses: number }> = {};
    for (const t of allTrades) {
      if (!tradeStats[t.asset]) tradeStats[t.asset] = { count: 0, pnl: 0, wins: 0, losses: 0 };
      tradeStats[t.asset].count++;
      tradeStats[t.asset].pnl += t.pnl || 0;
      if ((t.pnl || 0) > 0) tradeStats[t.asset].wins++;
      else tradeStats[t.asset].losses++;
    }

    // Collapse per-asset (group by asset, keep latest signal)
    const assetMap = new Map<string, any>();
    for (const d of decisions) {
      if (!assetMap.has(d.asset)) {
        assetMap.set(d.asset, { asset: d.asset, signal: d.signal, count: d._count.asset, lastAt: d._max.timestamp, confidence: d._max.avgConfidence });
      } else {
        const ex = assetMap.get(d.asset)!;
        ex.count += d._count.asset;
        if ((d._max.timestamp || 0) > (ex.lastAt || 0)) { ex.lastAt = d._max.timestamp; ex.signal = d.signal; }
      }
    }

    const result = Array.from(assetMap.values()).map(d => {
      const fund = fundMap[d.asset];
      const ts = tradeStats[d.asset];
      const pos = posMap[d.asset];
      const mem = memMap[d.asset];
      return {
        symbol: d.asset,
        name: fund?.name || d.asset,
        sector: fund?.sector || null,
        industry: fund?.industry || null,
        marketCap: fund?.marketCap || null,
        peRatio: fund?.peRatio || null,
        analystRating: fund?.analystRating || null,
        analystTargetPrice: fund?.analystTargetPrice || null,
        fundamentalScore: null,
        lastVote: d.signal,
        lastConfidence: d.confidence,
        debateCount: d.count,
        lastDebateAt: d.lastAt,
        tradeCount: ts?.count || 0,
        totalPnl: ts ? parseFloat(ts.pnl.toFixed(2)) : 0,
        winRate: ts && ts.count > 0 ? parseFloat(((ts.wins / ts.count) * 100).toFixed(1)) : null,
        hasOpenPosition: !!pos,
        openPositionPnl: pos ? parseFloat(pos.unrealizedPnl.toFixed(2)) : null,
        openPositionPct: pos ? parseFloat(pos.unrealizedPnlPct.toFixed(2)) : null,
        currentPrice: pos?.currentPrice || null,
        entryPrice: pos?.entryPrice || null,
        memoryWinRate: mem?.winRate || null,
        memoryTrades: mem?.totalTrades || 0,
        bestSetup: mem?.bestSetup || null,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stock universe' });
  }
});

// ── Single stock detail — trades + decisions + candles ────────────────────────
marketRouter.get('/stock/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const market = (req.query.market as string) || 'stocks';
    const [fund, trades, decisions, memory, position] = await Promise.all([
      prisma.companyFundamentals.findUnique({ where: { symbol } }),
      prisma.trade.findMany({ where: { asset: symbol }, orderBy: { openedAt: 'desc' }, take: 30 }),
      prisma.agentDecision.findMany({ where: { asset: symbol }, orderBy: { timestamp: 'desc' }, take: 5 }),
      prisma.stockMemory.findUnique({ where: { symbol } }),
      prisma.position.findFirst({ where: { asset: symbol, status: 'OPEN' } }),
    ]);
    res.json({ symbol, market, fundamentals: fund, trades, decisions, memory, position });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stock detail' });
  }
});

// ── Candles for a stock (from Polygon or Binance) ─────────────────────────────
marketRouter.get('/stock/:symbol/candles', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const market = (req.query.market as string || 'stocks') as 'crypto' | 'stocks' | 'forex';
    const { buildMarketSnapshot } = await import('../services/marketData');
    const snapshot = await buildMarketSnapshot(symbol, market);
    if (!snapshot) return res.json({ candles: [], indicators: null });
    res.json({ candles: snapshot.candles, indicators: snapshot.indicators, price: snapshot.price });
  } catch {
    res.json({ candles: [], indicators: null });
  }
});

// ── /api/journal ──────────────────────────────────────────────────────────────
export const journalRouter = Router();
journalRouter.use(requireAuth);

journalRouter.get('/', async (req: Request, res: Response) => {
  const { limit = '30' } = req.query;
  const journals = await prisma.dailyJournal.findMany({ take: parseInt(limit as string), orderBy: { date: 'desc' } });
  res.json(journals);
});

journalRouter.get('/:date', async (req: Request, res: Response) => {
  const journal = await prisma.dailyJournal.findUnique({ where: { date: req.params.date } });
  if (!journal) return res.status(404).json({ error: 'Journal not found' });
  res.json(journal);
});

journalRouter.post('/generate', requireAuth, async (_req: Request, res: Response) => {
  const { generateDailyJournal } = await import('../services/journalGenerator');
  await generateDailyJournal();
  res.json({ message: 'Journal generated' });
});

// ── /api/settings ─────────────────────────────────────────────────────────────
export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get('/', async (_req: Request, res: Response) => {
  res.json({
    tradingMode: process.env.TRADING_MODE || 'paper',
    stopLossCrypto: process.env.STOP_LOSS_CRYPTO_PCT || '3',
    stopLossStocks: process.env.STOP_LOSS_STOCKS_PCT || '2',
    takeProfitPct: process.env.TAKE_PROFIT_PCT || '6',
    maxRiskPerTrade: process.env.MAX_RISK_PER_TRADE_PCT || '1',
    maxPositionSize: process.env.MAX_POSITION_SIZE_PCT || '10',
    dailyLossLimit: process.env.DAILY_LOSS_LIMIT_PCT || '5',
    weeklyDrawdownLimit: process.env.WEEKLY_DRAWDOWN_LIMIT_PCT || '10',
    maxDrawdown: process.env.MAX_DRAWDOWN_ALL_TIME_PCT || '20',
    cashReserve: process.env.CASH_RESERVE_PCT || '30',
    maxTradesPerDay: process.env.MAX_TRADES_PER_DAY || '50',
    minAgentConfidence: process.env.MIN_AGENT_CONFIDENCE || '65',
    minVotesToExecute: process.env.MIN_VOTES_TO_EXECUTE || '7',
  });
});

// ── /api/kill-switch ──────────────────────────────────────────────────────────
export const killSwitchRouter = Router();
killSwitchRouter.use(requireAuth);

killSwitchRouter.post('/activate', async (_req: Request, res: Response) => {
  activateKillSwitch();
  // Cancel all open positions if in live mode
  if (process.env.TRADING_MODE === 'live') {
    // Close all open positions at market price
    await prisma.position.updateMany({ where: { status: 'OPEN' }, data: { status: 'CLOSED' } });
  }
  res.json({ active: true, timestamp: new Date().toISOString() });
});

killSwitchRouter.post('/deactivate', async (_req: Request, res: Response) => {
  deactivateKillSwitch();
  res.json({ active: false, timestamp: new Date().toISOString() });
});

killSwitchRouter.get('/status', async (_req: Request, res: Response) => {
  res.json({ active: isKillSwitchActive() });
});

// ── BACKTEST ROUTES (already defined in backtest.ts) ────────────────────────
export { default as backtestRouter } from './backtest';
export { chatRouter };
export { default as agentMonitorRouter } from './agentMonitor';
export { default as intelligenceRouter } from './intelligence';
