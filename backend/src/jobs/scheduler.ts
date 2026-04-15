import cron from 'node-cron';
import { logger } from '../utils/logger';
import { buildMarketSnapshot, CRYPTO_ASSETS, STOCK_ASSETS, getCurrentPrices } from '../services/marketData';
import { runAgentCouncil, isKillSwitchActive } from '../agents/orchestrator';
import { checkStopLosses } from '../trading/riskManager';
import { getPortfolioState } from '../services/portfolio';
import { generateDailyJournal } from '../services/journalGenerator';
import { prisma } from '../utils/prisma';

// Track if analysis is already running to prevent concurrent runs
let isAnalyzing = false;
let analysisQueue: Array<{ asset: string; market: string }> = [];

async function runAnalysis(asset: string, market: string) {
  if (isKillSwitchActive()) {
    logger.debug(`Skipping analysis for ${asset} — kill switch active`);
    return;
  }

  try {
    const prices = getCurrentPrices();
    const price = prices[asset];
    
    if (!price) {
      logger.debug(`No price data for ${asset}, skipping analysis`);
      return;
    }

    const marketType = (market === 'crypto' || market === 'stocks' || market === 'forex') ? market : 'crypto';
    const snapshot = await buildMarketSnapshot(asset, marketType);
    if (!snapshot) {
      logger.debug(`Failed to build snapshot for ${asset}`);
      return;
    }
    
    const portfolio = await getPortfolioState();
    
    logger.info(`🤖 Running agent council for ${asset}`);
    await runAgentCouncil(snapshot, portfolio);
  } catch (error) {
    logger.error(`Analysis failed for ${asset}`, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function initScheduler() {
  logger.info('✅ Scheduler initialized — analyzing every 60 seconds');

  // ── EVERY 60 SECONDS: Run agent council on all watched assets ─────────────
  cron.schedule('*/60 * * * * *', async () => {
    if (isKillSwitchActive()) {
      logger.info('⏸️ Scheduler paused — kill switch active');
      return;
    }

    const assetsToAnalyze = [...CRYPTO_ASSETS.slice(0, 5), ...STOCK_ASSETS.slice(0, 3)];
    
    // Stagger analysis to spread load
    for (let i = 0; i < assetsToAnalyze.length; i++) {
      const asset = assetsToAnalyze[i];
      const market = CRYPTO_ASSETS.includes(asset) ? 'crypto' : 'stocks';
      
      setTimeout(() => {
        runAnalysis(asset, market).catch(err => {
          logger.error(`Error analyzing ${asset}`, { error: err instanceof Error ? err.message : String(err) });
        });
      }, i * 1000); // Space out by 1 second each
    }
  });

  // ── EVERY 10 SECONDS: Check stop losses ───────────────────────────────────
  cron.schedule('*/10 * * * * *', async () => {
    try {
      const prices = getCurrentPrices();
      await checkStopLosses(prices);
    } catch (error) {
      logger.warn('Stop loss check failed', { error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ── EVERY 5 MINUTES: Portfolio snapshot ───────────────────────────────────
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
          pnlTotalPct: portfolio.pnlTotal / (portfolio.totalValue || 1) * 100
        }
      }).catch(() => {});
    } catch (error) {
      logger.error('Portfolio snapshot failed', { error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ── DAILY AT 11:59 PM: Generate AI journal ────────────────────────────────
  cron.schedule('59 23 * * *', async () => {
    logger.info('📓 Generating daily journal...');
    try {
      await generateDailyJournal();
    } catch (error) {
      logger.error('Journal generation failed', { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
