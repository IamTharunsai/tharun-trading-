// ── PRE-DEBATE GATE ───────────────────────────────────────────────────────────
// A full committee debate is ~30 LLM calls. Running it on every screened symbol
// spends more on tokens than a small account can earn. This free, deterministic
// check only lets a symbol into the (paid) debate when a known long setup is
// actually present. Disable with PRE_DEBATE_GATE=off.
export interface GateInput {
  price: number;
  indicators: {
    rsi14: number;
    ema9: number;
    ema21: number;
    ema200: number;
    volumeAvg20: number;
    atr14: number;
  };
  volume24h: number;
  /** Optional news sentiment (sentimentService, no X reads) for spike candidates. */
  sentiment?: { score: number; mentionCount: number; volumeZScore: number; baselineSamples?: number } | null;
}

export interface GateResult { pass: boolean; setup?: 'TREND_PULLBACK' | 'MOMENTUM_BREAKOUT' | 'OVERSOLD_REVERSION' | 'SENTIMENT_SPIKE'; reason: string }

export function preDebateGate(s: GateInput): GateResult {
  if (process.env.PRE_DEBATE_GATE === 'off') return { pass: true, reason: 'gate disabled' };
  const { price } = s;
  const { rsi14, ema9, ema21, ema200, volumeAvg20, atr14 } = s.indicators || ({} as any);
  const nums = [price, rsi14, ema9, ema21, ema200];
  if (nums.some(n => !Number.isFinite(n) || n <= 0)) return { pass: false, reason: 'insufficient indicator data' };

  const atrPct = Number.isFinite(atr14) && price > 0 ? atr14 / price : 0;
  if (atrPct > 0.08) return { pass: false, reason: `too volatile (ATR ${(atrPct * 100).toFixed(1)}% of price)` };

  const uptrend = price > ema200 && ema9 > ema21;
  const relVol = volumeAvg20 > 0 ? s.volume24h / volumeAvg20 : 1;

  if (uptrend && rsi14 >= 40 && rsi14 <= 55 && price <= ema9 * 1.01) {
    return { pass: true, setup: 'TREND_PULLBACK', reason: 'uptrend + RSI reset + price near EMA9' };
  }
  if (uptrend && rsi14 > 55 && rsi14 < 72 && relVol >= 1.5) {
    return { pass: true, setup: 'MOMENTUM_BREAKOUT', reason: `uptrend + ${relVol.toFixed(1)}x volume` };
  }
  if (price > ema200 && rsi14 < 30) {
    return { pass: true, setup: 'OVERSOLD_REVERSION', reason: 'oversold inside a long-term uptrend' };
  }
  // Sentiment spike: unusually many fresh, positive mentions (z-score vs. our
  // own 7-day history) while still in a long-term uptrend. This only earns a
  // committee review — the technical votes still decide, and sentiment can
  // only veto/size afterwards.
  const sent = s.sentiment;
  const spikeZ = Number(process.env.SENTIMENT_SPIKE_Z || 2);
  const minMentions = Number(process.env.SENTIMENT_MIN_MENTIONS || 5);
  if (sent && price > ema200 && sent.volumeZScore >= spikeZ && sent.score >= 0.3 && sent.mentionCount >= minMentions) {
    return { pass: true, setup: 'SENTIMENT_SPIKE', reason: `news volume spike z=${sent.volumeZScore.toFixed(1)} with sentiment ${sent.score.toFixed(2)} inside a long-term uptrend` };
  }
  return { pass: false, reason: 'no long setup (trend/pullback/breakout/oversold/sentiment spike) present' };
}
