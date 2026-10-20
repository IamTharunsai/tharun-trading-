jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../src/trading/brokerRouter', () => ({ getActiveMode: jest.fn(), getTradingBroker: jest.fn(), getTradingCredentials: jest.fn() }));
import axios from 'axios';
import { getActiveMode, getTradingBroker, getTradingCredentials } from '../src/trading/brokerRouter';
import { bindStockQuote, assertStockQuoteBinding, readStockEntryQuote } from '../src/trading/stockEntryQuote';
import { assertStockEntrySource, assertStockEntryQuote, readStockEntryPolicy, reduceStockEntryQuantity, assertStockEntryBudget } from '../src/trading/stockEntryPolicy';
import type { TradeSignal } from '../src/agents/types';

const now = Date.parse('2026-10-19T14:00:00Z');
const signal: TradeSignal = { asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 80,
  entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 105, positionSizePct: 1, reasoning: 'fixture', agentDecisionId: 'd1' };
const source = () => ({ market: 'stocks', dataEvidence: { source: 'Alpaca IEX', timeframe: '1Day', completedBars: 250,
  receivedAt: now, priceObservedAt: now, quoteObservedAt: now } });
const quote = () => ({ source: 'Alpaca IEX' as const, symbol: 'AAPL', bid: 99.99, ask: 100, observedAt: now, receivedAt: now });
const broker = {} as any;
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers({ now });
  (getActiveMode as jest.Mock).mockReturnValue('paper'); (getTradingBroker as jest.Mock).mockReturnValue(broker);
  (getTradingCredentials as jest.Mock).mockReturnValue({ mode: 'paper', apiKey: 'fixture', secret: 'fixture-secret' });
  (axios.get as jest.Mock).mockResolvedValue({ data: { symbol: 'AAPL', quote: { bp: 99.99, ap: 100, t: new Date(now).toISOString() } } });
});
afterEach(() => jest.useRealTimers());

test('source age cannot be refreshed by assembly time or omitted legacy provenance', () => {
  expect(() => assertStockEntrySource(source(), now)).not.toThrow();
  const stale = source(); stale.dataEvidence.priceObservedAt = now - 300001;
  expect(() => assertStockEntrySource({ ...stale, timestamp: now }, now)).toThrow('STOCK_ENTRY_SOURCE');
  expect(() => assertStockEntrySource({ market: 'stocks', timestamp: now }, now)).toThrow();
  expect(() => assertStockEntrySource(source(), now + 300001)).toThrow();
});
test.each(['NaN', '0', '-1', '10001', 'Infinity'])('malformed/out-of-bound quote age %s never disables guards', value => {
  expect(() => readStockEntryPolicy({ STOCK_ENTRY_QUOTE_MAX_AGE_MS: value })).toThrow('STOCK_ENTRY_POLICY_INVALID');
});
test('new quote observed during request is validated at receipt; fixed endpoint and credentials remain scoped', async () => {
  (axios.get as jest.Mock).mockImplementationOnce(async () => {
    jest.setSystemTime(now + 300);
    return { data: { symbol: 'AAPL', quote: { bp: 99.99, ap: 100, t: new Date(now + 100).toISOString() } } };
  });
  const evidence = await readStockEntryQuote('AAPL', bindStockQuote('paper', broker));
  expect(evidence).toMatchObject({ observedAt: now + 100, receivedAt: now + 300 });
  expect(assertStockEntryQuote(evidence, signal)).toBe(100);
  expect(axios.get).toHaveBeenCalledWith('https://data.alpaca.markets/v2/stocks/AAPL/quotes/latest', expect.objectContaining({
    headers: { 'APCA-API-KEY-ID': 'fixture', 'APCA-API-SECRET-KEY': 'fixture-secret' }, params: { feed: 'iex', currency: 'USD' },
    maxRedirects: 0, maxContentLength: 16384, timeout: 3000,
  }));
});
test.each(['mode', 'secret', 'broker'])('%s rotation while awaiting quote cannot reuse old authority', async change => {
  const binding = bindStockQuote('paper', broker);
  (axios.get as jest.Mock).mockImplementationOnce(async () => {
    if (change === 'mode') (getActiveMode as jest.Mock).mockReturnValue('live');
    if (change === 'secret') (getTradingCredentials as jest.Mock).mockReturnValue({ mode: 'paper', apiKey: 'fixture', secret: 'rotated' });
    if (change === 'broker') (getTradingBroker as jest.Mock).mockReturnValue({});
    return { data: { symbol: 'AAPL', quote: { bp: 99.99, ap: 100, t: new Date(now).toISOString() } } };
  });
  await expect(readStockEntryQuote('AAPL', binding)).rejects.toThrow('STOCK_ENTRY_ACCOUNT_CHANGED');
  expect(() => assertStockQuoteBinding(binding)).toThrow();
});
test('provider errors are bounded and never expose credentials or response bodies', async () => {
  (axios.get as jest.Mock).mockRejectedValue(new Error('private_token=SECRET'));
  await expect(readStockEntryQuote('AAPL', bindStockQuote('paper', broker))).rejects.toThrow(/^STOCK_ENTRY_QUOTE_UNAVAILABLE$/);
});
test.each([
  { symbol: 'MSFT' }, { bid: 101, ask: 100 }, { ask: Infinity }, { observedAt: now - 3001 },
  { observedAt: now + 501 }, { receivedAt: now + 1 }, { ask: 101 },
])('invalid/stale/moved quote cannot qualify entry: %p', changes => {
  expect(() => assertStockEntryQuote({ ...quote(), ...changes }, signal, now)).toThrow();
});
test('side prices and immutable protection enforce minimum 2:1 reward/risk', () => {
  const q = { ...quote(), bid: 99.8, ask: 100 };
  expect(assertStockEntryQuote(q, signal, now)).toBe(100);
  expect(assertStockEntryQuote(q, { ...signal, direction: 'SELL', stopLossPrice: 102, takeProfitPrice: 95 }, now)).toBe(99.8);
  // Still inside50bps movement, but now reward/risk<2 with unchanged target.
  expect(() => assertStockEntryQuote({ ...quote(), bid: 100.39, ask: 100.4 }, signal, now)).toThrow('OUTSIDE_APPROVED_PLAN');
  expect(() => assertStockEntryQuote(quote(), { ...signal, stopLossPrice: 100.01 }, now)).toThrow();
});
test('better/worse quote can only reduce quantity; notional and original stop-dollar budget are both bounded', () => {
  const worse = reduceStockEntryQuantity(signal, 1000, 100.2);
  expect(worse).toBeLessThan(10);
  expect(() => assertStockEntryBudget(signal, worse, 100.2, 1000, 20)).not.toThrow();
  expect(reduceStockEntryQuantity(signal, 1000, 99.8)).toBeLessThanOrEqual(10);
  expect(() => assertStockEntryBudget(signal, 10, 100.2, 1000, 20)).toThrow();
});
