/**
 * APEX Trading — Execution Engine
 *
 * Implements executeTradeSignal (imported by scheduler.ts) and
 * markToMarketOpenPositions (periodic P&L updater).
 *
 * Broker routing:
 *   stocks / ETFs  → Alpaca REST API (paper or live depending on env)
 *   crypto         → Alpaca REST API (crypto-enabled account)
 *   prediction     → polymarketMoneyGreed.ts handles its own execution
 */

import { prisma } from '../utils/prisma';
import { TradeSignal, PortfolioState } from '../agents/types';
import { getActiveMode, getTradingBroker } from './brokerRouter';

export function buildCryptoOrder(signal: TradeSignal, quantity: number) {
  // This codebase's Alpaca path has no bracket/OCO/OTO order class for
  // crypto (bracket attachment is equities-only — see buildStockOrder /
  // placeBrokerOrder), so no broker-hosted stop/target can be attached
  // here, and inventing one would only get the order rejected. Protection is therefore
  // APPLICATION_MONITORED by the DB monitors (checkStopLosses /
  // markToMarketOpenPositions), which is exactly why those monitors fail
  // loud — flag + alert — on a missing price instead of skipping.
  if (signal.market !== 'crypto' || signal.direction !== 'BUY' || !Number.isFinite(quantity) || quantity <= 0) return null;
  const qty = Math.floor(quantity * 1e6) / 1e6;
  if (qty <= 0) return null;
  return { payload: { symbol: `${signal.asset}/USD`, qty, side: 'buy', type: 'market', time_in_force: 'gtc' }, protection: 'APPLICATION_MONITORED' };
}
import { confirmOrderFill } from './orderFills';
export { confirmOrderFill } from './orderFills';
import { getCurrentPrice, buildMarketSnapshot } from '../services/marketData';
import { logger } from '../utils/logger';
import { isKillSwitchActive } from '../agents/orchestrator';
import { validateTradeSignal, flagProtectionUnknown } from './riskManager';
import { authorizePersistedDecision, executionPlanSchema } from './decisionAuthority';
import { buildStockOrder } from './stockOrders';
import { createHash } from 'crypto';
import type { AlpacaBroker } from '../services/alpacaBroker';
import { positionScopeKey, getVerifiedAccountScope, AccountScope } from './accountScope';
import { requestPositionExit } from './positionExits';
import { getPortfolioState } from '../services/portfolio';
import { validateLiveQualification } from './liveQualification';
import { checkForecastGate } from './forecastGate';
import { bindStockQuote, assertStockQuoteBinding, readStockEntryQuote, StockQuoteBinding } from './stockEntryQuote';
import { assertStockEntryQuote, assertStockEntryBudget, reduceStockEntryQuantity } from './stockEntryPolicy';
import { emitContractEvent, TradeExecutedPayload } from '../websocket/socketEvents';
export { buildStockOrder } from './stockOrders';

// ─── Env flags ───────────────────────────────────────────────────────────────
const DRY_RUN    = process.env.DRY_RUN === 'true';   // never sends broker orders when true

// ─── Market classifier ────────────────────────────────────────────────────────
function getMarketForAsset(asset: string): 'crypto' | 'stocks' {
  const CRYPTO = new Set(['BTC','ETH','SOL','BNB','ADA','AVAX','LINK','DOT','UNI','MATIC',
    'XRP','DOGE','SHIB','LTC','BCH','ATOM','FIL','NEAR','APT','ARB','OP','INJ','SUI',
    'SEI','TIA','PYTH','JTO','BONK','WIF','PEPE']);
  if (CRYPTO.has(asset)) return 'crypto';
  return 'stocks'; // prediction-market assets use polymarketMoneyGreed.ts, not this path
}

// ─── Price resolution (in-memory ws cache first, Binance/Alpaca fallback) ────
async function fetchCurrentPrice(asset: string): Promise<number | null> {
  // 1. In-memory WebSocket cache (populated by marketData.ts stream)
  const cached = getCurrentPrice(asset);
  if (cached && cached > 0) return cached;

  // 2. Live fetch fallback
  try {
    const market = getMarketForAsset(asset);
    const snap = await buildMarketSnapshot(asset, market);
    if (snap?.price && snap.price > 0) return snap.price;
  } catch {/* fall through */}

  return null;
}

// ─── Broker order placement (Alpaca) ─────────────────────────────────────────
async function placeBrokerOrder(
  asset: string,
  side: 'BUY' | 'SELL',
  qty: number,
  _price: number,   // reference only; we use market order
  stopLoss?: number,
  takeProfit?: number,
  clientOrderId?: string,
  intentId?: string,
  preparedRequest?: any,
  boundBroker?: AlpacaBroker | null,
): Promise<{ success: boolean; orderId?: string; fillPrice?: number; fillQty?: number; fees?: number; error?: string }> {

  if (DRY_RUN) {
    logger.info(`[EXEC] DRY_RUN — would ${side} ${qty.toFixed(4)} ${asset}`);
    return { success: true, orderId: `dryrun-${Date.now()}`, fillPrice: _price, fillQty: qty, fees: 0 };
  }

  const broker = boundBroker;
  if (!broker) {
    return { success: false, error: 'Alpaca credentials not configured — set ALPACA_API_KEY and ALPACA_SECRET_KEY in Railway env vars' };
  }

  try {
    const market = getMarketForAsset(asset);

    // Crypto: Alpaca uses "BTC/USD" format
    const symbol = market === 'crypto' ? `${asset}/USD` : asset;

    const orderRequest: any = preparedRequest || {
      symbol,
      qty: parseFloat(qty.toFixed(6)),
      side: side === 'BUY' ? 'buy' : 'sell',
      type: 'market',
      time_in_force: market === 'crypto' ? 'gtc' : 'day',
    };

    // Bracket order (stop-loss + take-profit) when levels provided.
    // Stocks only: Alpaca has no bracket order class for crypto (see
    // buildCryptoOrder) — crypto protection stays application-monitored.
    if (!preparedRequest && market === 'stocks' && Number.isInteger(qty) && stopLoss && takeProfit && side === 'BUY') {
      orderRequest.order_class = 'bracket';
      orderRequest.take_profit = { limit_price: parseFloat(takeProfit.toFixed(2)) };
      orderRequest.stop_loss   = { stop_price: parseFloat(stopLoss.toFixed(2)) };
    }

    orderRequest.client_order_id = clientOrderId;
    const order = await broker.createOrder(orderRequest);
    if (!order?.id) throw new Error('Broker response contains no order identity');
    if (intentId) await prisma.executionIntent.updateMany({ where: { id: intentId, status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'] } }, data: { brokerOrderId: order.id, status: 'SUBMITTED' } });

    const { fillPrice, fillQty } = await confirmOrderFill(broker, order.id, 6, 1000);
    if (fillQty > qty + 1e-6) throw new Error('Broker fill quantity exceeds submitted quantity');

    return {
      success: true,
      orderId: order.id,
      fillPrice,
      fillQty,
      fees: 0, // Actual fee activities are reconciled independently; not a zero-fee assertion.
    };
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.message || String(err);
    logger.error(`[EXEC] Alpaca order failed for ${asset}: ${msg}`);
    if (intentId) await prisma.executionIntent.updateMany({ where: { id: intentId, status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'] } }, data: {
      status: 'RECONCILIATION_REQUIRED', error: msg,
      ...(err?.orderId ? { brokerOrderId: err.orderId } : {}),
      ...(err?.lastState ? { lastBrokerState: err.lastState } : {}),
    } }).catch(() => {});
    return { success: false, error: msg };
  }
}

// ─── Record failure on AgentDecision row ─────────────────────────────────────
async function recordExecutionFailure(decisionId: string, reason: string): Promise<void> {
  if (!decisionId) return;
  await prisma.agentDecision.updateMany({
    where: { id: decisionId, executed: false },
    data: { executed: false, executionReason: reason },
  }).catch(() => {});
}

// ─── Close a trade (SL/TP trigger or manual) ─────────────────────────────────
async function closeTrade(tradeId: string, _exitPrice: number, exitReason: string): Promise<void> {
  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade?.positionId) throw new Error('Exit requires an account-bound position');
  const result = await requestPositionExit(trade.positionId, exitReason);
  if (!result.closed) logger.warn('Exit remains unconfirmed', { tradeId, result });
}

// ─── Poll for fill confirmation (used by intradayEngine) ─────────────────────
/**
 * confirmOrderFill — polls the broker until the order is filled or maxAttempts exhausted.
 * @param broker        AlpacaBroker instance
 * @param orderId       Broker order ID to poll
 * @param maxAttempts   Max polling attempts (default 8)
 * @param intervalMs    Delay between polls in ms (default 750)
 * Fill confirmation is implemented in orderFills.ts and re-exported above.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API — these are what scheduler.ts and the rest of the system import
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * executeTradeSignal — the function scheduler.ts imports.
 * Returns true if the order was successfully placed/recorded.
 */
export async function executeTradeSignal(
  signal: TradeSignal,
  portfolio: PortfolioState,
): Promise<boolean> {
  if (isKillSwitchActive()) {
    logger.warn('[EXEC] Kill switch active — trade blocked');
    return false;
  }

  const { asset, market, direction, agentDecisionId } = signal;
  let authorityVerified = false;
  let unsubmittedIntentId: string | null = null;
  let submissionStarted = false;
  const executionMode = getActiveMode();
  const executionBroker = getTradingBroker();

  try {
    const savedDecision = await prisma.agentDecision.findUnique({ where: { id: agentDecisionId } });
    signal = authorizePersistedDecision(savedDecision, signal, executionMode, Date.now(), Number(process.env.MAX_DECISION_AGE_MS ?? 300000));
    authorityVerified = true;
    const stockBinding: StockQuoteBinding | null = market === 'stocks' && executionBroker ? bindStockQuote(executionMode, executionBroker) : null;
    if (market === 'stocks' && !stockBinding) throw new Error('STOCK_ENTRY_ACCOUNT_CHANGED');
    if (direction === 'SELL' && (market !== 'stocks' || process.env.ALLOW_SHORT_SELLING !== 'true')) return false;
    if (executionMode === 'live') {
      const strategyKey = 'BHISHMA_COUNCIL';
      const revision = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RELEASE_COMMIT_SHA;
      const qualification = revision ? await prisma.strategyQualification.findFirst({
        where: { strategyKey, revision }, orderBy: { createdAt: 'desc' },
      }) : null;
      const qualified = validateLiveQualification(qualification, strategyKey, revision,
        Number(process.env.LIVE_MIN_DSR_PROBABILITY ?? 0.95));
      if (!qualified.approved) { await recordExecutionFailure(agentDecisionId, qualified.reason); return false; }
    }
    portfolio = await getPortfolioState();
    if (portfolio.brokerMode !== executionMode) throw new Error('Current account mode changed during execution');
    const risk = await validateTradeSignal(signal, portfolio);
    if (!risk.approved) {
      await recordExecutionFailure(agentDecisionId, risk.reason);
      return false;
    }
    // Forecast gate: a recorded, unexpired forecast for this asset that
    // opposes the entry side blocks the order before any price/quote/intent
    // work. Default ON (FORECAST_GATE_ENABLED=false disables). The trade's
    // own council call is excluded inside checkForecastGate — it is the
    // decision being executed, not independent evidence against it.
    const forecastGate = await checkForecastGate({ asset, direction, decisionId: agentDecisionId });
    if (!forecastGate.allowed) {
      await recordExecutionFailure(agentDecisionId, forecastGate.reason);
      return false;
    }
    // 1. Price
    const price = signal.entryPrice > 0
      ? signal.entryPrice
      : await fetchCurrentPrice(asset);

    if (!price || price <= 0) {
      const reason = `PRICE_FETCH_FAILED: Cannot get current price for ${asset}`;
      logger.warn(`[EXEC] ❌ ${reason}`);
      await recordExecutionFailure(agentDecisionId, reason);
      return false;
    }

    // 2. Cash / position size
    if (!executionBroker && !DRY_RUN) return false;
    const account = await executionBroker?.getPortfolioSummary();
    if (!account?.account_id || account.account_id !== portfolio.accountId || !Number.isFinite(account.cash) || account.cash < 0) return false;
    if (await executionBroker!.getPosition(market === 'crypto' ? `${asset}/USD` : asset)) return false;
    const cashBalance = account.cash;
    const sizePct = (risk.adjustedSize ?? signal.positionSizePct) / 100;
    const positionValue = Math.min(portfolio.totalValue * sizePct, cashBalance);

    if (positionValue < 1) {
      const reason = `INSUFFICIENT_CASH: Available $${cashBalance.toFixed(2)}, need at least $1`;
      logger.warn(`[EXEC] ❌ ${reason}`);
      await recordExecutionFailure(agentDecisionId, reason);
      return false;
    }

    const originalStopBudget = positionValue / price * Math.abs(price - signal.stopLossPrice);
    const firstQuote = stockBinding ? await readStockEntryQuote(asset, stockBinding) : null;
    const firstQuotePrice = firstQuote ? assertStockEntryQuote(firstQuote, signal) : price;
    let quantity = firstQuote ? reduceStockEntryQuantity(signal, positionValue, firstQuotePrice) : positionValue / price;
    let prepared = market === 'stocks' ? buildStockOrder(signal, quantity) : market === 'crypto' ? buildCryptoOrder(signal, quantity) : null;
    if (!prepared) {
      await recordExecutionFailure(agentDecisionId, 'UNSUPPORTED_STOCK_ORDER: invalid quantity or fractional short');
      return false;
    }
    if (prepared) quantity = prepared.payload.qty;
    else quantity = Math.floor(quantity * 1e6) / 1e6;
    const protectionSignal = () => ({ ...signal,
      stopLossPrice: prepared?.payload.stop_loss?.stop_price ?? signal.stopLossPrice,
      takeProfitPrice: prepared?.payload.take_profit?.limit_price ?? signal.takeProfitPrice });
    if (firstQuote) {
      assertStockEntryQuote(firstQuote, protectionSignal());
      // Broker-hosted protection is rounded by the existing order builder.
      // Budget using those actual levels; never round quantity/risk upward.
      quantity = Math.min(quantity, positionValue / firstQuotePrice,
        originalStopBudget / Math.abs(firstQuotePrice - protectionSignal().stopLossPrice));
      prepared = buildStockOrder(signal, quantity);
      if (!prepared) throw new Error('STOCK_ENTRY_ORDER_UNAVAILABLE');
      quantity = prepared.payload.qty;
      assertStockEntryQuote(firstQuote, protectionSignal());
      assertStockEntryBudget(protectionSignal(), quantity, firstQuotePrice, positionValue, originalStopBudget);
    }
    if (DRY_RUN) {
      logger.info(`[EXEC] DRY_RUN: reviewed ${direction} ${quantity} ${asset}; no submission or execution recorded`);
      return false;
    }
    // The unique decision key is an atomic cross-process claim. Never release an
    // ambiguous claim: resolve it by broker identity rather than posting again.
    const clientOrderId = `bh-${createHash('sha256').update(agentDecisionId).digest('hex').slice(0, 40)}`;
    let intent;
    try {
      intent = await prisma.$transaction(async tx => {
        const lockKey = positionScopeKey(account.account_id, executionMode, asset);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        const held = await tx.position.findFirst({ where: { scopeKey: lockKey, status: 'OPEN' } });
        const pending = await tx.executionIntent.findFirst({ where: { asset, accountId: account.account_id, mode: executionMode,
          status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'] } } });
        if (held || pending) throw new Error('An existing holding or pending entry owns this account/symbol');
        return tx.executionIntent.create({ data: {
        decisionId: agentDecisionId, clientOrderId, asset, market, direction,
        mode: executionMode, quantity, referencePrice: price,
        accountId: account.account_id, executionPlan: (savedDecision!.marketSnapshot as any).executionPlan,
        protection: prepared?.protection ?? 'APPLICATION_MONITORED', status: 'SUBMITTING',
        } });
      });
      unsubmittedIntentId = intent.id;
    } catch (error: any) {
      if (error?.code === 'P2002') logger.warn(`[EXEC] Decision ${agentDecisionId} already has a submission claim`);
      else logger.error('[EXEC] Cannot persist submission claim', { error: error?.message });
      return false;
    }

    if (isKillSwitchActive() || getActiveMode() !== executionMode) {
      await prisma.executionIntent.updateMany({ where: { id: intent.id, status: 'SUBMITTING', brokerOrderId: null },
        data: { status: 'TERMINAL_UNFILLED', error: 'Authority changed before submission' } });
      return false;
    }

    // 3. Place broker order (direction is VoteDirection which includes 'HOLD';
    //    signals with HOLD direction should never reach here, but cast for TS)
    if (direction !== 'BUY' && direction !== 'SELL') {
      const reason = `INVALID_DIRECTION: ${direction} is not a tradeable direction`;
      logger.warn(`[EXEC] ❌ ${reason}`);
      await recordExecutionFailure(agentDecisionId, reason);
      return false;
    }
    if (stockBinding) {
      // All asynchronous revalidation precedes the final quote. Its observation
      // age is checked AGAIN with no await between the last guard and POST.
      const [latestDecision, currentPortfolio, currentAccount, currentQualification] = await Promise.all([
        prisma.agentDecision.findUnique({ where: { id: agentDecisionId } }),
        getPortfolioState(), executionBroker!.getPortfolioSummary(),
        executionMode === 'live' ? prisma.strategyQualification.findFirst({ where: { strategyKey: 'BHISHMA_COUNCIL',
          revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RELEASE_COMMIT_SHA }, orderBy: { createdAt: 'desc' } }) : Promise.resolve(null),
      ]);
      signal = authorizePersistedDecision(latestDecision, signal, executionMode, Date.now(), Number(process.env.MAX_DECISION_AGE_MS ?? 300000));
      const finalRisk = await validateTradeSignal(signal, currentPortfolio);
      if (!finalRisk.approved || currentPortfolio.accountId !== account.account_id || currentPortfolio.brokerMode !== executionMode
        || currentAccount?.account_id !== account.account_id || !Number.isFinite(currentAccount.cash) || currentAccount.cash < 0) throw new Error('STOCK_ENTRY_RISK_OR_ACCOUNT_CHANGED');
      const finalNotionalBudget = Math.min(positionValue, currentPortfolio.totalValue * (finalRisk.adjustedSize ?? signal.positionSizePct) / 100, currentAccount.cash);
      const finalStopBudget = Math.min(originalStopBudget, finalNotionalBudget / signal.entryPrice * Math.abs(signal.entryPrice - signal.stopLossPrice));
      const finalQuote = await readStockEntryQuote(asset, stockBinding);
      const submitRisk = await validateTradeSignal(signal, currentPortfolio);
      if (!submitRisk.approved || (submitRisk.adjustedSize ?? signal.positionSizePct) < (finalRisk.adjustedSize ?? signal.positionSizePct)) throw new Error('STOCK_ENTRY_RISK_OR_ACCOUNT_CHANGED');
      const finalQuotePrice = assertStockEntryQuote(finalQuote, protectionSignal());
      assertStockEntryBudget(protectionSignal(), quantity, finalQuotePrice, finalNotionalBudget, finalStopBudget);
      authorizePersistedDecision(latestDecision, signal, executionMode, Date.now(), Number(process.env.MAX_DECISION_AGE_MS ?? 300000));
      assertStockQuoteBinding(stockBinding);
      if (executionMode === 'live' && !validateLiveQualification(currentQualification, 'BHISHMA_COUNCIL',
        process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RELEASE_COMMIT_SHA, Number(process.env.LIVE_MIN_DSR_PROBABILITY ?? 0.95)).approved) throw new Error('STOCK_ENTRY_LIVE_QUALIFICATION_CHANGED');
      const riskEvidence = currentPortfolio.capitalRisk;
      const riskTime = Date.parse(riskEvidence?.asOf ?? '');
      if (isKillSwitchActive() || currentPortfolio.riskDataComplete !== true || riskEvidence?.complete !== true
        || riskEvidence.accountId !== account.account_id || riskEvidence.brokerMode !== executionMode
        || !Number.isFinite(riskTime) || Date.now() - riskTime >= 390000 || riskTime > Date.now()
        || currentPortfolio.pnlDayPct !== riskEvidence.dailyPnlPct || currentPortfolio.pnlWeekPct !== riskEvidence.weeklyPnlPct
        || currentPortfolio.drawdownFromPeak !== riskEvidence.drawdownPct) throw new Error('STOCK_ENTRY_FINAL_GUARD_FAILED');
      // No await follows these guards before placeBrokerOrder calls createOrder.
      assertStockEntryQuote(finalQuote, protectionSignal());
    }
    submissionStarted = true;
    const order = await placeBrokerOrder(
      asset,
      direction as 'BUY' | 'SELL',
      quantity,
      price,
      signal.stopLossPrice,
      signal.takeProfitPrice,
      clientOrderId,
      intent.id,
      prepared?.payload ?? { symbol: `${asset}/USD`, qty: quantity, side: direction === 'BUY' ? 'buy' : 'sell', type: 'market', time_in_force: 'gtc' },
      executionBroker,
    );

    if (!order.success) {
      const reason = `BROKER_REJECT: ${order.error}`;
      logger.warn(`[EXEC] ❌ ${reason}`);
      await recordExecutionFailure(agentDecisionId, reason);
      return false;
    }

    const fillPrice = Number(order.fillPrice);
    quantity = order.fillQty ?? 0;
    if (!(Number.isFinite(fillPrice) && fillPrice > 0 && Number.isFinite(quantity) && quantity > 0)) {
      await recordExecutionFailure(agentDecisionId, 'INVALID_CONFIRMED_FILL: broker returned no valid price/quantity');
      return false;
    }

    await recordConfirmedExecution(signal, intent.id, order, fillPrice, quantity, prepared?.protection ?? 'APPLICATION_MONITORED');

    logger.info(`[EXEC] ✅ ${direction} ${quantity.toFixed(4)} ${asset} @ $${fillPrice.toFixed(2)} | Order: ${order.orderId}`);
    return true;

  } catch (err: any) {
    if (unsubmittedIntentId && !submissionStarted) {
      await prisma.executionIntent.updateMany({ where: { id: unsubmittedIntentId, status: 'SUBMITTING', brokerOrderId: null },
        data: { status: 'TERMINAL_UNFILLED', error: 'STOCK_ENTRY_PRE_SUBMIT_REFUSED' } }).catch(() => {});
    }
    const reason = `EXECUTION_EXCEPTION: ${err?.message || String(err)}`;
    logger.error(`[EXEC] ❌ Exception for ${asset}: ${reason}`);
    if (authorityVerified) await recordExecutionFailure(agentDecisionId, reason);
    return false;
  }
}

/** Recover by durable broker identity only. This routine never submits an order. */
export async function reconcileExecutionIntents(suppliedScope?: AccountScope): Promise<void> {
  if (DRY_RUN) return;
  const scope = suppliedScope ?? await getVerifiedAccountScope();
  const { broker, mode, accountId } = scope;
  const intents = await prisma.executionIntent.findMany({
    where: { mode, accountId, status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'] } },
    orderBy: { updatedAt: 'asc' }, take: 50,
  });
  for (const intent of intents) {
    try {
      const order = await broker.getOrderByClientOrderId(intent.clientOrderId);
      if (!order) {
        // Advance this inspection's timestamp so unresolved old claims cannot
        // permanently starve later ones. A 404 never releases the submission claim.
        await prisma.executionIntent.updateMany({ where: { id: intent.id, status: { not: 'RECORDED' } }, data: {
          status: 'RECONCILIATION_REQUIRED', error: 'Broker order unavailable by client identity',
        } });
        continue;
      }
      const expectedSymbol = intent.market === 'crypto' ? `${intent.asset}/USD` : intent.asset;
      if (order.client_order_id !== intent.clientOrderId || order.symbol !== expectedSymbol
        || order.side !== (intent.direction === 'BUY' ? 'buy' : 'sell')) throw new Error('Recovery order identity mismatch');
      const quantity = Number(order.filled_qty);
      const price = Number(order.filled_avg_price);
      const terminal = ['filled', 'canceled', 'expired', 'rejected', 'stopped'].includes(order.status);
      const observed = await prisma.executionIntent.updateMany({ where: { id: intent.id, status: { not: 'RECORDED' } }, data: {
        brokerOrderId: order.id, lastBrokerState: JSON.parse(JSON.stringify(order)),
        status: order.status === 'partially_filled' ? 'PARTIALLY_FILLED' : 'SUBMITTED',
      } });
      if (observed.count !== 1) continue;
      if (terminal && Number.isFinite(quantity) && quantity > 0) {
        if (!Number.isFinite(price) || price <= 0 || quantity > intent.quantity + 1e-6) throw new Error('Recovery fill is invalid or exceeds submitted quantity');
        const decision = await prisma.agentDecision.findUnique({ where: { id: intent.decisionId } });
        const plan = executionPlanSchema.parse(intent.executionPlan);
        if (!decision || decision.asset !== intent.asset || !plan || plan.direction !== intent.direction
          || plan.mode !== intent.mode || plan.market !== intent.market) throw new Error('Recovery decision identity mismatch');
        const signal: TradeSignal = {
          asset: intent.asset, market: intent.market as TradeSignal['market'], direction: intent.direction as TradeSignal['direction'],
          agentDecisionId: intent.decisionId, confidence: plan.confidence, entryPrice: plan.entryPrice,
          stopLossPrice: plan.stopLossPrice, takeProfitPrice: plan.takeProfitPrice,
          positionSizePct: plan.positionSizePct, reasoning: 'Recovered confirmed broker fill',
        };
        await recordConfirmedExecution(signal, intent.id, { orderId: order.id, fees: 0 }, price, quantity,
          order.status === 'filled' ? intent.protection : 'APPLICATION_MONITORED');
      } else if (terminal && quantity === 0) {
        await prisma.executionIntent.update({ where: { id: intent.id }, data: { status: 'TERMINAL_UNFILLED', error: `Broker terminal status: ${order.status}` } });
      }
    } catch (error: any) {
      await prisma.executionIntent.updateMany({ where: { id: intent.id, status: { not: 'RECORDED' } }, data: { status: 'RECONCILIATION_REQUIRED', error: error?.message || 'Recovery unavailable' } }).catch(() => {});
      logger.error('[EXEC] Intent reconciliation unavailable', { intentId: intent.id, error: error?.message });
    }
  }
}

/**
 * markToMarketOpenPositions — run every 5 min from scheduler.
 * Updates unrealized P&L on all open trades and triggers SL/TP closes.
 */
export async function markToMarketOpenPositions(): Promise<void> {
  const scope = await getVerifiedAccountScope();
  const openTrades = await prisma.trade.findMany({
    where: { status: 'OPEN', accountId: scope.accountId, brokerMode: scope.mode, positionId: { not: null } },
  });

  if (openTrades.length === 0) return;

  logger.info(`[MTM] Marking ${openTrades.length} open trade(s) to market`);

  for (const trade of openTrades) {
    try {
      const currentPrice = await fetchCurrentPrice(trade.asset);
      if (!currentPrice || currentPrice <= 0) {
        // Never skip silently: with no price this monitor cannot enforce
        // the trade's stop/target — flag the position + alert (crypto has
        // no broker bracket to fall back on; see flagProtectionUnknown).
        await flagProtectionUnknown(trade.positionId, trade.asset, 'markToMarketOpenPositions');
        continue;
      }

      const remainingQuantity = trade.quantity - trade.closedQuantity - (trade.feeQuantity ?? 0);
      const pnl = trade.type === 'BUY'
        ? (currentPrice - trade.entryPrice) * remainingQuantity
        : (trade.entryPrice - currentPrice) * remainingQuantity;

      const pnlPct = trade.type === 'BUY'
        ? (currentPrice - trade.entryPrice) / trade.entryPrice * 100
        : (trade.entryPrice - currentPrice) / trade.entryPrice * 100;

      await prisma.trade.update({
        where: { id: trade.id },
        data: { unrealizedPnl: pnl, unrealizedPnlPct: pnlPct },
      });

      // Trigger stop-loss / take-profit
      const sl = trade.stopLossPrice;
      const tp = trade.takeProfitPrice;

      const hitSL = sl && (trade.type === 'BUY' ? currentPrice <= sl : currentPrice >= sl);
      const hitTP = tp && (trade.type === 'BUY' ? currentPrice >= tp : currentPrice <= tp);

      if (hitSL) {
        await closeTrade(trade.id, currentPrice, 'STOP_LOSS');
        logger.warn(`[MTM] 🛑 SL triggered: ${trade.asset} @ $${currentPrice.toFixed(2)}`);
      } else if (hitTP) {
        await closeTrade(trade.id, currentPrice, 'TAKE_PROFIT');
        logger.info(`[MTM] 🎯 TP triggered: ${trade.asset} @ $${currentPrice.toFixed(2)}`);
      }

    } catch (err: any) {
      logger.error(`[MTM] Error for ${trade.asset}: ${err?.message}`);
    }
  }
}

/**
 * Re-anchor a signal's protection levels to an actual fill price. The debate
 * engine computes stopLossPrice/takeProfitPrice from a pre-trade snapshot;
 * by the time the broker fills, the market may have moved through them (a
 * stored take-profit below the fill is already passed and can never pay).
 * The intended percentage distances are preserved exactly and recomputed
 * from the fill, so for a long the stop is always below and the target
 * always above the price the position actually opened at. Degenerate
 * inputs (no usable signal entry or levels) pass the signal levels through
 * unchanged — inventing levels would be worse than keeping them.
 */
export function reanchorProtectionToFill(
  signal: { entryPrice: number; stopLossPrice: number; takeProfitPrice: number },
  fillPrice: number,
): { stopLossPrice: number; takeProfitPrice: number } {
  const entry = signal.entryPrice;
  const sl = signal.stopLossPrice;
  const tp = signal.takeProfitPrice;
  if (!(entry > 0) || !(fillPrice > 0) || !(sl > 0) || !(tp > 0) || sl === entry || tp === entry) {
    return { stopLossPrice: sl, takeProfitPrice: tp };
  }
  const stopPct = Math.abs(entry - sl) / entry;
  const takePct = Math.abs(tp - entry) / entry;
  return tp > entry
    ? { stopLossPrice: fillPrice * (1 - stopPct), takeProfitPrice: fillPrice * (1 + takePct) }
    : { stopLossPrice: fillPrice * (1 + stopPct), takeProfitPrice: fillPrice * (1 - takePct) };
}

export async function recordConfirmedExecution(signal: TradeSignal, intentId: string, order: { orderId?: string; fees?: number }, fillPrice: number, quantity: number, protection: string): Promise<void> {
  const { asset, market, direction, agentDecisionId } = signal;
  if (direction !== 'BUY' && direction !== 'SELL') throw new Error('Cannot record a non-trading direction');
  // Set inside the transaction only on the path that actually records the
  // fill; emitted after commit below (never for an already-RECORDED replay).
  let recorded: TradeExecutedPayload | null = null;
  await prisma.$transaction(async tx => {
    const intent = await tx.executionIntent.findUnique({ where: { id: intentId } });
    if (!intent?.accountId || !intent.mode) throw new Error('Fill account identity missing');
    if (intent.status === 'RECORDED') return;
    const claimed = await tx.executionIntent.updateMany({ where: { id: intentId,
      status: { in: ['SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'] } }, data: { status: 'RECORDING' } });
    if (claimed.count !== 1) return;
    const scopeKey = positionScopeKey(intent.accountId, intent.mode, asset);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeKey}))`;
    const existing = await tx.position.findUnique({ where: { scopeKey } });
    if (existing?.status === 'OPEN' && existing.side !== direction) throw new Error('Opposing fill needs lot reconciliation');
    const priorQty = existing?.status === 'OPEN' && existing.pendingEntryIntentId !== intentId ? existing.quantity : 0;
    const aggregateQuantity = priorQty + quantity;
    const aggregatePrice = (priorQty * (existing?.entryPrice ?? 0) + quantity * fillPrice) / aggregateQuantity;
    // Protection levels are stored against the price each row actually
    // opened at: this fill for the new trade and a fresh position, the
    // position's resulting average entry when adding to an existing one.
    const fillProtection = reanchorProtectionToFill(signal, fillPrice);
    const positionProtection = priorQty > 0 ? reanchorProtectionToFill(signal, aggregatePrice) : fillProtection;
    const position = await tx.position.upsert({ where: { scopeKey },
      create: { scopeKey, accountId: intent.accountId, brokerMode: intent.mode, asset, market,
        side: direction, entryPrice: fillPrice, currentPrice: fillPrice, quantity,
        status: 'OPEN', accountingStatus: 'RECONCILED', accountingError: null,
        brokerObservedQuantity: quantity, protectionStatus: protection, stopLossPrice: fillProtection.stopLossPrice,
        takeProfitPrice: fillProtection.takeProfitPrice, openedAt: new Date() },
      update: { side: direction, entryPrice: aggregatePrice, currentPrice: fillPrice, quantity: aggregateQuantity,
        status: 'OPEN', accountingStatus: 'RECONCILED', accountingError: null, evidenceVersion: { increment: 1 },
        pendingEntryIntentId: null, brokerObservedQuantity: aggregateQuantity, protectionStatus: protection, stopLossPrice: positionProtection.stopLossPrice,
        takeProfitPrice: positionProtection.takeProfitPrice, ...(priorQty === 0 ? { openedAt: new Date() } : {}) },
    });
    const createdTrade = await tx.trade.create({ data: { asset, market, type: direction, status: 'OPEN',
      entryPrice: fillPrice, quantity, fees: order.fees ?? 0, brokerOrderId: order.orderId,
      brokerConfirmed: true, accountId: intent.accountId, brokerMode: intent.mode, positionId: position.id,
      agentDecisionId, stopLossPrice: fillProtection.stopLossPrice, takeProfitPrice: fillProtection.takeProfitPrice,
      metadata: { lane: (intent.executionPlan as any)?.lane ?? 'COUNCIL' }, openedAt: new Date() } });
    await tx.agentDecision.update({ where: { id: agentDecisionId }, data: { executed: true,
      executionReason: `${direction} ${quantity.toFixed(4)} ${asset} @ $${fillPrice.toFixed(2)} | Order: ${order.orderId} | ${intent.mode.toUpperCase()}` } });
    await tx.executionIntent.update({ where: { id: intentId }, data: { status: 'RECORDED', fillPrice, fillQuantity: quantity, error: null } });
    recorded = {
      trade: { id: createdTrade.id, asset, type: direction, quantity, entryPrice: fillPrice },
      mode: intent.mode,
      accountId: intent.accountId,
    };
  });
  // Normalized `trade:executed` contract event (websocket/socketEvents.ts):
  // the dashboard toast + recent-trades store and the AgentMonitor feed both
  // consume exactly this shape. Emitted only after the recording transaction
  // commits, so a rolled-back or replayed recording never announces a trade.
  if (recorded) emitContractEvent('trade:executed', recorded);
}
