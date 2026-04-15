import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { TradeSignal, PortfolioState } from '../agents/types';
import { getIO } from '../websocket/server';

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

  // ── CALCULATE POSITION SIZE ───────────────────────────────────────────────
  const maxRiskPct = parseFloat(process.env.MAX_RISK_PER_TRADE_PCT || '1') / 100;
  const riskAmount = portfolioState.totalValue * maxRiskPct;
  const stopDistance = Math.abs(signal.entryPrice - signal.stopLossPrice);
  const sharesOrCoins = stopDistance > 0 ? riskAmount / stopDistance : 0;

  // Additional cap: never more than maxPositionSizePct of portfolio
  const maxPositionPct = parseFloat(process.env.MAX_POSITION_SIZE_PCT || '10') / 100;
  const maxPositionValue = portfolioState.totalValue * maxPositionPct;
  const maxShares = maxPositionValue / signal.entryPrice;
  const finalQty = Math.min(sharesOrCoins, maxShares);

  if (finalQty <= 0) {
    logger.warn(`Position size calculated as 0 for ${signal.asset} — skipping`);
    return false;
  }

  // ── WRITE TO DB FIRST (before any order placement) ───────────────────────
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
        agentDecisionId: signal.agentDecisionId,
      }
    });
  } catch (dbError) {
    logger.error('CRITICAL: DB write failed — aborting trade execution', { dbError, asset: signal.asset });
    return false;
  }

  // ── PAPER TRADING MODE ────────────────────────────────────────────────────
  if (isPaper) {
    logger.info(`📄 PAPER TRADE executed: ${signal.direction} ${finalQty.toFixed(6)} ${signal.asset} @ $${signal.entryPrice}`);
    await prisma.trade.update({ where: { id: tradeRecord.id }, data: { brokerConfirmed: true, brokerOrderId: `PAPER-${Date.now()}` } });
    await prisma.position.upsert({
      where: { asset: signal.asset },
      create: { asset: signal.asset, market: signal.market, quantity: finalQty, entryPrice: signal.entryPrice, currentPrice: signal.entryPrice, stopLossPrice: signal.stopLossPrice, takeProfitPrice: signal.takeProfitPrice },
      update: { quantity: finalQty, entryPrice: signal.entryPrice, currentPrice: signal.entryPrice, stopLossPrice: signal.stopLossPrice, takeProfitPrice: signal.takeProfitPrice }
    });
    await prisma.agentDecision.update({ where: { id: signal.agentDecisionId }, data: { executed: true } });

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

    await prisma.agentDecision.update({ where: { id: signal.agentDecisionId }, data: { executed: true } });

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
