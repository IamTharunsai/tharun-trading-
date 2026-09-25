import cron from 'node-cron';
import { logger } from '../utils/logger';
import { buildMarketSnapshot, CRYPTO_ASSETS, getCurrentPrices, getNextStockBatch, getTotalStockCount, refreshOpenPositionStockPrices } from '../services/marketData';
import { refreshFundamentalsForSymbol } from '../services/deepAnalysisService';
import { runDailyScreen } from '../services/stockScreener';
import { runInvestmentCommitteeDebate } from '../agents/debateEngine';
import { detectMarketRegime } from '../services/regimeDetector';
import { executeTradeSignal } from '../trading/executionEngine';
import { validateTradeSignal } from '../trading/riskManager';
import { runPostTradeAnalysis, generateWeeklyReport } from '../services/selfLearning';
import { getPortfolioState } from '../services/portfolio';
import { checkStopLosses } from '../trading/riskManager';
import { generateDailyJournal } from '../services/journalGenerator';
import { prisma } from '../utils/prisma';
import { isKillSwitchActive } from '../agents/orchestrator';
import { TradeSignal } from '../agents/types';
import { scanPolymarketOpportunities, placePolymarketBet, pollPolymarketResolutions } from '../services/polymarket';

// In-memory lock to prevent concurrent debates on same asset
const debateLocks = new Set<string>();

export async function runDebateForAsset(asset: string, market: 'crypto' | 'stocks' | 'forex' = 'crypto') {
  if (isKillSwitchActive()) return;
  const lockKey = `${asset}:${market}`;
  if (debateLocks.has(lockKey)) return;

  // Skip if open position already exists for this asset
  const openPos = await prisma.position.findFirst({ where: { asset, status: 'OPEN' } });
  if (openPos) {
    logger.info(`⏭️ Skipping debate for ${asset} — position already open (side: ${openPos.side})`);
    return;
  }

  debateLocks.add(lockKey);
  try {
    logger.info(`\n🏛️ Investment Committee convening for ${asset}...`);
    const snapshot = await buildMarketSnapshot(asset, market);
    if (!snapshot) { logger.warn(`No snapshot for ${asset}`); return; }
    const bWidth = (snapshot.indicators.bollingerBands.upper - snapshot.indicators.bollingerBands.lower) / snapshot.indicators.bollingerBands.middle;
    const regime = await detectMarketRegime(asset, {
      price: snapshot.price, priceChange24h: snapshot.priceChangePct24h,
      rsi: snapshot.indicators.rsi14, macdHistogram: snapshot.indicators.macd.histogram,
      bollingerWidth: bWidth, ema9: snapshot.indicators.ema9, ema21: snapshot.indicators.ema21,
      ema200: snapshot.indicators.ema200, volume24h: snapshot.volume24h,
      volumeAvg20: snapshot.indicators.volumeAvg20, atr14: snapshot.indicators.atr14,
    });
    const portfolio = await getPortfolioState();
    const transcript = await runInvestmentCommitteeDebate(snapshot, portfolio, regime.regime, regime);
    if (transcript.executionApproved && transcript.finalDecision !== 'HOLD') {
      const decision = await prisma.agentDecision.findFirst({ where: { asset }, orderBy: { timestamp: 'desc' } });
      const signal: TradeSignal = {
        asset, market,
        direction: transcript.finalDecision as 'BUY' | 'SELL',
        confidence: transcript.finalConfidence,
        entryPrice: snapshot.price,
        stopLossPrice: transcript.stopLossPrice,
        takeProfitPrice: transcript.takeProfitPrice,
        positionSizePct: transcript.positionSizePct,
        reasoning: transcript.masterSynthesis.slice(0, 500),
        agentDecisionId: decision?.id || ''
      };
      const riskCheck = await validateTradeSignal(signal, portfolio);
      if (riskCheck.approved) {
        const executed = await executeTradeSignal(signal, portfolio);
        transcript.tradeExecuted = executed;
        if (executed) {
          logger.info(`✅ Trade executed: ${transcript.finalDecision} ${asset} @ $${snapshot.price}`);
        } else {
          logger.warn(`🚫 Trade approved by risk check but execution failed/blocked for ${asset} (see execution logs above — Top Trader Rules, viability, or broker rejection)`);
        }
      } else {
        logger.info(`🚫 Trade blocked by Risk Validator: ${riskCheck.reason}`);
      }
    } else {
      logger.info(`📊 Committee decision: ${transcript.finalDecision} (not executed)`);
    }
    return transcript;
  } catch (error) {
    logger.error('Debate failed', { error: (error as Error)?.message || error, stack: (error as Error)?.stack, asset });
    throw error;
  } finally {
    setTimeout(() => debateLocks.delete(lockKey), 80000);
  }
}

// Fallback only — used if the live market screen fails (e.g. Polygon outage)
const FALLBACK_STOCKS = ['NVDA', 'AAPL', 'TSLA', 'AMZN', 'META'];

// Screens the whole market (small + large cap) and returns symbols the current
// account can actually afford to size a position in — not just a fixed list.
async function pickDynamicSymbols(count: number, skip = 0): Promise<string[]> {
  const [screened, portfolio] = await Promise.all([
    runDailyScreen().catch(() => []),
    getPortfolioState().catch(() => null),
  ]);
  if (screened.length === 0) return skip === 0 ? FALLBACK_STOCKS.slice(0, count) : [];

  const cash = portfolio?.cashBalance ?? 0;
  // ponytail: fractional-share orders make exact share count irrelevant, this just
  // excludes impractically-priced picks (e.g. $200k/share) for a small account
  const maxPrice = Math.max(cash, 20) * 25;
  const affordable = screened.filter(s => s.price <= maxPrice);

  return affordable.slice(skip, skip + count).map(s => s.symbol);
}

export function initScheduler() {

  // ── MARKET OPEN 9:35 AM ET — weekdays (Mon–Fri) ─────────────────────────
  // node-cron's timezone option resolves ET vs UTC (incl. DST) itself —
  // previously this used two hardcoded UTC crons (13:35 + 14:35) that both
  // fired every single day year-round, double-running (and double-billing)
  // the market-open scan regardless of season.
  // First 10 of the 30 tracked coins (list is roughly market-cap ordered, not
  // measured) — was hardcoded to just BTC/ETH/SOL before. ponytail: not a real
  // liquidity ranking, upgrade to a scored crypto screen if that matters later.
  const CRYPTO_SCAN_LIST = CRYPTO_ASSETS.slice(0, 10);
  const ET_ZONE = 'America/New_York';
  // Cap on debates per scan window — keeps API cost bounded while still giving
  // the screen room to move past the first batch when everything HOLDs.
  const MAX_STOCKS_PER_SCAN = 20;

  // Keeps moving to the next symbol in the screened list — instead of stopping after
  // a fixed 5 — until something actually trades or the per-window cap is hit.
  // Fetches the screened+affordability-filtered pool once and slices it locally
  // instead of re-screening the whole market on every batch (was hitting Polygon
  // repeatedly for the same data within one scan window). Returns how many
  // symbols it actually debated, so a caller with a follow-up window (mid-day)
  // can start past exactly what was covered instead of assuming the cap was hit.
  const scanStocksUntilTrade = async (label: string, startSkip: number): Promise<number> => {
    if (isKillSwitchActive()) return 0;
    const pool = await pickDynamicSymbols(startSkip + MAX_STOCKS_PER_SCAN, 0);
    const symbols = pool.slice(startSkip, startSkip + MAX_STOCKS_PER_SCAN);
    logger.info(`${label} — screened top ${symbols.length} opportunities: ${symbols.join(', ')}`);
    let tried = 0;
    for (const symbol of symbols) {
      if (isKillSwitchActive()) return tried;
      const transcript = await runDebateForAsset(symbol, 'stocks').catch(err => {
        logger.error(`${label} debate failed`, { err, symbol });
        return null;
      });
      tried++;
      await new Promise(r => setTimeout(r, 5000));
      if (transcript?.tradeExecuted) {
        logger.info(`${label} — trade found on ${symbol}, stopping scan`);
        return tried;
      }
    }
    return tried;
  };
  // Tracks how many symbols the market-open scan actually consumed, so the
  // mid-day scan resumes right after — not at a fixed offset that either
  // overlaps (wasted re-debates) or skips symbols entirely (an early market-open
  // exit on a fast trade left #4-20 forever unevaluated under the old fixed skip).
  let marketOpenTriedCount = MAX_STOCKS_PER_SCAN;
  cron.schedule('35 9 * * 1-5', async () => {
    marketOpenTriedCount = await scanStocksUntilTrade('🔔 MARKET OPEN', 0);
  }, { timezone: ET_ZONE });

  // ── MID-DAY 1:00 PM ET — continue past where the market-open scan left off ──
  cron.schedule('0 13 * * 1-5', () => scanStocksUntilTrade('☀️ MID-DAY SCAN', marketOpenTriedCount), { timezone: ET_ZONE });

  // ── CRYPTO: once per day at 8 AM ET — stop early once one trades ─────────
  cron.schedule('0 8 * * *', async () => {
    if (isKillSwitchActive()) return;
    logger.info('🪙 DAILY CRYPTO SCAN...');
    for (const coin of CRYPTO_SCAN_LIST) {
      const transcript = await runDebateForAsset(coin, 'crypto').catch(() => null);
      await new Promise(r => setTimeout(r, 5000));
      if (transcript?.tradeExecuted) {
        logger.info(`🪙 Trade found on ${coin}, stopping crypto scan`);
        break;
      }
    }
  }, { timezone: ET_ZONE });

  // ── EVERY 60 SECONDS: Refresh live prices for open stock positions ───────
  // Stock prices were only ever set once at boot (previous day's close) —
  // crypto gets continuous Binance WebSocket updates, stocks got nothing
  // after startup, so the stop-loss monitor below was comparing against a
  // frozen snapshot instead of real prices. Only refreshes symbols with an
  // actual open stock position, not the whole tracked universe.
  cron.schedule('*/60 * * * * *', async () => {
    try {
      const openStockPositions = await prisma.position.findMany({ where: { status: 'OPEN', market: 'stocks' }, select: { asset: true } });
      await refreshOpenPositionStockPrices(openStockPositions.map(p => p.asset));
    } catch (err) { logger.error('Open-position price refresh failed', { err }); }
  });

  // ── EVERY 10 SECONDS: Stop Loss Monitor ──────────────────────────────────
  cron.schedule('*/10 * * * * *', async () => {
    const prices = getCurrentPrices();
    await checkStopLosses(prices).catch(err => logger.error('Stop loss check failed', { err }));
  });

  // ── EVERY 5 MINUTES: Portfolio Snapshot ──────────────────────────────────
  cron.schedule('*/5 * * * *', async () => {
    try {
      const portfolio = await getPortfolioState();
      await prisma.portfolioSnapshot.create({
        data: {
          totalValue: portfolio.totalValue,
          cashBalance: portfolio.cashBalance,
          invested: portfolio.invested,
          pnlDay: portfolio.pnlDay,
          pnlDayPct: portfolio.pnlDayPct,
          pnlTotal: portfolio.pnlTotal,
          pnlTotalPct: (portfolio.pnlTotal / Math.max(portfolio.totalValue, 1)) * 100
        }
      });
    } catch (err) { logger.error('Portfolio snapshot failed', { err }); }
  });

  // ── EVERY HOUR: Market Regime Detection (crypto + next stock batch) ─────
  cron.schedule('0 * * * *', async () => {
    // Held positions always get a fresh regime read regardless of where they
    // land in the rotation — same reasoning as refreshOpenPositionStockPrices:
    // Investment Plan showed "No cached regime read yet" for NVDA/AMZN
    // indefinitely, since the blind rotation could take weeks to reach them
    // out of the full ~7000-stock universe.
    const openPositions = await prisma.position.findMany({ where: { status: 'OPEN' }, select: { asset: true, market: true } });
    const heldAssets = openPositions.map(p => ({ asset: p.asset, market: p.market as 'crypto' | 'stocks' }));
    const heldSymbols = new Set(heldAssets.map(a => a.asset));

    const cryptoAssets = CRYPTO_ASSETS.slice(0, 3).map(a => ({ asset: a, market: 'crypto' as const })).filter(a => !heldSymbols.has(a.asset));
    const stockAssets = getNextStockBatch(2).map(a => ({ asset: a, market: 'stocks' as const })).filter(a => !heldSymbols.has(a.asset));
    const regimeAssets = [...heldAssets, ...cryptoAssets, ...stockAssets];
    for (const { asset, market } of regimeAssets) {
      try {
        const snapshot = await buildMarketSnapshot(asset, market);
        if (!snapshot) continue;
        const bWidth = (snapshot.indicators.bollingerBands.upper - snapshot.indicators.bollingerBands.lower) / snapshot.indicators.bollingerBands.middle;
        await detectMarketRegime(asset, {
          price: snapshot.price,
          priceChange24h: snapshot.priceChangePct24h,
          rsi: snapshot.indicators.rsi14,
          macdHistogram: snapshot.indicators.macd.histogram,
          bollingerWidth: bWidth,
          ema9: snapshot.indicators.ema9,
          ema21: snapshot.indicators.ema21,
          ema200: snapshot.indicators.ema200,
          volume24h: snapshot.volume24h,
          volumeAvg20: snapshot.indicators.volumeAvg20,
          atr14: snapshot.indicators.atr14,
        });
      } catch (err) { logger.error(`Regime detection failed for ${asset}`, { err }); }
    }
  });

  // ── DAILY 11:59 PM: Generate Journal ─────────────────────────────────────
  cron.schedule('59 23 * * *', async () => {
    logger.info('📓 Generating daily journal...');
    await generateDailyJournal().catch(err => logger.error('Journal generation failed', { err }));
  });

  // ── EVERY SUNDAY 8 AM: Weekly Performance Report ─────────────────────────
  cron.schedule('0 8 * * 0', async () => {
    logger.info('📊 Generating weekly performance report...');
    await generateWeeklyReport().catch(err => logger.error('Weekly report failed', { err }));
  });

  // ── EVERY NIGHT 2 AM: Bulk refresh fundamentals for next day's debates ───
  cron.schedule('0 2 * * *', async () => {
    logger.info('🔄 Nightly fundamentals refresh — pre-loading deep analysis...');
    const batch = getNextStockBatch(50); // refresh 50 stocks every night
    for (const symbol of batch) {
      await refreshFundamentalsForSymbol(symbol).catch(() => {});
      await new Promise(r => setTimeout(r, 2000)); // 2s gap to respect API rate limits
    }
    logger.info(`✅ Nightly refresh done: ${batch.length} stocks updated`);
  });

  // ── EVERY 30 MINUTES: Polymarket Opportunity Scan ────────────────────────
  // placePolymarketBet had no dedup/position-limit check at all — every scan
  // blindly opened new bets regardless of what was already open, so the same
  // top-ranked market (whose recommendation doesn't change much scan to scan)
  // kept getting re-bet every 30 minutes indefinitely, unlike the stock/crypto
  // path which already checks for an existing open position per asset before
  // debating. Capped concurrent Polymarket positions at 3 (matching the
  // existing "top 3 opportunities" sizing) and skip placing more once at cap.
  const MAX_OPEN_POLYMARKET_POSITIONS = 3;
  cron.schedule('*/30 * * * *', async () => {
    if (isKillSwitchActive()) return;
    try {
      const openCount = await prisma.trade.count({ where: { asset: 'POLYMARKET', status: 'OPEN' } });
      const slotsAvailable = MAX_OPEN_POLYMARKET_POSITIONS - openCount;
      if (slotsAvailable <= 0) {
        logger.info(`🎯 Polymarket at max open positions (${openCount}/${MAX_OPEN_POLYMARKET_POSITIONS}) — skipping scan`);
        return;
      }
      const portfolio = await getPortfolioState();
      const opportunities = await scanPolymarketOpportunities(portfolio.totalValue);
      for (const opp of opportunities.slice(0, slotsAvailable)) {
        await placePolymarketBet(opp, opp.conditionId, true); // paper mode
      }
    } catch (err: any) { logger.warn(`Polymarket scan skipped: ${err?.message || err?.code || 'network error'}`); }
  });

  // ── EVERY 30 MINUTES: Polymarket Resolution Check ────────────────────────
  cron.schedule('*/30 * * * *', async () => {
    await pollPolymarketResolutions().catch(err => logger.error('Polymarket resolution poll failed', { err }));
  });

  // ── POST-TRADE LEARNING: Watch for newly closed trades ───────────────────
  cron.schedule('*/2 * * * *', async () => {
    try {
      const recentlyClosed = await prisma.trade.findMany({
        where: {
          status: 'CLOSED',
          closedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }
        },
        select: { id: true }
      });

      const analyzed = new Set<string>();
      for (const trade of recentlyClosed) {
        if (!analyzed.has(trade.id)) {
          analyzed.add(trade.id);
          await runPostTradeAnalysis(trade.id).catch(err => logger.error(`Post-trade analysis failed for ${trade.id}`, { err }));
        }
      }
    } catch (err) { logger.error('Post-trade polling failed', { err }); }
  });

  logger.info('✅ Tharun Trading Scheduler initialized:');
  logger.info('   ⏱️ Investment Committee: dynamic market screen at 9:35 AM & 1 PM ET');
  logger.info('   🛑 Stop-loss monitor every 10 seconds');
  logger.info('   📸 Portfolio snapshots every 5 minutes');
  logger.info('   🌍 Market regime detection every hour');
  logger.info('   🎯 Polymarket opportunity scan every 30 minutes');
  logger.info('   📓 Daily journal at 11:59 PM');
  logger.info('   📊 Weekly report every Sunday 8 AM');
  logger.info('   🎓 Post-trade learning every 2 minutes');
}
