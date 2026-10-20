import { z } from 'zod';

const bound = Number.MAX_SAFE_INTEGER / 100;
const positive = z.number().finite().positive().max(bound);
const nonnegative = z.number().finite().nonnegative().max(bound);
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const usd = z.object({ value: z.union([z.string().max(80).regex(/^\d+(?:\.\d+)?$/), nonnegative]), currency: z.literal('USD') });
const expectation = z.object({ orderId: identifier, marketSlug: z.string().min(1).max(256), side: z.enum(['YES', 'NO']),
  quantity: positive, sideMinPrice: z.number().finite().min(.01).max(.99) });
export type PredictionReductionExpectation = z.infer<typeof expectation>;
const orderSchema = z.object({ id: identifier, marketSlug: z.string().min(1).max(256),
  intent: z.enum(['ORDER_INTENT_SELL_LONG', 'ORDER_INTENT_SELL_SHORT']), type: z.literal('ORDER_TYPE_LIMIT'),
  tif: z.literal('TIME_IN_FORCE_IMMEDIATE_OR_CANCEL'), quantity: positive, cumQuantity: nonnegative, leavesQuantity: nonnegative,
  state: z.enum(['ORDER_STATE_NEW', 'ORDER_STATE_PENDING_NEW', 'ORDER_STATE_PENDING_RISK', 'ORDER_STATE_PENDING_CANCEL',
    'ORDER_STATE_PARTIALLY_FILLED', 'ORDER_STATE_FILLED', 'ORDER_STATE_CANCELED', 'ORDER_STATE_REJECTED', 'ORDER_STATE_EXPIRED']),
  price: usd, avgPx: usd.optional(), commissionNotionalTotalCollected: usd.optional(),
  outcomeSide: z.enum(['OUTCOME_SIDE_YES', 'OUTCOME_SIDE_NO']).optional(), action: z.literal('ORDER_ACTION_SELL').optional(),
});
export interface PredictionReductionEvidence { state: string; terminal: boolean; quantity: number; proceeds: number; fees: number | null }
const tolerance = 1e-8;
const numeric = (raw: string | number) => { const n = Number(raw); if (!Number.isFinite(n) || n < 0 || n > bound) throw new Error('REDUCTION_NUMERIC_BOUND'); return n; };

/** Separate from opening evidence: sales have a minimum proceeds price.
 * https://docs.polymarket.us/api-reference/orders/get-order
 * SELL_SHORT uses YES-denominated prices, economic NO proceeds are 1-YES:
 * https://docs.polymarket.us/api-reference/orders/overview#understanding-price-with-order-intent */
export function parsePredictionReductionEvidence(raw: unknown, input: PredictionReductionExpectation): PredictionReductionEvidence {
  const expected = expectation.parse(input);
  const row = orderSchema.parse((raw as any)?.order);
  const sidePrice = (yes: number) => expected.side === 'YES' ? yes : 1 - yes;
  const limit = numeric(row.price.value);
  if (row.id !== expected.orderId || row.marketSlug !== expected.marketSlug
    || row.intent !== (expected.side === 'YES' ? 'ORDER_INTENT_SELL_LONG' : 'ORDER_INTENT_SELL_SHORT')
    || (row.outcomeSide !== undefined && row.outcomeSide !== (expected.side === 'YES' ? 'OUTCOME_SIDE_YES' : 'OUTCOME_SIDE_NO'))
    || Math.abs(row.quantity - expected.quantity) > tolerance || limit <= 0 || limit >= 1
    || Math.abs(sidePrice(limit) - expected.sideMinPrice) > tolerance
    || row.cumQuantity > expected.quantity + tolerance || row.cumQuantity + row.leavesQuantity > expected.quantity + tolerance) throw new Error('REDUCTION_IDENTITY_CONFLICT');
  const terminal = ['ORDER_STATE_FILLED', 'ORDER_STATE_CANCELED', 'ORDER_STATE_REJECTED', 'ORDER_STATE_EXPIRED'].includes(row.state);
  if ((terminal && row.leavesQuantity > tolerance)
    || (row.state === 'ORDER_STATE_FILLED' && Math.abs(row.cumQuantity - expected.quantity) > tolerance)
    || (row.state === 'ORDER_STATE_REJECTED' && row.cumQuantity > 0)
    || (row.state === 'ORDER_STATE_PARTIALLY_FILLED' && !(row.cumQuantity > 0 && row.cumQuantity < expected.quantity))
    || (['ORDER_STATE_NEW', 'ORDER_STATE_PENDING_NEW', 'ORDER_STATE_PENDING_RISK'].includes(row.state) && row.cumQuantity > 0)) throw new Error('REDUCTION_STATE_CONFLICT');
  let proceeds = 0;
  if (row.cumQuantity > 0) {
    if (!row.avgPx) throw new Error('REDUCTION_AVERAGE_MISSING');
    const yesPrice = numeric(row.avgPx.value), outcome = sidePrice(yesPrice);
    if (yesPrice <= 0 || yesPrice >= 1 || outcome + tolerance < expected.sideMinPrice) throw new Error('REDUCTION_PRICE_FLOOR');
    proceeds = outcome * row.cumQuantity;
  }
  const fees = row.commissionNotionalTotalCollected ? numeric(row.commissionNotionalTotalCollected.value) : row.cumQuantity === 0 ? 0 : null;
  if (row.cumQuantity === 0 && fees !== 0) throw new Error('REDUCTION_FEES_WITHOUT_FILL');
  return { state: row.state, terminal, quantity: row.cumQuantity, proceeds, fees };
}

export function assertReductionProgress(previous: { appliedQuantity: number; appliedProceeds: number; appliedFees: number | null; terminal: boolean },
  next: PredictionReductionEvidence, sideMinPrice: number) {
  for (const n of [previous.appliedQuantity, previous.appliedProceeds, sideMinPrice]) if (!Number.isFinite(n) || n < 0) throw new Error('REDUCTION_PREVIOUS_INVALID');
  const qty = next.quantity - previous.appliedQuantity, proceeds = next.proceeds - previous.appliedProceeds;
  if (qty < 0 || proceeds < -tolerance || (previous.terminal && (!next.terminal || qty !== 0))
    || (qty === 0 && Math.abs(proceeds) > tolerance)
    || (qty > 0 && (proceeds + tolerance < qty * sideMinPrice || proceeds > qty + tolerance))
    || (previous.appliedFees !== null && ((next.fees === null && previous.appliedQuantity > 0)
      || (next.fees !== null && next.fees < previous.appliedFees)))) throw new Error('REDUCTION_CUMULATIVE_REGRESSION');
}

/** Pure cumulative projection: no incremental rounding and no fee double count. */
export function projectPredictionHolding(opening: { quantity: number; notional: number; fees: number },
  reductions: Array<{ appliedQuantity: number; appliedProceeds: number; appliedFees: number | null }>) {
  positive.parse(opening.quantity); nonnegative.parse(opening.notional); nonnegative.parse(opening.fees);
  let sold = 0, proceeds = 0, fees = 0; let knownFees = true;
  for (const reduction of reductions) {
    nonnegative.parse(reduction.appliedQuantity); nonnegative.parse(reduction.appliedProceeds);
    if (reduction.appliedProceeds > reduction.appliedQuantity + tolerance) throw new Error('REDUCTION_PROCEEDS_INVALID');
    sold += reduction.appliedQuantity; proceeds += reduction.appliedProceeds;
    if (reduction.appliedFees === null) { if (reduction.appliedQuantity > 0) knownFees = false; }
    else fees += nonnegative.parse(reduction.appliedFees);
  }
  if (sold > opening.quantity + tolerance) throw new Error('REDUCTION_EXCEEDS_OWNERSHIP');
  sold = Math.min(sold, opening.quantity);
  const remainingQuantity = Math.max(0, opening.quantity - sold);
  const allocatedBasis = (opening.notional + opening.fees) * (sold / opening.quantity);
  return { remainingQuantity, remainingBasis: (opening.notional + opening.fees) - allocatedBasis,
    realizedPnl: knownFees ? proceeds - fees - allocatedBasis : null };
}
