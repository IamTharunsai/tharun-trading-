import cron from 'node-cron';
import { logger } from '../utils/logger';
import { buildMarketSnapshot, CRYPTO_ASSETS, getCurrentPrices } from '../services/marketData';
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

  // ── EVERY 2 HOURS: Run Investment Committee Debate (paper mode — save credits) ─
  cron.schedule('0 */2 * * *', async () => {
    if (isKillSwitchActive()) return;
    const assetsToAnalyze = CRYPTO_ASSETS.slice(0, 5);
    const asset = assetsToAnalyze[Math.floor(Math.random() * assetsToAnalyze.length)];
    runDebateForAsset(asset, 'crypto').catch(err => logger.error('Debate cron failed', { err }));
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

  // ── EVERY 30 MINUTES: Polymarket Opportunity Scan ────────────────────────
  cron.schedule('*/30 * * * *', async () => {
    if (isKillSwitchActive()) return;
    try {
      const portfolio = await getPortfolioState();
      const opportunities = await scanPolymarketOpportunities(portfolio.totalValue);
      for (const opp of opportunities.slice(0, 3)) {
        await placePolymarketBet(opp, opp.question, true); // paper mode
      }
    } catch (err) { logger.error('Polymarket scan failed', { err }); }
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
  logger.info('   ⏱️ Investment Committee debates every 90 seconds');
  logger.info('   🛑 Stop-loss monitor every 10 seconds');
  logger.info('   📸 Portfolio snapshots every 5 minutes');
  logger.info('   🌍 Market regime detection every hour');
  logger.info('   🎯 Polymarket opportunity scan every 30 minutes');
  logger.info('   📓 Daily journal at 11:59 PM');
  logger.info('   📊 Weekly report every Sunday 8 AM');
  logger.info('   🎓 Post-trade learning every 2 minutes');
}
