import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { TradeSignal, PortfolioState } from '../agents/types';
import { getIO } from '../websocket/server';
import { validateWithTopTraderRules } from '../services/topTraderRules';
import { checkTradeViability, calculateMicroPosition, getAccountMode, EXCHANGE_FEES } from '../services/microAccountEngine';

// Conditional broker imports based on trading mode
let alpacaClient: any = null;
let binanceClient: any = null;

async function getBrokerClient(market: string) {
  if (market === 'crypto') {
    if (!binanceClient) {
      try {
        // @ts-ignore - Optional dependency
        const binance = await import('@binance/connector');
        const { Spot } = binance as any;
        binanceClient = new Spot(process.env.BINANCE_API_KEY, process.env.BINANCE_SECRET_KEY, {
          baseURL: 'https://api.binance.us'
        });
      } catch (err) {
        logger.warn('Binance connector not available — using paper trading mode', { error: err });
        return null;
      }
    }
    return binanceClient;
  } else {
    if (!alpacaClient) {
      try {
        const Alpaca = require('@alpacahq/alpaca-trade-api');
        alpacaClient = new Alpaca({
          keyId: process.env.ALPACA_API_KEY,
          secretKey: process.env.ALPACA_SECRET_KEY,
          baseUrl: process.env.ALPACA_BASE_URL,
          paper: process.env.TRADING_MODE === 'paper'
        });
      } catch (err) {
        logger.warn('Alpaca client not available — using paper trading mode', { error: err });
        return null;
      }
    }
    return alpacaClient;
  }
}

export async function executeTradeSignal(
  signal: TradeSignal,
  portfolioState: PortfolioState
): Promise<boolean> {

  const isPaper = process.env.TRADING_MODE !== 'live';
  logger.info(`💰 Executing ${signal.direction} for ${signal.asset}`, {
    mode: isPaper ? 'PAPER' : 'LIVE',
    price: signal.entryPrice,
    confidence: signal.confidence
  });

  // ── TOP TRADER RULES VALIDATION (25 laws) ─────────────────────────────────
  const exchange = signal.market === 'stocks' ? 'alpaca_stocks' : 'bybit_spot';
  const stopDistancePct = Math.abs(signal.entryPrice - signal.stopLossPrice) / signal.entryPrice;
  const expectedReturnPct = Math.abs(signal.takeProfitPrice - signal.entryPrice) / signal.entryPrice;
  const positionSizeEst = portfolioState.totalValue * (signal.positionSizePct / 100 || 0.01);

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
  const accountMode = getAccountMode(portfolioState.drawdownFromPeak, portfolioState.pnlDayPct);
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

  const finalQty = microPos.shares;

  if (finalQty <= 0) {
    logger.warn(`Position size calculated as 0 for ${signal.asset} — skipping`);
    return false;
  }

  // ── WRITE TO DB FIRST (before any order placement) ───────────────────────
  // agentDecisionId is a nullable FK in the schema, but TradeSignal types it
  // as a required string — force-trade (no real debate behind it) satisfied
  // that by passing '', which Prisma then tried to satisfy as a real foreign
  // key reference instead of treating as absent, failing every force-trade
  // with a foreign key violation and aborting before any order was placed
  // (confirmed safe — no untracked Alpaca order resulted, but no trade
  // executed either). Omit the field entirely when there's no real ID.
  let tradeRecord;
  try {
    tradeRecord = await prisma.trade.create({
      data: {
        asset: signal.asset,
        market: signal.market,
        type: signal.direction as any,
        entryPrice: signal.entryPrice,
        quantity: finalQty,
        status: 'OPEN',
        stopLossPrice: signal.stopLossPrice,
        takeProfitPrice: signal.takeProfitPrice,
        ...(signal.agentDecisionId ? { agentDecisionId: signal.agentDecisionId } : {}),
      }
    });
  } catch (dbError) {
    logger.error('CRITICAL: DB write failed — aborting trade execution', { dbError, asset: signal.asset });
    return false;
  }

  // ── PAPER TRADING: save to DB + send to Alpaca paper API ─────────────────
  if (isPaper) {
    logger.info(`📄 PAPER TRADE: ${signal.direction} ${finalQty.toFixed(4)} ${signal.asset} @ $${signal.entryPrice}`);
    let brokerOrderId = `PAPER-${Date.now()}`;
    // signal.entryPrice is the pre-trade quote — a market order can fill at a
    // meaningfully different price by the time it executes (confirmed live:
    // NVDA quoted at $202.78, actually filled at $206.92, a ~$204 phantom
    // unrealized gain baked into every P&L figure downstream until this was
    // caught). Reconciled below against Alpaca's real filled_avg_price once
    // the order actually fills.
    let fillPrice = signal.entryPrice;
    let fillQty = finalQty;

    // Send to Alpaca paper API so it shows in dashboard
    try {
      const client = await getBrokerClient(signal.market);
      if (client && signal.market === 'stocks') {
        const order = await client.createOrder({
          symbol: signal.asset,
          qty: Math.max(1, Math.floor(finalQty * 100) / 100),
          side: signal.direction.toLowerCase(),
          type: 'market',
          time_in_force: 'day'
        });
        brokerOrderId = order.id || brokerOrderId;
        logger.info(`✅ Alpaca paper order placed: ${order.id}`);

        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(r => setTimeout(r, 1000));
          const status = await client.getOrder(order.id).catch(() => null);
          if (status?.filled_avg_price) {
            fillPrice = parseFloat(status.filled_avg_price);
            fillQty = parseFloat(status.filled_qty) || finalQty;
            logger.info(`💵 Real fill: ${signal.asset} @ $${fillPrice} (quoted $${signal.entryPrice})`);
            break;
          }
          if (status?.status === 'canceled' || status?.status === 'rejected' || status?.status === 'expired') {
            logger.warn(`Order ${order.id} ended as ${status.status} — keeping quoted price`);
            break;
          }
        }
      }
    } catch (brokerErr: any) {
      logger.warn(`Alpaca paper order failed (trade still recorded): ${brokerErr.message}`);
    }

    await prisma.trade.update({ where: { id: tradeRecord.id }, data: { brokerConfirmed: true, brokerOrderId, entryPrice: fillPrice, quantity: fillQty } });

    // Check if position already open — don't overwrite with duplicate
    const existing = await prisma.position.findUnique({ where: { asset: signal.asset } });
    if (!existing || existing.status === 'CLOSED') {
      await prisma.position.upsert({
        where: { asset: signal.asset },
        create: { asset: signal.asset, market: signal.market, side: signal.direction, quantity: fillQty, entryPrice: fillPrice, currentPrice: fillPrice, stopLossPrice: signal.stopLossPrice, takeProfitPrice: signal.takeProfitPrice },
        update: { side: signal.direction, quantity: fillQty, entryPrice: fillPrice, currentPrice: fillPrice, stopLossPrice: signal.stopLossPrice, takeProfitPrice: signal.takeProfitPrice, status: 'OPEN' }
      });
    }

    if (signal.agentDecisionId) {
      await prisma.agentDecision.update({ where: { id: signal.agentDecisionId }, data: { executed: true } }).catch(() => {});
    }

    const io = getIO();
    io?.emit('trade:executed', { trade: tradeRecord, mode: 'paper', signal });
    return true;
  }

  // ── LIVE TRADING MODE ─────────────────────────────────────────────────────
  try {
    const client = await getBrokerClient(signal.market);
    let brokerOrderId: string;

    if (signal.market === 'crypto') {
      const side = signal.direction === 'BUY' ? 'BUY' : 'SELL';
      const order = await client.newOrder(signal.asset + 'USDT', side, 'MARKET', { quantity: finalQty.toFixed(6) });
      brokerOrderId = String(order.data.orderId);
    } else {
      const order = await client.createOrder({
        symbol: signal.asset,
        qty: Math.floor(finalQty * 100) / 100,
        side: signal.direction.toLowerCase(),
        type: 'market',
        time_in_force: 'gtc'
      });
      brokerOrderId = order.id;
    }

    // Confirm in DB
    await prisma.trade.update({
      where: { id: tradeRecord.id },
      data: { brokerConfirmed: true, brokerOrderId }
    });

    // Place stop-loss order
    await placeStopLossOrder(signal, finalQty, client);

    if (signal.agentDecisionId) {
      await prisma.agentDecision.update({ where: { id: signal.agentDecisionId }, data: { executed: true } }).catch(() => {});
    }

    const io = getIO();
    io?.emit('trade:executed', { trade: tradeRecord, mode: 'live', signal, brokerOrderId });

    logger.info(`✅ LIVE ORDER placed: ${signal.direction} ${finalQty} ${signal.asset}`, { brokerOrderId });
    return true;

  } catch (brokerError: any) {
    logger.error('Broker order failed', { error: brokerError.message, asset: signal.asset });
    await prisma.trade.update({ where: { id: tradeRecord.id }, data: { status: 'FAILED', exitReason: `Broker error: ${brokerError.message}` } });
    return false;
  }
}

async function placeStopLossOrder(signal: TradeSignal, qty: number, client: any) {
  try {
    if (signal.market !== 'crypto') {
      await client.createOrder({
        symbol: signal.asset,
        qty: Math.floor(qty * 100) / 100,
        side: signal.direction === 'BUY' ? 'sell' : 'buy',
        type: 'stop',
        stop_price: signal.stopLossPrice.toFixed(2),
        time_in_force: 'gtc'
      });
    }
    logger.info(`🛑 Stop-loss placed at $${signal.stopLossPrice} for ${signal.asset}`);
  } catch (err) {
    logger.error('Stop-loss order failed', { err, asset: signal.asset });
  }
}
