import axios from 'axios';
import { getForecast } from '../src/services/kronosService';

jest.mock('axios');
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
const mockedAxios = axios as jest.Mocked<typeof axios>;

const candles = Array.from({ length: 10 }, (_, i) => ({
  open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000,
  timestamp: Date.now() - (10 - i) * 86400000,
}));
const validMeanReturn = (111 - 109.5) / 109.5;

describe('kronosService.getForecast', () => {
  beforeEach(() => {
    process.env.KRONOS_SERVICE_URL = 'http://kronos-service.railway.internal:8000';
    jest.clearAllMocks();
  });

  it('returns the parsed forecast on a 200 response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { symbol: 'AAPL', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: validMeanReturn },
    });
    const result = await getForecast('AAPL', candles as any, 1);
    expect(result).toEqual({ symbol: 'AAPL', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: validMeanReturn });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://kronos-service.railway.internal:8000/forecast',
      expect.objectContaining({ symbol: 'AAPL', predLen: 1 }),
      expect.objectContaining({ family: 4 }),
    );
  });

  it('returns null (not a throw) when every retry fails', async () => {
    mockedAxios.post.mockRejectedValue({ isAxiosError: true, response: { status: 503 } });
    const result = await getForecast('AAPL', candles as any, 1);
    expect(result).toBeNull();
    expect(mockedAxios.post).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('retries once on a 503 then succeeds', async () => {
    mockedAxios.post
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
      .mockResolvedValueOnce({
        status: 200,
        data: { symbol: 'AAPL', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: validMeanReturn },
      });
    const result = await getForecast('AAPL', candles as any, 1);
    expect(result?.symbol).toBe('AAPL');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it.each([
    { symbol: 'MSFT', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: validMeanReturn },
    { symbol: 'AAPL', predictedClose: [111], upperBand: [], lowerBand: [109], meanReturn: validMeanReturn },
    { symbol: 'AAPL', predictedClose: [111], upperBand: [110], lowerBand: [112], meanReturn: validMeanReturn },
    { symbol: 'AAPL', predictedClose: [Infinity], upperBand: [113], lowerBand: [109], meanReturn: validMeanReturn },
    { symbol: 'AAPL', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: 0.99 },
  ])('refuses a mismatched or mathematically invalid forecast: %j', async data => {
    mockedAxios.post.mockResolvedValue({ status: 200, data });
    expect(await getForecast('AAPL', candles, 1)).toBeNull();
  });

  it('does not call a provider for invalid candles or a nonpositive horizon', async () => {
    expect(await getForecast('AAPL', [], 5)).toBeNull();
    expect(await getForecast('AAPL', candles.map(c => ({ ...c, timestamp: c.timestamp + 8640000000000000 })), 1)).toBeNull();
    expect(await getForecast('AAPL', candles, 0)).toBeNull();
    expect(await getForecast('AAPL', [{ ...candles[0], close: NaN }, ...candles.slice(1)], 1)).toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
