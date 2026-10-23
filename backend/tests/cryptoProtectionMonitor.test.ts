// Wave-2 fix (audit finding 2 / 03-trading-quant §1.3): crypto positions
// have no broker bracket — this codebase's Alpaca path attaches no
// bracket/OCO/OTO order class for crypto — so TP/SL enforcement rests
// entirely on the two DB monitors. Both used to skip silently when a
// price was missing. These tests prove a missing price now fails loud
// (error log + PROTECTION_UNKNOWN position flag + operator alert), that
// the flag does not spam, and that the placement path attaches broker
// protection exactly where it is supported (equities) and never
// fabricates it for crypto.
jest.mock('../src/utils/prisma', () => ({
  prisma: {
    trade: { findMany: jest.fn(), update: jest.fn() },
    position: { findUnique: jest.fn(), update: jest.fn() },
    agentDecision: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  },
}));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false, activateKillSwitch: jest.fn() }));
jest.mock('../src/trading/positionExits', () => ({ requestPositionExit: jest.fn() }));
jest.mock('../src/trading/brokerRouter', () => ({ getActiveMode: () => 'paper', getTradingBroker: () => null }));
jest.mock('../src/trading/accountScope', () => ({
  getVerifiedAccountScope: jest.fn(async () => ({ accountId: 'acct-1', mode: 'paper', broker: {} })),
  positionScopeKey: jest.fn(() => 'scope-key'),
}));
jest.mock('../src/services/marketData', () => ({ getCurrentPrice: jest.fn(), buildMarketSnapshot: jest.fn(async () => null) }));
const systemError = jest.fn(async (..._a: any[]) => {});
jest.mock('../src/services/alertService', () => ({
  alert: {
    systemError: (...a: any[]) => systemError(...a),
    tradeFailed: jest.fn(async () => {}),
    drawdownWarning: jest.fn(async () => {}),
  },
}));

import { prisma } from '../src/utils/prisma';
import { logger } from '../src/utils/logger';
import { checkStopLosses } from '../src/trading/riskManager';
import { markToMarketOpenPositions, buildCryptoOrder, buildStockOrder } from '../src/trading/executionEngine';
import { requestPositionExit } from '../src/trading/positionExits';
import { getCurrentPrice } from '../src/services/marketData';

const P = prisma as any;
const exit = requestPositionExit as jest.Mock;
const flush = async () => { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); };

const cryptoTrade = (over: any = {}) => ({
  id: 't1', asset: 'BTC', market: 'crypto', type: 'BUY', positionId: 'p1',
  entryPrice: 100, quantity: 0.5, closedQuantity: 0, feeQuantity: 0,
  stopLossPrice: 90, takeProfitPrice: 120, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  systemError.mockClear();
  P.position.findUnique.mockResolvedValue({ status: 'OPEN', protectionStatus: 'APPLICATION_MONITORED' });
  P.position.update.mockResolvedValue({});
  P.trade.update.mockResolvedValue({});
  exit.mockResolvedValue({ closed: true });
  (getCurrentPrice as jest.Mock).mockReturnValue(undefined);
});

describe('checkStopLosses — missing price fails loud, never silent', () => {
  it('flags the position PROTECTION_UNKNOWN and alerts when the price map is empty', async () => {
    P.trade.findMany.mockResolvedValue([cryptoTrade()]);
    // The old code returned before even loading trades on an empty map.
    await checkStopLosses({});
    expect(P.position.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { protectionStatus: 'PROTECTION_UNKNOWN' } });
    expect((logger as any).error).toHaveBeenCalledWith(expect.stringContaining('BTC'));
    await flush();
    expect(systemError).toHaveBeenCalledTimes(1);
    expect(systemError.mock.calls[0][1]).toContain('BTC');
    expect(systemError.mock.calls[0][1]).toContain('PROTECTION_UNKNOWN');
    expect(exit).not.toHaveBeenCalled();
  });

  it('flags on a non-finite price for the asset', async () => {
    P.trade.findMany.mockResolvedValue([cryptoTrade()]);
    await checkStopLosses({ BTC: NaN });
    expect(P.position.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { protectionStatus: 'PROTECTION_UNKNOWN' } });
    await flush();
    expect(systemError).toHaveBeenCalledTimes(1);
  });

  it('does not re-flag or re-alert a position already flagged (dead feed alarms once)', async () => {
    P.trade.findMany.mockResolvedValue([cryptoTrade()]);
    P.position.findUnique.mockResolvedValue({ status: 'OPEN', protectionStatus: 'PROTECTION_UNKNOWN' });
    await checkStopLosses({});
    expect(P.position.update).not.toHaveBeenCalled();
    await flush();
    expect(systemError).not.toHaveBeenCalled();
    // Still loud in the logs every cycle — silence was the bug.
    expect((logger as any).error).toHaveBeenCalled();
  });

  it('does not flag broker-hosted positions — their bracket legs do not depend on this feed', async () => {
    P.trade.findMany.mockResolvedValue([cryptoTrade({ asset: 'AAPL', market: 'stocks' })]);
    P.position.findUnique.mockResolvedValue({ status: 'OPEN', protectionStatus: 'BROKER_HOSTED' });
    await checkStopLosses({});
    expect(P.position.update).not.toHaveBeenCalled();
    await flush();
    expect(systemError).not.toHaveBeenCalled();
    // No false "blind protection" alarm either — the broker legs still work.
    expect((logger as any).error).not.toHaveBeenCalled();
  });

  it('still exits on a crossed stop when a price IS available, and does not flag', async () => {
    P.trade.findMany.mockResolvedValue([cryptoTrade()]);
    await checkStopLosses({ BTC: 85 });
    expect(exit).toHaveBeenCalledWith('p1', 'STOP_LOSS', expect.objectContaining({ accountId: 'acct-1' }));
    expect(P.position.update).not.toHaveBeenCalled();
    await flush();
    expect(systemError).not.toHaveBeenCalled();
  });
});

describe('markToMarketOpenPositions — missing price fails loud, never silent', () => {
  it('flags the position PROTECTION_UNKNOWN and alerts when no price can be fetched', async () => {
    P.trade.findMany.mockResolvedValue([cryptoTrade()]);
    await markToMarketOpenPositions();
    expect(P.position.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { protectionStatus: 'PROTECTION_UNKNOWN' } });
    await flush();
    expect(systemError).toHaveBeenCalledTimes(1);
    expect(systemError.mock.calls[0][1]).toContain('markToMarketOpenPositions');
    // No silent mark-to-market write happened for the unpriced trade.
    expect(P.trade.update).not.toHaveBeenCalled();
  });

  it('marks to market normally when a price IS available, and does not flag', async () => {
    P.trade.findMany.mockResolvedValue([cryptoTrade()]);
    (getCurrentPrice as jest.Mock).mockReturnValue(110);
    await markToMarketOpenPositions();
    expect(P.trade.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { unrealizedPnl: 5, unrealizedPnlPct: 10 },
    });
    expect(P.position.update).not.toHaveBeenCalled();
    await flush();
    expect(systemError).not.toHaveBeenCalled();
  });
});

describe('order placement — protection is attached only where the broker supports it', () => {
  const sig = (over: any = {}) => ({
    asset: 'BTC', market: 'crypto', direction: 'BUY', confidence: 80,
    entryPrice: 100, stopLossPrice: 90, takeProfitPrice: 120, positionSizePct: 5,
    reasoning: '', agentDecisionId: 'd1', ...over,
  }) as any;

  it('crypto: plain market order, NO fabricated bracket legs, protection stays APPLICATION_MONITORED', () => {
    const o = buildCryptoOrder(sig(), 0.25)!;
    expect(o.payload).toEqual({ symbol: 'BTC/USD', qty: 0.25, side: 'buy', type: 'market', time_in_force: 'gtc' });
    expect((o.payload as any).order_class).toBeUndefined();
    expect((o.payload as any).stop_loss).toBeUndefined();
    expect((o.payload as any).take_profit).toBeUndefined();
    expect(o.protection).toBe('APPLICATION_MONITORED');
  });

  it('stocks: whole-share BUY attaches the broker bracket (stop + target) — protection where supported', () => {
    const o = buildStockOrder(sig({ asset: 'NVDA', market: 'stocks', stopLossPrice: 94, takeProfitPrice: 115 }), 3.7)!;
    expect(o.payload.order_class).toBe('bracket');
    expect(o.payload.stop_loss).toEqual({ stop_price: 94 });
    expect(o.payload.take_profit).toEqual({ limit_price: 115 });
    expect(o.protection).toBe('BROKER_HOSTED');
  });
});
