import { z } from 'zod';

const usd = z.object({ value: z.union([z.string().max(80).regex(/^\d+(?:\.\d+)?$/), z.number().finite()]), currency: z.literal('USD') });
const expectationSchema = z.object({ orderId: z.string().min(1).max(128), marketSlug: z.string().min(1).max(256),
  side: z.enum(['YES', 'NO']), quantity: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),
  sideLimitPrice: z.number().finite().min(0.01).max(0.99) });
const states = z.enum(['ORDER_STATE_NEW', 'ORDER_STATE_PENDING_NEW', 'ORDER_STATE_PENDING_REPLACE',
  'ORDER_STATE_PENDING_CANCEL', 'ORDER_STATE_PENDING_RISK', 'ORDER_STATE_PARTIALLY_FILLED',
  'ORDER_STATE_FILLED', 'ORDER_STATE_CANCELED', 'ORDER_STATE_REPLACED', 'ORDER_STATE_REJECTED', 'ORDER_STATE_EXPIRED']);
const orderSchema = z.object({
  id: z.string().min(1), marketSlug: z.string().min(1), intent: z.enum(['ORDER_INTENT_BUY_LONG', 'ORDER_INTENT_BUY_SHORT']),
  type: z.literal('ORDER_TYPE_LIMIT'), quantity: z.number().finite().positive(),
  cumQuantity: z.number().finite().nonnegative(), leavesQuantity: z.number().finite().nonnegative(),
  state: states, price: usd, avgPx: usd.optional(), commissionNotionalTotalCollected: usd.optional(),
});

export interface PredictionOrderExpectation {
  orderId: string; marketSlug: string; side: 'YES' | 'NO'; quantity: number; sideLimitPrice: number;
}
export interface PredictionOrderEvidence {
  state: string; terminal: boolean; quantity: number; outcomePrice: number | null;
  notional: number; fees: number | null;
}

/** An order acknowledgement is not fill evidence. Every observation must match
 * the bound order, instrument, outcome and size; NO costs use 1 minus YES price. */
export function parsePredictionOrderEvidence(raw: unknown, expected: PredictionOrderExpectation): PredictionOrderEvidence {
  expected = expectationSchema.parse(expected);
  const order = orderSchema.parse((raw as any)?.order);
  const tolerance = 1e-8;
  const limit = Number(order.price.value);
  if (order.id !== expected.orderId || order.marketSlug !== expected.marketSlug
    || order.intent !== (expected.side === 'YES' ? 'ORDER_INTENT_BUY_LONG' : 'ORDER_INTENT_BUY_SHORT')
    || Math.abs(order.quantity - expected.quantity) > tolerance
    || !Number.isFinite(limit) || limit <= 0 || limit >= 1
    || Math.abs((expected.side === 'YES' ? limit : 1 - limit) - expected.sideLimitPrice) > tolerance
    || order.cumQuantity > expected.quantity + tolerance
    || order.cumQuantity + order.leavesQuantity > expected.quantity + tolerance) {
    throw new Error('PREDICTION_ORDER_EVIDENCE: order identity, outcome, size or limit differs');
  }
  const terminal = ['ORDER_STATE_FILLED', 'ORDER_STATE_CANCELED', 'ORDER_STATE_REJECTED', 'ORDER_STATE_EXPIRED'].includes(order.state);
  if ((order.state === 'ORDER_STATE_FILLED' && Math.abs(order.cumQuantity - expected.quantity) > tolerance)
    || (order.state === 'ORDER_STATE_REJECTED' && order.cumQuantity > 0)
    || (order.state === 'ORDER_STATE_PARTIALLY_FILLED' && !(order.cumQuantity > 0 && order.cumQuantity < expected.quantity))
    || (['ORDER_STATE_NEW', 'ORDER_STATE_PENDING_NEW', 'ORDER_STATE_PENDING_RISK'].includes(order.state) && order.cumQuantity > 0)) {
    throw new Error('PREDICTION_ORDER_EVIDENCE: state and cumulative fill disagree');
  }
  let outcomePrice: number | null = null;
  if (order.cumQuantity > 0) {
    if (!order.avgPx) throw new Error('PREDICTION_ORDER_EVIDENCE: average fill price missing');
    const yesPrice = Number(order.avgPx.value);
    if (!Number.isFinite(yesPrice) || yesPrice <= 0 || yesPrice >= 1) throw new Error('PREDICTION_ORDER_EVIDENCE: invalid average fill price');
    outcomePrice = expected.side === 'YES' ? yesPrice : 1 - yesPrice;
    if (outcomePrice > expected.sideLimitPrice + tolerance) throw new Error('PREDICTION_ORDER_EVIDENCE: fill exceeds outcome limit');
  }
  const fees = order.commissionNotionalTotalCollected ? Number(order.commissionNotionalTotalCollected.value) : null;
  if (fees !== null && (!Number.isFinite(fees) || fees < 0)) throw new Error('PREDICTION_ORDER_EVIDENCE: invalid collected fees');
  if (order.cumQuantity === 0 && fees !== null && fees > 0) throw new Error('PREDICTION_ORDER_EVIDENCE: fees without a fill');
  return { state: order.state, terminal, quantity: order.cumQuantity, outcomePrice,
    notional: outcomePrice === null ? 0 : outcomePrice * order.cumQuantity, fees };
}
