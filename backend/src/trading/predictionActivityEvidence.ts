import { z } from 'zod';
import { parsePredictionOrderEvidence, PredictionOrderExpectation } from './predictionOrderEvidence';

// Official shapes expose execution.tradeId and activity.trade.id, but do not
// establish historical retail linkage/finality. Matching them is a candidate,
// never account identity, fill/P&L authority or proof from a mock provider.
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const amount = z.object({ value: z.string().max(80).regex(/^-?\d+(?:\.\d+)?$/), currency: z.literal('USD') });
const decimal = z.string().max(80).regex(/^\d+(?:\.\d+)?$/);
const numeric = (value: string) => {
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER / 100) throw new Error('PREDICTION_ACTIVITY_NUMERIC_BOUND');
  return result;
};
const execution = z.object({ id, tradeId: id, type: z.enum(['EXECUTION_TYPE_PARTIAL_FILL', 'EXECUTION_TYPE_FILL']),
  lastShares: decimal, lastPx: amount, commissionNotionalCollected: amount.optional(), order: z.unknown() });
export type ExecutionTradeReference = { executionId: string; tradeId: string; marketSlug: string;
  quantity: number; yesPrice: number; collectedFee: number | null };
export function parseStoredExecutionReferences(raw: unknown): ExecutionTradeReference[] {
  return z.array(z.object({ executionId: id, tradeId: id, marketSlug: z.string().min(1).max(256),
    quantity: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER / 100),
    yesPrice: z.number().finite().positive().lt(1), collectedFee: z.number().finite().nonnegative().nullable(),
  })).max(200).parse(raw);
}

export function parseExecutionTradeReferences(raw: unknown, expected: PredictionOrderExpectation): ExecutionTradeReference[] {
  const list = (raw as any)?.executions;
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 200) throw new Error('PREDICTION_EXECUTION_REFERENCE_BOUND');
  const refs = new Map<string, ExecutionTradeReference>();
  for (const item of list) {
    if (!['EXECUTION_TYPE_PARTIAL_FILL', 'EXECUTION_TYPE_FILL'].includes(item?.type)) continue;
    const parsed = execution.parse(item);
    const order = parsePredictionOrderEvidence({ order: parsed.order }, expected);
    const quantity = numeric(parsed.lastShares), yesPrice = numeric(parsed.lastPx.value);
    const fee = parsed.commissionNotionalCollected ? numeric(parsed.commissionNotionalCollected.value) : null;
    const sidePrice = expected.side === 'YES' ? yesPrice : 1 - yesPrice;
    if (quantity <= 0 || quantity > order.quantity + 1e-8 || yesPrice <= 0 || yesPrice >= 1
      || sidePrice > expected.sideLimitPrice + 1e-8 || (fee !== null && fee < 0)) throw new Error('PREDICTION_EXECUTION_REFERENCE_INCONSISTENT');
    const reference = { executionId: parsed.id, tradeId: parsed.tradeId, marketSlug: expected.marketSlug, quantity, yesPrice, collectedFee: fee };
    const previous = refs.get(parsed.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(reference)) throw new Error('PREDICTION_EXECUTION_REFERENCE_CONFLICT');
    refs.set(parsed.id, reference);
  }
  return [...refs.values()];
}

const trade = z.object({ id, marketSlug: z.string().min(1).max(256), state: z.string().min(1).max(64),
  qty: decimal.optional(), qtyDecimal: decimal.optional(), price: amount,
  realizedPnl: amount.optional(), costBasis: amount.optional() });
export type TradeActivity = { id: string; marketSlug: string; state: string; quantity: number; price: number;
  realizedPnl: number | null; costBasis: number | null };
export function parseTradeActivityPage(raw: unknown) {
  const page = z.object({ activities: z.array(z.unknown()).max(100), nextCursor: z.string().max(2048).optional(), eof: z.boolean().optional() }).parse(raw);
  const trades: TradeActivity[] = [];
  for (const activity of page.activities as any[]) {
    if (activity?.type !== 'ACTIVITY_TYPE_TRADE') continue;
    const row = trade.parse(activity.trade);
    const qty = row.qtyDecimal ?? row.qty;
    if (qty === undefined) throw new Error('PREDICTION_ACTIVITY_QUANTITY_UNKNOWN');
    trades.push({ id: row.id, marketSlug: row.marketSlug, state: row.state, quantity: numeric(qty), price: numeric(row.price.value),
      realizedPnl: row.realizedPnl ? numeric(row.realizedPnl.value) : null,
      costBasis: row.costBasis ? numeric(row.costBasis.value) : null });
  }
  return { trades, nextCursor: page.nextCursor, eof: page.eof, rowCount: page.activities.length };
}

export function candidateExecutionActivityJoin(references: ExecutionTradeReference[], activities: TradeActivity[]) {
  const byId = new Map<string, TradeActivity>();
  for (const row of activities) {
    const prior = byId.get(row.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error('PREDICTION_ACTIVITY_CORRECTION_REQUIRES_REVIEW');
    byId.set(row.id, row);
  }
  return { status: 'UNPROVEN_PROVIDER_JOIN' as const, matches: references.map(reference => {
    const activity = byId.get(reference.tradeId);
    if (!activity) return { executionId: reference.executionId, tradeId: reference.tradeId, matched: false };
    if (activity.marketSlug !== reference.marketSlug || Math.abs(activity.quantity - reference.quantity) > 1e-8
      || Math.abs(activity.price - reference.yesPrice) > 1e-8) throw new Error('PREDICTION_ACTIVITY_IDENTITY_CONFLICT');
    return { executionId: reference.executionId, tradeId: reference.tradeId, matched: true };
  }) };
}
