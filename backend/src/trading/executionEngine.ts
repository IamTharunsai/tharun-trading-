import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { TradeSignal, PortfolioState } from '../agents/types';
import { getIO } from '../websocket/server';
import { validateWithTopTraderRules } from '../services/topTraderRules';
import { checkTradeViability, calculateMicroPosition, getAccountMode, EXCHANGE_FEES } from '../services/microAccountEngine';
import { LifecycleStateMachine, LifecycleState } from './lifecycleStateMachine';
import { getTradingBroker, getActiveMode } from './brokerRouter';
import { normalizeConfidence } from '../utils/confidence';

// DRY_RUN=true never sends a broker order (entries are simulated locally).
const isDryRun = () => process.env.DRY_RUN === 'true';

// Polls a just-placed order until it reaches the terminal 'filled' status,
// then returns the REAL fill price/qty — never the pre-trade quote.
// status === 'filled' is required (not just a truthy filled_avg_price), because
// Alpaca sets filled_avg_price on the first partial fill. Throws instead of
// falling back to the quote (root cause of past phantom NVDA/SDOT P&L).
export async function confirmOrderFill(client: any, orderId: string, attempts = 5, pollIntervalMs = 1000): Promise<{ fillPrice: number; fillQty: number }> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const status = await client.getOrder(orderId).catch(() => null);
    if (status?.status === 'filled' && status.filled_avg_price) {
      return { fillPrice: parseFloat(status.filled_avg_price), fillQty: parseFloat(status.filled_qty) };
    }
    if (status?.status === 'canceled' || status?.status === 'rejected' || status?.status === 'expired') {
      throw new Error(`Order ended as ${status.status}`);
    }
  }
  throw new Error('Order did not reach a confirmed fill within the poll window — not tracking an unconfirmed quantity/price as real');
}

/**
 * Builds the Alpaca order for a stock signal.
 * - Whole-share quantity (>=1): bracket order (broker-hosted stop + target), GTC
 *   so protection survives overnight.
 * - Fractional quantity (<1 share, typical for a $100 account): Alpaca does not
 *   allow bracket orders on fractional qty, so a plain DAY market order is sent
 *   and the stop/target are monitored by the app (checkStopLosses).
 * The old code forced qty up to at least 1 share (Math.max(1, …)), which could
 * buy a $200 share with a $100 account.
 */
export function buildStockOrder(signal: TradeSignal, qty: number): { payload: any; protection: 'BROKER_HOSTED' | 'APPLICATION_MONITORED' } | null {
  const side = signal.direction === 'BUY' ? 'buy' : 'sell';
  const wholeShares = Math.floor(qty);
  const validLevels = signal.stopLossPrice > 0 && signal.takeProfitPrice > 0;

  if (wholeShares >= 1 && validLevels) {
    return {
      protection: 'BROKER_HOSTED',
      payload: {
        symbol: signal.asset,
        qty: wholeShares,
        side,
        type: 'market',
        time_in_force: 'gtc',
        order_class: 'bracket',
        take_profit: { limit_price: parseFloat(signal.takeProfitPrice.toFixed(2)) },
        stop_loss: { stop_price: parseFloat(signal.stopLossPrice.toFixed(2)) },
      },
    };
  }

  const fractional = Math.floor(qty * 10000) / 10000;
  if (fractional <= 0) return null;
  // Fractional orders must be DAY market orders and cannot open shorts.
  if (side === 'sell') return null;
  return {
    protection: 'APPLICATION_MONITORED',
    payload: { symbol: signal.asset, qty: fractional, side, type: 'market', time_in_force: 'day' },
  };
}

/**
 * Crypto order for Alpaca (paper by default). Alpaca crypto uses "BTC/USD",
 * fractional qty, GTC, and does not support bracket orders or shorting, so
 * stops are application-monitored and SELL entries are refused.
 */
export function buildCryptoOrder(signal: TradeSignal, qty: number): { payload: any; protection: 'APPLICATION_MONITORED' } | null {
  if (signal.direction !== 'BUY') return null;
  const q = Math.floor(qty * 1e6) / 1e6;
  if (!(q > 0)) return null;
  return {
    protection: 'APPLICATION_MONITORED',
    payload: { symbol: `${signal.asset}/USD`, qty: q, side: 'buy', type: 'market', time_in_force: 'gtc' },
  };
}

const LIFECYCLE_STEPS: Array<[LifecycleState, (c: any) => string]> = [
  [LifecycleState.DATA_VALIDATED, () => 'Input quote and tick integrity validated'],
  [LifecycleState.UNIVERSE_FILTERED, () => 'Security master eligibility and tradability confirmed'],
  [LifecycleState.CANDIDATE_GENERATED, () => 'Trade candidate generated with R:R targets'],
  [LifecycleState.STRATEGY_ANALYZED, () => 'Strategy gates and Top Trader Rules validated'],
  [LifecycleState.AGENTS_EVALUATED, c => `AI agents consensus reached (${c.confidence}%)`],
  [LifecycleState.RISK_CHECKED, () => 'Portfolio drawdown and fee viability verified'],
  [LifecycleState.ORDER_PLANNED, c => `Order planned for ${c.qty} units`],
  [LifecycleState.FRESH_DATA_REVALIDATED, () => 'Pre-flight quote freshness confirmed prior to dispatch'],
  [LifecycleState.ORDER_SUBMITTED, c => `Order submitted (${c.orderId})`],
  [LifecycleState.PROVIDER_ACCEPTED, c => `Order accepted (${c.reconciliation})`],
  [LifecycleState.FILLED, c => `Filled ${c.fillQty} @ $${c.fillPrice}`],
  [LifecycleState.PROTECTION_VERIFIED, c => `Protective levels: SL $${c.sl}, TP $${c.tp} (${c.protection})`],
  [LifecycleState.POSITION_MONITORED, () => 'Position opened and active in portfolio monitoring'],
];

async function recordEntryLifecycle(tradeId: string, signal: TradeSignal, provider: string, ctx: any) {
  try {
    const corrId = `corr-${tradeId}`;
    const base = { correlationId: corrId, provider, environment: getActiveMode(), strategy: 'INTRADAY', symbol: signal.asset } as any;
    await LifecycleStateMachine.start({ ...base, sourceDataIds: [signal.asset, String(signal.entryPrice)], reason: `Initiating ${signal.direction} order flow` });
    for (const [state, reason] of LIFECYCLE_STEPS) {
      await LifecycleStateMachine.transition({ ...base, newState: state, reason: reason(ctx) });
    }
  } catch (err: any) {
    logger.warn('Lifecycle transition warning', { error: err.message });
  }
}

export async function executeTradeSignal(
  signal: TradeSignal,
  portfolioState: PortfolioState
): Promise<boolean> {
  const mode = getActiveMode();
  logger.info(`💰 Executing ${signal.direction} for ${signal.asset}`, { mode: mode.toUpperCase(), price: signal.entryPrice, confidence: signal.confidence });
  const { isKillSwitchActive } = await import('../agents/orchestrator');
  if (isKillSwitchActive()) {
    logger.warn('[EXEC] Kill switch active — trade blocked');
    return false;
  }

  // ── Hard gates that no amount of AI confidence can bypass ──────────────────
  if (signal.direction !== 'BUY' && signal.direction !== 'SELL') {
    logger.warn(`🚫 ${signal.asset}: ${signal.direction} is not a tradeable direction`);
    return false;
  }
  if (signal.direction === 'SELL') {
    // A SELL on a held long is an exit, never a new short on top of it.
    const held = await prisma.position.findFirst({ where: { asset: signal.asset, status: 'OPEN' } }).catch(() => null);
    if (held && held.side !== 'SELL') {
      logger.info(`↩️ SELL signal on held long ${signal.asset} — closing the position instead of opening a short`);
      const { closePosition } = await import('./riskManager');
      const r = await closePosition(held, signal.entryPrice, 'sell_signal_exit');
      return Boolean(r?.closed);
    }
    // No position → this would OPEN a short. Off unless explicitly enabled
    // (needs a margin account with >$2,000 equity and borrow at Alpaca).
    if (process.env.ALLOW_SHORT_SELLING !== 'true') {
      logger.warn(`🚫 Short entry skipped for ${signal.asset}: no open position and ALLOW_SHORT_SELLING is not "true"`);
      return false;
    }
    if (signal.market !== 'stocks') {
      logger.warn(`🚫 Short entry skipped for ${signal.asset}: shorting ${signal.market} is not supported on this broker`);
      return false;
    }
  }
  if (mode === 'live' && signal.market !== 'stocks') {
    logger.warn(`🚫 Live ${signal.market} execution is not implemented safely (no fill confirmation / position tracking). Skipping ${signal.asset}.`);
    return false;
  }
  const confidencePct = normalizeConfidence(signal.confidence);

  // ── TOP TRADER RULES VALIDATION ────────────────────────────────────────────
  const exchange = (signal.market === 'stocks' ? 'alpaca_stocks' : 'bybit_spot') as keyof typeof EXCHANGE_FEES;
  const stopDistancePct = Math.abs(signal.entryPrice - signal.stopLossPrice) / signal.entryPrice;
  const expectedReturnPct = Math.abs(signal.takeProfitPrice - signal.entryPrice) / signal.entryPrice;
  const positionSizeEst = portfolioState.totalValue * (signal.positionSizePct / 100 || 0.01);

  const topTraderCheck = await validateWithTopTraderRules(
    signal, portfolioState, confidencePct, Math.round(confidencePct * 0.25), 25, exchange, expectedReturnPct
  );
  if (!topTraderCheck.approved) {
    logger.warn(`🚫 TOP TRADER RULES BLOCKED trade on ${signal.asset}:`);
    topTraderCheck.violations.forEach(v => logger.warn(`   ${v}`));
    return false;
  }

  const viability = checkTradeViability(portfolioState.totalValue, positionSizeEst, expectedReturnPct, stopDistancePct, exchange);
  if (!viability.viable) {
    logger.warn(`🚫 VIABILITY CHECK FAILED for ${signal.asset}: ${viability.reason}`);
    return false;
  }

  const accountMode = getAccountMode(portfolioState.drawdownFromPeak, portfolioState.pnlDayPct);
  const microPos = calculateMicroPosition(portfolioState.totalValue, signal.entryPrice, signal.stopLossPrice, exchange, confidencePct, accountMode.riskMultiplier);
  if (!microPos.isAboveMinimum) {
    logger.warn(`🚫 Position below exchange minimum for ${signal.asset}: ${microPos.recommendation}`);
    return false;
  }
  // Honour the debate's (sentiment-adjusted) size: never buy more than
  // positionSizePct of the portfolio even if the micro-account sizer would.
  let plannedQty = microPos.shares;
  if (signal.positionSizePct > 0 && signal.entryPrice > 0) {
    const capQty = (portfolioState.totalValue * (signal.positionSizePct / 100)) / signal.entryPrice;
    if (capQty < plannedQty) plannedQty = Math.floor(capQty * 10000) / 10000;
  }
  if (!(plannedQty > 0)) {
    logger.warn(`Position size calculated as 0 for ${signal.asset} — skipping`);
    return false;
  }
  // Never spend more cash than we have.
  if (plannedQty * signal.entryPrice > portfolioState.cashBalance) {
    logger.warn(`🚫 Insufficient cash for ${signal.asset}: need $${(plannedQty * signal.entryPrice).toFixed(2)}, have $${portfolioState.cashBalance.toFixed(2)}`);
    return false;
  }

  // ── WRITE TO DB FIRST (before any order placement) ─────────────────────────
  let tradeRecord: any;
  try {
    tradeRecord = await prisma.trade.create({
      data: {
        asset: signal.asset,
        market: signal.market,
        type: signal.direction as any,
        entryPrice: signal.entryPrice,
        quantity: plannedQty,
        status: 'PENDING',
        stopLossPrice: signal.stopLossPrice,
        takeProfitPrice: signal.takeProfitPrice,
        ...(signal.agentDecisionId ? { agentDecisionId: signal.agentDecisionId } : {}),
      }
    });
  } catch (dbError) {
    logger.error('CRITICAL: DB write failed — aborting trade execution', { dbError, asset: signal.asset });
    return false;
  }

  let brokerOrderId = `local-sim-${Date.now()}`;
  let fillPrice = signal.entryPrice;
  let fillQty = plannedQty;
  let brokerConfirmed = false;
  let reconciliationStatus = 'UNCONFIRMED_LOCAL_SIMULATION';
  let protectionStatus: string = 'APPLICATION_MONITORED';
  let provider = 'SIMULATION';

  const brokerMarket = signal.market === 'stocks' || signal.market === 'crypto';
  if (brokerMarket && isDryRun()) {
    logger.info(`📝 DRY_RUN — simulated ${signal.direction} ${plannedQty} ${signal.asset} @ $${fillPrice} (no broker order sent)`);
  } else if (brokerMarket) {
    const broker = getTradingBroker();
    if (!broker) {
      if (mode === 'live') {
        await prisma.trade.update({ where: { id: tradeRecord.id }, data: { status: 'FAILED', exitReason: 'Live mode but no live broker credentials' } });
        logger.error('🚫 LIVE mode without ALPACA_LIVE_* credentials — refusing to simulate a live trade');
        return false;
      }
      logger.info(`📝 Local simulation for ${signal.asset} @ $${fillPrice} (no broker connected; unconfirmed)`);
    } else {
      const order = signal.market === 'crypto' ? buildCryptoOrder(signal, plannedQty) : buildStockOrder(signal, plannedQty);
      if (!order) {
        await prisma.trade.update({ where: { id: tradeRecord.id }, data: { status: 'REJECTED', exitReason: 'Order could not be built (short, fractional short or zero qty)' } });
        return false;
      }
      try {
        const placed = await broker.createOrder({ ...order.payload, client_order_id: tradeRecord.id });
        brokerOrderId = placed.id;
        const fill = await confirmOrderFill(broker, placed.id);
        fillPrice = fill.fillPrice;
        fillQty = fill.fillQty;
        brokerConfirmed = true;
        reconciliationStatus = 'BROKER_RECONCILED';
        protectionStatus = order.protection;
        provider = 'ALPACA';
        logger.info(`💵 ${mode.toUpperCase()} fill: ${signal.asset} ${fillQty} @ $${fillPrice} (quoted $${signal.entryPrice})`);
      } catch (brokerErr: any) {
        const msg = brokerErr?.response?.data?.message || brokerErr.message;
        logger.error(`🚫 Alpaca ${mode} order FAILED for ${signal.asset} — not tracking as confirmed`, { error: msg });
        await prisma.trade.update({ where: { id: tradeRecord.id }, data: { status: 'REJECTED', exitReason: `Broker rejected: ${msg}`, brokerConfirmed: false, brokerOrderId } });
        return false;
      }
    }
  }

  await prisma.trade.update({
    where: { id: tradeRecord.id },
    data: {
      brokerConfirmed,
      brokerOrderId,
      entryPrice: fillPrice,
      quantity: fillQty,
      // Local simulations are still OPEN trades so the stop monitor can close them.
      status: 'OPEN',
      reconciliationStatus,
    }
  });

  await recordEntryLifecycle(tradeRecord.id, signal, provider, {
    confidence: signal.confidence, qty: fillQty, orderId: brokerOrderId, reconciliation: reconciliationStatus,
    fillQty, fillPrice, sl: signal.stopLossPrice, tp: signal.takeProfitPrice, protection: protectionStatus,
  });

  await prisma.position.upsert({
    where: { asset: signal.asset },
    create: {
      asset: signal.asset, market: signal.market, side: signal.direction, quantity: fillQty,
      entryPrice: fillPrice, currentPrice: fillPrice, stopLossPrice: signal.stopLossPrice,
      takeProfitPrice: signal.takeProfitPrice, protectionStatus, status: 'OPEN',
    },
    update: {
      side: signal.direction, quantity: fillQty, entryPrice: fillPrice, currentPrice: fillPrice,
      stopLossPrice: signal.stopLossPrice, takeProfitPrice: signal.takeProfitPrice, protectionStatus, status: 'OPEN',
    }
  });

  if (signal.agentDecisionId) {
    await prisma.agentDecision.update({ where: { id: signal.agentDecisionId }, data: { executed: true } }).catch(() => {});
  }

  getIO()?.emit('trade:executed', { trade: { ...tradeRecord, entryPrice: fillPrice, quantity: fillQty, status: 'OPEN' }, mode, signal, brokerOrderId });
  logger.info(`✅ ${mode.toUpperCase()} ${brokerConfirmed ? 'BROKER' : 'SIMULATED'} ENTRY: ${signal.direction} ${fillQty} ${signal.asset} @ $${fillPrice}`);
  return true;
}

// ── Price resolution (in-memory ws cache first, snapshot fallback) ─────────────
async function fetchCurrentPrice(asset: string, market: string): Promise<number | null> {
  const { getCurrentPrice, buildMarketSnapshot } = await import('../services/marketData');
  const cached = getCurrentPrice(asset);
  if (cached && cached > 0) return cached;
  try {
    const snap = await buildMarketSnapshot(asset, (market === 'crypto' ? 'crypto' : 'stocks') as any);
    if (snap?.price && snap.price > 0) return snap.price;
  } catch { /* fall through */ }
  return null;
}

/**
 * markToMarketOpenPositions — run every 5 min from the scheduler.
 * Prices every open position and hands off to riskManager.checkStopLosses,
 * which updates unrealized P&L and — when a stop/target is hit — sends a REAL
 * exit order to the active broker (paper broker in paper mode) before marking
 * the trade closed. The previous version only rewrote DB rows, leaving any
 * broker position open.
 */
export async function markToMarketOpenPositions(): Promise<void> {
  const open = await prisma.position.findMany({ where: { status: 'OPEN' } });
  if (open.length === 0) return;
  const prices: Record<string, number> = {};
  for (const p of open) {
    const px = await fetchCurrentPrice(p.asset, p.market).catch(() => null);
    if (px && px > 0) prices[p.asset] = px;
  }
  if (Object.keys(prices).length === 0) return;
  const { checkStopLosses } = await import('./riskManager');
  await checkStopLosses(prices);
}
