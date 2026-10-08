// ── PREDICTION-MARKET MATH (pure, no I/O) ────────────────────────────────────
// Everything the Polymarket edge engine needs that can be unit-tested without
// a network: probability blending, fees, order-book walking, edge after costs,
// fractional Kelly, and the scorecard metrics (Brier, log loss, calibration).
//
// Conventions: prices and probabilities are 0..1. "YES side" = the long
// instrument. Buying NO at q is the same trade as selling YES at 1 - q.

export const P_EPS = 0.005;

export function clampP(p: number, eps = P_EPS): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1 - eps, Math.max(eps, p));
}

export function logit(p: number): number {
  const q = clampP(p);
  return Math.log(q / (1 - q));
}

export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

// ── Fees ─────────────────────────────────────────────────────────────────────

/**
 * Polymarket US taker fee per contract: Θ × p × (1 − p) (docs.polymarket.us/fees,
 * Θ = market.feeCoefficient, 0.0695 at the time of writing). Makers pay none
 * (they get a small rebate, which we ignore to stay conservative).
 */
export function takerFeePerShare(theta: number, price: number): number {
  if (!(theta > 0)) return 0;
  const p = Math.min(1, Math.max(0, price));
  return theta * p * (1 - p);
}

// ── Order book ───────────────────────────────────────────────────────────────

export interface BookLevel { price: number; size: number }
export interface Book { bids: BookLevel[]; asks: BookLevel[] }
export type Side = 'YES' | 'NO';

function sortedBids(b: Book): BookLevel[] { return [...(b.bids || [])].filter(l => l.size > 0).sort((x, y) => y.price - x.price); }
function sortedAsks(b: Book): BookLevel[] { return [...(b.asks || [])].filter(l => l.size > 0).sort((x, y) => x.price - y.price); }

export function bestBid(b: Book): number | null { const l = sortedBids(b)[0]; return l ? l.price : null; }
export function bestAsk(b: Book): number | null { const l = sortedAsks(b)[0]; return l ? l.price : null; }

/** Levels you can BUY `side` from, cheapest first, in that side's price terms. */
export function buyLevels(b: Book, side: Side): BookLevel[] {
  return side === 'YES'
    ? sortedAsks(b)
    : sortedBids(b).map(l => ({ price: 1 - l.price, size: l.size })); // buy NO = sell YES into bids
}

/** Levels you can SELL `side` into, best first, in that side's price terms. */
export function sellLevels(b: Book, side: Side): BookLevel[] {
  return side === 'YES'
    ? sortedBids(b)
    : sortedAsks(b).map(l => ({ price: 1 - l.price, size: l.size })); // sell NO = buy YES from asks
}

export interface FillEstimate {
  requestedShares: number;
  filledShares: number;
  vwap: number;          // average price of the filled part (0 when nothing fills)
  worstPrice: number;
  notional: number;
  fullyFilled: boolean;
  slippage: number;      // vwap − top-of-book price (positive = worse, for buys)
}

/** Walk the levels (already ordered best-first) for `shares`. */
export function walkLevels(levels: BookLevel[], shares: number, direction: 'buy' | 'sell' = 'buy'): FillEstimate {
  let remaining = Math.max(0, shares);
  let filled = 0, notional = 0, worst = 0;
  for (const l of levels) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, l.size);
    filled += take; notional += take * l.price; worst = l.price; remaining -= take;
  }
  const vwap = filled > 0 ? notional / filled : 0;
  const top = levels[0]?.price ?? 0;
  return {
    requestedShares: shares,
    filledShares: filled,
    vwap,
    worstPrice: worst,
    notional,
    fullyFilled: remaining <= 1e-9 && filled > 0,
    slippage: filled > 0 ? (direction === 'buy' ? vwap - top : top - vwap) : 0,
  };
}

/** Shares available at or better than `limit` (buy: price <= limit; sell: price >= limit). */
export function depthAtOrBetter(levels: BookLevel[], limit: number, direction: 'buy' | 'sell' = 'buy'): number {
  return levels
    .filter(l => (direction === 'buy' ? l.price <= limit + 1e-9 : l.price >= limit - 1e-9))
    .reduce((s, l) => s + l.size, 0);
}

export function roundToTick(price: number, tick: number, mode: 'down' | 'up' | 'nearest' = 'nearest'): number {
  const t = tick > 0 ? tick : 0.001;
  const n = price / t;
  const r = mode === 'down' ? Math.floor(n + 1e-9) : mode === 'up' ? Math.ceil(n - 1e-9) : Math.round(n);
  return Number((r * t).toFixed(6));
}

// ── Fair probability ─────────────────────────────────────────────────────────

export interface FairInputs {
  marketMid: number;
  llmProb?: number | null;
  llmConfidence?: number | null;     // 0..100
  headlineCount?: number;
  freshestHeadlineHours?: number | null;
  sentimentScore?: number | null;    // -1..+1 tone
  sentimentMentions?: number;
  momentum?: number | null;          // logit change over the lookback window
}

export interface FairWeights {
  wLlm: number;            // weight on the LLM's logit deviation from the market (scaled by evidence)
  wSentiment: number;      // logit nudge per unit of tone (tone ≠ outcome, keep small)
  wMomentum: number;       // weight on recent logit momentum
  maxDeviation: number;    // hard cap |fair − mid| (probability points, 0..1)
  fullEvidenceHeadlines: number; // headlines needed for full news credit
  staleHours: number;      // headlines older than this get reduced credit
}

export const DEFAULT_FAIR_WEIGHTS: FairWeights = {
  wLlm: 1.0, wSentiment: 0.15, wMomentum: 0.25, maxDeviation: 0.2, fullEvidenceHeadlines: 3, staleHours: 24,
};

export interface FairResult {
  fair: number;            // calibrated (if a calibration was given) fair YES probability
  rawFair: number;         // before calibration
  evidenceWeight: number;  // 0..1, how far we let the LLM pull away from the market
  components: { base: number; llm: number; sentiment: number; momentum: number };
}

/** 0..1 credit for the LLM estimate: its confidence × how much fresh news backed it. */
export function evidenceWeight(i: FairInputs, w: FairWeights = DEFAULT_FAIR_WEIGHTS): number {
  if (i.llmProb == null || !Number.isFinite(i.llmProb)) return 0;
  const conf = Math.min(1, Math.max(0, (i.llmConfidence ?? 50) / 100));
  const n = Math.max(0, i.headlineCount ?? 0);
  // No news at all: the LLM is guessing from the question text → heavy shrink.
  let news = n === 0 ? 0.25 : Math.min(1, 0.5 + 0.5 * n / Math.max(1, w.fullEvidenceHeadlines));
  if (n > 0 && i.freshestHeadlineHours != null && i.freshestHeadlineHours > w.staleHours) news *= 0.6;
  return Math.min(1, Math.max(0, conf * news));
}

/**
 * Weighted logit blend that SHRINKS TOWARD THE MARKET PRICE when evidence is
 * thin. The market price is the prior: it already aggregates everyone else's
 * information, so our model only moves away from it in proportion to evidence.
 */
export function blendFairProbability(
  i: FairInputs,
  w: FairWeights = DEFAULT_FAIR_WEIGHTS,
  calibration?: PlattParams | null,
): FairResult {
  const mid = clampP(i.marketMid);
  const base = logit(mid);
  const ev = evidenceWeight(i, w);
  const llm = i.llmProb != null && Number.isFinite(i.llmProb) ? ev * w.wLlm * (logit(i.llmProb) - base) : 0;
  const mentions = Math.max(0, i.sentimentMentions ?? 0);
  const sentiment = i.sentimentScore != null && Number.isFinite(i.sentimentScore)
    ? w.wSentiment * Math.max(-1, Math.min(1, i.sentimentScore)) * Math.min(1, mentions / 5)
    : 0;
  const momentum = i.momentum != null && Number.isFinite(i.momentum)
    ? w.wMomentum * Math.max(-1, Math.min(1, i.momentum))
    : 0;
  let raw = sigmoid(base + llm + sentiment + momentum);
  raw = Math.min(mid + w.maxDeviation, Math.max(mid - w.maxDeviation, raw));
  raw = clampP(raw);
  const fair = calibration ? clampP(applyPlatt(raw, calibration)) : raw;
  return { fair, rawFair: raw, evidenceWeight: ev, components: { base, llm, sentiment, momentum } };
}

/** Logit change between the latest point and the point ~lookbackSec earlier. */
export function momentumFromHistory(points: Array<{ t: number; p: number }>, lookbackSec = 86_400): number | null {
  const pts = points.filter(x => Number.isFinite(x.t) && Number.isFinite(x.p) && x.p > 0 && x.p < 1).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const target = last.t - lookbackSec;
  let ref = pts[0];
  for (const x of pts) { if (x.t <= target) ref = x; else break; }
  if (ref === last) return null;
  return logit(last.p) - logit(ref.p);
}

// ── Edge after costs ─────────────────────────────────────────────────────────

export interface SideEdge {
  side: Side;
  fairSide: number;     // fair probability of this side
  execPrice: number;    // price per share we'd pay
  feePerShare: number;
  halfSpread: number;
  rawEdge: number;      // fairSide − execPrice
  required: number;     // fee + halfSpread + minEdge
  netEdge: number;      // rawEdge − required (must be > 0 to bet)
}

export interface EdgeInputs {
  fairYes: number;
  bestBid: number;      // YES bid
  bestAsk: number;      // YES ask
  theta: number;        // taker fee coefficient
  minEdge: number;      // e.g. 0.05 = 5 points
  mode: 'taker' | 'limit';
  tick?: number;
}

/**
 * Executable price per side: taker = cross the spread (YES at ask, NO at
 * 1 − bid, plus taker fee); limit = one tick inside the spread (no fee, but
 * only fills if the market trades through). The bet threshold is always
 * fee + half-spread + minEdge on top of that executable price.
 */
export function computeSideEdges(i: EdgeInputs): SideEdge[] {
  const tick = i.tick && i.tick > 0 ? i.tick : 0.001;
  const spread = Math.max(0, i.bestAsk - i.bestBid);
  const halfSpread = spread / 2;
  const out: SideEdge[] = [];
  for (const side of ['YES', 'NO'] as Side[]) {
    const fairSide = side === 'YES' ? i.fairYes : 1 - i.fairYes;
    const takerPx = side === 'YES' ? i.bestAsk : 1 - i.bestBid;
    const bidPx = side === 'YES' ? i.bestBid : 1 - i.bestAsk;
    const execPrice = i.mode === 'taker'
      ? takerPx
      : Math.min(takerPx, spread > tick + 1e-9 ? roundToTick(bidPx + tick, tick) : bidPx);
    const feePerShare = i.mode === 'taker' ? takerFeePerShare(i.theta, execPrice) : 0;
    const rawEdge = fairSide - execPrice;
    const required = feePerShare + halfSpread + i.minEdge;
    out.push({ side, fairSide, execPrice, feePerShare, halfSpread, rawEdge, required, netEdge: rawEdge - required });
  }
  return out.sort((a, b) => b.netEdge - a.netEdge);
}

// ── Sizing ───────────────────────────────────────────────────────────────────

/** Full-Kelly bankroll fraction for buying a $1-payout contract at `cost` (incl. fee) with win prob q. */
export function kellyFraction(q: number, cost: number): number {
  if (!(cost > 0 && cost < 1) || !(q > cost)) return 0;
  return (q - cost) / (1 - cost);
}

export interface SizeInputs {
  fairSide: number;
  costPerShare: number;   // exec price + fee per share
  confidence: number;     // 0..1 (evidence weight)
  bankrollUsd: number;
  kellyMultiplier: number; // e.g. 0.25 = quarter Kelly
  maxBetUsd: number;
  maxBetPctOfBankroll: number;
}

export function sizeBetUsd(s: SizeInputs): number {
  const f = kellyFraction(s.fairSide, s.costPerShare) * s.kellyMultiplier * Math.min(1, Math.max(0, s.confidence));
  const usd = Math.min(f * s.bankrollUsd, s.maxBetUsd, s.maxBetPctOfBankroll * s.bankrollUsd);
  return Math.max(0, Math.floor(usd * 100 + 1e-6) / 100);
}

// ── Scorecard metrics ────────────────────────────────────────────────────────

export function brier(p: number, outcome: number): number { return (p - outcome) ** 2; }

export function logLoss(p: number, outcome: number, eps = 1e-4): number {
  const q = Math.min(1 - eps, Math.max(eps, p));
  return -(outcome * Math.log(q) + (1 - outcome) * Math.log(1 - q));
}

export interface CalibrationBucket { lo: number; hi: number; count: number; avgPredicted: number; observedFreq: number }

export function calibrationBuckets(points: Array<{ p: number; outcome: number }>, buckets = 10): CalibrationBucket[] {
  const out: CalibrationBucket[] = [];
  for (let b = 0; b < buckets; b++) {
    const lo = b / buckets, hi = (b + 1) / buckets;
    const inB = points.filter(x => x.p >= lo && (b === buckets - 1 ? x.p <= hi : x.p < hi));
    out.push({
      lo, hi, count: inB.length,
      avgPredicted: inB.length ? inB.reduce((s, x) => s + x.p, 0) / inB.length : 0,
      observedFreq: inB.length ? inB.reduce((s, x) => s + x.outcome, 0) / inB.length : 0,
    });
  }
  return out;
}

export interface PlattParams { a: number; b: number; n: number }

export function applyPlatt(p: number, c: PlattParams): number { return sigmoid(c.a * logit(p) + c.b); }

/**
 * Platt scaling in logit space: outcome ~ sigmoid(a·logit(p) + b), fitted by
 * Newton's method with a ridge penalty pulling toward the identity (a=1, b=0)
 * so a small sample can't produce a wild calibration.
 */
export function fitPlatt(points: Array<{ p: number; outcome: number }>, ridge = 1.0, iters = 50): PlattParams {
  const xs = points.filter(x => Number.isFinite(x.p) && Number.isFinite(x.outcome)).map(x => ({ x: logit(x.p), y: Math.min(1, Math.max(0, x.outcome)) }));
  let a = 1, b = 0;
  for (let k = 0; k < iters; k++) {
    let ga = ridge * (a - 1), gb = ridge * b, haa = ridge, hab = 0, hbb = ridge;
    for (const { x, y } of xs) {
      const p = sigmoid(a * x + b);
      const r = p - y, wgt = p * (1 - p);
      ga += r * x; gb += r; haa += wgt * x * x; hab += wgt * x; hbb += wgt;
    }
    const det = haa * hbb - hab * hab;
    if (!(Math.abs(det) > 1e-12)) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b, n: xs.length };
}
