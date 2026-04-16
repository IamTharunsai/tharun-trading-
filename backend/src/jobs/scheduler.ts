import cron from 'node-cron';
import Bull from 'bull';
import { logger } from '../utils/logger';
import { redis } from '../utils/redis';
import { buildMarketSnapshot, CRYPTO_ASSETS, STOCK_ASSETS, getCurrentPrices } from '../services/marketData';
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

// Bull queue for investment committee debates
const debateQueue = new Bull('investment-committee', {
  redis: { port: 6379, host: process.env.REDIS_URL?.split('://')[1]?.split(':')[0] || 'localhost' }
});

export function initScheduler() {

  // ── EVERY 90 SECONDS: Run Investment Committee Debate ─────────────────────
  cron.schedule('*/90 * * * * *', async () => {
    if (isKillSwitchActive()) return;

    const assetsToAnalyze = CRYPTO_ASSETS.slice(0, 5);
    const asset = assetsToAnalyze[Math.floor(Math.random() * assetsToAnalyze.length)];

    const lockKey = `debate:lock:${asset}`;
    const locked = await redis.get(lockKey).catch(() => null);
    if (locked) return;
    await redis.setex(lockKey, 80, '1').catch(() => {});

    debateQueue.add({ asset, market: 'crypto' }, {
      attempts: 1,
      removeOnComplete: 50,
      removeOnFail: 20
    });
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

  // ── EVERY HOUR: Market Regime Detection ──────────────────────────────────
  cron.schedule('0 * * * *', async () => {
    for (const asset of CRYPTO_ASSETS.slice(0, 5)) {
      try {
        const snapshot = await buildMarketSnapshot(asset, 'crypto');
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

      for (const trade of recentlyClosed) {
        const alreadyAnalyzed = await redis.get(`analyzed:${trade.id}`).catch(() => null);
        if (!alreadyAnalyzed) {
          await runPostTradeAnalysis(trade.id).catch(err => logger.error(`Post-trade analysis failed for ${trade.id}`, { err }));
          await redis.setex(`analyzed:${trade.id}`, 86400, '1').catch(() => {});
        }
      }
    } catch (err) { logger.error('Post-trade polling failed', { err }); }
  });

  // ── DEBATE QUEUE PROCESSOR ────────────────────────────────────────────────
  debateQueue.process(async (job) => {
    const { asset, market } = job.data;
    if (isKillSwitchActive()) return;

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

        const decision = await prisma.agentDecision.findFirst({
          where: { asset }, orderBy: { timestamp: 'desc' }
        });

        const signal: TradeSignal = {
          asset,
          market,
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
        logger.info(`📊 Committee decision: HOLD / BLOCKED`);
      }

    } catch (error) {
      logger.error('Debate queue processor failed', { error, asset });
    }
  });

  logger.info('✅ Day 4 Scheduler initialized:');
  logger.info('   ⏱️ Investment Committee debates every 90 seconds');
  logger.info('   🛑 Stop-loss monitor every 10 seconds');
  logger.info('   📸 Portfolio snapshots every 5 minutes');
  logger.info('   🌍 Market regime detection every hour');
  logger.info('   📓 Daily journal at 11:59 PM');
  logger.info('   📊 Weekly report every Sunday 8 AM');
  logger.info('   🎓 Post-trade learning every 2 minutes');
}
