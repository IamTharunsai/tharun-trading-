// ── AUTH ROUTES ───────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import { prisma } from '../utils/prisma';
import { redis } from '../utils/redis';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getPortfolioState } from '../services/portfolio';
import { activateKillSwitch, deactivateKillSwitch, isKillSwitchActive } from '../agents/orchestrator';
import backtestRoutes from './backtest';
import { chatRouter } from './chat';
import intelligenceRouter from './intelligence';
import { closePosition } from '../trading/riskManager';
import { getCurrentPrices } from '../services/marketData';

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
    const secret = speakeasy.generateSecret({ name: 'THARUN TRADING BOT', issuer: 'TharunTradingBot' });

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

tradesRouter.post('/:id/close', async (req: Request, res: Response) => {
  const trade = await prisma.trade.findUnique({ where: { id: req.params.id } });
  if (!trade || trade.status !== 'OPEN') {
    return res.status(404).json({ error: 'Open trade not found' });
  }
  const position = await prisma.position.findFirst({ where: { asset: trade.asset, status: 'OPEN' } });
  if (!position) {
    return res.status(404).json({ error: 'No open position for this trade\'s asset' });
  }
  const exitPrice = req.body.price ?? getCurrentPrices()[trade.asset] ?? trade.entryPrice;
  const result = await closePosition(position, exitPrice, 'manual_close');
  res.json({ closed: true, pnl: result.pnl, pnlPct: result.pnlPct });
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
    const { buildMarketSnapshot, getCurrentPrice } = await import('../services/marketData');
    const { executeTradeSignal } = await import('../trading/executionEngine');
    const { validateTradeSignal } = await import('../trading/riskManager');
    const { getPortfolioState } = await import('../services/portfolio');
    const axios = (await import('axios')).default;

    // Try snapshot first, fall back to direct Polygon price fetch. This runs
    // on the same production process as every other cron job hammering
    // Polygon/Alpaca (portfolio snapshots, regime detection, Polymarket
    // scans) — a single transient rate-limit blip previously failed the
    // whole request with no retry, even though the exact same lookup
    // reliably succeeds moments later. One retry with a short backoff smooths
    // that over without masking a genuinely bad symbol/real outage.
    let price: number | null = null;
    for (let attempt = 0; attempt < 2 && !price; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
      const snapshot = await buildMarketSnapshot(asset, market).catch(() => null);
      if (snapshot) {
        price = snapshot.price;
        continue;
      }
      // Direct Polygon fetch as fallback
      price = getCurrentPrice(asset);
      if (!price && process.env.POLYGON_API_KEY) {
        const today = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        const r = await axios.get(`https://api.polygon.io/v2/aggs/ticker/${asset}/range/1/day/${from}/${today}`, {
          params: { adjusted: true, sort: 'desc', limit: 1, apiKey: process.env.POLYGON_API_KEY }, timeout: 8000
        }).catch(() => null);
        price = r?.data?.results?.[0]?.c || null;
      }
    }

    if (!price) return res.status(400).json({ error: `Could not get price for ${asset}. Check Polygon API key or try a crypto symbol.` });

    const portfolio = await getPortfolioState();
    const stopLoss = direction === 'BUY' ? price * 0.98 : price * 1.02;
    const takeProfit = direction === 'BUY' ? price * 1.06 : price * 0.94;

    const signal = {
      asset, market: market as 'stocks' | 'crypto' | 'forex', direction: direction as 'BUY' | 'SELL',
      confidence: 80, entryPrice: price, stopLossPrice: stopLoss,
      takeProfitPrice: takeProfit, positionSizePct: 1,
      reasoning: `Manual test trade — forced execution`,
      agentDecisionId: ''
    };

    const risk = await validateTradeSignal(signal, portfolio);
    if (!risk.approved) return res.status(400).json({ error: `Risk check failed: ${risk.reason}` });

    const trade = await executeTradeSignal(signal, portfolio);
    res.json({ success: true, trade, message: `✅ Paper trade executed: ${direction} ${asset} @ $${price.toFixed(2)}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Execution failed' });
  }
});

// Run full debate + execute trade if approved — used for immediate test
agentsRouter.post('/run-and-trade', async (req: Request, res: Response) => {
  try {
    const { asset = 'NVDA', market = 'stocks' } = req.body;
    const { runDebateForAsset } = await import('../jobs/scheduler');
    // Respond immediately, run debate in background
    res.json({ message: `🏛️ Full debate starting for ${asset} (${market}) — check DebateRoom for live updates`, asset, market, status: 'running' });
    runDebateForAsset(asset, market as 'crypto' | 'stocks' | 'forex').catch((err: any) => {
      console.error('run-and-trade debate failed:', err?.message);
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to start debate' });
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

// ── Upcoming IPOs (Finnhub, cached 6h) ─────────────────────────────────────────
marketRouter.get('/ipo-calendar', async (_req: Request, res: Response) => {
  try {
    const { getIpoCalendar } = await import('../services/ipoService');
    res.json(await getIpoCalendar());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch IPO calendar' });
  }
});

// ── Every tradeable US stock (browse-all, not just debated) ───────────────────
// Sector/industry is only real for symbols we've actually analyzed
// (CompanyFundamentals, ~20 today, grows as more get debated) — getting real
// sector data for all ~7400 would mean one rate-limited API call per symbol
// (hours, and we'd get blocked). Returns null rather than guessing for the
// rest, so the frontend can show "—" honestly instead of fake coverage.
marketRouter.get('/all-stocks', async (_req: Request, res: Response) => {
  try {
    const { getAllStocksDetailed } = await import('../services/marketData');
    const [stocks, fundamentals] = await Promise.all([
      getAllStocksDetailed(),
      prisma.companyFundamentals.findMany({ select: { symbol: true, sector: true, industry: true } }),
    ]);
    const sectorMap = new Map(fundamentals.map(f => [f.symbol, { sector: f.sector, industry: f.industry }]));
    res.json(stocks.map(s => ({ ...s, sector: sectorMap.get(s.symbol)?.sector || null, industry: sectorMap.get(s.symbol)?.industry || null })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stock list' });
  }
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

// ── Market regime per asset (from hourly regime-detection cache) ──────────────
marketRouter.get('/regimes', async (req: Request, res: Response) => {
  try {
    const assets = ((req.query.assets as string) || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!assets.length) return res.json({});
    const { redis } = await import('../utils/redis');
    const vals = await redis.mget(assets.map(a => `regime:${a}`));
    const result: Record<string, any> = {};
    assets.forEach((a, i) => { if (vals[i]) result[a] = JSON.parse(vals[i]!); });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch regimes' });
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
    // Stop-loss/take-profit are NOT fixed percentages — they're computed per
    // trade from that asset's ATR (volatility-adaptive), take-profit set at
    // 2.5x the stop distance (LAW 3: min 2:1 risk/reward). These env vars
    // were never read anywhere else in the codebase; showing them as if they
    // were the real values was misleading.
    stopLossMethod: 'ATR-based (dynamic per trade, not a fixed %)',
    takeProfitMethod: '2.5x the ATR-based stop distance (min 2:1 risk/reward)',
    maxRiskPerTrade: process.env.MAX_RISK_PER_TRADE_PCT || '1',
    maxPositionSize: process.env.MAX_POSITION_SIZE_PCT || '10',
    dailyLossLimit: process.env.DAILY_LOSS_LIMIT_PCT || '5',
    weeklyDrawdownLimit: process.env.WEEKLY_DRAWDOWN_LIMIT_PCT || '10',
    maxDrawdown: process.env.MAX_DRAWDOWN_ALL_TIME_PCT || '20',
    cashReserve: process.env.CASH_RESERVE_PCT || '30',
    maxTradesPerDay: process.env.MAX_TRADES_PER_DAY || '50',
    minAgentConfidence: process.env.MIN_AGENT_CONFIDENCE || '65',
    minVotesToExecute: process.env.MIN_VOTES_TO_EXECUTE || '7',
    cacheStatus: redis.status === 'ready' ? 'Redis (connected)' : 'None — running without cache',
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
