import * as M from '../src/trading/predictionMath';

const book: M.Book = {
  bids: [{ price: 0.40, size: 100 }, { price: 0.39, size: 200 }],
  asks: [{ price: 0.43, size: 50 }, { price: 0.42, size: 100 }, { price: 0.45, size: 500 }],
};

describe('fees and book walking', () => {
  it('uses the Polymarket US taker fee Θ·p·(1−p)', () => {
    expect(M.takerFeePerShare(0.0695, 0.5)).toBeCloseTo(0.017375);
    expect(M.takerFeePerShare(0.0695, 0.5) * 100).toBeCloseTo(1.74, 2); // docs example: 100 contracts @ $0.50
    expect(M.takerFeePerShare(0, 0.5)).toBe(0);
  });

  it('derives NO levels from the YES book (buy NO = sell YES into bids)', () => {
    expect(M.buyLevels(book, 'YES').map(l => l.price)).toEqual([0.42, 0.43, 0.45]);
    expect(M.buyLevels(book, 'NO').map(l => l.price)).toEqual([0.6, 0.61].map(x => Number(x.toFixed(2))));
    expect(M.sellLevels(book, 'NO')[0].price).toBeCloseTo(0.58);
  });

  it('walks levels for a VWAP and reports partial fills', () => {
    const f = M.walkLevels(M.buyLevels(book, 'YES'), 120);
    expect(f.fullyFilled).toBe(true);
    expect(f.vwap).toBeCloseTo((100 * 0.42 + 20 * 0.43) / 120);
    expect(f.slippage).toBeGreaterThan(0);
    expect(M.walkLevels(M.buyLevels(book, 'YES'), 10_000).fullyFilled).toBe(false);
    expect(M.depthAtOrBetter(M.buyLevels(book, 'YES'), 0.43)).toBe(150);
  });
});

describe('fair probability blend', () => {
  it('stays at the market price with no LLM estimate', () => {
    const r = M.blendFairProbability({ marketMid: 0.4 });
    expect(r.fair).toBeCloseTo(0.4, 6);
    expect(r.evidenceWeight).toBe(0);
  });

  it('shrinks hard toward the market when there is no news, less with fresh news', () => {
    const noNews = M.blendFairProbability({ marketMid: 0.4, llmProb: 0.6, llmConfidence: 80, headlineCount: 0 });
    const news = M.blendFairProbability({ marketMid: 0.4, llmProb: 0.6, llmConfidence: 80, headlineCount: 4, freshestHeadlineHours: 2 });
    const stale = M.blendFairProbability({ marketMid: 0.4, llmProb: 0.6, llmConfidence: 80, headlineCount: 4, freshestHeadlineHours: 72 });
    expect(noNews.fair).toBeGreaterThan(0.4);
    expect(noNews.fair).toBeLessThan(0.45);
    expect(news.fair).toBeGreaterThan(noNews.fair);
    expect(news.fair).toBeCloseTo(0.6 - 0.04, 1); // conf 0.8 × full news credit
    expect(stale.fair).toBeLessThan(news.fair);
  });

  it('caps the deviation from the market price', () => {
    const r = M.blendFairProbability({ marketMid: 0.3, llmProb: 0.99, llmConfidence: 100, headlineCount: 10, freshestHeadlineHours: 1 });
    expect(r.fair).toBeCloseTo(0.5, 6); // default maxDeviation 0.2
  });

  it('adds small sentiment and momentum nudges', () => {
    const base = M.blendFairProbability({ marketMid: 0.5 }).fair;
    expect(M.blendFairProbability({ marketMid: 0.5, sentimentScore: 1, sentimentMentions: 10 }).fair).toBeGreaterThan(base);
    expect(M.blendFairProbability({ marketMid: 0.5, sentimentScore: 1, sentimentMentions: 0 }).fair).toBeCloseTo(base);
    expect(M.blendFairProbability({ marketMid: 0.5, momentum: -0.4 }).fair).toBeLessThan(base);
  });

  it('computes logit momentum from price history', () => {
    const h = [{ t: 0, p: 0.4 }, { t: 43_200, p: 0.45 }, { t: 86_400, p: 0.5 }];
    expect(M.momentumFromHistory(h, 86_400)).toBeCloseTo(M.logit(0.5) - M.logit(0.4));
    expect(M.momentumFromHistory([{ t: 0, p: 0.5 }])).toBeNull();
  });
});

describe('edge after costs', () => {
  it('requires fee + half-spread + min edge over the taker price', () => {
    const e = M.computeSideEdges({ fairYes: 0.55, bestBid: 0.40, bestAsk: 0.42, theta: 0.0695, minEdge: 0.05, mode: 'taker' });
    const yes = e.find(x => x.side === 'YES')!;
    expect(yes.execPrice).toBe(0.42);
    expect(yes.required).toBeCloseTo(M.takerFeePerShare(0.0695, 0.42) + 0.01 + 0.05);
    expect(yes.netEdge).toBeCloseTo(0.13 - yes.required);
    expect(e[0].side).toBe('YES');
    const thin = M.computeSideEdges({ fairYes: 0.47, bestBid: 0.40, bestAsk: 0.42, theta: 0.0695, minEdge: 0.05, mode: 'taker' });
    expect(thin[0].netEdge).toBeLessThan(0);
  });

  it('limit mode prices one tick inside the spread with no fee; NO side mirrors', () => {
    const e = M.computeSideEdges({ fairYes: 0.30, bestBid: 0.40, bestAsk: 0.42, theta: 0.0695, minEdge: 0.05, mode: 'limit', tick: 0.001 });
    const no = e.find(x => x.side === 'NO')!;
    expect(no.execPrice).toBeCloseTo(0.581); // NO bid 0.58 + 1 tick
    expect(no.feePerShare).toBe(0);
    expect(e[0].side).toBe('NO');
  });
});

describe('sizing', () => {
  it('fractional Kelly scaled by confidence, then capped', () => {
    expect(M.kellyFraction(0.6, 0.5)).toBeCloseTo(0.2);
    expect(M.kellyFraction(0.4, 0.5)).toBe(0);
    const s = { fairSide: 0.6, costPerShare: 0.5, confidence: 1, bankrollUsd: 1000, kellyMultiplier: 0.25, maxBetUsd: 1000, maxBetPctOfBankroll: 1 };
    expect(M.sizeBetUsd(s)).toBeCloseTo(50);
    expect(M.sizeBetUsd({ ...s, confidence: 0.5 })).toBeCloseTo(25);
    expect(M.sizeBetUsd({ ...s, maxBetUsd: 5 })).toBe(5);
    expect(M.sizeBetUsd({ ...s, maxBetPctOfBankroll: 0.01 })).toBe(10);
  });
});

describe('scorecard metrics', () => {
  it('Brier, log loss and calibration buckets', () => {
    expect(M.brier(0.7, 1)).toBeCloseTo(0.09);
    expect(M.logLoss(0.5, 1)).toBeCloseTo(Math.log(2));
    const b = M.calibrationBuckets([{ p: 0.05, outcome: 0 }, { p: 0.95, outcome: 1 }, { p: 0.92, outcome: 0 }]);
    expect(b).toHaveLength(10);
    expect(b[9]).toMatchObject({ count: 2, observedFreq: 0.5 });
    expect(b[0].count).toBe(1);
  });

  it('Platt scaling corrects an overconfident model', () => {
    // Model says 90% but the event happens only ~60% of the time.
    const pts: Array<{ p: number; outcome: number }> = [];
    for (let i = 0; i < 200; i++) pts.push({ p: 0.9, outcome: i % 10 < 6 ? 1 : 0 });
    for (let i = 0; i < 200; i++) pts.push({ p: 0.1, outcome: i % 10 < 4 ? 1 : 0 });
    const c = M.fitPlatt(pts, 0.01);
    expect(M.applyPlatt(0.9, c)).toBeCloseTo(0.6, 1);
    expect(M.applyPlatt(0.1, c)).toBeCloseTo(0.4, 1);
    const id = M.fitPlatt([], 1);
    expect(id.a).toBeCloseTo(1); expect(id.b).toBeCloseTo(0);
  });
});
