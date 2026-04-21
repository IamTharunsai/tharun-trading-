import cron from 'node-cron';
import { logger } from '../utils/logger';
import { buildMarketSnapshot, CRYPTO_ASSETS, getCurrentPrices, getNextStockBatch, getTotalStockCount } from '../services/marketData';
import { refreshFundamentalsForSymbol } from '../services/deepAnalysisService';
import { getScreenedSymbols } from '../services/stockScreener';
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
import { scanPolymarketOpportunities, placePolymarketBet } from '../services/polymarket';

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
    const transcript = await runInvestmentCommitteeDebate(snapshot, portfolio, regime.regime);
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
        await executeTradeSignal(signal, portfolio);
        logger.info(`✅ Trade executed: ${transcript.finalDecision} ${asset} @ $${snapshot.price}`);
      } else {
        logger.info(`🚫 Trade blocked by Risk Validator: ${riskCheck.reason}`);
      }
    } else {
      logger.info(`📊 Committee decision: ${transcript.finalDecision} (not executed)`);
    }
    return transcript;
  } catch (error) {
    logger.error('Debate failed', { error, asset });
    throw error;
  } finally {
    setTimeout(() => debateLocks.delete(lockKey), 80000);
  }
}

export function initScheduler() {

  // High-quality stocks always included in every scan cycle
  const PRIORITY_WATCHLIST = [
    'NVDA','AAPL','MSFT','TSLA','AMZN','META','GOOGL','AMD','PLTR','MSTR',
    'COIN','SOFI','ARM','SMCI','CRWD','PANW','SNOW','UBER','LYFT','RIVN',
    'SPY','QQQ','AAPL','NOW','SHOP','SQ','ROKU','DKNG','RBLX','HOOD'
  ];

  // ── EVERY 2 HOURS: Rotate through ALL stocks + crypto ────────────────────
  cron.schedule('0 */2 * * *', async () => {
    if (isKillSwitchActive()) return;

    // Screened = today's momentum stocks. Always add priority watchlist too.
    let screened: string[] = [];
    try { screened = await getScreenedSymbols(); } catch { /* fallback below */ }

    // Merge priority + screened, deduplicate, take top 30
    const merged = [...PRIORITY_WATCHLIST, ...screened.filter(s => !PRIORITY_WATCHLIST.includes(s))];
    const stockBatch = merged.slice(0, 30);
    logger.info(`📊 Scanning ${stockBatch.length} stocks (priority+screened, ${getTotalStockCount()} total)`);
    for (const symbol of stockBatch) {
      await runDebateForAsset(symbol, 'stocks').catch(err => logger.error('Stock debate failed', { err, symbol }));
      await new Promise(r => setTimeout(r, 5000)); // 5s cooldown between debates
    }

    // Also scan 5 random crypto assets
    const cryptoBatch = [...CRYPTO_ASSETS].sort(() => Math.random() - 0.5).slice(0, 5);
    for (const coin of cryptoBatch) {
      await runDebateForAsset(coin, 'crypto').catch(err => logger.error('Crypto debate failed', { err, coin }));
      await new Promise(r => setTimeout(r, 5000));
    }
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
    const cryptoAssets = CRYPTO_ASSETS.slice(0, 3).map(a => ({ asset: a, market: 'crypto' as const }));
    const stockAssets = getNextStockBatch(2).map(a => ({ asset: a, market: 'stocks' as const }));
    const regimeAssets = [...cryptoAssets, ...stockAssets];
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
  cron.schedule('*/30 * * * *', async () => {
    if (isKillSwitchActive()) return;
    try {
      const portfolio = await getPortfolioState();
      const opportunities = await scanPolymarketOpportunities(portfolio.totalValue);
      for (const opp of opportunities.slice(0, 3)) {
        await placePolymarketBet(opp, opp.question, true); // paper mode
      }
    } catch (err: any) { logger.warn(`Polymarket scan skipped: ${err?.message || err?.code || 'network error'}`); }
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
  logger.info('   ⏱️ Investment Committee debates every 2 hours');
  logger.info('   🛑 Stop-loss monitor every 10 seconds');
  logger.info('   📸 Portfolio snapshots every 5 minutes');
  logger.info('   🌍 Market regime detection every hour');
  logger.info('   🎯 Polymarket opportunity scan every 30 minutes');
  logger.info('   📓 Daily journal at 11:59 PM');
  logger.info('   📊 Weekly report every Sunday 8 AM');
  logger.info('   🎓 Post-trade learning every 2 minutes');
}
