/**
 * APEX-3 P_apex + APEX-∞ Superforecasting (base rate, Bayes, order book, time decay).
 * Minimum edge: 8% (APEX-∞). Liquidity > $500. No YES/NO < $0.03 lottery tickets.
 */

export interface ApexProbabilityInput {
  marketYesPrice: number;
  category: string;
  question?: string;
  newsSignal: number; // -1 to 1
  modelPrediction?: number;
  orderBookImbalance?: number; // -1 to 1
  daysToResolution: number;
  bookDepthUsd: number;
  resolutionRisk?: 'SAFE' | 'RISKY' | 'TRAP';
}

export interface ApexProbabilityResult {
  pApex: number;
  baseRate: number;
  edge: number;
  side: 'YES' | 'NO' | 'SKIP';
  sizeMultiplier: number;
  reasons: string[];
}

export const CATEGORY_BASE_RATES: Record<string, number> = {
  election: 0.65,
  politics: 0.65,
  fed: 0.3,
  merger: 0.85,
  crypto: 0.5,
  recession: 0.18,
  sports: 0.5,
  weather: 0.5,
  company: 0.5,
  general: 0.5,
};

export function categoryBaseRate(category: string, question = ''): number {
  const c = (category || 'general').toLowerCase();
  const q = question.toLowerCase();
  if (q.includes('incumbent') || q.includes('re-elect')) return 0.65;
  if (q.includes('merger') || q.includes('acquisition')) return 0.85;
  if (q.includes('recession')) return 0.18;
  if (q.includes('fed') || q.includes('rate hike')) return 0.3;
  for (const [k, v] of Object.entries(CATEGORY_BASE_RATES)) {
    if (c.includes(k)) return v;
  }
  return 0.5;
}

export function bayesianUpdate(prior: number, likelihoodIfTrue: number, likelihoodIfFalse: number): number {
  const pE = likelihoodIfTrue * prior + likelihoodIfFalse * (1 - prior);
  if (pE <= 0) return prior;
  return Math.min(0.99, Math.max(0.01, (likelihoodIfTrue * prior) / pE));
}

export function computePApex(input: ApexProbabilityInput): ApexProbabilityResult {
  const reasons: string[] = [];
  const baseRate = categoryBaseRate(input.category);
  const news = (input.newsSignal + 1) / 2; // 0–1
  const model = input.modelPrediction ?? baseRate;
  const book = input.orderBookImbalance ?? 0;
  const bookTerm = book * 0.5 + 0.5;

  // APEX-3 mix: α=0.30 β=0.25 γ=0.30 δ=0.15
  let pApex = 0.3 * baseRate + 0.25 * news + 0.3 * model + 0.15 * bookTerm;
  reasons.push(`baseRate=${baseRate.toFixed(2)}`);

  if (Math.abs(book) > 0.3) {
    pApex += book > 0 ? 0.05 : -0.05;
    reasons.push(book > 0 ? 'smart-money YES imbalance' : 'smart-money NO imbalance');
  }

  if (input.daysToResolution <= 3 && Math.abs(pApex - input.marketYesPrice) >= 0.06) {
    reasons.push('time-decay window 1.5× Kelly');
  }

  pApex = Math.min(0.99, Math.max(0.01, pApex));
  const edge = pApex - input.marketYesPrice;

  const lottery = input.marketYesPrice < 0.03 || input.marketYesPrice > 0.97;
  const thin = input.bookDepthUsd < 500;
  const trap = input.resolutionRisk === 'TRAP';
  const tooLong = input.daysToResolution > 30;
  const sports = /sport|nba|nfl|mlb|nhl|soccer|ufc/i.test(`${input.category} ${input.question || ''}`);

  let side: 'YES' | 'NO' | 'SKIP' = 'SKIP';
  if (!lottery && !thin && !trap && !tooLong && !sports) {
    if (edge >= 0.08) side = 'YES';
    else if (edge <= -0.08) side = 'NO';
  } else {
    if (lottery) reasons.push('PM-4 lottery ticket');
    if (thin) reasons.push('PM-2 thin book');
    if (trap) reasons.push('resolution TRAP');
    if (tooLong) reasons.push('PM-3 hold > 30d');
    if (sports) reasons.push('sports — zero informational edge');
  }

  const sizeMultiplier = input.daysToResolution <= 3 && Math.abs(edge) >= 0.06 ? 1.5 : 1.0;
  return { pApex, baseRate, edge, side, sizeMultiplier, reasons };
}
