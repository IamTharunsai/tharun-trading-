import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { TradeSignal, PortfolioState } from '../agents/types';
import { validateWithTopTraderRules } from '../services/topTraderRules';
import { checkTradeViability, calculateMicroPosition, getAccountMode, EXCHANGE_FEES } from '../services/microAccountEngine';
import { createAlpacaBroker } from '../services/alpacaBroker';
import { resolveSurvivalPolicy } from '../services/survivalEngine';
import { isKillSwitchActive } from '../agents/orchestrator';
import { assertPaperTrading } from './paperConfig';
import { executionQuantity } from './orderSizing';
import { stockEntryWindow } from './marketSession';
import { applyEntryObservation, entryClientId, reconcilePaperEntry } from './paperOrderLifecycle';

// Polls a just-placed Alpaca order until it reaches the terminal 'filled'
// status, then returns the REAL fill price/qty — never the pre-trade quote.
// Must check status === 'filled' specifically, not just a truthy
// filled_avg_price: Alpaca populates that field as soon as ANY shares fill,
// while status stays 'partially_filled' until the rest finishes working.
// Trusting the first partial fill would record e.g. 10-of-100 shares as the
// whole (closed) position, leaving the other 90 live on Alpaca's book with
// nothing tracking them locally. If the order never reaches 'filled' within
// this window, throws rather than falling back to the stale quote — used to
// be the exact root cause of a ~$204 phantom unrealized gain on a real NVDA
// position, and (separately) a $1,060 fully-fabricated profit on an SDOT
// order that Alpaca had actually rejected.
export async function confirmOrderFill(client: any, orderId: string, attempts = 5, pollIntervalMs = 1000): Promise<{ fillPrice: number; fillQty: number }> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const status = await client.getOrder(orderId).catch(() => null);
    if (status?.status === 'filled' && status.filled_avg_price) {
      const fillPrice = Number(status.filled_avg_price);
      const fillQty = Number(status.filled_qty);
      if (!Number.isFinite(fillPrice) || fillPrice <= 0 || !Number.isFinite(fillQty) || fillQty <= 0) {
        throw new Error('Broker returned invalid fill price or quantity');
      }
      return { fillPrice, fillQty };
    }
    if (status?.status === 'canceled' || status?.status === 'rejected' || status?.status === 'expired') {
      throw new Error(`Order ended as ${status.status}`);
    }
  }
  throw new Error('Order did not reach a confirmed fill within the poll window — not tracking an unconfirmed quantity/price as real');
}


const executingAssets = new Set<string>();

export async function executeTradeSignal(signal: TradeSignal, portfolioState: PortfolioState): Promise<boolean> {
  assertPaperTrading();
  if (isKillSwitchActive() || executingAssets.has(signal.asset)) return false;
  executingAssets.add(signal.asset);
  try { return await executePaperEntry(signal, portfolioState); }
  finally { executingAssets.delete(signal.asset); }
}

async function executePaperEntry(signal: TradeSignal, portfolioState: PortfolioState): Promise<boolean> {
  // ── TOP TRADER RULES VALIDATION (25 laws) ─────────────────────────────────
  const exchange = signal.market === 'stocks' ? 'alpaca_stocks' : 'bybit_spot';
  const stopDistancePct = Math.abs(signal.entryPrice - signal.stopLossPrice) / signal.entryPrice;
  const expectedReturnPct = Math.abs(signal.takeProfitPrice - signal.entryPrice) / signal.entryPrice;
  const positionSizeEst = portfolioState.totalValue * signal.positionSizePct / 100;

  const topTraderCheck = await validateWithTopTraderRules(
    signal,
    portfolioState,
    signal.confidence,
    Math.round(signal.confidence * 0.25), // estimate vote count from confidence
    25,
    exchange,
    expectedReturnPct
  );

  if (!topTraderCheck.approved) {
    logger.warn(`🚫 TOP TRADER RULES BLOCKED trade on ${signal.asset}:`);
    topTraderCheck.violations.forEach(v => logger.warn(`   ${v}`));
    return false;
  }

  // ── TRADE VIABILITY CHECK (fee analysis) ──────────────────────────────────
  const viability = checkTradeViability(
    portfolioState.totalValue,
    positionSizeEst,
    expectedReturnPct,
    stopDistancePct,
    exchange as keyof typeof EXCHANGE_FEES
  );

  if (!viability.viable) {
    logger.warn(`🚫 VIABILITY CHECK FAILED for ${signal.asset}: ${viability.reason}`);
    return false;
  }

  // ── CALCULATE POSITION SIZE (micro-account optimized) ─────────────────────
  const accountMode = getAccountMode(portfolioState.drawdownFromPeak, portfolioState.pnlDayPct, portfolioState.totalValue);
  const microPos = calculateMicroPosition(
    portfolioState.totalValue,
    signal.entryPrice,
    signal.stopLossPrice,
    exchange as keyof typeof EXCHANGE_FEES,
    signal.confidence,
    accountMode.riskMultiplier
  );

  if (!microPos.isAboveMinimum) {
    logger.warn(`🚫 Position below exchange minimum for ${signal.asset}: ${microPos.recommendation}`);
    return false;
  }

  // Never round a small fractional allocation UP to a whole share. Respect the
  // committee allocation as well as the risk-based sizing limit.
  const finalQty = executionQuantity(signal, portfolioState, microPos.shares);

  if (finalQty <= 0 || finalQty * signal.entryPrice < EXCHANGE_FEES[exchange].minOrderUSD) {
    logger.warn(`Position size calculated as 0 for ${signal.asset} — skipping`);
    return false;
  }


  const broker = signal.market === 'stocks' ? createAlpacaBroker(true) : null;
  if (signal.market === 'forex') return false; // No paper forex adapter is configured.
  if (signal.market === 'stocks') {
    if (!broker) return false;
    const [clock, asset, held] = await Promise.all([broker.getClock(), broker.getAsset(signal.asset), broker.getPosition(signal.asset)]);
    if (!stockEntryWindow(clock) || !asset.tradable || held) return false;
    if (!Number.isInteger(finalQty) && !asset.fractionable) return false;
    if (signal.direction === 'SELL' && !asset.shortable) return false;
  }

  // Serialise reservation across server processes. Pending orders consume a slot
  // and capital before any broker call; duplicate decisions cannot re-enter.
  const tradeRecord = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(784321)`;
    if (isKillSwitchActive()) return null;
    const active = await tx.trade.findMany({ where: { status: 'OPEN' } });
    if (active.some(t => t.asset === signal.asset)) return null;
    if (signal.agentDecisionId && await tx.trade.findFirst({ where: { agentDecisionId: signal.agentDecisionId } })) return null;
    const policy = resolveSurvivalPolicy({ bankroll: portfolioState.totalValue, drawdownFromPeakPct: portfolioState.drawdownFromPeak, dailyLossPct: portfolioState.pnlDayPct });
    if (active.length >= policy.maxOpenPositions) return null;
    const pendingValue = active.filter(t => !t.brokerConfirmed).reduce((s, t) => s + t.entryPrice * t.quantity, 0);
    const committedValue = active.reduce((s, t) => s + t.entryPrice * t.quantity, 0);
    const reserve = Number(process.env.CASH_RESERVE_PCT || '30') / 100;
    const cost = finalQty * signal.entryPrice;
    if (cost + pendingValue > portfolioState.cashBalance - portfolioState.totalValue * reserve + 1e-8) return null;
    if (committedValue + cost > portfolioState.totalValue * (1 - reserve) + 1e-8) return null;
    const trade = await tx.trade.create({ data: {
      asset: signal.asset, market: signal.market, type: signal.direction as 'BUY' | 'SELL',
      entryPrice: signal.entryPrice, quantity: finalQty, status: 'OPEN', brokerConfirmed: false,
      stopLossPrice: signal.stopLossPrice, takeProfitPrice: signal.takeProfitPrice,
      exitReason: 'Entry pending submission',
      ...(signal.agentDecisionId ? { agentDecisionId: signal.agentDecisionId } : {}),
    } });
    return tx.trade.update({ where: { id: trade.id }, data: { brokerOrderId: 'CLIENT:' + entryClientId(trade.id) } });
  });
  if (!tradeRecord) return false;

  if (isKillSwitchActive()) {
    await prisma.trade.update({ where: { id: tradeRecord.id }, data: { status: 'CANCELLED', exitReason: 'Kill switch activated before submission' } });
    return false;
  }

  if (!broker) {
    // Local crypto simulation is explicitly identified in the order ID.
    return applyEntryObservation(tradeRecord, {
      id: 'PAPER-' + tradeRecord.id, status: 'filled', filled_qty: finalQty,
      filled_avg_price: signal.entryPrice, symbol: signal.asset, side: signal.direction.toLowerCase(),
    });
  }

  try {
    const order = await broker.createOrder({
      symbol: signal.asset, qty: finalQty, side: signal.direction === 'BUY' ? 'buy' : 'sell',
      type: 'market', time_in_force: 'day', client_order_id: entryClientId(tradeRecord.id),
    });
    const filled = await applyEntryObservation(tradeRecord, order);
    if (filled) return true;
    return await reconcilePaperEntry({ ...tradeRecord, brokerOrderId: order.id }, broker);
  } catch (error) {
    // A timeout may have happened AFTER acceptance. Never label it failed merely
    // because the response was lost; lookup by the durable client ID first.
    try {
      const order = await broker.getOrderByClientId(entryClientId(tradeRecord.id));
      if (order) return await reconcilePaperEntry({ ...tradeRecord, brokerOrderId: order.id }, broker);
      const status = (error as any)?.response?.status;
      if ([400, 401, 403, 422].includes(status)) {
        await prisma.trade.updateMany({ where: { id: tradeRecord.id, brokerConfirmed: false, status: 'OPEN' },
          data: { status: 'FAILED', exitReason: 'Broker rejected entry (HTTP ' + status + ')' } });
      }
    } catch { /* Keep reservation when the lookup or database is unavailable. */ }
    logger.warn('Paper entry not yet confirmed', { tradeId: tradeRecord.id, error: (error as Error).message });
    return false;
  }
}
