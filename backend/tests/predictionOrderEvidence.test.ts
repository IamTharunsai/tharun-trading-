import { parsePredictionOrderEvidence } from '../src/trading/predictionOrderEvidence';
const expected = { orderId: 'order', marketSlug: 'market', side: 'YES' as const, quantity: 5, sideLimitPrice: .5 };
const order = () => ({ id: 'order', marketSlug: 'market', intent: 'ORDER_INTENT_BUY_LONG', type: 'ORDER_TYPE_LIMIT',
  price: { value: '0.5', currency: 'USD' }, quantity: 5, cumQuantity: 2, leavesQuantity: 3,
  state: 'ORDER_STATE_PARTIALLY_FILLED', avgPx: { value: '0.49', currency: 'USD' },
  commissionNotionalTotalCollected: { value: '0.03', currency: 'USD' } });
test('an acknowledgement alone cannot become a fill', () => {
  expect(() => parsePredictionOrderEvidence({ id: 'order' }, expected)).toThrow();
});
test('partial fills expose only cumulative confirmed quantity and collected fees', () => {
  expect(parsePredictionOrderEvidence({ order: order() }, expected)).toEqual({ state: 'ORDER_STATE_PARTIALLY_FILLED',
    terminal: false, quantity: 2, outcomePrice: .49, notional: .98, fees: .03 });
});
test('NO fill cost complements the YES average', () => {
  const o = { ...order(), intent: 'ORDER_INTENT_BUY_SHORT', price: { value: '0.6', currency: 'USD' }, avgPx: { value: '0.61', currency: 'USD' } };
  expect(parsePredictionOrderEvidence({ order: o }, { ...expected, side: 'NO', sideLimitPrice: .4 }).outcomePrice).toBeCloseTo(.39);
});
test('missing fees are unknown rather than free', () => {
  const o: any = order(); delete o.commissionNotionalTotalCollected;
  expect(parsePredictionOrderEvidence({ order: o }, expected).fees).toBeNull();
});
test.each([
  { id: 'other' }, { marketSlug: 'other' }, { intent: 'ORDER_INTENT_BUY_SHORT' }, { quantity: 6 },
  { cumQuantity: 6, leavesQuantity: 0 }, { state: 'ORDER_STATE_FILLED' }, { state: 'ORDER_STATE_REJECTED' },
  { avgPx: { value: '0.51', currency: 'USD' } }, { avgPx: { value: 'NaN', currency: 'USD' } },
  { commissionNotionalTotalCollected: { value: '-1', currency: 'USD' } },
])('rejects mismatched or impossible evidence %j', change => {
  expect(() => parsePredictionOrderEvidence({ order: { ...order(), ...change } }, expected)).toThrow();
});
test('canceled partial fills are terminal but retain the actual filled quantity', () => {
  expect(parsePredictionOrderEvidence({ order: { ...order(), state: 'ORDER_STATE_CANCELED', leavesQuantity: 0 } }, expected)).toMatchObject({ terminal: true, quantity: 2 });
});
