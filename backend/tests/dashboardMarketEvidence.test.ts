import axios from 'axios';
import { respondWithDashboardEvidence } from '../src/routes/dashboardMarketResponse';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
const get = axios.get as jest.Mock;
type Evidence = typeof import('../src/services/dashboardMarketEvidence');
const NOW = Date.parse('2026-10-15T15:00:00.000Z');
let evidence: Evidence;
const original = { ...process.env };
const quote = { latestTrade: { p: 110, t: '2026-10-15T14:55:00Z' }, dailyBar: { c: 109, v: 0, t: '2026-10-15T04:00:00Z' }, prevDailyBar: { c: 100, t: '2026-10-14T04:00:00Z' } };
const coin = { id: 'avalanche-2', symbol: 'avax', name: 'Avalanche', current_price: 23.45, price_change_percentage_24h: -2.3, market_cap: 100, total_volume: 0, high_24h: 25, low_24h: 22, last_updated: '2026-10-15T14:50:00Z' };

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers({ now: NOW });
  process.env.ALPACA_API_KEY = 'fixture_configured_key';
  process.env.ALPACA_SECRET_KEY = 'fixture_configured_secret';
  process.env.FRED_API_KEY = 'fixture_configured_fred';
  evidence = require('../src/services/dashboardMarketEvidence');
  // resetModules creates a fresh axios mock as well as an empty evidence cache.
  const currentAxios = require('axios').default;
  get.mockReset();
  currentAxios.get = get;
});
afterEach(() => {
  try { expect(jest.getTimerCount()).toBe(0); }
  finally { jest.useRealTimers(); process.env = { ...original }; }
});

describe('Express 4 dashboard failure boundary', () => {
  function response() {
    const res = { json: jest.fn(), status: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  }
  test('unexpected provider rejection resolves with a generic 503 response, never raw failure details', async () => {
    const res = response();
    const load = jest.fn().mockRejectedValue(new Error('private provider detail must stay private'));
    await expect(respondWithDashboardEvidence(res, load)).resolves.toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'market_feed_unavailable', observedAt: null, receivedAt: '2026-10-15T15:00:00.000Z' });
  });
  test('a synchronous lazy-import failure is contained and preserves the crypto error contract', async () => {
    const res = response();
    await expect(respondWithDashboardEvidence(res, () => { throw new Error('module load failure'); }, 'crypto')).resolves.toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'crypto_feed_unavailable', source: 'CoinGecko', observedAt: null, receivedAt: '2026-10-15T15:00:00.000Z' });
  });
  test('successful data passes through without inventing an error or changing its schema', async () => {
    const res = response(); const data = [{ symbol: 'AVAX', price: 23.45 }];
    await respondWithDashboardEvidence(res, async () => data);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(data);
  });
});

describe('dashboard financial field normalization', () => {
  test.each([null, undefined, '', ' ', true, false, '.', 'NaN', Infinity, 'Infinity', {}, []])('does not turn missing/invalid %p into zero', value => {
    expect(evidence.finiteNumber(value)).toBeNull();
  });
  test('retains real numeric zero, negative values and numeric provider strings', () => {
    expect(evidence.finiteNumber(0)).toBe(0);
    expect(evidence.finiteNumber('-2.4')).toBe(-2.4);
    expect(evidence.finiteNumber('1e-8')).toBe(1e-8);
  });
  test('normalizes actual CoinGecko snake_case fields without a Bitcoin-sized AVAX fallback', () => {
    const rows = evidence.normalizeCryptoAssets([coin], '2026-10-15T15:00:00.000Z');
    expect(rows).toEqual([expect.objectContaining({ symbol: 'AVAX', price: 23.45, change24h: -2.3, volume24h: 0, high24h: 25, low24h: 22, marketCap: 100, observedAt: '2026-10-15T14:50:00.000Z', source: 'CoinGecko', quoteCurrency: 'USD' })]);
  });
  test('invalid crypto price/time stays unknown; duplicate IDs and malformed symbols are excluded', () => {
    const rows = evidence.normalizeCryptoAssets([{ ...coin, current_price: null, last_updated: '2026-10-16T00:00:00Z', total_volume: -1 }, coin, { ...coin, id: 'bad', symbol: '<script>' }], 'receipt');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ price: null, observedAt: null, volume24h: null });
  });
  test('stock change uses the actual latest price/previous close and retains zero volume', () => {
    expect(evidence.normalizeStockSnapshot(quote)).toMatchObject({ price: 110, change1d: expect.closeTo(10), volume: 0, observedAt: '2026-10-15T14:55:00.000Z', priceKind: 'latest_trade', volumeObservedAt: null, volumePeriodStart: '2026-10-15T04:00:00.000Z', volumePeriodKind: 'daily_bar' });
  });
  test('daily close fallback labels its period start and never treats midnight as an observation time', () => {
    expect(evidence.normalizeStockSnapshot({ ...quote, latestTrade: null })).toMatchObject({ price: 109, observedAt: null, priceKind: 'daily_bar_close', barPeriodStart: '2026-10-15T04:00:00.000Z', volumeObservedAt: null });
    expect(evidence.normalizeStockSnapshot({ ...quote, prevDailyBar: { c: 0, t: quote.prevDailyBar.t } }).change1d).toBeNull();
    expect(evidence.normalizeStockSnapshot({ ...quote, prevDailyBar: { c: 100, t: quote.latestTrade.t } }).change1d).toBeNull();
    expect(evidence.normalizeStockSnapshot(null)).toMatchObject({ price: null, change1d: null, volume: null, observedAt: null });
  });
  test('FRED missing observations are excluded rather than converted to a zero yield', () => {
    expect(evidence.normalizeFredObservations([
      { date: '2026-10-14', value: '.' }, { date: '2026-10-13', value: null },
      { date: '2026-10-12', value: '0' }, { date: '2026-10-11', value: '-0.25' },
      { date: '2026-10-16', value: '4' }, { date: '2026-02-30', value: '4' },
    ])).toEqual([{ date: '2026-10-12', value: 0 }, { date: '2026-10-11', value: -0.25 }]);
  });
});

describe('provider errors, cache and distinct observation/receipt time', () => {
  test('crypto provider failure refuses sample quotes and has a bounded negative cache', async () => {
    get.mockRejectedValue(new Error('secret-provider-error'));
    await expect(evidence.getDashboardCryptoAssets()).rejects.toThrow('dashboard_feed_unavailable');
    await expect(evidence.getDashboardCryptoAssets()).rejects.toThrow('dashboard_feed_unavailable');
    expect(get).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(15_001);
    get.mockResolvedValue({ data: [coin] });
    await expect(evidence.getDashboardCryptoAssets()).resolves.toEqual([expect.objectContaining({ price: 23.45 })]);
  });
  test('concurrent requests share one fetch; cached receipt and observed time do not become now', async () => {
    let finish!: (value: unknown) => void;
    get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = evidence.getDashboardCryptoAssets(); const second = evidence.getDashboardCryptoAssets();
    expect(get).toHaveBeenCalledTimes(1);
    finish({ data: [coin] });
    const rows = await first;
    expect(await second).toEqual(rows);
    jest.advanceTimersByTime(30_000);
    const cached = await evidence.getDashboardCryptoAssets();
    expect(cached[0].observedAt).toBe('2026-10-15T14:50:00.000Z');
    expect(cached[0].receivedAt).toBe('2026-10-15T15:00:00.000Z');
    expect(get).toHaveBeenCalledTimes(1);
  });
  test('successful but malformed crypto body cannot publish sample assets', async () => {
    get.mockResolvedValue({ data: { message: 'rate-limited' } });
    await expect(evidence.getDashboardCryptoAssets()).rejects.toThrow('dashboard_feed_unavailable');
  });
  test('global feed success and sentiment failure returns partial real data with unknown sentiment', async () => {
    get.mockImplementation((url: string) => url.includes('/global') ? Promise.resolve({ data: { data: { total_market_cap: { usd: 123 }, total_volume: { usd: 0 }, market_cap_percentage: { btc: 50, eth: 10 }, updated_at: NOW / 1000 - 600 } } }) : Promise.reject(new Error('offline')));
    expect(await evidence.getDashboardCryptoOverview()).toMatchObject({ totalMarketCap: 123, totalVolume24h: 0, btcDominance: 50, fearGreedIndex: null, fearGreedLabel: null, observedAt: null, globalObservedAt: '2026-10-15T14:50:00.000Z', fearGreedObservedAt: null, status: 'partial' });
  });
  test('a real zero sentiment score is retained when the global feed fails', async () => {
    get.mockImplementation((url: string) => url.includes('/global') ? Promise.reject(new Error('offline')) : Promise.resolve({ data: { data: [{ value: '0', value_classification: 'Extreme Fear', timestamp: String(NOW / 1000 - 3600) }] } }));
    expect(await evidence.getDashboardCryptoOverview()).toMatchObject({ totalMarketCap: null, btcDominance: null, fearGreedIndex: 0, fearGreedLabel: 'Extreme Fear', fearGreedObservedAt: '2026-10-15T14:00:00.000Z', status: 'partial' });
  });
  test('all unavailable overview fields remain null instead of default dominance/cap/sentiment', async () => {
    get.mockRejectedValue(new Error('offline'));
    expect(await evidence.getDashboardCryptoOverview()).toMatchObject({ totalMarketCap: null, totalVolume24h: null, btcDominance: null, ethDominance: null, fearGreedIndex: null, fearGreedLabel: null, status: 'unavailable' });
  });
});

describe('sector proxies, curve dates and screener evidence', () => {
  test('actual ETF observations are explicitly proxies with no invented sector market caps', async () => {
    get.mockResolvedValue({ data: { XLK: quote } });
    const result = await evidence.getDashboardSectors();
    expect(result).toMatchObject({ kind: 'sector_etf_proxies', source: 'Alpaca IEX', observedAt: null, status: 'partial' });
    expect(result.sectors[0]).toMatchObject({ ticker: 'XLK', price: 110, changePercent: expect.closeTo(10), marketCap: null });
    expect(result.sectors[1]).toMatchObject({ price: null, changePercent: null, observedAt: null });
    expect(get.mock.calls[0][1]).toMatchObject({ timeout: 8000, maxRedirects: 0, maxContentLength: 1048576, params: { feed: 'iex', symbols: expect.stringContaining('XLK') } });
  });
  test('unconfigured sectors and Treasury feeds remain explicitly unavailable without network calls', async () => {
    delete process.env.ALPACA_API_KEY; delete process.env.FRED_API_KEY;
    expect((await evidence.getDashboardSectors()).status).toBe('unavailable');
    const curve = await evidence.getDashboardTreasuryYields();
    expect(curve).toMatchObject({ spread2Y10Y: null, recessionProbability: null, oneMonthAgo: [], oneYearAgo: [], status: 'unavailable', reason: 'fred_not_configured' });
    expect(curve.current.every(row => row.rate === null && row.observedAt === null)).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });
  test('curve derives a same-date spread, retains per-tenor observation dates and omits guessed historic curves', async () => {
    get.mockImplementation((_url: string, config: any) => Promise.resolve({ data: { observations: [{ date: '2026-10-14', value: config.params.series_id === 'DGS2' ? '4.2' : config.params.series_id === 'DGS10' ? '4.0' : '0' }] } }));
    const result = await evidence.getDashboardTreasuryYields();
    expect(result.spread2Y10Y).toBeCloseTo(-0.2);
    expect(result.current.find(row => row.maturity === '1M')).toMatchObject({ rate: 0, observedAt: '2026-10-14' });
    expect(result).toMatchObject({ oneMonthAgo: [], oneYearAgo: [], observedAt: null, recessionProbability: null });
    expect(get).toHaveBeenCalledTimes(11);
  });
  test('curve missing/unequal provider dates cannot manufacture an inversion', async () => {
    get.mockImplementation((_url: string, config: any) => config.params.series_id === 'DGS30' ? Promise.reject(new Error('offline')) : Promise.resolve({ data: { observations: [{ date: config.params.series_id === 'DGS2' ? '2026-10-13' : '2026-10-14', value: '4.1' }] } }));
    const result = await evidence.getDashboardTreasuryYields();
    expect(result.spread2Y10Y).toBeNull();
    expect(result.status).toBe('partial');
    expect(result.current.find(row => row.maturity === '30Y')?.rate).toBeNull();
  });
  test('screener uses actual fields and leaves uncomputed factors unknown on partial feed failure', async () => {
    get.mockImplementation((url: string) => url.includes('alpaca') ? Promise.resolve({ data: { AAPL: quote } }) : Promise.reject(new Error('offline')));
    const result = await evidence.getDashboardScreener(['AAPL', 'AAPL', 'bad/symbol']);
    expect(result.status).toBe('partial');
    expect(result.data).toEqual([expect.objectContaining({ symbol: 'AAPL', price: 110, market: 'stocks', change1d: expect.closeTo(10), volume: 0, rsi14: null, signal: null, volumeRatio: null, change5d: null, change20d: null, marketCap: null, sector: null, volumeUnit: 'shares' })]);
    expect(get.mock.calls.find(call => call[0].includes('alpaca'))?.[1].params.symbols).toBe('AAPL');
  });
  test('screener uses USD crypto volume and real observed price without random change or RSI', async () => {
    delete process.env.ALPACA_API_KEY;
    get.mockResolvedValue({ data: [coin] });
    expect((await evidence.getDashboardScreener([])).data).toEqual([expect.objectContaining({ symbol: 'AVAX', name: 'Avalanche', price: 23.45, change1d: -2.3, volume: 0, volumeUnit: 'USD', rsi14: null, signal: null, source: 'CoinGecko' })]);
  });
  test('screener retains real universe company names and leaves symbol-only names unknown', async () => {
    get.mockImplementation((url: string) => url.includes('alpaca') ? Promise.resolve({ data: { AAPL: quote, MSFT: quote } }) : Promise.reject(new Error('offline')));
    const result = await evidence.getDashboardScreener([{ symbol: 'AAPL', name: 'Apple Inc.' }, { symbol: 'MSFT' }]);
    expect(result.data.find(row => row.symbol === 'AAPL')).toMatchObject({ name: 'Apple Inc.' });
    expect(result.data.find(row => row.symbol === 'MSFT')).toMatchObject({ name: null });
  });
  test('cached screener stock receipts retain provider retrieval time instead of acquiring a new timestamp', async () => {
    get.mockImplementation((url: string) => Promise.resolve({ data: url.includes('alpaca') ? { AAPL: quote } : [coin] }));
    const first = await evidence.getDashboardScreener(['AAPL']);
    jest.advanceTimersByTime(25_000);
    const second = await evidence.getDashboardScreener(['AAPL']);
    const row = second.data.find(item => item.market === 'stocks');
    expect(row?.receivedAt).toBe('2026-10-15T15:00:00.000Z');
    expect(row?.observedAt).toBe('2026-10-15T14:55:00.000Z');
    expect(second.receivedAt).not.toBe(first.receivedAt);
    expect(get).toHaveBeenCalledTimes(2);
  });
  test('macro indicators use provider observations, not Fincept example figures', async () => {
    get.mockResolvedValue({ data: { observations: [{ date: '2026-10-14', value: '2.0' }, { date: '2026-10-13', value: '1.5' }] } });
    const result = await evidence.getDashboardMacroIndicators();
    expect(result.indicators[0]).toMatchObject({ name: 'Fed Funds Rate', value: 2, previousValue: 1.5, change: 0.5, asOf: '2026-10-14', source: 'FRED DFF' });
    expect(result.indicators.find(row => row.name === 'CPI YoY')?.value).toBeNull();
    expect(result.status).toBe('partial');
  });
  test('inflation needs a genuine twelve-month comparison and never substitutes twelve irregular observations', async () => {
    const monthly = Array.from({ length: 14 }, (_, offset) => {
      const at = new Date(Date.UTC(2026, 8 - offset, 1));
      return { date: at.toISOString().slice(0, 10), value: String(offset === 0 ? 105 : 100) };
    });
    get.mockImplementation((_url: string, config: any) => Promise.resolve({ data: { observations: config.params.series_id === 'PCEPILFE' ? monthly.filter((_row, index) => index !== 5) : monthly } }));
    const result = await evidence.getDashboardMacroIndicators();
    expect(result.indicators.find(row => row.name === 'CPI YoY')).toMatchObject({ value: expect.closeTo(5), previousValue: 0, asOf: '2026-09-01' });
    expect(result.indicators.find(row => row.name === 'Core PCE YoY')?.value).toBeNull();
  });
});
