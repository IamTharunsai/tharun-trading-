jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../src/utils/config', () => ({ appConfig: { ALPACA: { activeMode: 'paper',
  paperApiKey: 'fixture-paper', paperSecretKey: 'fixture-paper-secret', liveApiKey: 'fixture-live', liveSecretKey: 'fixture-live-secret' } } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/utils/redis', () => ({ redis: { get: jest.fn(), setex: jest.fn() } }));
jest.mock('../src/websocket/server', () => ({ getIO: jest.fn() }));
import axios from 'axios';
import { appConfig } from '../src/utils/config';
import { logger } from '../src/utils/logger';
import { fetchAlpacaStockSnapshotEvidence as fetchEvidence, parseCompletedStockBars, parseStockSnapshot } from '../src/services/stockSnapshotEvidence';
import { buildMarketSnapshot } from '../src/services/marketData';

const now = Date.parse('2026-10-17T14:00:00Z'), day = 86_400_000;
const bars = Array.from({ length: 420 }, (_, index) => now - (420 - index) * day)
  .filter(time => ![0, 6].includes(new Date(time).getUTCDay())).map((time, index) => ({
    t: new Date(time - 10 * 3_600_000).toISOString(), o: 100 + index, h: 102 + index, l: 99 + index, c: 101 + index, v: 1000 + index,
  }));
const snapshot = () => ({ latestTrade: { p: 402, t: '2026-10-16T19:59:59Z' },
  latestQuote: { bp: 401, ap: 403, t: '2026-10-16T20:00:00Z' },
  dailyBar: { h: 404, l: 395, v: 12000, t: '2026-10-16T04:00:00Z' },
  prevDailyBar: { c: 400, t: '2026-10-15T04:00:00Z' } });
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers({ now }); appConfig.ALPACA.activeMode = 'paper';
  (axios.get as jest.Mock).mockImplementation(async (url: string) => ({ data: url.endsWith('/snapshot') ? snapshot() : { bars: { NEW: bars }, next_page_token: null } }));
});
afterEach(() => jest.useRealTimers());

test('newly selected stock obtains actual dated history and quote without cache subscription or Polygon', async () => {
  const result = await buildMarketSnapshot('NEW', 'stocks');
  expect(result).toMatchObject({ asset: 'NEW', market: 'stocks', price: 402, bidPrice: 401, askPrice: 403,
    volume24h: 12000, volumeChange: null, candles: expect.any(Array),
    dataEvidence: { source: 'Alpaca IEX', timeframe: '1Day', completedBars: bars.length,
      priceObservedAt: Date.parse('2026-10-16T19:59:59Z'), quoteObservedAt: Date.parse('2026-10-16T20:00:00Z') } });
  expect(result!.candles).toHaveLength(bars.length);
  expect(result!.indicators.sma200).toBeCloseTo(bars.slice(-200).reduce((sum, row) => sum + row.c, 0) / 200);
  expect(result!.indicators.sma50).not.toBe(result!.indicators.sma200);
  expect(axios.get).toHaveBeenCalledWith('https://data.alpaca.markets/v2/stocks/bars', expect.objectContaining({
    maxRedirects: 0, params: expect.objectContaining({ symbols: 'NEW', timeframe: '1Day', feed: 'iex', adjustment: 'all', sort: 'asc', limit: 1000 }),
  }));
  expect((axios.get as jest.Mock).mock.calls.every(([url]: [string]) => url.startsWith('https://data.alpaca.markets/'))).toBe(true);
});

test('market-data authentication follows active mode and never crosses to paper credentials', async () => {
  appConfig.ALPACA.activeMode = 'live';
  await fetchEvidence('NEW', now);
  for (const [, request] of (axios.get as jest.Mock).mock.calls) expect(request.headers).toEqual({
    'APCA-API-KEY-ID': 'fixture-live', 'APCA-API-SECRET-KEY': 'fixture-live-secret',
  });
});

test('historical pagination uses only the fixed official endpoint and verifies continuation', async () => {
  (axios.get as jest.Mock).mockImplementation(async (url: string, request: any) => ({ data: url.endsWith('/snapshot') ? snapshot()
    : request.params.page_token ? { bars: { NEW: bars.slice(150) }, next_page_token: null }
      : { bars: { NEW: bars.slice(0, 150) }, next_page_token: 'fixture-page' } }));
  expect((await fetchEvidence('NEW', now)).candles).toHaveLength(bars.length);
  expect((axios.get as jest.Mock).mock.calls).toHaveLength(3);
  (axios.get as jest.Mock).mockImplementation(async (url: string) => ({ data: url.endsWith('/snapshot') ? snapshot()
    : { bars: { NEW: bars.slice(0, 150) }, next_page_token: 'repeated' } }));
  await expect(fetchEvidence('NEW', now)).rejects.toThrow('STOCK_HISTORY_TRUNCATED');
});

test.each(['../secret', 'NEW?key=secret', '', 'NEW/OTHER'])('invalid symbol %s sends no request', async symbol => {
  await expect(fetchEvidence(symbol, now)).rejects.toThrow('STOCK_SYMBOL_INVALID');
  expect(axios.get).not.toHaveBeenCalled();
});

test('current unfinished daily bar is excluded and insufficient long averages are not manufactured', () => {
  const current = { ...bars[bars.length - 1], t: '2026-10-17T04:00:00Z', c: 9999, h: 10000 };
  expect(parseCompletedStockBars([...bars, current], now)).toHaveLength(bars.length);
  expect(() => parseCompletedStockBars(bars.slice(-199), now)).toThrow('STOCK_HISTORY_INSUFFICIENT');
  expect(() => parseCompletedStockBars([], now)).toThrow('STOCK_HISTORY_INSUFFICIENT');
});

test.each([
  { c: NaN }, { h: 1 }, { l: 999999 }, { v: -1 }, { o: '100' }, { t: 'invalid' },
  { t: '2099-01-01T00:00:00Z' },
])('malformed bar cannot become a technical indicator: %p', replacement => {
  expect(() => parseCompletedStockBars([{ ...bars[0], ...replacement }, ...bars.slice(1)], now)).toThrow('STOCK_HISTORY_INVALID');
});

test('duplicate/out-of-order bars and stale history are rejected', () => {
  expect(() => parseCompletedStockBars([bars[0], ...bars], now)).toThrow('STOCK_HISTORY_INVALID');
  expect(() => parseCompletedStockBars(bars.slice().reverse(), now)).toThrow('STOCK_HISTORY_INVALID');
  expect(() => parseCompletedStockBars(bars.slice(0, -10), now)).toThrow('STOCK_HISTORY_INSUFFICIENT');
});

test.each([
  { latestTrade: { p: 1, t: '2099-01-01T00:00:00Z' } },
  { latestTrade: { p: 0, t: '2026-10-16T19:59:59Z' } },
  { latestQuote: { bp: 404, ap: 403, t: '2026-10-16T20:00:00Z' } },
  { latestQuote: { bp: 401, ap: 403, t: '2026-09-01T20:00:00Z' } },
  { prevDailyBar: { c: 0, t: '2026-10-15T04:00:00Z' } },
])('invalid observed quote/trade cannot turn into cached or zero-spread evidence: %p', replacement => {
  expect(() => parseStockSnapshot({ ...snapshot(), ...replacement }, now)).toThrow(/^STOCK_/);
});

test('transport failures yield no snapshot and logs never serialize provider credentials', async () => {
  (axios.get as jest.Mock).mockRejectedValue(Object.assign(new Error('private token and body'), { request: { secret: 'fixture-key' } }));
  expect(await buildMarketSnapshot('NEW', 'stocks')).toBeNull();
  expect(logger.warn).toHaveBeenCalledWith('market_snapshot_unavailable', { market: 'stocks', code: 'MARKET_SNAPSHOT_UNAVAILABLE' });
  expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toMatch(/private|fixture-key/);
});

test('unconnected forex is not silently routed to stock data', async () => {
  expect(await buildMarketSnapshot('EURUSD', 'forex')).toBeNull();
  expect(axios.get).not.toHaveBeenCalled();
});
