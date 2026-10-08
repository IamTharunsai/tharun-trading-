// Execution authority contracts after integrating the durable entry/exit path.
// Full broker fill/reconciliation cases live in positionExits.behavior and executionAuthority.behavior.
jest.mock('../src/utils/prisma', () => ({ prisma: { agentDecision: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false, activateKillSwitch: jest.fn() }));
jest.mock('../src/trading/positionExits', () => ({ requestPositionExit: jest.fn() }));
const broker = { createOrder: jest.fn(), flattenSymbol: jest.fn() };
jest.mock('../src/trading/brokerRouter', () => ({ getActiveMode: () => 'paper', getTradingBroker: () => broker }));
import { executeTradeSignal, buildCryptoOrder } from '../src/trading/executionEngine';
import { closePosition } from '../src/trading/riskManager';
import { requestPositionExit } from '../src/trading/positionExits';
const signal: any = { asset: 'AAPL', market: 'stocks', direction: 'SELL', confidence: 70, entryPrice: 100, stopLossPrice: 103, takeProfitPrice: 94, positionSizePct: 5, agentDecisionId: 'unpersisted' };
beforeEach(() => jest.clearAllMocks());
test('unpersisted SELL cannot open a short or close a holding', async () => {
  expect(await executeTradeSignal(signal, { totalValue: 1000, cashBalance: 900, positions: [{ asset: 'AAPL', side: 'BUY' }] } as any)).toBe(false);
  expect(broker.createOrder).not.toHaveBeenCalled(); expect(broker.flattenSymbol).not.toHaveBeenCalled();
});
test('crypto shorts are refused even with the short flag', () => {
  process.env.ALLOW_SHORT_SELLING = 'true';
  expect(buildCryptoOrder({ ...signal, market: 'crypto', asset: 'BTC' }, 0.01)).toBeNull();
});
test('crypto BUY quantity is rounded down and uses fractional GTC', () => {
  expect(buildCryptoOrder({ ...signal, market: 'crypto', asset: 'BTC', direction: 'BUY' }, 0.0123456789)?.payload).toEqual({ symbol: 'BTC/USD', qty: 0.012345, side: 'buy', type: 'market', time_in_force: 'gtc' });
});
test('manual exits use durable position identity and ignore caller price', async () => {
  (requestPositionExit as jest.Mock).mockResolvedValue({ closed: true, pnl: -25 });
  expect(await closePosition({ id: 'p1', asset: 'AAPL' }, 999, 'stop_loss')).toMatchObject({ closed: true, pnl: -25 });
  expect(requestPositionExit).toHaveBeenCalledWith('p1', 'stop_loss');
});
test('pending exit never claims closure', async () => {
  (requestPositionExit as jest.Mock).mockResolvedValue({ closed: false, pending: true });
  expect((await closePosition({ id: 'p1', asset: 'BTC' }, 99, 'stop_loss')).closed).toBe(false);
});
test('missing position identity is refused', async () => {
  expect((await closePosition({ asset: 'AAPL' }, 99, 'stop_loss')).closed).toBe(false);
  expect(requestPositionExit).not.toHaveBeenCalled();
});