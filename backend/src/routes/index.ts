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
