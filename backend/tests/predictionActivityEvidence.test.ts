import { parseExecutionTradeReferences, parseTradeActivityPage, candidateExecutionActivityJoin } from '../src/trading/predictionActivityEvidence';
const expected = { orderId: 'order-1', marketSlug: 'market-1', side: 'YES' as const, quantity: 2, sideLimitPrice: .5 };
const order = { id: 'order-1', marketSlug: 'market-1', intent: 'ORDER_INTENT_BUY_LONG', type: 'ORDER_TYPE_LIMIT',
  quantity: 2, cumQuantity: .25, leavesQuantity: 1.75, state: 'ORDER_STATE_PARTIALLY_FILLED',
  price: { value: '0.5', currency: 'USD' }, avgPx: { value: '0.49', currency: 'USD' },
  commissionNotionalTotalCollected: { value: '0.00', currency: 'USD' } };
const execution = { id: 'exec-1', tradeId: 'trade-1', type: 'EXECUTION_TYPE_PARTIAL_FILL', lastShares: '0.25',
  lastPx: { value: '0.49', currency: 'USD' }, commissionNotionalCollected: { value: '0.00', currency: 'USD' }, order };
const activity = { type: 'ACTIVITY_TYPE_TRADE', trade: { id: 'trade-1', marketSlug: 'market-1', state: 'TRADE_STATE_NEW',
  qty: '0', qtyDecimal: '0.25', price: { value: '0.49', currency: 'USD' }, realizedPnl: { value: '-0.01', currency: 'USD' } } };

test('official-shaped execution and activity identity fixture is explicitly an unproven candidate, not provider proof', () => {
  const refs = parseExecutionTradeReferences({ id: 'order-1', executions: [execution] }, expected);
  expect(refs[0]).toMatchObject({ quantity: .25, collectedFee: 0 });
  const page = parseTradeActivityPage({ activities: [activity], eof: true });
  expect(page.trades[0]).toMatchObject({ quantity: .25, realizedPnl: -.01, costBasis: null });
  expect(candidateExecutionActivityJoin(refs, page.trades)).toEqual({ status: 'UNPROVEN_PROVIDER_JOIN',
    matches: [{ executionId: 'exec-1', tradeId: 'trade-1', matched: true }] });
});

test('same symbol/time/price without the exact trade ID never creates a join', () => {
  const refs = parseExecutionTradeReferences({ executions: [execution] }, expected);
  const page = parseTradeActivityPage({ activities: [{ ...activity, trade: { ...activity.trade, id: 'different-trade' } }], eof: true });
  expect(candidateExecutionActivityJoin(refs, page.trades).matches[0].matched).toBe(false);
  expect(() => candidateExecutionActivityJoin(refs, [{ ...page.trades[0], id: 'trade-1', marketSlug: 'other-market' }])).toThrow('IDENTITY_CONFLICT');
});

test('partial and terminal fill quantities/fees remain checked against the bound order', () => {
  const terminal = { ...order, cumQuantity: 2, leavesQuantity: 0, state: 'ORDER_STATE_FILLED',
    commissionNotionalTotalCollected: { value: '0.03', currency: 'USD' } };
  expect(parseExecutionTradeReferences({ executions: [{ ...execution, type: 'EXECUTION_TYPE_FILL', lastShares: '2', order: terminal }] }, expected)[0].quantity).toBe(2);
  expect(() => parseExecutionTradeReferences({ executions: [{ ...execution, order: { ...terminal, cumQuantity: 1 } }] }, expected)).toThrow();
  expect(() => parseExecutionTradeReferences({ executions: [{ ...execution, commissionNotionalCollected: { value: '-1', currency: 'USD' } }] }, expected)).toThrow();
  expect(parseExecutionTradeReferences({ id: 'order-1' }, expected)).toEqual([]);
  expect(() => parseExecutionTradeReferences({ executions: [{ ...execution, order: { ...order, id: 'wrong-order' } }] }, expected)).toThrow();
});

test('duplicate identity conflicts and oversized/corrupt pages require review', () => {
  const refs = parseExecutionTradeReferences({ executions: [execution, execution] }, expected);
  expect(refs).toHaveLength(1);
  const trades = parseTradeActivityPage({ activities: [activity], eof: true }).trades;
  expect(() => candidateExecutionActivityJoin(refs, [...trades, { ...trades[0], realizedPnl: -50 }])).toThrow('CORRECTION_REQUIRES_REVIEW');
  expect(() => parseTradeActivityPage({ activities: Array(101).fill(activity), eof: true })).toThrow();
  expect(() => parseTradeActivityPage({ activities: [{ ...activity, trade: { ...activity.trade, qtyDecimal: 'NaN' } }], eof: true })).toThrow();
});
