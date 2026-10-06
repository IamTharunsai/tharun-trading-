// ── SYSTEM STATUS ─────────────────────────────────────────────────────────────
// One honest status endpoint for the top bar and Settings page: which services
// are actually connected and healthy right now. Replaces hardcoded
// "SCHEDULER ONLINE / SYSTEM ACTIVE / SYNCHRONIZED" labels in the UI.
import { Router, Request, Response } from 'express';
import { requireAuth, requireOwner } from '../middleware/auth';
import { appConfig } from '../utils/config';
import { getLlmHealth } from '../utils/llmRouter';
import { isPlaceholderKey } from '../utils/apiKeys';

const router = Router();
router.use(requireAuth);

const configured = (v?: string) => !isPlaceholderKey(v);

router.get('/status', async (_req: Request, res: Response) => {
  const [{ getLlmSpendToday }, { universe }, { getIntradayStatus }, { getLastBrokerSync }, { isKillSwitchActive }, pmUs] = await Promise.all([
    import('../agents/debateEngine'),
    import('../services/universeService'),
    import('../trading/intradayEngine'),
    import('../services/brokerSync'),
    import('../agents/orchestrator'),
    import('../services/polymarketUS'),
  ]);
  let alpaca = { connected: false, mode: appConfig.TRADING_MODE as string };
  try {
    const { accountManager } = await import('../services/accountManager');
    const st: any = accountManager.getLiveAccountsSummary().alpaca;
    alpaca = { connected: Boolean(st.connected), mode: st.paperMode ? 'paper' : 'live' };
  } catch { /* noop */ }
  const llm = getLlmHealth();
  const spend = getLlmSpendToday();
  const intraday = await getIntradayStatus().catch(() => null);
  const u = universe.status();

  res.json({
    scheduler: 'online',
    killSwitch: isKillSwitchActive(),
    tradingMode: appConfig.TRADING_MODE,
    polymarket: {
      mode: process.env.POLYMARKET_US_LIVE === 'true' ? 'live' : 'paper',
      usConnected: pmUs.isPolymarketUSConfigured(),
    },
    llm: {
      fast: { provider: llm.fast.provider, model: llm.fast.model, healthy: llm.fast.healthy, lastError: llm.fast.lastError },
      smart: { provider: llm.smart.provider, model: llm.smart.model, healthy: llm.smart.healthy, lastError: llm.smart.lastError },
      spendTodayUsd: Number(spend.usd.toFixed(4)),
      callsToday: (spend as any).calls ?? null,
      budgetUsd: spend.budget,
    },
    alpaca,
    brokerSync: getLastBrokerSync(),
    universe: u,
    intraday,
    dataProviders: {
      sec: { configured: true },
      nasdaq: { configured: true, healthy: u.source.includes('NASDAQ') },
      alpaca: { configured: appConfig.ALPACA.isPaperConfigured || appConfig.ALPACA.isLiveConfigured, healthy: alpaca.connected },
      finnhub: { configured: configured(process.env.FINNHUB_API_KEY) },
      polygon: { configured: configured(process.env.POLYGON_API_KEY) },
      alphaVantage: { configured: configured(process.env.ALPHA_VANTAGE_API_KEY) },
      fred: { configured: configured(process.env.FRED_API_KEY) },
      newsapi: { configured: configured(process.env.NEWSAPI_KEY) },
      polymarket: { configured: true },
      polymarketUs: { configured: pmUs.isPolymarketUSConfigured() },
      yahoo: { configured: true },
      nvidia: { configured: configured(process.env.NVIDIA_API_KEY) },
      anthropic: { configured: configured(process.env.ANTHROPIC_API_KEY) },
    },
    serverTime: new Date().toISOString(),
  });
});

// Owner-only manual triggers (useful for testing the fast lane outside the scheduler).
router.post('/intraday/scan', requireOwner, async (req: Request, res: Response) => {
  const { runIntradayScan } = await import('../trading/intradayEngine');
  res.json(await runIntradayScan({ force: req.query.force === 'true' }));
});
router.post('/broker-sync', requireOwner, async (_req: Request, res: Response) => {
  const { syncBrokerPositions } = await import('../services/brokerSync');
  res.json(await syncBrokerPositions());
});

export default router;
