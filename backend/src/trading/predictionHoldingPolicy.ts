import { createHash } from 'crypto';
import { z } from 'zod';
import type { VenueBook, VenueMarket } from '../services/predictionVenue';
import type { PmUsExecutionSnapshot } from '../services/polymarketUS';
import { sellLevels, walkLevels } from './predictionMath';
import { decideExit, ExitThresholds } from './predictionExitDecision';
import { lockPredictionForecastMarket } from './predictionForecastCustody';

const bound = Number.MAX_SAFE_INTEGER / 100;
const quantity = z.number().finite().positive().max(bound);
const probability = z.number().finite().min(0).max(1);
const forecastSchema = z.object({ id: z.string().min(1), venue: z.literal('polymarket_us'), marketSlug: z.string().min(1),
  fairProb: probability, llmProb: probability, evidenceWeight: z.number().finite().positive().max(1),
  createdAt: z.coerce.date(), resolvedAt: z.coerce.date().nullish() });
export const exitThresholdsSchema = z.object({ tpBuffer: probability, exitEdge: probability, evidenceShift: probability });
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function readPredictionExitThresholds(): ExitThresholds {
  const n = (key: string, fallback: number) => process.env[key] === undefined ? fallback : Number(process.env[key]);
  return exitThresholdsSchema.parse({ tpBuffer: n('POLYMARKET_TP_BUFFER', .01), exitEdge: n('POLYMARKET_EXIT_EDGE', .02),
    evidenceShift: n('POLYMARKET_EVIDENCE_SHIFT', .1) });
}
export function predictionForecastFingerprint(raw: unknown) {
  const f = forecastSchema.parse(raw);
  return fingerprint([f.id, f.venue, f.marketSlug, f.fairProb, f.llmProb, f.evidenceWeight, f.createdAt.getTime(), f.resolvedAt?.getTime() ?? null]);
}
export function predictionMarketPolicyFingerprint(m: VenueMarket) {
  return fingerprint([m.venue, m.id, m.open, m.executionMetadataVerified, m.tickSize, m.minQty, m.feeCoefficient]);
}

/** Standard taker fee cap, valid for every positive actual cumulative fill q:
 * E <= q*theta/4. Half-even nearest-cent rounding R satisfies R(x)<=2x for
 * x>=0 (below half a cent R=0; otherwise R<=x+.005<=2x). The documented
 * cumulative cap therefore gives collectedFees/q <= theta/2, including dust
 * and partial IOC fills. Never divide a planned order's rounded fee by its
 * planned quantity to infer the fee of a smaller actual fill.
 * https://docs.polymarket.us/fees#standard-fee-rules */
export function predictionRoundedFeeBoundPerContract(theta: number) {
  probability.parse(theta);
  return theta / 2;
}
export const holdingPolicyEvidenceSchema = z.object({ version: z.literal(2), feeBound: z.literal('STANDARD_ROUNDED_THETA_HALF'), openingExecutionId: z.string().min(1),
  forecastId: z.string().min(1), forecastHash: z.string().regex(/^[a-f0-9]{64}$/),
  entryPredictionId: z.string().min(1), entryForecastHash: z.string().regex(/^[a-f0-9]{64}$/),
  marketHash: z.string().regex(/^[a-f0-9]{64}$/), thresholds: exitThresholdsSchema,
  reason: z.enum(['tp_converged', 'edge_flipped', 'evidence_changed']), remainingQuantity: quantity,
  quantity, sideMinPrice: z.number().finite().min(.01).max(.99), bookObservedAt: z.number().finite(), expiresAt: z.number().finite() });
export type HoldingPolicyEvidence = z.infer<typeof holdingPolicyEvidenceSchema>;
export type PolicyHolding = { openingExecutionId: string; credentialScopeKey: string; marketSlug: string; side: 'YES' | 'NO';
  remainingQuantity: number; openingQuantity: number; openingNotional: number };
export type HoldingPolicyPlan = { status: 'HOLD' | 'BLOCKED'; reason: string }
  | { status: 'REDUCTION_READY'; reason: HoldingPolicyEvidence['reason']; requestKey: string; quantity: number; sideMinPrice: number; policyEvidence: HoldingPolicyEvidence };

export function planPredictionHoldingReduction(args: { holding: PolicyHolding; snapshot: PmUsExecutionSnapshot;
  market: VenueMarket; book: VenueBook; forecast: unknown; entryForecast: unknown; thresholds: ExitThresholds; now?: number }): HoldingPolicyPlan {
  const now = args.now ?? Date.now();
  try {
    const { holding: h, snapshot: s, market: m, book: b } = args;
    const cfg = exitThresholdsSchema.parse(args.thresholds), current = forecastSchema.parse(args.forecast), entry = forecastSchema.parse(args.entryForecast);
    quantity.parse(h.remainingQuantity); quantity.parse(h.openingQuantity); quantity.parse(h.openingNotional);
    if (!['YES', 'NO'].includes(h.side) || h.remainingQuantity > h.openingQuantity || h.openingNotional >= h.openingQuantity) throw new Error('HOLDING_BASIS_INVALID');
    if (current.venue !== m.venue || current.marketSlug !== h.marketSlug || entry.marketSlug !== h.marketSlug
      || current.resolvedAt || entry.resolvedAt || current.createdAt < entry.createdAt
      || current.createdAt.getTime() > now + 1000 || now - current.createdAt.getTime() > 300000) throw new Error('FORECAST_UNAVAILABLE_OR_STALE');
    if (s.scopeKey !== h.credentialScopeKey || !Number.isFinite(s.observedAt) || now - s.observedAt > 5000 || s.observedAt > now + 1000
      || s.openOrders.length) throw new Error('ACCOUNT_UNAVAILABLE_OR_STALE');
    const p = s.positions[h.marketSlug], raw = p?.netPositionDecimal ?? p?.netPosition;
    if (p?.expired !== false || typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error('POSITION_OR_SETTLEMENT_UNRECONCILED');
    const signed = Number(raw), expected = (h.side === 'YES' ? 1 : -1) * h.remainingQuantity;
    if (!Number.isFinite(signed) || Math.abs(signed - expected) > 1e-8) throw new Error('POSITION_DISCREPANCY');
    if (m.id !== h.marketSlug || m.venue !== 'polymarket_us' || !m.open || m.executionMetadataVerified !== true
      || !Number.isFinite(m.tickSize) || m.tickSize < .000001 || m.tickSize > .1 || !Number.isFinite(m.minQty) || m.minQty <= 0
      || !Number.isFinite(m.feeCoefficient) || m.feeCoefficient < 0 || m.feeCoefficient > 1
      || b.state !== 'MARKET_STATE_OPEN' || !Number.isFinite(b.fetchedAt) || now - b.fetchedAt > 5000 || b.fetchedAt > now + 1000) throw new Error('BOOK_OR_MARKET_UNAVAILABLE');
    for (const levels of [b.bids, b.asks]) {
      if (!Array.isArray(levels) || !levels.length || levels.length > 2000 || levels.some(l => !Number.isFinite(l.price) || l.price < .01 || l.price > .99
        || !Number.isFinite(l.size) || l.size <= 0 || l.size > bound)) throw new Error('BOOK_LEVEL_INVALID');
    }
    if (Math.max(...b.bids.map(l => l.price)) >= Math.min(...b.asks.map(l => l.price))) throw new Error('BOOK_CROSSED');
    const levels = sellLevels(b, h.side), depth = levels.reduce((sum, l) => sum + l.size, 0);
    const cap = Math.min(h.remainingQuantity, Math.abs(signed), depth);
    let contracts = Math.floor(cap / m.minQty) * m.minQty;
    if (contracts > cap) contracts -= m.minQty;
    if (!Number.isFinite(contracts) || contracts < m.minQty || contracts > cap) throw new Error('EXECUTABLE_QUANTITY_BELOW_MINIMUM');
    const fill = walkLevels(levels, contracts, 'sell');
    if (!fill.fullyFilled || fill.filledShares > cap || fill.worstPrice <= 0) throw new Error('EXECUTABLE_DEPTH_UNAVAILABLE');
    // YES floor rounds down; NO floor rounds down in economic NO terms, then
    // complements to the YES grid. Never increase quantity to absorb dust.
    let yesLimit = h.side === 'YES' ? Math.floor(fill.worstPrice / m.tickSize) * m.tickSize
      : Math.ceil((1 - fill.worstPrice) / m.tickSize) * m.tickSize;
    yesLimit = Number(yesLimit.toFixed(6));
    let floor = h.side === 'YES' ? yesLimit : Number((1 - yesLimit).toFixed(6));
    if (floor > fill.worstPrice) {
      yesLimit = Number((yesLimit + (h.side === 'YES' ? -m.tickSize : m.tickSize)).toFixed(6));
      floor = h.side === 'YES' ? yesLimit : Number((1 - yesLimit).toFixed(6));
    }
    if (floor < .01 || floor > .99) throw new Error('SALE_FLOOR_UNSUPPORTED');
    // Includes positive cent rounding even if the IOC fills only a fraction.
    // This conservative planning bound never books commission or guarantees P&L.
    const decision = decideExit({ side: h.side, entryPrice: h.openingNotional / h.openingQuantity,
      exitPrice: floor - predictionRoundedFeeBoundPerContract(m.feeCoefficient), fairNowYes: current.fairProb,
      fairAtEntrySide: h.side === 'YES' ? entry.fairProb : 1 - entry.fairProb, cfg });
    if (!decision.exit) return { status: 'HOLD', reason: 'THESIS_REMAINS_OPEN' };
    const policyEvidence = holdingPolicyEvidenceSchema.parse({ version: 2, feeBound: 'STANDARD_ROUNDED_THETA_HALF', openingExecutionId: h.openingExecutionId,
      forecastId: current.id, forecastHash: predictionForecastFingerprint(current), entryPredictionId: entry.id,
      entryForecastHash: predictionForecastFingerprint(entry), marketHash: predictionMarketPolicyFingerprint(m), thresholds: cfg,
      reason: decision.reason, remainingQuantity: h.remainingQuantity, quantity: contracts, sideMinPrice: floor,
      bookObservedAt: b.fetchedAt, expiresAt: Math.min(b.fetchedAt + 5000, current.createdAt.getTime() + 300000) });
    return { status: 'REDUCTION_READY', reason: decision.reason, quantity: contracts, sideMinPrice: floor, policyEvidence,
      requestKey: fingerprint(['holding-policy-v2', h.openingExecutionId, current.id, h.remainingQuantity]) };
  } catch (error) {
    return { status: 'BLOCKED', reason: error instanceof Error && !(error instanceof z.ZodError) ? error.message : 'POLICY_EVIDENCE_INVALID' };
  }
}

/** Re-read original policy custody at claim and consumption. A newer book does
 * not extend the lifetime of an older forecast or quote decision. */
export async function assertPredictionHoldingPolicy(tx: any, raw: unknown, opening: any, holding: any,
  request: { quantity: number; sideMinPrice: number }, marketHash: string) {
  if (raw === undefined || raw === null) return;
  const policy = holdingPolicyEvidenceSchema.parse(raw), now = Date.now();
  if (policy.openingExecutionId !== opening.id || policy.entryPredictionId !== opening.predictionId
    || policy.quantity !== request.quantity || policy.sideMinPrice !== request.sideMinPrice
    || policy.remainingQuantity !== holding.remainingQuantity || policy.marketHash !== marketHash
    || policy.expiresAt <= now || policy.bookObservedAt > now + 1000 || now - policy.bookObservedAt > 5000
    || fingerprint(policy.thresholds) !== fingerprint(readPredictionExitThresholds())) throw new Error('HOLDING_POLICY_AUTHORITY_CHANGED');
  // Caller already holds the account lock. The shared market lock stays held
  // through claim creation/consumption at transaction commit; probability and
  // resolution publishers acquire the same market lock before mutating rows.
  // This is a transaction linearization point, not a promise that no forecast
  // can publish after commit and before a subsequent network POST.
  await lockPredictionForecastMarket(tx, 'polymarket_us', opening.marketSlug);
  if (policy.expiresAt <= Date.now() || Date.now() - policy.bookObservedAt > 5000) throw new Error('HOLDING_POLICY_AUTHORITY_CHANGED');
  const latest = await tx.polymarketPrediction.findFirst({ where: { venue: 'polymarket_us', marketSlug: opening.marketSlug },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const entry = await tx.polymarketPrediction.findUnique({ where: { id: opening.predictionId } });
  const afterReads = Date.now();
  if (!latest || latest.id !== policy.forecastId || latest.marketSlug !== opening.marketSlug || latest.venue !== 'polymarket_us'
    || policy.expiresAt <= afterReads || latest.resolvedAt || new Date(latest.createdAt).getTime() > afterReads + 1000
    || afterReads - new Date(latest.createdAt).getTime() > 300000
    || predictionForecastFingerprint(latest) !== policy.forecastHash || predictionForecastFingerprint(entry) !== policy.entryForecastHash) {
    throw new Error('HOLDING_POLICY_FORECAST_CHANGED');
  }
}
