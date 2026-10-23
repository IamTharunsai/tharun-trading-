import axios from 'axios';
import { getForecast, validateKronosForecast } from '../src/services/kronosService';
import { logger } from '../src/utils/logger';

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

const warnMock = logger.warn as unknown as jest.Mock;

// The exact response shape kronos-service/forecast.py produces after the
// quantile-band fix: ensemble of 5 sampled paths over a 5-step horizon for
// a series whose last close is 149.5. The literals are the Python
// implementation's own output for that ensemble (mean of runs, 0.16/0.84
// ensemble quantiles enveloped against the mean, meanReturn recomputed
// from the returned final predicted close) — not hand-rounded values.
const serviceShaped = {
  symbol: 'AAPL',
  predictedClose: [150, 150.7, 151.4, 152.1, 152.8],
  upperBand: [151.36, 151.86, 152.36, 153.18, 154],
  lowerBand: [148.64, 149.46, 150.28, 151.1, 151.92],
  meanReturn: 0.022073578595317802,
};

describe('kronosService.validateKronosForecast', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('accepts a service-shaped response and logs nothing', () => {
    expect(validateKronosForecast(serviceShaped, 'AAPL', 5, 149.5)).toEqual(serviceShaped);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('accepts the service-shaped response end to end through getForecast', async () => {
    process.env.KRONOS_SERVICE_URL = 'http://kronos-service.railway.internal:8000';
    const serviceCandles = Array.from({ length: 10 }, (_, i) => ({
      open: 140 + i, high: 141 + i, low: 139 + i, close: 140.5 + i, volume: 1000,
      timestamp: Date.now() - (10 - i) * 86400000,
    }));
    serviceCandles[serviceCandles.length - 1].close = 149.5;
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: serviceShaped });
    const result = await getForecast('AAPL', serviceCandles as any, 5);
    expect(result).toEqual(serviceShaped);
  });

  const base = {
    symbol: 'AAPL',
    predictedClose: [101, 102, 103],
    upperBand: [104, 105, 106],
    lowerBand: [98, 99, 100],
    meanReturn: 0.03, // (103 - 100) / 100
  };

  it('names the schema check (and the failing path) when a band value is non-positive', () => {
    expect(validateKronosForecast({ ...base, lowerBand: [98, -1, 100] }, 'AAPL', 3, 100)).toBeNull();
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining('schema'),
      expect.objectContaining({
        check: 'schema',
        issues: expect.arrayContaining([expect.stringContaining('lowerBand')]),
        arrays: expect.objectContaining({ lowerBand: expect.objectContaining({ min: -1 }) }),
      }),
    );
  });

  it('names the symbol check on a symbol mismatch', () => {
    expect(validateKronosForecast({ ...base, symbol: 'MSFT' }, 'AAPL', 3, 100)).toBeNull();
    expect(warnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ check: 'symbol', received: 'MSFT' }),
    );
  });

  it('names the length check with the actual array lengths', () => {
    expect(validateKronosForecast({ ...base, upperBand: [104, 105] }, 'AAPL', 3, 100)).toBeNull();
    expect(warnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        check: 'length', predLen: 3,
        lengths: expect.objectContaining({ upperBand: 2 }),
      }),
    );
  });

  it('names the band-order check with the violating index', () => {
    expect(validateKronosForecast({ ...base, lowerBand: [102, 99, 100] }, 'AAPL', 3, 100)).toBeNull();
    expect(warnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ check: 'band-order', index: 0 }),
    );
  });

  it('names the meanReturn check with the delta when the return disagrees', () => {
    expect(validateKronosForecast({ ...base, meanReturn: 0.05 }, 'AAPL', 3, 100)).toBeNull();
    expect(warnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ check: 'meanReturn', expected: 0.03, received: 0.05 }),
    );
  });
});

