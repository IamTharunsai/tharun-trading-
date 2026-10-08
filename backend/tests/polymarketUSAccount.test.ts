const balances = jest.fn();
const positions = jest.fn();
const orders = jest.fn();
const createOrder = jest.fn();
jest.mock('polymarket-us', () => ({ PolymarketUS: jest.fn().mockImplementation(() => ({ account: { balances }, portfolio: { positions }, orders: { list: orders, create: createOrder } })) }), { virtual: true });
jest.mock('../src/utils/config', () => ({ appConfig: { TRADING_MODE: 'paper' } }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn() } }));
import { getPolymarketUSAccount, getPolymarketUSHealth, placePolymarketUSOrder } from '../src/services/polymarketUS';
import { PolymarketUS } from 'polymarket-us';
beforeEach(() => {
  jest.clearAllMocks();
  process.env.POLYMARKET_KEY_ID = 'fixture-key';
  process.env.POLYMARKET_SECRET_KEY = 'fixture-secret';
  balances.mockResolvedValue({ balances: [{ currency: 'USD', currentBalance: 10, buyingPower: 9 }] });
  positions.mockResolvedValue({ positions: {} });
  orders.mockResolvedValue({ orders: [] });
});
test('keeps verified cash when auxiliary positions/orders fail', async () => {
  positions.mockRejectedValue(new Error('fixture'));
  orders.mockRejectedValue(new Error('fixture'));
  expect(await getPolymarketUSAccount()).toMatchObject({ connected: true, cash: 10, buyingPower: 9, positions: null, openOrders: null });
});
test('missing USD and optional values are unknown, not zero', async () => {
  balances.mockResolvedValue({ balances: [{ currency: 'USDC', currentBalance: 10 }] });
  expect(await getPolymarketUSAccount()).toMatchObject({ cash: null, buyingPower: null, openOrderValue: null, balanceAvailable: false });
});
test('real zero remains a known balance', async () => {
  balances.mockResolvedValue({ balances: [{ currency: 'USD', currentBalance: 0, buyingPower: 0 }] });
  expect(await getPolymarketUSAccount()).toMatchObject({ cash: 0, buyingPower: 0, balanceAvailable: true });
});
test('invalid or rejected balances do not report a connected account', async () => {
  balances.mockResolvedValue({});
  await expect(getPolymarketUSAccount()).rejects.toThrow('response is invalid');
  balances.mockRejectedValue(new Error('fixture-secret must never escape'));
  await expect(getPolymarketUSAccount()).rejects.toThrow('balance request failed');
});
test('secret rotation creates a fresh authenticated client', async () => {
  await getPolymarketUSAccount();
  process.env.POLYMARKET_SECRET_KEY = 'fixture-rotated';
  await getPolymarketUSAccount();
  expect(PolymarketUS).toHaveBeenLastCalledWith({ keyId: 'fixture-key', secretKey: 'fixture-rotated' });
});
test('connection health requires a recent successful request for current credentials', async () => {
  process.env.POLYMARKET_SECRET_KEY = 'fixture-health';
  expect(getPolymarketUSHealth()).toMatchObject({ configured: true, connected: false, status: 'unverified' });
  await getPolymarketUSAccount();
  expect(getPolymarketUSHealth().connected).toBe(true);
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 90001);
  expect(getPolymarketUSHealth().connected).toBe(false);
  clock.mockRestore();
  balances.mockRejectedValue(new Error('fixture'));
  await expect(getPolymarketUSAccount()).rejects.toThrow();
  expect(getPolymarketUSHealth().connected).toBe(false);
});
test('older failed request cannot erase newer verified health', async () => {
  let rejectOld!: (error: Error) => void;
  balances.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
  const old = getPolymarketUSAccount().catch(() => null);
  await getPolymarketUSAccount();
  rejectOld(new Error('fixture old failure'));
  await old;
  expect(getPolymarketUSHealth().connected).toBe(true);
});
test('account data from credentials rotated during a request is refused', async () => {
  let finish!: (result: unknown) => void;
  balances.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const request = getPolymarketUSAccount();
  process.env.POLYMARKET_SECRET_KEY = 'fixture-new-account';
  finish({ balances: [{ currency: 'USD', currentBalance: 10 }] });
  await expect(request).rejects.toThrow('credentials changed');
  expect(getPolymarketUSHealth().connected).toBe(false);
});
test.each([
  [{ marketSlug: 'fixture', side: 'YES', price: 0.5, quantity: Infinity }, 'Invalid price/quantity'],
  [{ marketSlug: 'fixture', side: 'YES', price: 0.999, quantity: 1 }, 'Invalid price/quantity'],
  [{ marketSlug: 'fixture', side: 'YES', price: 0.555, quantity: 1 }, 'whole cents'],
  [{ marketSlug: 'fixture', side: 'YES', price: 0.5, quantity: 0.5 }, 'Invalid price/quantity'],
  [{ marketSlug: '', side: 'YES', price: 0.5, quantity: 1 }, 'Invalid market slug'],
  [{ marketSlug: 'fixture', side: 'INVALID', price: 0.5, quantity: 1 }, 'Invalid outcome side'],
])('invalid US order cannot reach the SDK: %j', async (request, message) => {
  const { appConfig } = require('../src/utils/config');
  appConfig.TRADING_MODE = 'live';
  process.env.POLYMARKET_US_LIVE = 'true';
  process.env.POLYMARKET_US_MAX_ORDER_USD = '5';
  await expect(placePolymarketUSOrder(request as any)).rejects.toThrow(message);
  expect(createOrder).not.toHaveBeenCalled();
  appConfig.TRADING_MODE = 'paper';
});
test('invalid configured order cap fails closed', async () => {
  const { appConfig } = require('../src/utils/config');
  appConfig.TRADING_MODE = 'live';
  process.env.POLYMARKET_US_LIVE = 'true';
  process.env.POLYMARKET_US_MAX_ORDER_USD = 'not-a-number';
  await expect(placePolymarketUSOrder({ marketSlug: 'fixture', side: 'YES', price: 0.5, quantity: 1 })).rejects.toThrow('order limit');
  expect(createOrder).not.toHaveBeenCalled();
  appConfig.TRADING_MODE = 'paper';
});