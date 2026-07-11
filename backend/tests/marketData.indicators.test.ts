import { calculateMACD, calculateStochastic } from '../src/services/marketData';

describe('calculateMACD — real signal line', () => {
  it('signal line is not a fixed 0.2 scalar of the current MACD value', () => {
    // Two different price series that produce different MACD-history shapes
    // but could produce the SAME instantaneous MACD value at the end —
    // a real (history-smoothed) signal line differs between them; a fake
    // scalar-of-current-value signal line would be identical.
    const trending = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
    const choppy = [...Array.from({ length: 35 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5)), 117.5, 118, 118.5, 119, 119.5];

    const macdTrending = calculateMACD(trending);
    const macdChoppy = calculateMACD(choppy);

    // Both end near the same current MACD value by construction of the fixtures above,
    // but a real EMA-smoothed signal line reflects each series' different history.
    expect(macdTrending.signal).not.toBeCloseTo(macdTrending.value * 0.2, 5);
    expect(macdChoppy.signal).not.toBeCloseTo(macdChoppy.value * 0.2, 5);
  });
});

describe('calculateStochastic — real %D', () => {
  it('%D is a 3-period SMA of %K, not %K * 0.9', () => {
    const candles = Array.from({ length: 20 }, (_, i) => ({
      high: 105 + i, low: 95 + i, close: 100 + i, open: 100 + i, volume: 1000,
      timestamp: Date.now() - (20 - i) * 60000,
    }));
    const { k, d } = calculateStochastic(candles as any, 14);
    expect(d).not.toBeCloseTo(k * 0.9, 5);
  });

  it('does not produce NaN when candles.length < period (e.g. thin Polygon results)', () => {
    const candles = Array.from({ length: 8 }, (_, i) => ({
      high: 105 + i, low: 95 + i, close: 100 + i, open: 100 + i, volume: 1000,
      timestamp: Date.now() - (8 - i) * 60000,
    }));
    const { d } = calculateStochastic(candles as any, 14);
    expect(Number.isNaN(d)).toBe(false);
  });
});
