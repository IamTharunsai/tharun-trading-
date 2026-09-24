import { resolveCapitalTier, resolveDrawdownMode, resolveSurvivalPolicy, marketAllowed } from '../src/services/survivalEngine';
import { computeExpectedValue, shouldKillTrade } from '../src/services/expectedValueEngine';
import { computePApex, bayesianUpdate, categoryBaseRate } from '../src/services/polymarketProbability';
import { extractFeatures, FEATURE_COUNT } from '../src/ml/featureExtractor';
import { ApexLearner } from '../src/ml/apexLearner';
import { runTier1Agents } from '../src/agents/tier1Agents';
import { dailyApiBudgetUsd } from '../src/services/apiCostTracker';
import { scoreMdaLanguage, scoreEarningsTranscript } from '../src/services/secEdgarService';
import { weightedConsensus } from '../src/ml/agentWeights';
import { MarketSnapshot, PortfolioState } from '../src/agents/types';

describe('APEX-3 survival engine', () => {
  it('maps bankroll to five capital tiers', () => {
    expect(resolveCapitalTier(150)).toBe('CRITICAL');
    expect(resolveCapitalTier(100)).toBe('CRITICAL');
    expect(resolveCapitalTier(400)).toBe('CAUTION');
    expect(resolveCapitalTier(600)).toBe('NORMAL');
    expect(resolveCapitalTier(30)).toBe('SURVIVAL');
    expect(resolveCapitalTier(8)).toBe('REBIRTH');
  });

  it('uses APEX-3 drawdown bands 5/10/20', () => {
    expect(resolveDrawdownMode(4, 0)).toBe('NORMAL');
    expect(resolveDrawdownMode(6, 0)).toBe('CAUTION');
    expect(resolveDrawdownMode(12, 0)).toBe('RECOVERY');
    expect(resolveDrawdownMode(21, 0)).toBe('DEFEND');
    expect(resolveDrawdownMode(0, -6)).toBe('DEFEND');
  });

  it('blocks stocks below SURVIVAL and DEFEND kills new trades', () => {
    const survival = resolveSurvivalPolicy({ bankroll: 25, drawdownFromPeakPct: 0, dailyLossPct: 0 });
    expect(survival.allowStocks).toBe(false);
    expect(survival.allowPolymarket).toBe(true);
    expect(survival.allowCloudAI).toBe(false);
    expect(marketAllowed(survival, 'stocks')).toBe(false);
    expect(marketAllowed(survival, 'prediction')).toBe(true);

    const defend = resolveSurvivalPolicy({ bankroll: 500, drawdownFromPeakPct: 22, dailyLossPct: 0 });
    expect(defend.drawdownMode).toBe('DEFEND');
    expect(defend.riskMultiplier).toBe(0);
    expect(marketAllowed(defend, 'prediction')).toBe(false);
  });

  it('caps daily Claude budget at min($2, 2% bankroll)', () => {
    expect(dailyApiBudgetUsd(50)).toBe(1);
    expect(dailyApiBudgetUsd(1000)).toBe(2);
  });
});

describe('APEX-∞ expected value', () => {
  it('kills negative EV and accepts positive EV with PF>1.2', () => {
    const good = computeExpectedValue({ winProbability: 0.6, avgWin: 2, avgLoss: 1 });
    expect(good.positive).toBe(true);
    expect(good.halfKellyFraction).toBeGreaterThan(0);
    expect(shouldKillTrade(good, 0.01)).toBe(false);

    const bad = computeExpectedValue({ winProbability: 0.3, avgWin: 1, avgLoss: 2 });
    expect(bad.ev).toBeLessThan(0);
    expect(shouldKillTrade(bad, 0.01)).toBe(true);
  });

  it('caps half-Kelly at 2% of bankroll', () => {
    const ev = computeExpectedValue({ winProbability: 0.9, avgWin: 10, avgLoss: 1 });
    expect(ev.cappedBetPct).toBeLessThanOrEqual(0.02);
  });
});

describe('Polymarket P_apex + superforecasting', () => {
  it('uses incumbent base rate 65%', () => {
    expect(categoryBaseRate('politics', 'Will the incumbent win re-election?')).toBe(0.65);
  });

  it('Bayesian-updates a prior', () => {
    const p = bayesianUpdate(0.3, 0.78, 0.3);
    expect(p).toBeGreaterThan(0.3);
    expect(p).toBeLessThan(0.9);
  });

  it('requires 8% edge and $500 book, skips lottery tickets', () => {
    const hit = computePApex({
      marketYesPrice: 0.45,
      category: 'election',
      newsSignal: 0.8,
      modelPrediction: 0.7,
      orderBookImbalance: 0.4,
      daysToResolution: 5,
      bookDepthUsd: 2000,
    });
    expect(hit.pApex).toBeGreaterThan(0.45);
    expect(['YES', 'NO', 'SKIP']).toContain(hit.side);

    const lottery = computePApex({
      marketYesPrice: 0.02,
      category: 'general',
      newsSignal: 0,
      daysToResolution: 3,
      bookDepthUsd: 5000,
    });
    expect(lottery.side).toBe('SKIP');

    const thin = computePApex({
      marketYesPrice: 0.5,
      category: 'general',
      newsSignal: 1,
      modelPrediction: 0.8,
      daysToResolution: 3,
      bookDepthUsd: 100,
    });
    expect(thin.side).toBe('SKIP');
  });
});

describe('feature extractor + online learner', () => {
  const snapshot = {
    asset: 'AAPL',
    market: 'stocks',
    price: 100,
    priceChange24h: 1,
    priceChangePct24h: 1,
    volume24h: 1e6,
    volumeChange: 0,
    high24h: 101,
    low24h: 99,
    candles: Array.from({ length: 30 }, (_, i) => ({ open: 99, high: 101, low: 98, close: 100 + i * 0.01, volume: 1000, timestamp: i })),
    indicators: {
      rsi14: 55, macd: { value: 0.1, signal: 0.05, histogram: 0.05 },
      bollingerBands: { upper: 105, middle: 100, lower: 95 },
      ema9: 101, ema21: 100, ema200: 90, sma50: 98, sma200: 90,
      atr14: 2, obv: 1000, stochasticK: 60, stochasticD: 55, volumeAvg20: 900,
      vwap: 99.5, fibonacci: { r236: 0, r382: 0, r500: 0, r618: 0, r786: 0 },
      week52High: 120, week52Low: 80, distanceFrom52wHigh: 0.1,
      isAboveSma50: true, isAboveSma200: true, isSma50AboveSma200: true, volumeRatio: 1.4,
    },
    bidPrice: 99.9, askPrice: 100.1, spread: 0.2, timestamp: Date.now(),
  } as MarketSnapshot;

  it('emits 50 features', () => {
    const f = extractFeatures(snapshot, { tier1Consensus: 0.7, newsScore: 0.2 });
    expect(f).toHaveLength(FEATURE_COUNT);
    expect(f.every(x => Number.isFinite(x))).toBe(true);
  });

  it('updates win probability after profitable trades', () => {
    const learner = new ApexLearner(null); // Synthetic test outcomes must never train the deployed model.
    const f = extractFeatures(snapshot);
    const before = learner.predictWinProbability(f);
    for (let i = 0; i < 12; i++) learner.learnFromTrade(f, 1);
    const after = learner.predictWinProbability(f);
    expect(after).toBeGreaterThanOrEqual(before);
    expect(learner.nTrades).toBeGreaterThanOrEqual(12);
  });
});

describe('Tier-1 rule agents', () => {
  it('rejects DEFEND mode', () => {
    const snapshot = {
      asset: 'AAPL', market: 'stocks', price: 100,
      priceChange24h: 1, priceChangePct24h: 1, volume24h: 1, volumeChange: 0, high24h: 101, low24h: 99,
      candles: [],
      indicators: {
        rsi14: 60, macd: { value: 1, signal: 0, histogram: 1 },
        bollingerBands: { upper: 110, middle: 100, lower: 90 },
        ema9: 101, ema21: 100, ema200: 90, sma50: 98, sma200: 90,
        atr14: 2, obv: 1, stochasticK: 70, stochasticD: 60, volumeAvg20: 1,
        vwap: 99, fibonacci: { r236: 0, r382: 0, r500: 0, r618: 0, r786: 0 },
        week52High: 1, week52Low: 1, distanceFrom52wHigh: 0,
        isAboveSma50: true, isAboveSma200: true, isSma50AboveSma200: true, volumeRatio: 2,
      },
      bidPrice: 100, askPrice: 100, spread: 0, timestamp: 0,
    } as MarketSnapshot;
    const portfolio = {
      totalValue: 100, cashBalance: 100, invested: 0, pnlDay: 0, pnlDayPct: 0, pnlWeekPct: 0,
      pnlTotal: 0, positions: [], dailyLossToday: 0, tradesExecutedToday: 0, drawdownFromPeak: 25,
    } as PortfolioState;
    const policy = resolveSurvivalPolicy({ bankroll: 100, drawdownFromPeakPct: 25, dailyLossPct: 0 });
    const result = runTier1Agents(snapshot, portfolio, policy);
    expect(result.rejected).toBe(true);
    expect(result.dominant).toBe('HOLD');
  });
});

describe('MD&A + earnings NLP', () => {
  it('flags buried bad news and raised guidance', () => {
    const red = scoreMdaLanguage('We face a challenging macroeconomic environment and visibility is limited.');
    expect(red.score).toBeLessThan(0);
    const green = scoreMdaLanguage('Record revenue and raised full-year guidance. Repurchasing shares.');
    expect(green.score).toBeGreaterThan(0);
    const earn = scoreEarningsTranscript('The board authorized a share buyback and we raised full-year outlook.');
    expect(earn.trade).toBe(true);
    expect(earn.direction).toBe('BUY');
  });
});

describe('agent weight consensus', () => {
  it('down-weights losing agents', () => {
    const c = weightedConsensus({ a: 1, b: 0 }, { a: 2, b: 0.25 });
    expect(c).toBeCloseTo(2 / 2.25);
  });
});
