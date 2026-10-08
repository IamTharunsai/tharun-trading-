// Polymarket US market data normalization + the gated order path. The SDK and
// axios are mocked: no network, no real orders.
const sdk = {
  events: { list: jest.fn() },
  markets: { book: jest.fn(), bbo: jest.fn(), settlement: jest.fn() },
  orders: { create: jest.fn().mockResolvedValue({ id: 'ord-1' }), cancel: jest.fn().mockResolvedValue(undefined) },
};
jest.mock('polymarket-us', () => ({ PolymarketUS: jest.fn().mockImplementation(() => sdk) }), { virtual: true });
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false }));
jest.mock('axios');
import axios from 'axios';
import {
  normalizeUSMarket, listPolymarketUSMarkets, getPolymarketUSBook, getPolymarketUSPriceHistory,
  getPolymarketUSSettlement, placePolymarketUSOrder, cancelPolymarketUSOrder, toYesOrderPrice,
} from '../src/services/polymarketUS';

const rawMarket = (over: any = {}) => ({
  slug: 'tec-mlb-nlchamp-lad', question: 'National League Champion', title: 'Los Angeles Dodgers',
  category: 'sports', status: 'MARKET_STATUS_OPEN', active: true, closed: false, archived: false,
  bestBidQuote: { value: '0.5980', currency: 'USD' }, bestAskQuote: { value: '0.6000', currency: 'USD' },
  feeCoefficient: 0.0695, orderPriceMinTickSize: 0.001, minimumTradeQty: 1, endDate: '2026-11-06T21:20:09Z',
  marketType: 'futures', description: 'Will the Dodgers win the pennant?', ...over,
});

const LIVE = { TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK', POLYMARKET_US_LIVE: 'true', POLYMARKET_KEY_ID: 'kid', POLYMARKET_SECRET_KEY: 'c2VjcmV0' };
const saved = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...saved };
  ['TRADING_MODE', 'LIVE_TRADING_CONFIRMED', 'POLYMARKET_US_LIVE', 'POLYMARKET_US_MAX_ORDER_USD', 'POLYMARKET_MAX_BET_USD'].forEach(k => delete process.env[k]);
});

describe('market data', () => {
  it('normalizes a gateway market with its event (YES quotes, fee Θ, grouping)', () => {
    const m = normalizeUSMarket(rawMarket(), { slug: 'mlb-nlchamp', title: 'National League Champion' })!;
    expect(m).toMatchObject({
      venue: 'polymarket_us', id: 'tec-mlb-nlchamp-lad', question: 'National League Champion: Los Angeles Dodgers',
      eventId: 'mlb-nlchamp', category: 'sports', open: true, bestBid: 0.598, bestAsk: 0.6, feeCoefficient: 0.0695, tickSize: 0.001,
    });
    expect(normalizeUSMarket(rawMarket({ status: 'MARKET_STATUS_SUSPENDED' }))!.open).toBe(false);
    expect(normalizeUSMarket({})).toBeNull();
  });

  it('lists markets from events (paged) and respects the max', async () => {
    sdk.events.list.mockResolvedValueOnce({ events: [{ slug: 'e1', title: 'E1', markets: [rawMarket({ slug: 'a' }), rawMarket({ slug: 'b' })] }] });
    const ms = await listPolymarketUSMarkets(1);
    expect(ms.map(m => m.id)).toEqual(['a']);
    expect(ms[0].eventId).toBe('e1');
  });

  it('unwraps { marketData } books and sorts levels', async () => {
    sdk.markets.book.mockResolvedValueOnce({ marketData: {
      state: 'MARKET_STATE_OPEN',
      bids: [{ px: { value: '0.59' }, qty: '10' }, { px: { value: '0.598' }, qty: '113' }],
      offers: [{ px: { value: '0.62' }, qty: '5' }, { px: { value: '0.60' }, qty: '4147' }],
      stats: { openInterest: '99701', sharesTraded: '1062855', lastTradePx: { value: '0.60' }, lastTradeSetTime: '2026-10-08T06:16:14Z' },
    } });
    const b = (await getPolymarketUSBook('x'))!;
    expect(b.bids[0]).toEqual({ price: 0.598, size: 113 });
    expect(b.asks[0]).toEqual({ price: 0.6, size: 4147 });
    expect(b).toMatchObject({ openInterest: 99701, volume: 1062855, lastTrade: 0.6, state: 'MARKET_STATE_OPEN' });
    expect(b.lastTradeAt).toBe(Date.parse('2026-10-08T06:16:14Z'));
    sdk.markets.book.mockRejectedValueOnce(new Error('boom'));
    expect(await getPolymarketUSBook('x')).toBeNull();
  });

  it('price history returns the YES mid from long/short display prices', async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ data: { history: [{ timestamp: 1, longPrice: 0.42, shortPrice: 0.60 }] } });
    const h = await getPolymarketUSPriceHistory('x');
    expect(h).toHaveLength(1);
    expect(h[0].t).toBe(1);
    expect(h[0].p).toBeCloseTo(0.41);
    expect((axios.get as jest.Mock).mock.calls[0][1].params).toMatchObject({ symbol: 'x', fixedInterval: 'INTERVAL_1W', fidelity: 180 });
  });

  it('settlement: value when settled, null on 404 / unsettled', async () => {
    sdk.markets.settlement.mockResolvedValueOnce({ slug: 'x', settlement: 1 });
    expect(await getPolymarketUSSettlement('x')).toBe(1);
    sdk.markets.settlement.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }));
    expect(await getPolymarketUSSettlement('x')).toBeNull();
  });
});

describe('gated order path', () => {
  it('refuses real orders without the full live gate (nothing sent)', async () => {
    process.env.POLYMARKET_US_LIVE = 'true'; // alone is never enough
    await expect(placePolymarketUSOrder({ marketSlug: 'x', side: 'YES', price: 0.5, quantity: 2 })).rejects.toThrow(/disabled/);
    await expect(cancelPolymarketUSOrder('o', 'x')).rejects.toThrow(/disabled/);
    expect(sdk.orders.create).not.toHaveBeenCalled();
    expect(sdk.orders.cancel).not.toHaveBeenCalled();
  });

  it('sends NO orders at the YES price (1 − q), per the US single-instrument convention', async () => {
    Object.assign(process.env, LIVE);
    expect(toYesOrderPrice('NO', 0.4)).toBeCloseTo(0.6);
    await placePolymarketUSOrder({ marketSlug: 'x', side: 'NO', price: 0.4, quantity: 5 });
    const args = sdk.orders.create.mock.calls[0][0];
    expect(args).toMatchObject({ intent: 'ORDER_INTENT_BUY_SHORT', price: { value: '0.600', currency: 'USD' }, tif: 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL', quantity: 5 });
  });

  it('supports post-only GTD limits and still enforces the per-order $ cap', async () => {
    Object.assign(process.env, LIVE);
    await placePolymarketUSOrder({ marketSlug: 'x', side: 'YES', price: 0.42, quantity: 5, tif: 'GTD', goodTillTime: '2026-10-08T12:00:00Z', postOnly: true });
    expect(sdk.orders.create.mock.calls[0][0]).toMatchObject({ tif: 'TIME_IN_FORCE_GOOD_TILL_DATE', goodTillTime: '2026-10-08T12:00:00Z', participateDontInitiate: true, price: { value: '0.420' } });
    await expect(placePolymarketUSOrder({ marketSlug: 'x', side: 'YES', price: 0.5, quantity: 100 })).rejects.toThrow(/exceeds/);
    await expect(placePolymarketUSOrder({ marketSlug: 'x', side: 'YES', price: 0.5, quantity: 2, tif: 'GTD' })).rejects.toThrow(/goodTillTime/);
  });
});
