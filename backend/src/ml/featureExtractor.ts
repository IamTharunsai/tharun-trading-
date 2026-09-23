import { MarketSnapshot, TechnicalIndicators } from '../agents/types';

export const FEATURE_COUNT = 50;

function n(v: number | undefined, fallback = 0): number {
  return Number.isFinite(v as number) ? (v as number) : fallback;
}

function pctB(ind: TechnicalIndicators, price: number): number {
  const { upper, lower } = ind.bollingerBands || { upper: price, lower: price };
  const span = upper - lower;
  if (!span) return 0.5;
  return (price - lower) / span;
}

function bbWidth(ind: TechnicalIndicators): number {
  const { upper, lower, middle } = ind.bollingerBands || { upper: 0, lower: 0, middle: 0 };
  if (!middle) return 0;
  return (upper - lower) / middle;
}

/**
 * 50-float feature vector per APEX-3 ApexLearner spec.
 * Missing optional intelligence fields are zero-filled so the vector length is stable.
 */
export function extractFeatures(
  snapshot: MarketSnapshot,
  extras: {
    newsScore?: number;
    wsbMentions?: number;
    stocktwitsScore?: number;
    optionsBias?: number;
    socialMomentum?: number;
    spyRegime?: number;
    vixLevel?: number;
    spyVs200ma?: number;
    sectorRank?: number;
    riskEnv?: number;
    peVsSector?: number;
    revGrowth?: number;
    epsSurprise?: number;
    analystRevision?: number;
    insiderSignal?: number;
    tier1Consensus?: number;
    tier2Consensus?: number;
    riskScore?: number;
    regimeFit?: number;
    toptraderScore?: number;
    kellyConfidence?: number;
    corrPenalty?: number;
  } = {}
): number[] {
  const ind = snapshot.indicators;
  const price = snapshot.price || 1;
  const candles = snapshot.candles || [];
  const close = (i: number) => candles[candles.length - 1 - i]?.close ?? price;
  const ret = (bars: number) => {
    const older = close(bars);
    if (!older) return 0;
    return (price - older) / older;
  };

  const rsi = n(ind.rsi14, 50);
  const macdHist = n(ind.macd?.histogram);
  const atrPct = n(ind.atr14) / price;
  const features: number[] = [
    rsi / 100,
    macdHist,
    pctB(ind, price),
    atrPct,
    price / (n(ind.ema21, price) || price),
    price / (n(ind.sma50, price) || price),
    price / (n(ind.vwap, price) || price),
    n(ind.stochasticK, 50) / 100,
    (rsi - 50) / 50, // williams-r proxy
    (price - n(ind.sma50, price)) / (n(ind.atr14, 1) || 1), // cci-ish
    n(ind.volumeRatio, 1),
    n(ind.obv) === 0 ? 0 : Math.tanh(n(ind.obv) / 1e6),
    Math.min(n(ind.volumeRatio, 1), 5) / 5, // mfi proxy
    snapshot.priceChangePct24h / 100,
    n(ind.volumeRatio) > 1 ? 1 : -1, // A/D proxy
    Math.tanh(n(ind.obv) / 5e6),
    ret(1),
    ret(5),
    ret(20),
    ret(Math.min(60, candles.length - 1)),
    0.4 * ret(1) + 0.3 * ret(5) + 0.2 * ret(20) + 0.1 * ret(Math.min(60, candles.length - 1)),
    ret(10),
    atrPct,
    atrPct * 1.2,
    bbWidth(ind),
    n(ind.atr14) / (n(ind.ema21, 1) || 1),
    atrPct > 0.03 ? 1 : 0,
    n(extras.spyRegime),
    n(extras.vixLevel) / 20 - 1,
    n(extras.spyVs200ma),
    n(extras.sectorRank) / 11,
    n(extras.riskEnv),
    n(extras.peVsSector),
    n(extras.revGrowth),
    n(extras.epsSurprise),
    n(extras.analystRevision),
    n(extras.insiderSignal),
    n(extras.newsScore),
    n(extras.wsbMentions),
    n(extras.stocktwitsScore),
    n(extras.optionsBias),
    n(extras.socialMomentum),
    n(extras.tier1Consensus),
    n(extras.tier2Consensus),
    n(extras.riskScore),
    n(extras.regimeFit),
    n(extras.toptraderScore) / 100,
    n(extras.kellyConfidence),
    n(extras.corrPenalty),
    Math.sin((2 * Math.PI * new Date().getUTCHours()) / 24),
  ];

  while (features.length < FEATURE_COUNT) features.push(0);
  return features.slice(0, FEATURE_COUNT);
}
