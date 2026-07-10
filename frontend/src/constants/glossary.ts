// Plain-English definitions for the indicator jargon shown on Charts —
// native title attribute tooltips, no extra UI dependency needed.
export const GLOSSARY: Record<string, string> = {
  'Trend vs EMA9': 'Whether price is trading above or below its 9-period Exponential Moving Average — above suggests short-term bullish momentum, below suggests bearish.',
  RSI: 'Relative Strength Index (0-100): measures how fast/hard price has moved recently. Above 70 = overbought (may pull back), below 30 = oversold (may bounce).',
  MACD: 'Moving Average Convergence Divergence: the gap between a fast and slow moving average. A positive histogram means bullish momentum is building; negative means bearish.',
  Bollinger: 'Bollinger Bands: a volatility envelope 2 standard deviations above/below the 20-day average price. Price at the upper band = statistically stretched high; lower band = stretched low.',
  Stochastic: 'Stochastic Oscillator (0-100): compares the current close to its recent trading range. Above 80 = overbought, below 20 = oversold.',
  EMA9: '9-period Exponential Moving Average — a fast-moving trend line, weighted toward recent prices.',
  EMA21: '21-period Exponential Moving Average — a medium-speed trend line.',
  EMA200: '200-period Exponential Moving Average — the long-term trend line institutions watch most; price above it is broadly considered a bull market for that asset.',
  ATR14: 'Average True Range (14-period): the typical size of price swings recently, in dollars. Used to size stop-losses to each asset\'s real volatility instead of a fixed %.',
  VWAP: 'Volume-Weighted Average Price: the average price paid for the asset today, weighted by how much volume traded at each price. Institutions often use it as a fair-value benchmark.',
  'Bollinger Upper': 'The upper Bollinger Band — 2 standard deviations above the 20-day moving average.',
  'Bollinger Lower': 'The lower Bollinger Band — 2 standard deviations below the 20-day moving average.',
  'MACD Histogram': 'The gap between the MACD line and its signal line. Growing positive bars = strengthening bullish momentum; growing negative bars = strengthening bearish momentum.',
};

// Longest key first — "Bollinger Upper" must win over the shorter "Bollinger"
// when both are valid startsWith matches for the same label.
const SORTED_KEYS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);

export function glossaryTitle(label: string): string {
  const key = SORTED_KEYS.find(k => label.startsWith(k));
  return key ? GLOSSARY[key] : '';
}
