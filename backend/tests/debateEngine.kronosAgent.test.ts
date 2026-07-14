describe('Agent #14 — Quant Forecaster wiring', () => {
  it('AGENT_ROSTER includes id 14 with the Quant Forecaster persona', () => {
    const { AGENT_ROSTER } = require('../src/agents/debateEngine');
    const agent14 = AGENT_ROSTER.find((a: any) => a.id === 14);
    expect(agent14).toBeDefined();
    expect(agent14.name).toBe('Quant Forecaster');
    expect(typeof agent14.systemPrompt).toBe('string');
    expect(agent14.systemPrompt.length).toBeGreaterThan(0);
  });

  it('round1Roster still excludes only id 10 (Devil\'s Advocate), not id 14', () => {
    const debateEngineSrc = require('fs').readFileSync(
      require('path').join(__dirname, '../src/agents/debateEngine.ts'), 'utf-8'
    );
    const match = debateEngineSrc.match(/AGENT_ROSTER\.filter\(a => a\.id !== (\d+)\)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('10');
  });

  it('buildMarketContext includes the forecast section when forecastSummary is provided', () => {
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
      snapshot, portfolio, 'TRENDING', '', '', '', '', '',
      'Predicted close (5-bar): $152.30 (band $150.10-$154.50) | Expected return: +1.5%'
    );
    expect(context).toContain('QUANT FORECAST');
    expect(context).toContain('152.30');
  });
});
