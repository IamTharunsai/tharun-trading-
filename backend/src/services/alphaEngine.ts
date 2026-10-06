/**
 * INTEGRATION: Vibe-Trading → APEX
 * Alpha Zoo Engine — WorldQuant-inspired 101 Alphas
 *
 * Vibe-Trading ref: https://github.com/HKUDS/Vibe-Trading
 * Original paper: "101 Formulaic Alphas" (Zura Kakushadze, 2015)
 * APEX file location: backend/src/services/alphaEngine.ts
 *
 * Implements the 20 highest-capacity alphas from the 101 set,
 * adapted for APEX's daily OHLCV + fundamental data model.
 *
 * Usage:
 *   const engine = new AlphaEngine(priceHistory);
 *   const signals = await engine.computeAll();
 *   const composite = engine.compositeSignal(signals);
 */

export interface OHLCVBar {
  date: string;        // ISO date
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
  returns?: number;    // pre-computed daily return if available
}

export interface AlphaResult {
  alphaId: string;
  name: string;
  value: number;       // latest alpha value (normalized -1 to +1)
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;  // 0-100
  description: string;
}

export interface CompositeSignal {
  signal: 'BUY' | 'SELL' | 'HOLD';
  score: number;       // -1 (strong sell) to +1 (strong buy)
  confidence: number;
  alphas: AlphaResult[];
  bullCount: number;
  bearCount: number;
}

// ---- Rolling statistics helpers ----

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / arr.length);
}

function rank(arr: number[]): number[] {
  const sorted = [...arr].sort((a, b) => a - b);
  return arr.map(v => sorted.indexOf(v) / (arr.length - 1)); // 0-1 rank
}

function tsRank(series: number[], lookback: number): number {
  const window = series.slice(-lookback);
  const current = window[window.length - 1];
  const below = window.filter(v => v < current).length;
  return below / lookback;
}

function tsCorr(x: number[], y: number[], lookback: number): number {
  const xw = x.slice(-lookback);
  const yw = y.slice(-lookback);
  const mx = mean(xw), my = mean(yw);
  const num = xw.reduce((sum, xi, i) => sum + (xi - mx) * (yw[i] - my), 0);
  const den = std(xw) * std(yw) * lookback;
  return den === 0 ? 0 : num / den;
}

function delta(series: number[], d: number): number[] {
  return series.map((v, i) => i < d ? 0 : v - series[i - d]);
}

function rollingMean(series: number[], w: number): number[] {
  return series.map((_, i) => {
    if (i < w - 1) return NaN;
    return mean(series.slice(i - w + 1, i + 1));
  });
}

function rollingStd(series: number[], w: number): number[] {
  return series.map((_, i) => {
    if (i < w - 1) return NaN;
    return std(series.slice(i - w + 1, i + 1));
  });
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return (value - min) / (max - min) * 2 - 1; // -1 to +1
}

function toSignal(value: number, buyThreshold = 0.15, sellThreshold = -0.15): 'BUY' | 'SELL' | 'HOLD' {
  if (value > buyThreshold) return 'BUY';
  if (value < sellThreshold) return 'SELL';
  return 'HOLD';
}

function confidence(value: number): number {
  return Math.min(100, Math.round(Math.abs(value) * 100));
}

// ---- The 20 Alpha implementations ----

export class AlphaEngine {
  private bars: OHLCVBar[];
  private closes: number[];
  private opens: number[];
  private highs: number[];
  private lows: number[];
  private volumes: number[];
  private returns: number[];
  private vwaps: number[];

  constructor(bars: OHLCVBar[]) {
    if (bars.length < 30) throw new Error('AlphaEngine requires at least 30 bars of history');
    this.bars = bars;
    this.closes = bars.map(b => b.close);
    this.opens = bars.map(b => b.open);
    this.highs = bars.map(b => b.high);
    this.lows = bars.map(b => b.low);
    this.volumes = bars.map(b => b.volume);
    this.vwaps = bars.map(b => b.vwap ?? (b.high + b.low + b.close) / 3);
    this.returns = bars.map((b, i) => i === 0 ? 0 : (b.close - bars[i - 1].close) / bars[i - 1].close);
  }

  // Alpha #1: Corr between log-return and log-volume change, mean-reverted
  alpha001(): AlphaResult {
    const logRet = this.returns.map(r => Math.log(1 + r + 1e-10));
    const logVol = this.volumes.map(v => Math.log(v + 1));
    const logVolDelta = delta(logVol, 1);
    const corr = tsCorr(logRet, logVolDelta, 20);
    const val = -corr; // negative corr = buy (high return + falling volume = exhaustion reversal)
    return {
      alphaId: 'A001', name: 'Return-Volume Divergence',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val), confidence: confidence(val),
      description: 'Buy when returns are high but volume is contracting (strength into weakness)',
    };
  }

  // Alpha #2: -1 * correlation(rank(delta(log(volume),2)), rank((close-open)/open), 6)
  alpha002(): AlphaResult {
    const logVol = this.volumes.map(v => Math.log(v + 1));
    const deltaVol = delta(logVol, 2).slice(-20);
    const bodyRatio = this.closes.map((c, i) => (c - this.opens[i]) / this.opens[i]).slice(-20);
    const rankDVol = rank(deltaVol);
    const rankBody = rank(bodyRatio);
    const corr = tsCorr(rankDVol, rankBody, 6);
    const val = -corr;
    return {
      alphaId: 'A002', name: 'Volume-Body Rank Correlation',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val), confidence: confidence(val),
      description: 'Bearish when volume increases and price body grows (distribution)',
    };
  }

  // Alpha #3: -1 * correlation(rank(open), rank(volume), 10)
  alpha003(): AlphaResult {
    const n = this.closes.length;
    const openSlice = this.opens.slice(n - 10);
    const volSlice = this.volumes.slice(n - 10);
    const rankOpen = rank(openSlice);
    const rankVol = rank(volSlice);
    const corr = rankOpen.reduce((s, ro, i) => s + ro * rankVol[i], 0) / 10;
    const val = -(corr * 2 - 1); // approximate correlation from rank products
    return {
      alphaId: 'A003', name: 'Open-Volume Rank Anti-Corr',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val, 0.1, -0.1), confidence: confidence(val),
      description: 'Sell when high-price opens coincide with high volume (supply)',
    };
  }

  // Alpha #5: rank(open - ts_sum(vwap, 10) / 10) * -1 * rank(|close - vwap|)
  alpha005(): AlphaResult {
    const n = this.closes.length;
    const vwapMean10 = mean(this.vwaps.slice(n - 10));
    const openDev = this.opens[n - 1] - vwapMean10;
    const closeDev = Math.abs(this.closes[n - 1] - this.vwaps[n - 1]);

    // Normalized as a 0-to-1 rank approximation using recent history
    const openDevs = this.opens.slice(n - 20).map((o, i) => o - mean(this.vwaps.slice(n - 20 + i - 9, n - 20 + i + 1)));
    const closeDEvs = this.closes.slice(n - 20).map((c, i) => Math.abs(c - this.vwaps[n - 20 + i]));
    const rankOpenDev = rank(openDevs)[19];
    const rankCloseDev = rank(closeDEvs)[19];
    const val = -(rankOpenDev - 0.5) * (rankCloseDev - 0.5) * 4;

    return {
      alphaId: 'A005', name: 'VWAP Deviation Signal',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val), confidence: confidence(val),
      description: 'Capitalizes on extreme price deviations from VWAP',
    };
  }

  // Alpha #6: -1 * correlation(open, volume, 10)
  alpha006(): AlphaResult {
    const corr = tsCorr(this.opens, this.volumes, 10);
    const val = -corr;
    return {
      alphaId: 'A006', name: 'Open-Volume Anti-Correlation',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val, 0.1, -0.1), confidence: confidence(val),
      description: 'Mean reversion: sell when opening price rises with volume',
    };
  }

  // Alpha #7: (adv20 < volume) ? ((-1 * ts_rank(abs(delta(close, 7)), 60)) * sign(delta(close, 7))) : -1
  alpha007(): AlphaResult {
    const n = this.closes.length;
    const adv20 = mean(this.volumes.slice(n - 20));
    const currentVol = this.volumes[n - 1];
    const deltaClose7 = this.closes[n - 1] - this.closes[n - 8];
    const absDelta7 = Math.abs(deltaClose7);

    if (currentVol <= adv20) {
      return {
        alphaId: 'A007', name: 'Volume-Adjusted Momentum',
        value: -0.3, signal: 'SELL', confidence: 30,
        description: 'Low volume day — cautious bearish',
      };
    }

    const absDeltaHistory = this.closes.slice(n - 60).map((c, i) =>
      i < 7 ? 0 : Math.abs(c - this.closes[n - 60 + i - 7])
    );
    const rankMag = tsRank(absDeltaHistory, 60);
    const val = -rankMag * Math.sign(deltaClose7);

    return {
      alphaId: 'A007', name: 'Volume-Adjusted Momentum',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val), confidence: confidence(val),
      description: 'High-volume reversal signal: fade large moves on high volume',
    };
  }

  // Alpha #9: 0 < ts_min(delta(close,1), 5) → delta(close,1); ts_max(delta(close,1),5) < 0 → delta(close,1); else -delta(close,1)
  alpha009(): AlphaResult {
    const n = this.closes.length;
    const dailyDeltas = this.closes.slice(n - 6).map((c, i) => i === 0 ? 0 : c - this.closes[n - 6 + i - 1]);
    const minDelta = Math.min(...dailyDeltas.slice(1));
    const maxDelta = Math.max(...dailyDeltas.slice(1));
    const latestDelta = dailyDeltas[dailyDeltas.length - 1];

    let val: number;
    if (minDelta > 0) val = latestDelta;
    else if (maxDelta < 0) val = latestDelta;
    else val = -latestDelta;

    // Normalize by ATR proxy
    const atr5 = std(dailyDeltas.slice(1));
    const normVal = atr5 > 0 ? val / (atr5 * 3) : 0;

    return {
      alphaId: 'A009', name: 'Trend Consistency',
      value: Math.max(-1, Math.min(1, normVal)),
      signal: toSignal(normVal), confidence: confidence(normVal),
      description: 'Follow trend if consistent, fade if mixed (trend/mean-reversion hybrid)',
    };
  }

  // Alpha #12: sign(delta(volume, 1)) * (-1 * delta(close, 1))
  alpha012(): AlphaResult {
    const n = this.closes.length;
    const volChange = this.volumes[n - 1] - this.volumes[n - 2];
    const closeChange = this.closes[n - 1] - this.closes[n - 2];
    const raw = Math.sign(volChange) * (-closeChange);
    const atr = std(this.returns.slice(-20)) * this.closes[n - 1];
    const val = atr > 0 ? Math.max(-1, Math.min(1, raw / (atr * 3))) : 0;

    return {
      alphaId: 'A012', name: 'Volume-Price Divergence',
      value: val,
      signal: toSignal(val), confidence: confidence(val),
      description: 'Buy when volume up but price down (accumulation), sell otherwise',
    };
  }

  // Alpha #16: -1 * rank(covariance(rank(high), rank(volume), 5))
  alpha016(): AlphaResult {
    const n = this.closes.length;
    const highSlice = this.highs.slice(n - 5);
    const volSlice = this.volumes.slice(n - 5);
    const rankH = rank(highSlice);
    const rankV = rank(volSlice);
    const mH = mean(rankH), mV = mean(rankV);
    const cov = rankH.reduce((s, h, i) => s + (h - mH) * (rankV[i] - mV), 0) / 5;
    const val = -cov; // high-high rank correlates with volume-high = distribution
    return {
      alphaId: 'A016', name: 'High-Volume Covariance',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val, 0.1, -0.1), confidence: confidence(val),
      description: 'Bearish when highs and volume both rise together (distribution)',
    };
  }

  // Alpha #20: -1 * ((open - delay(high, 1)) * (open - delay(close, 1)) * (open - delay(low, 1)))
  alpha020(): AlphaResult {
    const n = this.closes.length;
    const prevH = this.highs[n - 2];
    const prevC = this.closes[n - 2];
    const prevL = this.lows[n - 2];
    const currO = this.opens[n - 1];
    const raw = -((currO - prevH) * (currO - prevC) * (currO - prevL));
    const scale = Math.pow(this.closes[n - 1], 3) * 0.001;
    const val = scale > 0 ? Math.max(-1, Math.min(1, raw / scale)) : 0;

    return {
      alphaId: 'A020', name: 'Gap-to-Prior-Range',
      value: val,
      signal: toSignal(val), confidence: confidence(val),
      description: 'Gap open analysis: positive when open gaps beyond prior range',
    };
  }

  // Alpha #25: rank(-returns * adv20 * vwap * (high - close))
  alpha025(): AlphaResult {
    const n = this.closes.length;
    const adv20 = mean(this.volumes.slice(n - 20));
    const ret = this.returns[n - 1];
    const vwap = this.vwaps[n - 1];
    const highClose = this.highs[n - 1] - this.closes[n - 1];
    const raw = -(ret * adv20 * vwap * highClose);

    // Normalize against 20-day rolling history
    const rawHistory = this.returns.slice(n - 20).map((r, i) => {
      const h = this.highs[n - 20 + i];
      const c = this.closes[n - 20 + i];
      const v = this.vwaps[n - 20 + i];
      return -(r * adv20 * v * (h - c));
    });
    const rk = tsRank(rawHistory, 20);
    const val = rk * 2 - 1;

    return {
      alphaId: 'A025', name: 'Return × Volume × VWAP × Wick',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val), confidence: confidence(val),
      description: 'Composite factor: positive return momentum adjusted for upper-wick rejection',
    };
  }

  // Alpha #28: scale(((correlation(adv20, low, 5) + ((high + low) / 2)) - close))
  alpha028(): AlphaResult {
    const n = this.closes.length;
    const adv20 = mean(this.volumes.slice(n - 20));
    const adv20Arr = new Array(5).fill(adv20);
    const lowSlice = this.lows.slice(n - 5);
    const corr = tsCorr(adv20Arr, lowSlice, 5);
    const midpoint = (this.highs[n - 1] + this.lows[n - 1]) / 2;
    const raw = corr + midpoint - this.closes[n - 1];
    const scale = this.closes[n - 1] * 0.02;
    const val = scale > 0 ? Math.max(-1, Math.min(1, raw / scale)) : 0;

    return {
      alphaId: 'A028', name: 'Volume-Low Correlation + Midpoint',
      value: val,
      signal: toSignal(val), confidence: confidence(val),
      description: 'Mean reversion: high when price closes below midpoint on avg-volume days',
    };
  }

  // Alpha #34: rank(((1 - rank(std(returns, 2))) + (1 - rank(delta(close, 1)))))
  alpha034(): AlphaResult {
    const n = this.closes.length;
    const recentRet = this.returns.slice(n - 20);
    const vol2 = rollingStd(recentRet, 2).filter(v => !isNaN(v));
    const rankVol = tsRank(vol2, vol2.length);
    const deltas = delta(this.closes, 1).slice(n - 20);
    const rankDelta = tsRank(deltas, deltas.length);
    const val = ((1 - rankVol) + (1 - rankDelta)) - 1; // center around 0

    return {
      alphaId: 'A034', name: 'Low Volatility + Low Momentum',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val), confidence: confidence(val),
      description: 'Buys quiet stocks with low recent momentum (calm before breakout)',
    };
  }

  // Alpha #35: ts_rank(volume, 32) * (1 - ts_rank((close + high - low), 16)) * (1 - ts_rank(returns, 32))
  alpha035(): AlphaResult {
    const n = this.closes.length;
    const volRank = tsRank(this.volumes.slice(n - 32), 32);
    const trueRange = this.closes.map((c, i) => c + this.highs[i] - this.lows[i]);
    const trRank = tsRank(trueRange.slice(n - 16), 16);
    const retRank = tsRank(this.returns.slice(n - 32), 32);
    const val = (volRank * (1 - trRank) * (1 - retRank)) * 2 - 0.5;

    return {
      alphaId: 'A035', name: 'Volume × Calm × Low Return',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val), confidence: confidence(val),
      description: 'High volume, tight range, negative returns = accumulation signal',
    };
  }

  // Alpha #40: -1 * rank(std(high, 10)) * correlation(high, volume, 10)
  alpha040(): AlphaResult {
    const n = this.closes.length;
    const highStd = std(this.highs.slice(n - 10));
    const highStdHistory = this.highs.slice(n - 30).map((_, i) =>
      i < 9 ? NaN : std(this.highs.slice(n - 30 + i - 9, n - 30 + i + 1))
    ).filter(v => !isNaN(v));
    const rankHighStd = tsRank(highStdHistory, highStdHistory.length);
    const corr = tsCorr(this.highs, this.volumes, 10);
    const val = -(rankHighStd - 0.5) * 2 * corr;

    return {
      alphaId: 'A040', name: 'High Volatility × Volume Corr',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val), confidence: confidence(val),
      description: 'Sell high-volatility moves confirmed by volume',
    };
  }

  // Alpha #54: -1 * ((low - close) * (open^5)) / ((low - high) * (close^5))
  alpha054(): AlphaResult {
    const n = this.closes.length;
    const l = this.lows[n - 1], c = this.closes[n - 1], o = this.opens[n - 1], h = this.highs[n - 1];
    const denom = (l - h) * Math.pow(c, 5);
    const val = denom !== 0 ? Math.max(-1, Math.min(1, -((l - c) * Math.pow(o, 5)) / denom)) : 0;

    return {
      alphaId: 'A054', name: 'Candle Shape Signal',
      value: val,
      signal: toSignal(val, 0.2, -0.2), confidence: confidence(val),
      description: 'Captures information in the intraday candle shape (shadows vs body)',
    };
  }

  // Alpha #60: 0 - (1 * ((2 * scale(rank((((close - low) - (high - close)) / (high - low)) * volume))) - scale(rank(ts_argmax(close, 10)))))
  alpha060(): AlphaResult {
    const n = this.closes.length;
    const c = this.closes[n - 1], h = this.highs[n - 1], l = this.lows[n - 1], v = this.volumes[n - 1];
    const range = h - l;
    const money_flow = range > 0 ? ((c - l) - (h - c)) / range * v : 0;

    // ts_argmax: position of max close in last 10 bars
    const last10 = this.closes.slice(n - 10);
    const argmax = last10.indexOf(Math.max(...last10)) / 9; // 0-1

    const val = -(2 * (money_flow > 0 ? 0.5 : -0.5) - argmax);

    return {
      alphaId: 'A060', name: 'Money Flow vs Recent High',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val), confidence: confidence(val),
      description: 'Bearish if price is near recent highs with negative money flow',
    };
  }

  // Alpha #101: ((close - open) / ((high - low) + .001))
  alpha101(): AlphaResult {
    const n = this.closes.length;
    const c = this.closes[n - 1], o = this.opens[n - 1], h = this.highs[n - 1], l = this.lows[n - 1];
    const val = (c - o) / (h - l + 0.001);

    return {
      alphaId: 'A101', name: 'Intraday Return Efficiency',
      value: Math.max(-1, Math.min(1, val)),
      signal: toSignal(val, 0.2, -0.2), confidence: confidence(val),
      description: 'Ratio of body to full range; +1 = full bull candle, -1 = full bear candle',
    };
  }

  // Volatility-adjusted momentum (custom addition)
  alphaVAM(): AlphaResult {
    const n = this.closes.length;
    const ret5 = (this.closes[n - 1] - this.closes[n - 6]) / this.closes[n - 6];
    const vol10 = std(this.returns.slice(n - 10));
    const sharpe5 = vol10 > 0 ? ret5 / (vol10 * Math.sqrt(5)) : 0;
    const val = Math.max(-1, Math.min(1, sharpe5 / 3));

    return {
      alphaId: 'AVAM', name: 'Volatility-Adjusted Momentum (5d)',
      value: val,
      signal: toSignal(val), confidence: confidence(val),
      description: 'Sharpe-scaled 5-day momentum; risk-normalized trend signal',
    };
  }

  // ---- Main compute function ----
  computeAll(): AlphaResult[] {
    const alphas = [
      this.alpha001(),
      this.alpha002(),
      this.alpha003(),
      this.alpha005(),
      this.alpha006(),
      this.alpha007(),
      this.alpha009(),
      this.alpha012(),
      this.alpha016(),
      this.alpha020(),
      this.alpha025(),
      this.alpha028(),
      this.alpha034(),
      this.alpha035(),
      this.alpha040(),
      this.alpha054(),
      this.alpha060(),
      this.alpha101(),
      this.alphaVAM(),
    ];
    return alphas;
  }

  // ---- Composite signal ----
  compositeSignal(alphas?: AlphaResult[]): CompositeSignal {
    const results = alphas ?? this.computeAll();
    const scores = results.map(a => a.value);
    const weights = results.map(a => a.confidence / 100);
    const totalWeight = weights.reduce((s, w) => s + w, 0);

    const weightedScore = scores.reduce((s, v, i) => s + v * weights[i], 0) / (totalWeight || 1);

    const bullCount = results.filter(a => a.signal === 'BUY').length;
    const bearCount = results.filter(a => a.signal === 'SELL').length;

    let signal: 'BUY' | 'SELL' | 'HOLD';
    if (weightedScore > 0.15 && bullCount > bearCount) signal = 'BUY';
    else if (weightedScore < -0.15 && bearCount > bullCount) signal = 'SELL';
    else signal = 'HOLD';

    return {
      signal,
      score: Math.round(weightedScore * 1000) / 1000,
      confidence: Math.min(100, Math.round(Math.abs(weightedScore) * 150)),
      alphas: results,
      bullCount,
      bearCount,
    };
  }
}

/**
 * Helper: build AlphaEngine from APEX's Trade/market data
 * Usage: const engine = buildAlphaEngine(marketDataArray);
 */
export function buildAlphaEngine(data: Array<{
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>): AlphaEngine {
  const bars: OHLCVBar[] = data.map((d, i) => ({
    ...d,
    vwap: (d.high + d.low + d.close) / 3,
    returns: i === 0 ? 0 : (d.close - data[i - 1].close) / data[i - 1].close,
  }));
  return new AlphaEngine(bars);
}

/**
 * Integrate into debate engine: add as a Tier-1 alpha agent
 *
 * In backend/src/agents/debateEngine.ts, add:
 *
 * import { buildAlphaEngine } from '../services/alphaEngine';
 *
 * async function runAlphaZooAgent(asset: string, bars: OHLCVBar[]): Promise<AgentVote> {
 *   const engine = buildAlphaEngine(bars);
 *   const composite = engine.compositeSignal();
 *   return {
 *     agentId: 'alpha-zoo',
 *     agentName: 'Alpha Zoo (19 Formulaic Alphas)',
 *     signal: composite.signal,
 *     confidence: composite.confidence,
 *     reasoning: `Score: ${composite.score.toFixed(3)} | Bull/Bear: ${composite.bullCount}/${composite.bearCount} | Top: ${composite.alphas.sort((a,b)=>b.confidence-a.confidence)[0].name}`,
 *     tier: 1,
 *   };
 * }
 */
