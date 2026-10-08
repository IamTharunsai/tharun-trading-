jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import axios from 'axios';
import { fetchHistoricalBars, historicalRange, latestCompletedBar } from '../src/trading/historicalBars';
import { runBacktest } from '../src/trading/backtestingEngine';

const start = Date.parse('2025-01-01T00:00:00Z');
const hour = 3600000;
const kline = (t: number) => [t, '100', '102', '99', '101', '25', t + hour - 1, '2525'];
beforeEach(() => jest.clearAllMocks());

test('point-in-time lookup never observes a future bar, including across dates', () => {
  const bars = [{ timestamp: start, close: 100 }, { timestamp: start + hour, close: 101 },
    { timestamp: start + 25 * hour, close: 999 }];
  expect(latestCompletedBar(bars, start - 1)).toBeNull();
  expect(latestCompletedBar(bars, start + 24 * hour)).toEqual({ timestamp: start + hour, close: 101 });
  bars[2].close = 0.001;
  expect(latestCompletedBar(bars, start + 24 * hour)?.close).toBe(101);
  expect(latestCompletedBar([], start)).toBeNull();
});

test('dated crypto history uses completed timestamps and base-asset volume', async () => {
  (axios.get as jest.Mock).mockResolvedValue({ data: [kline(start)] });
  const bars = await fetchHistoricalBars('BTC/USDT', '2025-01-01', '2025-01-01');
  expect(axios.get).toHaveBeenCalledWith('https://api.binance.com/api/v3/klines', expect.objectContaining({
    params: { symbol: 'BTCUSDT', interval: '1h', startTime: start, endTime: start + 24 * hour - 1, limit: 1000 },
  }));
  expect(bars[0]).toMatchObject({ openTime: start, timestamp: start + hour, volume: 25 });
});

test('crypto pagination advances past a full page without overlapping it', async () => {
  (axios.get as jest.Mock).mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => kline(start + i * hour)) })
    .mockResolvedValueOnce({ data: [kline(start + 1000 * hour)] });
  const bars = await fetchHistoricalBars('BTC/USDT', '2025-01-01', '2025-02-15');
  expect(bars).toHaveLength(1001);
  expect((axios.get as jest.Mock).mock.calls[1][1].params.startTime).toBe(start + 1000 * hour);
});

test('missing stock credentials cannot create invented prices', async () => {
  const original = process.env.POLYGON_API_KEY;
  try {
    delete process.env.POLYGON_API_KEY;
    await expect(fetchHistoricalBars('AAPL', '2025-01-01', '2025-01-01')).rejects.toThrow('not configured');
    expect(axios.get).not.toHaveBeenCalled();
  } finally { if (original === undefined) delete process.env.POLYGON_API_KEY; else process.env.POLYGON_API_KEY = original; }
});

test('malformed or duplicated crypto prices fail rather than produce a result', async () => {
  (axios.get as jest.Mock).mockResolvedValue({ data: [kline(start), kline(start)] });
  await expect(fetchHistoricalBars('BTC/USDT', '2025-01-01', '2025-01-01')).rejects.toThrow('duplicate');
  (axios.get as jest.Mock).mockResolvedValue({ data: [[start, '100', '90', '99', '101', '25', start + hour - 1]] });
  await expect(fetchHistoricalBars('BTC/USDT', '2025-01-01', '2025-01-01')).rejects.toThrow('Malformed');
});

test('empty history or failed provider read aborts the actual backend run', async () => {
  (axios.get as jest.Mock).mockResolvedValue({ data: [] });
  await expect(runBacktest({ startDate: '2025-01-01', endDate: '2025-01-01', initialCapital: 1000, symbols: ['BTC/USDT'] }))
    .rejects.toThrow('Historical data unavailable');
  (axios.get as jest.Mock).mockRejectedValue(new Error('fixture timeout'));
  await expect(fetchHistoricalBars('BTC/USDT', '2025-01-01', '2025-01-01')).rejects.toThrow('fixture timeout');
});

test('invalid calendar dates, excessive ranges and future days are rejected', () => {
  expect(() => historicalRange('2025-02-30', '2025-03-01')).toThrow('Invalid');
  expect(() => historicalRange('2024-01-01', '2025-02-01')).toThrow('1–366');
  expect(() => historicalRange('2099-01-01', '2099-01-02')).toThrow('completed');
  expect(() => historicalRange('2025-01-03', '2025-01-01')).toThrow('1–366');
});

test('stock history uses requested windows and fails on provider truncation', async () => {
  const original = process.env.POLYGON_API_KEY;
  process.env.POLYGON_API_KEY = 'fixture-polygon-key';
  try {
    (axios.get as jest.Mock).mockImplementation(async (url: string) => {
      const parts = url.split('/');
      const t = Number(parts[parts.length - 2]);
      return { data: { results: [{ t, o: 100, h: 102, l: 99, c: 101, v: 25 }] } };
    });
    const bars = await fetchHistoricalBars('AAPL', '2025-01-01', '2025-02-15');
    expect(bars).toHaveLength(2);
    expect((axios.get as jest.Mock).mock.calls[0][0]).toContain(`/hour/${start}/${start + 30 * 24 * hour - 1}`);
    expect((axios.get as jest.Mock).mock.calls[0][1].params).toMatchObject({ adjusted: true, sort: 'asc', limit: 50000 });
    (axios.get as jest.Mock).mockResolvedValue({ data: { next_url: 'https://untrusted.invalid/page', results: [] } });
    await expect(fetchHistoricalBars('AAPL', '2025-01-01', '2025-01-01')).rejects.toThrow('truncated');
  } finally { if (original === undefined) delete process.env.POLYGON_API_KEY; else process.env.POLYGON_API_KEY = original; }
});
