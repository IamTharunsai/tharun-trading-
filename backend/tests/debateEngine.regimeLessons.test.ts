describe('buildMarketContext — regime-matched lessons section', () => {
  it('includes a REGIME HISTORY section when regimeLessons is provided', () => {
    const { __test__buildMarketContext } = require('../src/agents/debateEngine');
    const snapshot = {
      asset: 'AAPL', price: 150, priceChangePct24h: 1.2, volume24h: 1000000,
      indicators: {
        rsi14: 55, macd: { histogram: 0.1 }, stochasticK: 60, stochasticD: 58,
        bollingerBands: { upper: 155, middle: 150, lower: 145 },
        ema9: 151, ema21: 149, ema200: 140, sma50: 148, sma200: 142,
        vwap: 150, atr14: 2, week52High: 160, week52Low: 120, distanceFrom52wHigh: 6,
        fibonacci: { r236: 152, r382: 150, r500: 148, r618: 146 },
        isAboveSma200: true, isSma50AboveSma200: true, volumeRatio: 1.1, obv: 1,
      },
    };
    const portfolio = { totalValue: 100000, cashBalance: 40000, pnlDayPct: 0 };
    const context = __test__buildMarketContext(
      snapshot, portfolio, 'TRENDING_BULL', '', '', '', '', '', '',
      'Past debates on AAPL in TRENDING_BULL regime:\n2026-07-01: BUY (72% confidence), executed'
    );
    expect(context).toContain('REGIME HISTORY');
    expect(context).toContain('2026-07-01: BUY');
  });

  it('omits the section entirely when regimeLessons is empty', () => {
    const { __test__buildMarketContext } = require('../src/agents/debateEngine');
    const snapshot = {
      asset: 'AAPL', price: 150, priceChangePct24h: 1.2, volume24h: 1000000,
      indicators: {
        rsi14: 55, macd: { histogram: 0.1 }, stochasticK: 60, stochasticD: 58,
        bollingerBands: { upper: 155, middle: 150, lower: 145 },
        ema9: 151, ema21: 149, ema200: 140, sma50: 148, sma200: 142,
        vwap: 150, atr14: 2, week52High: 160, week52Low: 120, distanceFrom52wHigh: 6,
        fibonacci: { r236: 152, r382: 150, r500: 148, r618: 146 },
        isAboveSma200: true, isSma50AboveSma200: true, volumeRatio: 1.1, obv: 1,
      },
    };
    const portfolio = { totalValue: 100000, cashBalance: 40000, pnlDayPct: 0 };
    const context = __test__buildMarketContext(snapshot, portfolio, 'TRENDING_BULL', '', '', '', '', '', '', '');
    expect(context).not.toContain('REGIME HISTORY');
  });
});
