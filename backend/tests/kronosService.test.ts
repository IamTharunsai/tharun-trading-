import axios from 'axios';
import { getForecast } from '../src/services/kronosService';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const candles = Array.from({ length: 10 }, (_, i) => ({
  open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000,
  timestamp: Date.now() - (10 - i) * 86400000,
}));

describe('kronosService.getForecast', () => {
  beforeEach(() => {
    process.env.KRONOS_SERVICE_URL = 'http://kronos-service.railway.internal:8000';
    jest.clearAllMocks();
  });

  it('returns the parsed forecast on a 200 response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { symbol: 'AAPL', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: 0.05 },
    });
    const result = await getForecast('AAPL', candles as any, 1);
    expect(result).toEqual({ symbol: 'AAPL', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: 0.05 });
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
        data: { symbol: 'AAPL', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: 0.05 },
      });
    const result = await getForecast('AAPL', candles as any, 1);
    expect(result?.symbol).toBe('AAPL');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });
});
