// Exercises execution -> durable reservation -> broker observation -> position.
// External services are fakes; PostgreSQL/Broker runtime verification is separate.
jest.mock('../src/utils/prisma', () => ({ prisma: {
  $transaction: jest.fn(), $executeRaw: jest.fn(),
  trade: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
  position: { findUnique: jest.fn(), upsert: jest.fn() }, agentDecision: { update: jest.fn() },
} }));
jest.mock('../src/services/alpacaBroker', () => ({ createAlpacaBroker: jest.fn() }));
jest.mock('../src/services/topTraderRules', () => ({ validateWithTopTraderRules: jest.fn().mockResolvedValue({ approved: true }) }));
jest.mock('../src/services/microAccountEngine', () => ({
  checkTradeViability: () => ({ viable: true }), calculateMicroPosition: () => ({ isAboveMinimum: true, shares: 1 }),
  getAccountMode: () => ({ riskMultiplier: 1 }), EXCHANGE_FEES: { alpaca_stocks: { minOrderUSD: 1 }, bybit_spot: { minOrderUSD: 1 } },
}));
jest.mock('../src/trading/marketSession', () => ({ stockEntryWindow: jest.fn(() => true) }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: jest.fn(() => false) }));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));

import { executeTradeSignal } from '../src/trading/executionEngine';
import { prisma } from '../src/utils/prisma';
import { createAlpacaBroker } from '../src/services/alpacaBroker';
import { stockEntryWindow } from '../src/trading/marketSession';
import { isKillSwitchActive } from '../src/agents/orchestrator';
import { TradeSignal, PortfolioState } from '../src/agents/types';

const signal: TradeSignal = { asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 90,
  entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110, positionSizePct: 1, reasoning: '', agentDecisionId: '' };
const portfolio: PortfolioState = { totalValue: 1000, cashBalance: 1000, invested: 0, positions: [], pnlDay: 0,
  pnlDayPct: 0, pnlWeekPct: 0, pnlTotal: 0, dailyLossToday: 0, tradesExecutedToday: 0, drawdownFromPeak: 0 };
const filled = { id: 'o1', symbol: 'AAPL', side: 'buy', status: 'filled', filled_qty: '0.1', filled_avg_price: '101' };
let saved: any;
const broker = { getClock: jest.fn(), getAsset: jest.fn(), getPosition: jest.fn(), createOrder: jest.fn(), getOrder: jest.fn(), getOrderByClientId: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRADING_MODE = 'paper'; delete process.env.ALPACA_BASE_URL;
  saved = null;
  (isKillSwitchActive as jest.Mock).mockReturnValue(false);
  (stockEntryWindow as jest.Mock).mockReturnValue(true);
  (createAlpacaBroker as jest.Mock).mockReturnValue(broker);
  broker.getClock.mockResolvedValue({});
  broker.getAsset.mockResolvedValue({ tradable: true, fractionable: true, shortable: true });
  broker.getPosition.mockResolvedValue(null);
  broker.createOrder.mockImplementation(async () => { expect(saved?.brokerOrderId).toBe('CLIENT:entry-t1'); return filled; });
  broker.getOrder.mockResolvedValue({ ...filled, status: 'accepted', filled_qty: '0', filled_avg_price: null });
  broker.getOrderByClientId.mockResolvedValue(null);
  (prisma.$transaction as jest.Mock).mockImplementation(fn => fn(prisma));
  (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.trade.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.trade.create as jest.Mock).mockImplementation(({ data }) => { saved = { id: 't1', ...data }; return Promise.resolve(saved); });
  (prisma.trade.update as jest.Mock).mockImplementation(({ data }) => { saved = { ...saved, ...data }; return Promise.resolve(saved); });
  (prisma.trade.updateMany as jest.Mock).mockImplementation(({ data }) => { saved = { ...saved, ...data }; return Promise.resolve({ count: 1 }); });
  (prisma.trade.findUnique as jest.Mock).mockImplementation(() => Promise.resolve(saved));
  (prisma.position.findUnique as jest.Mock).mockResolvedValue(null);
});

it('reserves before submitting and tracks the actual fractional fill', async () => {
  expect(await executeTradeSignal(signal, portfolio)).toBe(true);
  expect(broker.createOrder).toHaveBeenCalledWith(expect.objectContaining({ qty: 0.1, client_order_id: 'entry-t1', time_in_force: 'day' }));
  expect(saved.entryPrice).toBe(101);
  expect(saved.brokerConfirmed).toBe(true);
  expect(prisma.position.upsert).toHaveBeenCalledTimes(1);
});
it('retains an accepted unfilled order as pending', async () => {
  broker.createOrder.mockResolvedValue({ ...filled, status: 'accepted', filled_qty: '0', filled_avg_price: null });
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(saved.status).toBe('OPEN'); expect(saved.brokerConfirmed).toBe(false);
  expect(saved.brokerOrderId).toBe('o1');
  expect(prisma.position.upsert).not.toHaveBeenCalled();
});
it('does not release the reservation after a network timeout', async () => {
  broker.createOrder.mockRejectedValue(new Error('timeout'));
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(saved.status).toBe('OPEN'); expect(saved.brokerConfirmed).toBe(false);
  expect(saved.brokerOrderId).toBe('CLIENT:entry-t1');
});
it('recovers a fill after a lost order submission response', async () => {
  broker.createOrder.mockRejectedValue(new Error('timeout'));
  broker.getOrderByClientId.mockResolvedValue(filled); broker.getOrder.mockResolvedValue(filled);
  expect(await executeTradeSignal(signal, portfolio)).toBe(true);
  expect(broker.createOrder).toHaveBeenCalledTimes(1);
});
it('blocks a second entry for a symbol with a pending reservation', async () => {
  (prisma.trade.findMany as jest.Mock).mockResolvedValue([{ ...signal, asset: 'AAPL', brokerConfirmed: false }]);
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(broker.createOrder).not.toHaveBeenCalled();
});
it('does not submit when the broker clock blocks entry', async () => {
  (stockEntryWindow as jest.Mock).mockReturnValue(false);
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(prisma.trade.create).not.toHaveBeenCalled();
});
it('honors the kill switch even when invoked directly', async () => {
  (isKillSwitchActive as jest.Mock).mockReturnValue(true);
  expect(await executeTradeSignal(signal, portfolio)).toBe(false);
  expect(broker.createOrder).not.toHaveBeenCalled();
});
