/** Read-only dashboard evidence. Never substitute sample financial values for a failed feed. */
import axios from 'axios';
import { isPlaceholderKey } from '../utils/apiKeys';

const REQUEST = { timeout: 8000, maxContentLength: 1024 * 1024, maxRedirects: 0 };
const cache = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
const failures = new Map<string, { expires: number; error: Error }>();
const FAILED_FEED_TTL = 15_000;

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const failure = failures.get(key);
  if (failure && failure.expires > Date.now()) throw failure.error;
  const active = pending.get(key);
  if (active) return active as Promise<T>;
  // The keys below are fixed endpoint names; the screener intentionally has no symbol-keyed cache.
  const task = load().then(value => {
    const unavailable = value !== null && typeof value === 'object' && 'status' in value && (value as { status: string }).status !== 'available';
    cache.set(key, { value, expires: Date.now() + (unavailable ? FAILED_FEED_TTL : ttl) });
    return value;
  }).catch(() => {
    const error = new Error('dashboard_feed_unavailable');
    failures.set(key, { expires: Date.now() + FAILED_FEED_TTL, error });
    throw error;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
const positive = (value: unknown) => { const n = finiteNumber(value); return n !== null && n > 0 ? n : null; };
const nonnegative = (value: unknown) => { const n = finiteNumber(value); return n !== null && n >= 0 ? n : null; };
const percentage = (value: unknown) => { const n = finiteNumber(value); return n !== null && n >= 0 && n <= 100 ? n : null; };

export function observationTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) && date > 0 && date <= Date.now() + 60_000 ? new Date(date).toISOString() : null;
}
function unixTime(value: unknown): string | null {
  const seconds = finiteNumber(value);
  if (seconds === null || seconds <= 0 || seconds * 1000 > Date.now() + 60_000) return null;
  return new Date(seconds * 1000).toISOString();
}
const received = () => new Date().toISOString();
const record = (v: any): Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {};

export interface CryptoAssetEvidence {
  id: string; symbol: string; name: string; market: 'crypto'; price: number | null;
  change24h: number | null; volume24h: number | null; marketCap: number | null;
  high24h: number | null; low24h: number | null; observedAt: string | null;
  receivedAt: string; source: 'CoinGecko'; quoteCurrency: 'USD';
}

export function normalizeCryptoAssets(raw: unknown, receivedAt: string): CryptoAssetEvidence[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  return raw.slice(0, 20).flatMap(item => {
    const row = record(item);
    if (typeof row.id !== 'string' || row.id.length > 100 || !row.id || ids.has(row.id) || typeof row.symbol !== 'string' || !/^[a-z0-9._-]{1,20}$/i.test(row.symbol)) return [];
    ids.add(row.id);
    return [{ id: row.id, symbol: row.symbol.toUpperCase(), name: typeof row.name === 'string' ? row.name.slice(0, 100) : row.symbol.toUpperCase(), market: 'crypto' as const,
      price: positive(row.current_price), change24h: finiteNumber(row.price_change_percentage_24h),
      volume24h: nonnegative(row.total_volume), marketCap: nonnegative(row.market_cap),
      high24h: positive(row.high_24h), low24h: positive(row.low_24h),
      observedAt: observationTime(row.last_updated), receivedAt, source: 'CoinGecko' as const, quoteCurrency: 'USD' as const }];
  });
}

export async function getDashboardCryptoAssets(): Promise<CryptoAssetEvidence[]> {
  return cached('crypto-assets', 60_000, async () => {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      ...REQUEST, params: { vs_currency: 'usd', order: 'market_cap_desc', per_page: 20, page: 1, sparkline: false },
    });
    const assets = normalizeCryptoAssets(response.data, received());
    if (!assets.some(row => row.price !== null)) throw new Error('crypto_feed_unavailable');
    return assets;
  });
}

export async function getDashboardCryptoOverview() {
  return cached('crypto-overview', 60_000, async () => {
    const [globalResponse, sentimentResponse] = await Promise.allSettled([
      axios.get('https://api.coingecko.com/api/v3/global', REQUEST),
      axios.get('https://api.alternative.me/fng/', { ...REQUEST, params: { limit: 1 } }),
    ]);
    const global = globalResponse.status === 'fulfilled' ? record(record(globalResponse.value.data).data) : {};
    const sentimentRaw = sentimentResponse.status === 'fulfilled' ? record(sentimentResponse.value.data).data : null;
    const sentiment = Array.isArray(sentimentRaw) ? record(sentimentRaw[0]) : {};
    const totalMarketCap = positive(record(global.total_market_cap).usd);
    const index = percentage(sentiment.value);
    const globalObservedAt = unixTime(global.updated_at);
    const fearGreedObservedAt = unixTime(sentiment.timestamp);
    return {
      totalMarketCap, totalVolume24h: nonnegative(record(global.total_volume).usd),
      btcDominance: percentage(record(global.market_cap_percentage).btc), ethDominance: percentage(record(global.market_cap_percentage).eth),
      fearGreedIndex: index, fearGreedLabel: index !== null && typeof sentiment.value_classification === 'string' ? sentiment.value_classification.slice(0, 80) : null,
      observedAt: null, globalObservedAt, fearGreedObservedAt, receivedAt: received(),
      source: 'CoinGecko / Alternative.me',
      status: totalMarketCap !== null && index !== null ? 'available' : totalMarketCap !== null || index !== null ? 'partial' : 'unavailable',
    };
  });
}

const SECTORS = [
  ['Technology', 'XLK'], ['Healthcare', 'XLV'], ['Financials', 'XLF'], ['Energy', 'XLE'],
  ['Consumer Discretionary', 'XLY'], ['Industrials', 'XLI'], ['Materials', 'XLB'],
  ['Utilities', 'XLU'], ['Real Estate', 'XLRE'], ['Communication Services', 'XLC'], ['Consumer Staples', 'XLP'],
] as const;

function alpacaHeaders(): Record<string, string> | null {
  if (isPlaceholderKey(process.env.ALPACA_API_KEY) || isPlaceholderKey(process.env.ALPACA_SECRET_KEY)) return null;
  return { 'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY! };
}

export function normalizeStockSnapshot(raw: unknown) {
  const snapshot = record(raw);
  const trade = record(snapshot.latestTrade);
  const bar = record(snapshot.dailyBar);
  const prior = record(snapshot.prevDailyBar);
  const tradePrice = positive(trade.p);
  const price = tradePrice ?? positive(bar.c);
  const previousClose = positive(prior.c);
  const observedAt = tradePrice !== null ? observationTime(trade.t) : null;
  const barPeriodStart = observationTime(bar.t);
  const previousClosePeriodStart = observationTime(prior.t);
  const referenceTime = tradePrice !== null ? observedAt : barPeriodStart;
  // A bar timestamp describes its period start, not when its final/current close was observed.
  return { price, observedAt, barPeriodStart, previousClosePeriodStart,
    priceKind: tradePrice !== null ? 'latest_trade' : price !== null ? 'daily_bar_close' : null,
    change1d: price !== null && previousClose !== null && referenceTime !== null && previousClosePeriodStart !== null && referenceTime > previousClosePeriodStart
      ? finiteNumber((price / previousClose - 1) * 100) : null,
    volume: nonnegative(bar.v), volumeObservedAt: null, volumePeriodStart: barPeriodStart, volumePeriodKind: 'daily_bar' };
}

async function stockSnapshots(symbols: string[]) {
  const headers = alpacaHeaders();
  if (!headers || symbols.length === 0) return {};
  const response = await axios.get('https://data.alpaca.markets/v2/stocks/snapshots', {
    ...REQUEST, headers, params: { symbols: symbols.join(','), feed: 'iex' },
  });
  return record(response.data);
}

/** Exact-symbol research read. Do not share the screener's universe cache key. */
export async function getResearchStockQuote(symbol: string) {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new Error('invalid_symbol');
  const snapshots = await stockSnapshots([symbol]);
  if (!snapshots[symbol]) throw new Error('market_feed_unavailable');
  return { symbol, market: 'stocks' as const, ...normalizeStockSnapshot(snapshots[symbol]),
    source: 'Alpaca IEX' as const, receivedAt: received() };
}

export async function getDashboardSectors() {
  return cached('sectors', 60_000, async () => {
    const snapshots: Record<string, any> = await stockSnapshots(SECTORS.map(([, ticker]) => ticker)).catch(() => ({}));
    const sectors = SECTORS.map(([name, ticker]) => {
      const value = normalizeStockSnapshot(snapshots[ticker]);
      return { name, ticker, price: value.price, changePercent: value.change1d, observedAt: value.observedAt,
        priceKind: value.priceKind, barPeriodStart: value.barPeriodStart, marketCap: null, source: 'Alpaca IEX' };
    });
    const count = sectors.filter(row => row.price !== null).length;
    return { sectors, kind: 'sector_etf_proxies', source: 'Alpaca IEX', observedAt: null, receivedAt: received(),
      status: count === SECTORS.length ? 'available' : count > 0 ? 'partial' : 'unavailable' };
  });
}

const TREASURIES = [
  ['1M', 1, 'DGS1MO'], ['3M', 3, 'DGS3MO'], ['6M', 6, 'DGS6MO'], ['1Y', 12, 'DGS1'],
  ['2Y', 24, 'DGS2'], ['3Y', 36, 'DGS3'], ['5Y', 60, 'DGS5'], ['7Y', 84, 'DGS7'],
  ['10Y', 120, 'DGS10'], ['20Y', 240, 'DGS20'], ['30Y', 360, 'DGS30'],
] as const;

export function normalizeFredObservations(raw: unknown): Array<{ date: string; value: number }> {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 420).flatMap(item => {
    const row = record(item); const value = finiteNumber(row.value);
    const date = typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? observationTime(row.date) : null;
    return value !== null && date !== null && date.slice(0, 10) === row.date ? [{ date: row.date, value }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date));
}

async function fredObservations(series: string, limit: number) {
  if (isPlaceholderKey(process.env.FRED_API_KEY)) return [];
  const response = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
    ...REQUEST, params: { series_id: series, api_key: process.env.FRED_API_KEY, file_type: 'json', sort_order: 'desc', limit },
  });
  return normalizeFredObservations(record(response.data).observations);
}

function annualInflation(rows: Array<{ date: string; value: number }>, offset: number): number | null {
  const current = rows[offset]; const prior = rows[offset + 12];
  if (!current || !prior || prior.value <= 0) return null;
  const months = (Number(current.date.slice(0, 4)) - Number(prior.date.slice(0, 4))) * 12
    + Number(current.date.slice(5, 7)) - Number(prior.date.slice(5, 7));
  // Twelve observations cannot stand in for twelve months if a provider returned a gap.
  return months === 12 ? finiteNumber((current.value / prior.value - 1) * 100) : null;
}

export async function getDashboardTreasuryYields() {
  return cached('treasuries', 6 * 60 * 60_000, async () => {
    const current = await Promise.all(TREASURIES.map(async ([maturity, months, series]) => {
      const rows = await fredObservations(series, 10).catch(() => []);
      return { maturity, months, rate: rows[0]?.value ?? null, observedAt: rows[0]?.date ?? null, source: `FRED ${series}` };
    }));
    const two = current.find(row => row.maturity === '2Y'); const ten = current.find(row => row.maturity === '10Y');
    // A curve spread compares the same observation date; missing/unequal dates cannot establish inversion.
    const spread = two && ten && two.rate !== null && ten.rate !== null && two.observedAt !== null && two.observedAt === ten.observedAt ? finiteNumber(ten.rate - two.rate) : null;
    const count = current.filter(row => row.rate !== null).length;
    return { current, oneMonthAgo: [], oneYearAgo: [], spread2Y10Y: spread, recessionProbability: null,
      source: 'FRED', observedAt: null, receivedAt: received(),
      status: count === current.length ? 'available' : count > 0 ? 'partial' : 'unavailable',
      reason: isPlaceholderKey(process.env.FRED_API_KEY) ? 'fred_not_configured' : count === 0 ? 'fred_feed_unavailable' : null };
  });
}

export async function getDashboardScreener(stockUniverse: Array<string | { symbol: string; name?: string }>) {
  const names = new Map<string, string | null>();
  for (const asset of stockUniverse) {
    const symbol = typeof asset === 'string' ? asset : asset?.symbol;
    if (typeof symbol !== 'string' || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || names.has(symbol)) continue;
    names.set(symbol, typeof asset !== 'string' && typeof asset.name === 'string' && asset.name.trim() && asset.name.trim() !== symbol ? asset.name.trim().slice(0, 200) : null);
    if (names.size >= 40) break;
  }
  const symbols = [...names.keys()];
  const [stocks, crypto] = await Promise.allSettled([
    cached('screener-stocks', 30_000, async () => ({ snapshots: await stockSnapshots(symbols), receivedAt: received() })),
    getDashboardCryptoAssets(),
  ]);
  const snapshots: Record<string, any> = stocks.status === 'fulfilled' ? stocks.value.snapshots : {};
  const stocksReceivedAt = stocks.status === 'fulfilled' ? stocks.value.receivedAt : null;
  const receivedAt = received();
  const unavailableFields = { rsi14: null, volumeRatio: null, change5d: null, change20d: null, sector: null, signal: null, inWatchlist: false };
  const equities = symbols.flatMap(symbol => {
    if (!snapshots[symbol]) return [];
    const quote = normalizeStockSnapshot(snapshots[symbol]);
    return [{ symbol, name: names.get(symbol) ?? null, market: 'stocks', ...quote, ...unavailableFields, marketCap: null, source: 'Alpaca IEX', receivedAt: stocksReceivedAt, volumeUnit: 'shares' }];
  });
  const coins = crypto.status === 'fulfilled' ? crypto.value.map(row => ({
    symbol: row.symbol, name: row.name, assetId: row.id, market: 'crypto', price: row.price, change1d: row.change24h, volume: row.volume24h,
    ...unavailableFields, marketCap: row.marketCap, observedAt: row.observedAt, receivedAt: row.receivedAt, source: row.source, volumeUnit: 'USD',
  })) : [];
  const data = [...equities, ...coins];
  return { data, source: 'Alpaca IEX / CoinGecko', observedAt: null, receivedAt,
    status: equities.length === symbols.length && coins.length > 0 ? 'available' : data.length > 0 ? 'partial' : 'unavailable',
    scope: 'Up to 40 configured stock-universe symbols and the top 20 CoinGecko assets; not an exchange-wide ranking' };
}

export async function getDashboardMacroIndicators() {
  return cached('macro-indicators', 6 * 60 * 60_000, async () => {
    const definitions = [
      ['Fed Funds Rate', 'DFF', '%', 'monetary'], ['CPI YoY', 'CPIAUCSL', '%', 'inflation'],
      ['Core PCE YoY', 'PCEPILFE', '%', 'inflation'], ['Unemployment Rate', 'UNRATE', '%', 'employment'],
      ['Real GDP Growth (annualized QoQ)', 'A191RL1Q225SBEA', '%', 'growth'],
      ['10Y Treasury Yield', 'DGS10', '%', 'rates'], ['2Y Treasury Yield', 'DGS2', '%', 'rates'],
      ['WTI Crude Oil', 'DCOILWTICO', '$/bbl', 'commodities'],
    ] as const;
    const indicators = await Promise.all(definitions.map(async ([name, series, unit, category]) => {
      const yoy = series === 'CPIAUCSL' || series === 'PCEPILFE';
      const rows = await fredObservations(series, yoy ? 14 : 10).catch(() => []);
      const value = yoy ? annualInflation(rows, 0) : rows[0]?.value ?? null;
      const previousValue = yoy ? annualInflation(rows, 1) : rows[1]?.value ?? null;
      const change = value !== null && previousValue !== null ? finiteNumber(value - previousValue) : null;
      return { name, value, previousValue, change, changePct: change !== null && previousValue !== null && previousValue !== 0 ? finiteNumber(change / Math.abs(previousValue) * 100) : null,
        unit, category, asOf: rows[0]?.date ?? null, observedAt: rows[0]?.date ?? null,
        trend: change === null ? null : change > 0 ? 'up' : change < 0 ? 'down' : 'flat', country: 'US', source: `FRED ${series}` };
    }));
    const count = indicators.filter(row => row.value !== null).length;
    return { indicators, source: 'FRED', observedAt: null, receivedAt: received(), status: count === indicators.length ? 'available' : count > 0 ? 'partial' : 'unavailable' };
  });
}
