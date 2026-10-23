import cron from 'node-cron';
import { schedulerRuntime, markSchedulerFailure, markSchedulerSkip } from './schedulerRuntime';
import { createContinuousCryptoScan } from './cryptoScan';
import { AccountScope, getVerifiedAccountScope } from '../trading/accountScope';
import { getActiveMode, getTradingBroker } from '../trading/brokerRouter';
import { logger } from '../utils/logger';
import { buildMarketSnapshot, CRYPTO_ASSETS, getCurrentPrices, getNextStockBatch, getTotalStockCount, refreshOpenPositionStockPrices } from '../services/marketData';
import { refreshFundamentalsForSymbol } from '../services/deepAnalysisService';
import { runDailyScreen } from '../services/stockScreener';
import { runInvestmentCommitteeDebate } from '../agents/debateEngine';
import { detectMarketRegime } from '../services/regimeDetector';
import { executeTradeSignal, markToMarketOpenPositions, reconcileExecutionIntents } from '../trading/executionEngine';
import { validateTradeSignal } from '../trading/riskManager';
import { runPostTradeAnalysis, generateWeeklyReport } from '../services/selfLearning';
import { getPortfolioState } from '../services/portfolio';
import { recordPortfolioObservation } from '../services/cashFlowRisk';
import { checkStopLosses } from '../trading/riskManager';
import { reconcilePositionExits } from '../trading/positionExits';
import { generateDailyJournal } from '../services/journalGenerator';
import { prisma } from '../utils/prisma';
import { isKillSwitchActive } from '../agents/orchestrator';
import { TradeSignal } from '../agents/types';
import { preDebateGate } from '../trading/preDebateGate';
import { scanPolymarketOpportunities, placePolymarketBet, pollPolymarketResolutions, isPolymarketScanRunning } from '../services/polymarket';

const analyzedTradeIds = new Set<string>();

// In-memory lock to prevent concurrent debates on same asset
const debateLocks = new Set<string>();

export async function runDebateForAsset(asset: string, market: 'crypto' | 'stocks' | 'forex' = 'crypto', opts: { bypassGate?: boolean; maximumNotionalUsd?: number; executionLane?: 'COUNCIL' | 'INTRADAY'; purpose?: 'ENTRY' | 'RESEARCH'; expectedScope?: AccountScope } = {}) {
  const purpose = opts.purpose ?? 'ENTRY';
  if (purpose !== 'ENTRY' && purpose !== 'RESEARCH') throw new Error('Invalid debate execution purpose');
  if (isKillSwitchActive()) { markSchedulerSkip('KILL_SWITCH_ACTIVE'); return; }
  const currentBinding = () => !opts.expectedScope || (getActiveMode() === opts.expectedScope.mode && getTradingBroker() === opts.expectedScope.broker);
  const currentScope = (portfolio: Awaited<ReturnType<typeof getPortfolioState>>) => currentBinding()
    && (!opts.expectedScope || (portfolio.accountId === opts.expectedScope.accountId && portfolio.brokerMode === opts.expectedScope.mode));
  if (!currentBinding()) { markSchedulerSkip('ACCOUNT_SCOPE_CHANGED'); return; }
  const lockKey = `${asset}:${market}`;
  if (debateLocks.has(lockKey)) { markSchedulerSkip('ALREADY_RUNNING'); return; }

  // Skip if open position already exists for this asset
  const currentPortfolio = await getPortfolioState();
  if (!currentScope(currentPortfolio)) { markSchedulerSkip('ACCOUNT_SCOPE_CHANGED'); return; }
  const openPos = currentPortfolio.positions.find(position => position.asset === asset);
  if (openPos) {
    markSchedulerSkip('POSITION_ALREADY_OPEN');
    logger.info(`⏭️ Skipping debate for ${asset} — position already open (side: ${openPos.side})`);
    return;
  }

  debateLocks.add(lockKey);
  try {
    logger.info(`\n🏛️ Investment Committee convening for ${asset}...`);
    const snapshot = await buildMarketSnapshot(asset, market);
    if (!snapshot) { markSchedulerFailure('NO_MARKET_SNAPSHOT'); logger.warn(`No snapshot for ${asset}`); return; }
    // Cheap news-only sentiment (no X reads) so a mention-volume spike can
    // nominate a symbol the technical gate would otherwise skip.
    let gateSentiment: any = null;
    if (!opts.bypassGate) {
      try {
        const svc = await import('../services/sentimentService');
        if (svc.isSentimentEnabled()) gateSentiment = await svc.getSentiment(asset, { market, includeX: false });
      } catch { markSchedulerFailure(); gateSentiment = null; }
    }
    const gate = opts.bypassGate ? { pass: true,
      setup: opts.executionLane === 'INTRADAY' ? 'INTRADAY_PREFILTER' : 'MANUAL',
      reason: opts.executionLane === 'INTRADAY' ? 'autonomous intraday setup forwarded to shared council' : 'manually triggered' } : preDebateGate({ ...(snapshot as any), sentiment: gateSentiment });
    if (!gate.pass) {
      markSchedulerSkip('PRE_DEBATE_GATE');
      logger.info(`⏭️ ${asset}: skipped before debate — ${gate.reason} (saved ~30 LLM calls)`);
      return;
    }
    logger.info(`✅ ${asset}: ${gate.setup} — ${gate.reason}`);
    const bWidth = (snapshot.indicators.bollingerBands.upper - snapshot.indicators.bollingerBands.lower) / snapshot.indicators.bollingerBands.middle;
    const regime = await detectMarketRegime(asset, {
      price: snapshot.price, priceChange24h: snapshot.priceChangePct24h,
      rsi: snapshot.indicators.rsi14, macdHistogram: snapshot.indicators.macd.histogram,
      bollingerWidth: bWidth, ema9: snapshot.indicators.ema9, ema21: snapshot.indicators.ema21,
      ema200: snapshot.indicators.ema200, volume24h: snapshot.volume24h,
      volumeAvg20: snapshot.indicators.volumeAvg20, atr14: snapshot.indicators.atr14,
    });
    const portfolio = await getPortfolioState();
    if (!currentScope(portfolio)) { markSchedulerSkip('ACCOUNT_SCOPE_CHANGED'); return; }
    const transcript = await runInvestmentCommitteeDebate(snapshot, portfolio, regime.regime, regime, opts.executionLane ?? 'COUNCIL', undefined, undefined, purpose);
    // Research is blocked before risk/execution, independently of the returned vote.
    if (purpose === 'RESEARCH') {
      transcript.purpose = 'RESEARCH';
      transcript.executionApproved = false;
      transcript.positionSizePct = 0;
      transcript.tradeExecuted = false;
      transcript.blockReason = 'Research only — no execution authority';
      return transcript;
    }
    if (transcript.executionApproved && transcript.finalDecision !== 'HOLD') {
      if (!transcript.decisionId) {
        transcript.executionApproved = false;
        transcript.blockReason = 'Current decision has no persisted identity';
        return transcript;
      }
      const signal: TradeSignal = {
        asset, market,
        direction: transcript.finalDecision as 'BUY' | 'SELL',
        confidence: transcript.finalConfidence,
        entryPrice: snapshot.price,
        stopLossPrice: transcript.stopLossPrice,
        takeProfitPrice: transcript.takeProfitPrice,
        positionSizePct: opts.maximumNotionalUsd === undefined ? transcript.positionSizePct
          : Math.min(transcript.positionSizePct, opts.maximumNotionalUsd / portfolio.totalValue * 100),
        reasoning: transcript.masterSynthesis.slice(0, 500),
        agentDecisionId: transcript.decisionId,
        voteCounts: {
          supporting: transcript.agentVotes.filter(v => v.vote === transcript.finalDecision && v.executionEligible !== false).length,
          opposing: transcript.agentVotes.filter(v => v.vote !== transcript.finalDecision && v.vote !== 'HOLD' && v.executionEligible !== false).length,
          abstaining: transcript.agentVotes.filter(v => v.vote === 'HOLD' || v.executionEligible === false).length,
        },
      };
      const riskCheck = await validateTradeSignal(signal, portfolio);
      if (riskCheck.approved && typeof riskCheck.adjustedSize === 'number') {
        signal.positionSizePct = riskCheck.adjustedSize; // clamped to MAX_POSITION_SIZE_PCT
      }
      if (riskCheck.approved) {
        const executed = await executeTradeSignal({ ...signal, positionSizePct: riskCheck.adjustedSize ?? signal.positionSizePct }, portfolio);
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
    setTimeout(() => debateLocks.delete(lockKey), 80000).unref();
  }
}


// Screens the whole market (small + large cap) and returns symbols the current
// account can actually afford to size a position in — not just a fixed list.
async function pickDynamicSymbols(count: number, skip = 0): Promise<string[]> {
  const [screened, portfolio] = await Promise.all([
    runDailyScreen().catch(() => { markSchedulerFailure(); return []; }),
    getPortfolioState().catch(() => { markSchedulerFailure(); return null; }),
  ]);
  // No hardcoded fallback list: if the Polygon screen is empty, take a
  // sector-balanced slice of the live universe (Nasdaq screener + Alpaca).
  if (screened.length === 0) {
    const { universe } = await import('../services/universeService');
    const open = await prisma.position.findMany({ where: { status: 'OPEN' }, select: { asset: true } }).catch(() => { markSchedulerFailure(); return []; });
    return universe.swingCandidates(skip + count, new Set(open.map((p: any) => p.asset))).slice(skip, skip + count);
  }

  const cash = portfolio?.cashBalance ?? 0;
  // ponytail: fractional-share orders make exact share count irrelevant, this just
  // excludes impractically-priced picks (e.g. $200k/share) for a small account
  const maxPrice = Math.max(cash, 20) * 25;
  const affordable = screened.filter(s => s.price <= maxPrice);

  return affordable.slice(skip, skip + count).map(s => s.symbol);
}

export function initScheduler() {
  if (!schedulerRuntime.begin()) return;
  const schedule = <T>(id: string, expression: string, callback: () => T | Promise<T>, options?: cron.ScheduleOptions) => {
    const observed = schedulerRuntime.register(id, expression, options?.timezone ?? 'SYSTEM_DEFAULT', callback);
    return cron.schedule(expression, observed, options);
  };
  try {
  // Recovery is observed independently of ENTRY flags, kill state and venue.
  // First cron tick after startup is at most30s away; boot does not perform I/O.
  schedule('prediction_order_recovery', '*/30 * * * * *', async () => {
    try {
      const { recoverPredictionOrders } = await import('../trading/predictionRecovery');
      const result = await recoverPredictionOrders();
      if (result.outcome === 'RECOVERY_UNAVAILABLE' || result.outcome === 'OWNER_UNAVAILABLE') markSchedulerFailure('BROKER_EVIDENCE_UNAVAILABLE');
      else if (result.unresolved > 0 || result.outcome === 'GRANT_REVIEW_REQUIRED') markSchedulerFailure('BROKER_RECONCILIATION_INCOMPLETE');
    } catch { markSchedulerFailure('BROKER_EVIDENCE_UNAVAILABLE'); logger.warn('prediction_order_recovery_unavailable'); }
  });
  // Research remains server-side and independent of opening a chat. The
  // durable service selects current-account holdings due for specialist review.
  schedule('held_position_research', '* * * * *', async () => {
    try {
      const { reviewOpenPositions } = await import('../services/positionResearch');
      await reviewOpenPositions();
    } catch (error) { markSchedulerFailure(); logger.error('Held-position research unavailable', { error }); }
  });

  // ── MARKET OPEN 9:35 AM ET — weekdays (Mon–Fri) ─────────────────────────
  // node-cron's timezone option resolves ET vs UTC (incl. DST) itself —
  // previously this used two hardcoded UTC crons (13:35 + 14:35) that both
  // fired every single day year-round, double-running (and double-billing)
  // the market-open scan regardless of season.
  const ET_ZONE = 'America/New_York';
  // Cap on debates per scan window — keeps API cost bounded while still giving
  // the screen room to move past the first batch when everything HOLDs.
  const MAX_STOCKS_PER_SCAN = Number(process.env.SWING_DEBATES_PER_WINDOW || 20);
  const MAX_SWING_ENTRIES_PER_WINDOW = Number(process.env.SWING_ENTRIES_PER_WINDOW || 3);

  // Keeps moving to the next symbol in the screened list — instead of stopping after
  // a fixed 5 — until something actually trades or the per-window cap is hit.
  // Fetches the screened+affordability-filtered pool once and slices it locally
  // instead of re-screening the whole market on every batch (was hitting Polygon
  // repeatedly for the same data within one scan window). Returns how many
  // symbols it actually debated, so a caller with a follow-up window (mid-day)
  // can start past exactly what was covered instead of assuming the cap was hit.
  const scanStocksUntilTrade = async (label: string, startSkip: number): Promise<number> => {
    if (isKillSwitchActive()) { markSchedulerSkip('KILL_SWITCH_ACTIVE'); return 0; }
    const pool = await pickDynamicSymbols(startSkip + MAX_STOCKS_PER_SCAN, 0);
    const symbols = pool.slice(startSkip, startSkip + MAX_STOCKS_PER_SCAN);
    if (!symbols.length) markSchedulerSkip('NO_CANDIDATES');
    logger.info(`${label} — screened top ${symbols.length} opportunities: ${symbols.join(', ')}`);
    let tried = 0;
    let entries = 0;
    // Run stocks in parallel mini-batches of 3 — each debate is independent
    // (debateLocks prevents double-entry on the same asset). Batch size is
    // intentionally small: Polygon REST is rate-limited to ~5 req/s, and the
    // 5 s inter-batch pause keeps pressure within the free-tier window.
    const STOCK_BATCH = 3;
    for (let i = 0; i < symbols.length; i += STOCK_BATCH) {
      if (isKillSwitchActive()) { markSchedulerSkip('KILL_SWITCH_ACTIVE'); return tried; }
      const batch = symbols.slice(i, i + STOCK_BATCH);
      const results = await Promise.all(
        batch.map(symbol =>
          runDebateForAsset(symbol, 'stocks').catch(err => {
            markSchedulerFailure();
            logger.error(`${label} debate failed`, { err, symbol });
            return null;
          })
        )
      );
      tried += batch.length;
      await new Promise(r => setTimeout(r, 5000));
      for (const transcript of results) {
        if (transcript?.tradeExecuted) {
          entries++;
          logger.info(`${label} — trade executed (${entries}/${MAX_SWING_ENTRIES_PER_WINDOW} this window)`);
        }
      }
      if (entries >= MAX_SWING_ENTRIES_PER_WINDOW) return tried;
    }
    return tried;
  };
  // Tracks how many symbols the market-open scan actually consumed, so the
  // mid-day scan resumes right after — not at a fixed offset that either
  // overlaps (wasted re-debates) or skips symbols entirely (an early market-open
  // exit on a fast trade left #4-20 forever unevaluated under the old fixed skip).
  let marketOpenTriedCount = MAX_STOCKS_PER_SCAN;
  schedule('swing_market_open', '35 9 * * 1-5', async () => {
    marketOpenTriedCount = await scanStocksUntilTrade('🔔 MARKET OPEN', 0);
  }, { timezone: ET_ZONE });

  // ── MID-DAY 1:00 PM ET — continue past where the market-open scan left off ──
  schedule('swing_late_morning', '0 11 * * 1-5', async () => {
    marketOpenTriedCount += await scanStocksUntilTrade('🕚 LATE-MORNING SCAN', marketOpenTriedCount);
  }, { timezone: ET_ZONE });
  schedule('swing_midday', '0 13 * * 1-5', () => scanStocksUntilTrade('☀️ MID-DAY SCAN', marketOpenTriedCount), { timezone: ET_ZONE });

  // ── INTRADAY FAST LANE: scan every 2 minutes during the session ───────────
  schedule('intraday_scan', '*/2 9-15 * * 1-5', async () => {
    const { runIntradayScan } = await import('../trading/intradayEngine');
    const scanStartedAt = Date.now();
    const result = await runIntradayScan().catch(err => { markSchedulerFailure(); logger.error('Intraday scan error', { err: err?.message }); });
    // This engine catches failures and may return a previous/no scan result.
    // Do not turn a fulfilled Promise into a claim of successful market work.
    if (!result || result.note || !result.at || Date.parse(result.at) < scanStartedAt) {
      if (result?.note?.startsWith('error:')) markSchedulerFailure('INTRADAY_FAILED');
      else markSchedulerSkip('INTRADAY_NOT_RUN');
    }
  }, { timezone: ET_ZONE });
  // Time stop for intraday positions every minute; hard flatten at 15:50 ET.
  schedule('intraday_exits', '* 9-15 * * 1-5', async () => {
    const { manageIntradayExits } = await import('../trading/intradayEngine');
    await manageIntradayExits().catch(err => { markSchedulerFailure(); logger.error('Intraday exit manager error', { err: err?.message }); });
  }, { timezone: ET_ZONE });
  schedule('intraday_flatten', '50 15 * * 1-5', async () => {
    const { manageIntradayExits } = await import('../trading/intradayEngine');
    logger.info('🔔 15:50 ET — flattening all intraday positions');
    await manageIntradayExits({ flattenAll: true }).catch(err => { markSchedulerFailure(); logger.error('EOD flatten error', { err: err?.message }); });
  }, { timezone: ET_ZONE });

  // ── BROKER SYNC: the broker is the source of truth for holdings ──────────
  schedule('broker_sync', '*/60 * * * * *', async () => {
    const { syncBrokerPositions } = await import('../services/brokerSync');
    const result = await syncBrokerPositions().catch(err => { markSchedulerFailure(); logger.error('Broker sync failed', { err: err?.message }); });
    if (result?.skipped) markSchedulerFailure('BROKER_EVIDENCE_UNAVAILABLE');
    if (result?.unresolved?.length || result?.activityEvidence === 'ACTIVITY_EVIDENCE_UNAVAILABLE') markSchedulerFailure('BROKER_RECONCILIATION_INCOMPLETE');
  });

  // Eligible crypto scanning is independent of US stock session hours. The
  // callback admits bounded cadence/rotation; shared council/execution gates
  // remain authoritative. One-minute ticks also support e.g. seven-minute cadence.
  schedule('crypto_scan', '* * * * *', createContinuousCryptoScan({
    scope: getVerifiedAccountScope, killed: isKillSwitchActive, supportedAssets: CRYPTO_ASSETS,
    debate: (asset, expectedScope) => runDebateForAsset(asset, 'crypto', { expectedScope }),
    skip: markSchedulerSkip, failure: markSchedulerFailure,
    observe: counts => logger.info('crypto_scan_observed', counts),
  }));

  // ── EVERY 60 SECONDS: Refresh live prices for open stock positions ───────
  // Stock prices were only ever set once at boot (previous day's close) —
  // crypto gets continuous Binance WebSocket updates, stocks got nothing
  // after startup, so the stop-loss monitor below was comparing against a
  // frozen snapshot instead of real prices. Only refreshes symbols with an
  // actual open stock position, not the whole tracked universe.
  schedule('open_stock_prices', '*/60 * * * * *', async () => {
    try {
      const openStockPositions = await prisma.position.findMany({ where: { status: 'OPEN', market: 'stocks' }, select: { asset: true } });
      await refreshOpenPositionStockPrices(openStockPositions.map((p: any) => p.asset));
    } catch (err) { markSchedulerFailure(); logger.error('Open-position price refresh failed', { err }); }
  });

  // ── EVERY 10 SECONDS: Stop Loss Monitor ──────────────────────────────────
  schedule('stop_loss_monitor', '*/10 * * * * *', async () => {
    await reconcilePositionExits().catch(err => { markSchedulerFailure(); logger.error('Exit reconciliation unavailable', { error: err?.message }); });
    if (isKillSwitchActive()) {
      const { liquidateCurrentAccount } = await import('../trading/killLiquidation');
      await liquidateCurrentAccount().catch(err => { markSchedulerFailure(); logger.error('Kill-switch exits unavailable', { error: err?.message }); });
    }
    const prices = getCurrentPrices();
    await checkStopLosses(prices).catch(err => { markSchedulerFailure(); logger.error('Stop loss check failed', { err }); });
  });

  // ── EVERY 5 MINUTES: Mark-to-market + Portfolio Snapshot ─────────────────
  schedule('portfolio_snapshot', '*/5 * * * *', async () => {
    try {
      await reconcileExecutionIntents();
      // Update P&L on all open trades with real current prices
      // Triggers SL/TP closes automatically when prices cross levels
      await markToMarketOpenPositions().catch(err => { markSchedulerFailure(); logger.error('Mark-to-market failed', { err: err?.message }); });

      const portfolio = await getPortfolioState();
      if (portfolio.riskDataComplete !== true) markSchedulerFailure('RISK_EVIDENCE_INCOMPLETE');
      await recordPortfolioObservation(portfolio);
    } catch (err) { markSchedulerFailure(); logger.error('Portfolio snapshot failed', { err }); }
  });

  // ── EVERY HOUR: Market Regime Detection (crypto + next stock batch) ─────
  schedule('market_regime', '0 * * * *', async () => {
    // Held positions always get a fresh regime read regardless of where they
    // land in the rotation — same reasoning as refreshOpenPositionStockPrices:
    // Investment Plan showed "No cached regime read yet" for NVDA/AMZN
    // indefinitely, since the blind rotation could take weeks to reach them
    // out of the full ~7000-stock universe.
    const currentAccount = await getPortfolioState();
    const openPositions = currentAccount.positions;
    const heldAssets = openPositions.map((p: any) => ({ asset: p.asset, market: p.market as 'crypto' | 'stocks' }));
    const heldSymbols = new Set(heldAssets.map((a: any) => a.asset));

    const cryptoAssets = CRYPTO_ASSETS.slice(0, 3).map(a => ({ asset: a, market: 'crypto' as const })).filter(a => !heldSymbols.has(a.asset));
    const stockAssets = getNextStockBatch(2).map(a => ({ asset: a, market: 'stocks' as const })).filter(a => !heldSymbols.has(a.asset));
    const regimeAssets = [...heldAssets, ...cryptoAssets, ...stockAssets];
    // Run all regime detections in parallel — each is an independent snapshot
    // fetch + LLM classification with no cross-asset dependencies. Was sequential
    // before (O(n × latency)); now O(max_latency) regardless of list length.
    await Promise.allSettled(
      regimeAssets.map(async ({ asset, market }) => {
        try {
          const snapshot = await buildMarketSnapshot(asset, market);
           if (!snapshot) { markSchedulerFailure('NO_MARKET_SNAPSHOT'); return; }
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
        } catch (err) { markSchedulerFailure(); logger.error(`Regime detection failed for ${asset}`, { err }); }
      })
    );
  });

  // ── DAILY 11:59 PM: Generate Journal ─────────────────────────────────────
  schedule('daily_journal', '59 23 * * *', async () => {
    logger.info('📓 Generating daily journal...');
    await generateDailyJournal().catch(err => { markSchedulerFailure(); logger.error('Journal generation failed', { err }); });
  });

  // ── EVERY SUNDAY 8 AM: Weekly Performance Report ─────────────────────────
  schedule('weekly_report', '0 8 * * 0', async () => {
    logger.info('📊 Generating weekly performance report...');
    await generateWeeklyReport().catch(err => { markSchedulerFailure(); logger.error('Weekly report failed', { err }); });
  });

  // ── EVERY NIGHT 2 AM: Bulk refresh fundamentals for next day's debates ───
  schedule('fundamentals_refresh', '0 2 * * *', async () => {
    logger.info('🔄 Nightly fundamentals refresh — pre-loading deep analysis...');
    const batch = getNextStockBatch(50); // refresh 50 stocks every night
    for (const symbol of batch) {
      await refreshFundamentalsForSymbol(symbol).catch(() => { markSchedulerFailure(); });
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
  const MAX_OPEN_POLYMARKET_POSITIONS = Number(process.env.POLYMARKET_MAX_OPEN || 10);
  // POLYMARKET_VENUE=us (default): the Polymarket US edge engine
  // (services/polymarketEdge.ts) — paper only, order-book aware, scored.
  // POLYMARKET_VENUE=intl: the older international Gamma scanner (paper).
  const polymarketVenue = String(process.env.POLYMARKET_VENUE || 'us').toLowerCase() === 'intl' ? 'intl' : 'us';
  schedule('prediction_scan', `*/${Number(process.env.POLYMARKET_SCAN_EVERY_MIN || 15)} * * * *`, async () => {
    if (isKillSwitchActive()) { markSchedulerSkip('KILL_SWITCH_ACTIVE'); return; }
    if (polymarketVenue === 'us') {
      try {
        const edge = await import('../services/polymarketEdge');
        if (edge.isEdgeScanRunning()) {
          markSchedulerSkip('ALREADY_RUNNING');
          logger.info('🎯 Previous Polymarket edge scan still running — skipping this tick');
          return;
        }
        await edge.runPolymarketEdgeScan();
      } catch (err: any) { markSchedulerFailure(); logger.warn(`Polymarket edge scan skipped: ${err?.message || err?.code || 'network error'}`); }
      return;
    }
    try {
      const openCount = await prisma.trade.count({ where: { asset: 'POLYMARKET', status: 'OPEN' } });
      const slotsAvailable = MAX_OPEN_POLYMARKET_POSITIONS - openCount;
      if (slotsAvailable <= 0) {
        markSchedulerSkip('POSITION_CAP');
        logger.info(`🎯 Polymarket at max open positions (${openCount}/${MAX_OPEN_POLYMARKET_POSITIONS}) — skipping scan`);
        return;
      }
      const portfolio = await getPortfolioState();
      if (isPolymarketScanRunning()) {
        markSchedulerSkip('ALREADY_RUNNING');
        logger.info('🎯 Previous Polymarket scan still running — skipping this tick');
        return;
      }
      const opportunities = await scanPolymarketOpportunities(portfolio.totalValue);
      // The only place bets are placed. placePolymarketBet re-checks de-dupe per
      // market, POLYMARKET_MAX_OPEN and the optional USD exposure cap, and is
      // paper unless the live gate allows (it never does with isPaper=true).
      for (const opp of opportunities.slice(0, slotsAvailable)) {
        await placePolymarketBet(opp, opp.conditionId, true);
      }
    } catch (err: any) { markSchedulerFailure(); logger.warn(`Polymarket scan skipped: ${err?.message || err?.code || 'network error'}`); }
  });

  // ── EVERY 30 MINUTES: Polymarket Resolution Check ────────────────────────
  schedule('prediction_resolution', '*/30 * * * *', async () => {
    await pollPolymarketResolutions().catch(err => { markSchedulerFailure(); logger.error('Polymarket resolution poll failed', { err }); });
  });

  // ── Polymarket US edge engine upkeep (paper) ─────────────────────────────
  // Every 5 min: fill/expire/cancel resting paper limit orders, then exits
  // (resolution, take-profit at fair, edge flip, evidence change).
  if (polymarketVenue === 'us') {
    schedule('prediction_paper_upkeep', '*/5 * * * *', async () => {
      try {
        const edge = await import('../services/polymarketEdge');
        const { polymarketUSVenue } = await import('../services/polymarketUS');
        if (!isKillSwitchActive()) await edge.processPaperOrders(polymarketUSVenue);
        await edge.managePolymarketPositions(polymarketUSVenue); // exits only reduce risk
      } catch (err: any) { markSchedulerFailure(); logger.warn(`Polymarket paper upkeep skipped: ${err?.message || 'error'}`); }
    });
    // Hourly: score predictions against real resolutions.
    schedule('prediction_score_resolution', '17 * * * *', async () => {
      try {
        const edge = await import('../services/polymarketEdge');
        await edge.resolvePolymarketPredictions();
      } catch (err: any) { markSchedulerFailure(); logger.warn(`Polymarket prediction resolution skipped: ${err?.message || 'error'}`); }
    });
    // Daily 9 AM: scorecard summary in the logs.
    schedule('prediction_scorecard', '0 9 * * *', async () => {
      try { await (await import('../services/polymarketEdge')).logScorecardSummary(); } catch { markSchedulerFailure(); /* log only */ }
    });
  }

  // ── POST-TRADE LEARNING: Watch for newly closed trades ───────────────────
  schedule('post_trade_learning', '*/2 * * * *', async () => {
    try {
      const recentlyClosed = await prisma.trade.findMany({
        where: {
          status: 'CLOSED',
          closedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }
        },
        select: { id: true }
      });

      for (const trade of recentlyClosed) {
        // Module-level memo: the 5-min lookback overlaps the 2-min cadence, so
        // without this each closed trade was analysed (and billed) 2-3 times.
        if (!analyzedTradeIds.has(trade.id)) {
          analyzedTradeIds.add(trade.id);
          await runPostTradeAnalysis(trade.id).catch(err => { markSchedulerFailure(); logger.error(`Post-trade analysis failed for ${trade.id}`, { err }); });
        }
      }
    } catch (err) { markSchedulerFailure(); logger.error('Post-trade polling failed', { err }); }
  });

  // ── Mark-to-market open positions every 5 minutes ────────────────────────
  schedule('mark_to_market', '*/5 * * * *', async () => {
    try {
      const { markToMarketOpenPositions } = await import('../trading/executionEngine');
      await markToMarketOpenPositions();
    } catch (err) { markSchedulerFailure(); logger.error('Mark-to-market failed', { err }); }
    // Score matured forecasts (ForecastRecord) against realized prices on
    // the same 5-minute tick. Separate guard: a scoring failure is logged
    // and never changes this job's outcome or the positions pass above.
    try {
      const { scoreMaturedForecasts } = await import('../services/forecastScorecard');
      const scored = await scoreMaturedForecasts();
      if (scored.scored) logger.info(`📊 Forecast scorecard: scored ${scored.scored} matured forecast(s), ${scored.pending} awaiting a price`);
    } catch (err: any) { logger.warn(`Forecast scoring skipped: ${err?.message || 'error'}`); }
  });

  // ── Verify audit ledger chain integrity daily at 6 AM ────────────────────
  schedule('ledger_integrity', '0 6 * * *', async () => {
    try {
      const { verifyChain } = await import('../services/auditLedger');
      const result = await verifyChain();
      if (!result.valid) {
        markSchedulerFailure('LEDGER_INVALID');
        logger.error(`[LEDGER ALERT] Chain corruption at sequence ${result.firstCorruptedSequence}`);
        // TODO: send Telegram/email alert
      } else {
        logger.info(`[LEDGER] Chain integrity OK — ${result.count} events verified`);
      }
    } catch (err) { markSchedulerFailure(); logger.error('Ledger integrity check failed', { err }); }
  });

  logger.info('✅ Bhishma Scheduler initialized:');
  logger.info('   ⏱️ Investment Committee (swing): 9:35, 11:00 & 13:00 ET, sector-balanced universe');
  logger.info('   ⚡ Intraday fast lane: every 2 min 9:40–15:30 ET, flatten 15:50 ET');
  logger.info('   🔄 Broker position sync every 60 seconds');
  logger.info('   🛑 Stop-loss monitor every 10 seconds');
  logger.info('   📸 Portfolio snapshots every 5 minutes');
  logger.info('   🌍 Market regime detection every hour');
  logger.info(`   🎯 Polymarket scan every ${Number(process.env.POLYMARKET_SCAN_EVERY_MIN || 15)} min (${String(process.env.POLYMARKET_VENUE || 'us').toLowerCase() === 'intl' ? 'international scanner' : 'US edge engine, paper'})`);
  logger.info('   📓 Daily journal at 11:59 PM');
  logger.info('   📊 Weekly report every Sunday 8 AM');
  logger.info('   🎓 Post-trade learning every 2 minutes');
  // Observation only: it submits no work or orders. Same cron engine as jobs.
  cron.schedule('*/10 * * * * *', () => schedulerRuntime.heartbeat());
  schedulerRuntime.ready();
  } catch (error) {
    schedulerRuntime.fail('INIT_FAILED');
    throw error;
  }
}
