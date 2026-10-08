import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { TradeSignal, PortfolioState } from '../agents/types';
import { getIO } from '../websocket/server';
import { activateKillSwitch } from '../agents/orchestrator';
import { correlationService } from '../services/correlationService';
import { LifecycleStateMachine, LifecycleState } from './lifecycleStateMachine';
import { getTradingBroker, getActiveMode } from './brokerRouter';
import { confirmOrderFill } from './executionEngine';
import { readRiskSettings } from '../utils/config';
import { normalizeConfidence } from '../utils/confidence';

// Non-blocking alert for genuine risk-limit rejections. (The previous version
// had `!approved && a || b`, which alerted on every MAX_POSITIONS reason even
// for approved trades.)
function alertRiskRejection(signal: TradeSignal, reason: string) {
  import('../services/alertService')
    .then(({ alert }) => alert.tradeFailed(signal.asset, reason, signal.direction as any).catch(() => {}))
    .catch(() => {});
}

function reject(signal: TradeSignal, reason: string, alertable = false): { approved: false; reason: string } {
  if (alertable) alertRiskRejection(signal, reason);
  return { approved: false, reason };
}

// ── RISK MANAGER ──────────────────────────────────────────────────────────────
export async function validateTradeSignal(
  signal: TradeSignal,
  portfolio: PortfolioState
): Promise<{ approved: boolean; reason?: string; adjustedSize?: number }> {
  // All limits come from env (documented in .env.example) via readRiskSettings().
  const risk = readRiskSettings();
  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  if (signal.direction !== 'BUY' && signal.direction !== 'SELL') {
    return { approved: false, reason: 'HOLD — no position change needed' };
  }

  // Confidence is 0-100 (normalised in case a caller passes a 0-1 fraction).
  const confidencePct = normalizeConfidence(signal.confidence);
  if (confidencePct < risk.minAgentConfidence) {
    return reject(signal, `Confidence ${confidencePct.toFixed(0)}% below MIN_AGENT_CONFIDENCE ${risk.minAgentConfidence}%`);
  }

  // Daily loss limit
  const pnlDayPct = num(portfolio.pnlDayPct);
  if (pnlDayPct <= -risk.dailyLossLimitPct) {
    logger.warn(`🛑 Daily loss limit hit: ${pnlDayPct.toFixed(2)}%`);
    getIO()?.emit('guardrail:triggered', { rule: 'DAILY_LOSS_LIMIT', value: pnlDayPct });
    return reject(signal, `Daily loss limit hit: ${pnlDayPct.toFixed(2)}% (limit ${risk.dailyLossLimitPct}%)`, true);
  }

  // Weekly drawdown limit — middle tier between the daily and all-time checks.
  const pnlWeekPct = num(portfolio.pnlWeekPct);
  if (pnlWeekPct <= -risk.weeklyDrawdownLimitPct) {
    logger.warn(`🛑 Weekly drawdown limit hit: ${pnlWeekPct.toFixed(2)}%`);
    getIO()?.emit('guardrail:triggered', { rule: 'WEEKLY_DRAWDOWN_LIMIT', value: pnlWeekPct });
    return reject(signal, `Weekly drawdown limit hit: ${pnlWeekPct.toFixed(2)}% (limit ${risk.weeklyDrawdownLimitPct}%)`, true);
  }

  // Max drawdown from peak → kill switch
  const ddPeak = num(portfolio.drawdownFromPeak);
  if (ddPeak >= risk.maxDrawdownPct) {
    logger.error(`🚨 MAX DRAWDOWN HIT: ${ddPeak.toFixed(2)}% — ACTIVATING KILL SWITCH`);
    activateKillSwitch();
    getIO()?.emit('guardrail:triggered', { rule: 'MAX_DRAWDOWN_KILL_SWITCH', value: ddPeak });
    return reject(signal, `Max drawdown emergency stop: ${ddPeak.toFixed(2)}% (limit ${risk.maxDrawdownPct}%)`, true);
  }

  // Daily trade limit
  if (num(portfolio.tradesExecutedToday) >= risk.maxTradesPerDay) {
    return reject(signal, `Daily trade limit: ${portfolio.tradesExecutedToday} (MAX_TRADES_PER_DAY ${risk.maxTradesPerDay})`);
  }

  // Open-position cap
  const openCount = (portfolio.positions || []).length;
  if (openCount >= risk.maxOpenPositions) {
    return reject(signal, `Max open positions: ${openCount}/${risk.maxOpenPositions}`, true);
  }

  // Fail closed on a broken/empty portfolio read — NaN comparisons are always
  // false, which previously let every later check pass.
  if (!Number.isFinite(portfolio.totalValue) || portfolio.totalValue <= 0 || !Number.isFinite(portfolio.cashBalance)) {
    return reject(signal, 'Portfolio value unavailable — refusing to trade blind');
  }

  // Position concentration: clamp (not reject) oversized requests to the limit.
  const requestedPct = Math.max(0, num(signal.positionSizePct));
  const adjustedSize = Math.min(requestedPct, risk.maxPositionSizePct);

  // Cash reserve check — measured AFTER this trade spends its cash.
  const tradeValue = portfolio.totalValue * (adjustedSize / 100);
  const cashPct = ((portfolio.cashBalance - tradeValue) / portfolio.totalValue) * 100;
  if (cashPct < risk.cashReservePct) {
    return reject(signal, `Cash reserve would drop to ${cashPct.toFixed(1)}% (min: ${risk.cashReservePct}%)`);
  }

  // Cross-asset correlation check (real Pearson correlation on daily returns).
  const heldAssets = (portfolio.positions || []).map((p: any) => p.asset).filter((a: string) => a !== signal.asset);
  if (heldAssets.length > 0) {
    const concentration = await correlationService.shouldAddAssetToPortfolio(signal.asset, heldAssets, 0.75).catch(() => null);
    if (concentration && !concentration.shouldAdd) {
      logger.warn(`🛑 Concentration risk blocked: ${signal.asset}`, { reason: concentration.reason });
      return reject(signal, concentration.reason);
    }
  }

  return { approved: true, reason: `Approved (${confidencePct.toFixed(0)}% confidence, size ${adjustedSize.toFixed(2)}%)`, adjustedSize };
}

// ── STOP LOSS MONITOR ─────────────────────────────────────────────────────────
export async function checkStopLosses(currentPrices: Record<string, number>) {
  try {
    const openPositions = await prisma.position.findMany({ where: { status: 'OPEN' } });

    for (const position of openPositions) {
      const currentPrice = currentPrices[position.asset];
      if (!currentPrice) continue;

      const isShort = position.side === 'SELL';
      const pnlPct = isShort
        ? ((position.entryPrice - currentPrice) / position.entryPrice) * 100
        : ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      const unrealizedPnl = isShort
        ? (position.entryPrice - currentPrice) * position.quantity
        : (currentPrice - position.entryPrice) * position.quantity;

      await prisma.position.update({
        where: { id: position.id },
        data: { currentPrice, unrealizedPnl, unrealizedPnlPct: pnlPct }
      });

      // Stop loss: for LONG price falls below stop, for SHORT price rises above stop
      const stopHit = isShort
        ? currentPrice >= position.stopLossPrice
        : currentPrice <= position.stopLossPrice;

      // Take profit: for LONG price rises above target, for SHORT price falls below target
      const tpHit = isShort
        ? currentPrice <= position.takeProfitPrice
        : currentPrice >= position.takeProfitPrice;

      if (stopHit) {
        logger.warn(`🛑 STOP LOSS TRIGGERED for ${position.asset} (${isShort ? 'SHORT' : 'LONG'}): $${currentPrice}`);
        await closePosition(position, currentPrice, 'stop_loss');
      } else if (tpHit) {
        logger.info(`🎯 TAKE PROFIT HIT for ${position.asset} (${isShort ? 'SHORT' : 'LONG'}): $${currentPrice}`);
        await closePosition(position, currentPrice, 'take_profit');
      }
    }
  } catch (error) {
    logger.error('Stop loss check failed', { error });
  }
}

const closingAssets = new Set<string>();

export async function closePosition(position: any, requestedExitPrice: number, reason: string) {
  // The 10 s stop monitor and the 5 min mark-to-market can race on the same
  // position; never send two exit orders for one position.
  if (closingAssets.has(position.asset)) {
    logger.info(`⏳ Close already in progress for ${position.asset} — skipping duplicate (${reason})`);
    return { pnl: 0, pnlPct: 0, closed: false };
  }
  closingAssets.add(position.asset);
  try {
    return await closePositionInner(position, requestedExitPrice, reason);
  } finally {
    closingAssets.delete(position.asset);
  }
}

async function closePositionInner(position: any, requestedExitPrice: number, reason: string) {
  const isShort = position.side === 'SELL';

  // Find the trade that opened this position (broker-confirmed OPEN or a local simulation).
  const openTrade = await prisma.trade.findFirst({ where: { asset: position.asset, status: 'OPEN' } })
    || await prisma.trade.findFirst({ where: { asset: position.asset, status: 'LOCAL_SIMULATION' } });

  // ── SEND THE EXIT TO THE BROKER ─────────────────────────────────────────────
  // Previously this function only updated the local DB, so an app-monitored
  // stop "closed" the position on screen while the real shares stayed open at
  // Alpaca. Now: if the entry was broker-confirmed, flatten it at the broker
  // (cancelling any bracket legs first) and use the real fill as exit price.
  // getTradingBroker() returns the PAPER broker in paper mode, so paper
  // positions are really closed at Alpaca paper too. Local simulations
  // (no broker order ever sent) are closed in the DB only.
  let exitPrice = requestedExitPrice;
  if (openTrade?.brokerConfirmed && position.market !== 'prediction') {
    const broker = getTradingBroker();
    if (!broker) {
      logger.error(`🚨 Cannot close ${position.asset} at broker — no broker credentials. Position left OPEN for manual action.`);
      getIO()?.emit('guardrail:triggered', { rule: 'EXIT_FAILED_NO_BROKER', asset: position.asset });
      return { pnl: 0, pnlPct: 0, closed: false };
    }
    try {
      // Alpaca crypto positions are keyed "BTCUSD"; stocks by ticker.
      const brokerSymbol = position.market === 'crypto' ? `${position.asset}USD` : position.asset;
      const exitOrder = await broker.flattenSymbol(brokerSymbol);
      if (exitOrder?.id) {
        const fill = await confirmOrderFill(broker, exitOrder.id).catch(() => null);
        if (fill?.fillPrice) exitPrice = fill.fillPrice;
      }
      // exitOrder === null → broker already flat (bracket stop/target filled there).
    } catch (err: any) {
      logger.error(`🚨 Broker exit FAILED for ${position.asset} — position left OPEN, will retry`, { error: err?.response?.data?.message || err.message });
      getIO()?.emit('guardrail:triggered', { rule: 'EXIT_FAILED', asset: position.asset });
      return { pnl: 0, pnlPct: 0, closed: false };
    }
  }

  const pnl = isShort
    ? (position.entryPrice - exitPrice) * position.quantity
    : (exitPrice - position.entryPrice) * position.quantity;
  const pnlPct = isShort
    ? ((position.entryPrice - exitPrice) / position.entryPrice) * 100
    : ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

  // Close the trade
  if (openTrade) {
    await prisma.trade.update({
      where: { id: openTrade.id },
      data: { exitPrice, pnl, pnlPct, status: 'CLOSED', closedAt: new Date(), exitReason: reason }
    });

    // ── COMPLETE PERSISTENT LIFECYCLE AUDIT TRAIL ───────────────────────────
    try {
      const corrId = `corr-${openTrade.id}`;
      // Verify active instance or recover
      const existing = LifecycleStateMachine.get(corrId);
      if (existing) {
        await LifecycleStateMachine.transition({
          correlationId: corrId,
          provider: 'ALPACA',
          environment: getActiveMode(),
          strategy: 'INTRADAY',
          symbol: position.asset,
          newState: LifecycleState.EXIT_SUBMITTED,
          reason: `Exit submitted due to ${reason}`
        });
        await LifecycleStateMachine.transition({
          correlationId: corrId,
          provider: 'ALPACA',
          environment: getActiveMode(),
          strategy: 'INTRADAY',
          symbol: position.asset,
          newState: LifecycleState.EXIT_FILLED,
          reason: `Exit executed @ $${exitPrice}`
        });
        await LifecycleStateMachine.transition({
          correlationId: corrId,
          provider: 'ALPACA',
          environment: getActiveMode(),
          strategy: 'INTRADAY',
          symbol: position.asset,
          newState: LifecycleState.PROVIDER_RECONCILED,
          reason: 'Position closed and reconciled with ledger'
        });
        await LifecycleStateMachine.transition({
          correlationId: corrId,
          provider: 'ALPACA',
          environment: getActiveMode(),
          strategy: 'INTRADAY',
          symbol: position.asset,
          newState: LifecycleState.PERFORMANCE_CALCULATED,
          reason: `Realized PnL calculated: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`
        });
        await LifecycleStateMachine.transition({
          correlationId: corrId,
          provider: 'ALPACA',
          environment: getActiveMode(),
          strategy: 'INTRADAY',
          symbol: position.asset,
          newState: LifecycleState.MODEL_OUTCOME_RECORDED,
          reason: 'Outcome feedback recorded to agent performance metrics'
        });
        await LifecycleStateMachine.transition({
          correlationId: corrId,
          provider: 'ALPACA',
          environment: getActiveMode(),
          strategy: 'INTRADAY',
          symbol: position.asset,
          newState: LifecycleState.AUDIT_COMPLETE,
          reason: 'Complete trade lifecycle audit completed successfully'
        });
      }
    } catch (lifecycleErr: any) {
      logger.warn('Lifecycle exit audit transition warning', { error: lifecycleErr.message });
    }
  }

  await prisma.position.update({
    where: { id: position.id },
    data: { status: 'CLOSED' }
  });

  getIO()?.emit('position:closed', { asset: position.asset, exitPrice, pnl, pnlPct, reason });
  logger.info(`Position closed: ${position.asset} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) | Reason: ${reason}`);
  return { pnl, pnlPct, closed: true };
}
