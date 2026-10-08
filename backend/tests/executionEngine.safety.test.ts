const prismaMock = {
  trade: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  position: { findFirst: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  agentDecision: { update: jest.fn() },
};
jest.mock('../src/utils/prisma', () => ({ prisma: prismaMock }));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false, activateKillSwitch: jest.fn() }));
jest.mock('../src/services/correlationService', () => ({ correlationService: {} }));
const broker = { createOrder: jest.fn(), getOrder: jest.fn(), flattenSymbol: jest.fn() };
let brokerAvailable = true;
jest.mock('../src/trading/brokerRouter', () => ({
  getTradingBroker: () => (brokerAvailable ? broker : null),
  getActiveMode: () => 'paper',
}));

import { executeTradeSignal, buildCryptoOrder } from '../src/trading/executionEngine';
import { closePosition } from '../src/trading/riskManager';

const sig = (over: any = {}) => ({
  asset: 'AAPL', market: 'stocks', direction: 'SELL', confidence: 70,
  entryPrice: 100, stopLossPrice: 103, takeProfitPrice: 94, positionSizePct: 5,
  reasoning: '', agentDecisionId: '', ...over,
}) as any;
const pf = { totalValue: 1000, cashBalance: 900, pnlDayPct: 0, drawdownFromPeak: 0, positions: [] } as any;

beforeEach(() => {
  jest.clearAllMocks();
  brokerAvailable = true;
  delete process.env.ALLOW_SHORT_SELLING;
  prismaMock.trade.update.mockResolvedValue({});
  prismaMock.position.update.mockResolvedValue({});
});

describe('ALLOW_SHORT_SELLING', () => {
  it('a SELL with no position is skipped by default (no order, no DB trade)', async () => {
    prismaMock.position.findFirst.mockResolvedValue(null);
    const ok = await executeTradeSignal(sig(), pf);
    expect(ok).toBe(false);
    expect(broker.createOrder).not.toHaveBeenCalled();
    expect(prismaMock.trade.create).not.toHaveBeenCalled();
  });

  it('a SELL on a held long closes it (broker exit), never stacks a short', async () => {
    prismaMock.position.findFirst.mockResolvedValue({ id: 'p1', asset: 'AAPL', market: 'stocks', side: 'BUY', entryPrice: 90, quantity: 2 });
    prismaMock.trade.findFirst.mockResolvedValue({ id: 't1', asset: 'AAPL', brokerConfirmed: true });
    broker.flattenSymbol.mockResolvedValue({ id: 'exit-1' });
    broker.getOrder.mockResolvedValue({ status: 'filled', filled_avg_price: '101', filled_qty: '2' });
    const ok = await executeTradeSignal(sig(), pf);
    expect(ok).toBe(true);
    expect(broker.flattenSymbol).toHaveBeenCalledWith('AAPL');
    expect(broker.createOrder).not.toHaveBeenCalled();
  }, 15000);

  it('crypto shorts are refused even when shorting is enabled', async () => {
    process.env.ALLOW_SHORT_SELLING = 'true';
    prismaMock.position.findFirst.mockResolvedValue(null);
    expect(await executeTradeSignal(sig({ asset: 'BTC', market: 'crypto' }), pf)).toBe(false);
    expect(buildCryptoOrder(sig({ asset: 'BTC', market: 'crypto' }), 0.01)).toBeNull();
  });

  it('builds a crypto BUY as BTC/USD fractional GTC', () => {
    const o = buildCryptoOrder(sig({ asset: 'BTC', market: 'crypto', direction: 'BUY' }), 0.0123456789)!;
    expect(o.payload).toEqual({ symbol: 'BTC/USD', qty: 0.012345, side: 'buy', type: 'market', time_in_force: 'gtc' });
  });
});

describe('closePosition sends a real exit to the active (paper) broker', () => {
  it('flattens a broker-confirmed position and books the real fill', async () => {
    prismaMock.trade.findFirst.mockResolvedValue({ id: 't1', asset: 'AAPL', brokerConfirmed: true });
    broker.flattenSymbol.mockResolvedValue({ id: 'exit-1' });
    broker.getOrder.mockResolvedValue({ status: 'filled', filled_avg_price: '97.5', filled_qty: '10' });
    const r = await closePosition({ id: 'p1', asset: 'AAPL', market: 'stocks', side: 'BUY', entryPrice: 100, quantity: 10 }, 99, 'stop_loss');
    expect(broker.flattenSymbol).toHaveBeenCalledWith('AAPL');
    expect(r.closed).toBe(true);
    expect(r.pnl).toBeCloseTo(-25); // real fill 97.5, not the requested 99
    expect(prismaMock.trade.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED', exitPrice: 97.5 }) }));
  }, 15000);

  it('maps crypto to the Alpaca position symbol (BTCUSD)', async () => {
    prismaMock.trade.findFirst.mockResolvedValue({ id: 't2', asset: 'BTC', brokerConfirmed: true });
    broker.flattenSymbol.mockResolvedValue(null); // already flat at broker
    await closePosition({ id: 'p2', asset: 'BTC', market: 'crypto', side: 'BUY', entryPrice: 60000, quantity: 0.01 }, 61000, 'take_profit');
    expect(broker.flattenSymbol).toHaveBeenCalledWith('BTCUSD');
  });

  it('leaves the position OPEN when the broker exit fails', async () => {
    prismaMock.trade.findFirst.mockResolvedValue({ id: 't3', asset: 'AAPL', brokerConfirmed: true });
    broker.flattenSymbol.mockRejectedValue(new Error('market closed'));
    const r = await closePosition({ id: 'p3', asset: 'AAPL', market: 'stocks', side: 'BUY', entryPrice: 100, quantity: 1 }, 95, 'stop_loss');
    expect(r.closed).toBe(false);
    expect(prismaMock.trade.update).not.toHaveBeenCalled();
    expect(prismaMock.position.update).not.toHaveBeenCalled();
  });

  it('refuses to fake-close a broker position when no broker is configured', async () => {
    brokerAvailable = false;
    prismaMock.trade.findFirst.mockResolvedValue({ id: 't4', asset: 'AAPL', brokerConfirmed: true });
    const r = await closePosition({ id: 'p4', asset: 'AAPL', market: 'stocks', side: 'BUY', entryPrice: 100, quantity: 1 }, 95, 'stop_loss');
    expect(r.closed).toBe(false);
  });

  it('local simulations (never sent to a broker) close in the DB only', async () => {
    prismaMock.trade.findFirst.mockResolvedValue({ id: 't5', asset: 'AAPL', brokerConfirmed: false });
    const r = await closePosition({ id: 'p5', asset: 'AAPL', market: 'stocks', side: 'BUY', entryPrice: 100, quantity: 1 }, 105, 'take_profit');
    expect(broker.flattenSymbol).not.toHaveBeenCalled();
    expect(r.closed).toBe(true);
  });
});
