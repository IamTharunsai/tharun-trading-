import { parsePredictionReductionEvidence, assertReductionProgress, projectPredictionHolding } from '../src/trading/predictionReductionEvidence';

const expected = { orderId: 'sell', marketSlug: 'market', side: 'YES' as const, quantity: 2.5, sideMinPrice: .7 };
const order = () => ({ id: 'sell', marketSlug: 'market', intent: 'ORDER_INTENT_SELL_LONG', type: 'ORDER_TYPE_LIMIT',
  tif: 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL', quantity: 2.5, cumQuantity: .5, leavesQuantity: 2,
  state: 'ORDER_STATE_PARTIALLY_FILLED', price: { value: '0.7', currency: 'USD' },
  avgPx: { value: '0.8', currency: 'USD' }, commissionNotionalTotalCollected: { value: '0.01', currency: 'USD' } });

test('fractional YES sales use cumulative actual proceeds and commission', () => {
  expect(parsePredictionReductionEvidence({ order: order() }, expected)).toEqual({ state: 'ORDER_STATE_PARTIALLY_FILLED',
    terminal: false, quantity: .5, proceeds: .4, fees: .01 });
});
test('SELL_SHORT converts YES .2 to economic NO .8 and enforces a NO floor of .7', () => {
  const no = { ...order(), intent: 'ORDER_INTENT_SELL_SHORT', price: { value: '0.3', currency: 'USD' },
    avgPx: { value: '0.2', currency: 'USD' }, outcomeSide: 'OUTCOME_SIDE_NO', action: 'ORDER_ACTION_SELL' };
  expect(parsePredictionReductionEvidence({ order: no }, { ...expected, side: 'NO' }).proceeds).toBeCloseTo(.4);
  expect(() => parsePredictionReductionEvidence({ order: { ...no, avgPx: { value: '0.4', currency: 'USD' } } },
    { ...expected, side: 'NO' })).toThrow('REDUCTION_PRICE_FLOOR');
});
test.each([
  { id: 'other' }, { marketSlug: 'other' }, { quantity: 3 }, { cumQuantity: 3 }, { intent: 'ORDER_INTENT_BUY_LONG' },
  { action: 'ORDER_ACTION_BUY' }, { outcomeSide: 'OUTCOME_SIDE_NO' }, { tif: 'TIME_IN_FORCE_GOOD_TILL_CANCEL' },
  { avgPx: { value: '0.6', currency: 'USD' } }, { state: 'ORDER_STATE_FILLED' },
  { state: 'ORDER_STATE_CANCELED' }, { commissionNotionalTotalCollected: { value: '-1', currency: 'USD' } },
])('rejects incompatible identity/action/size/state/price %j', change => {
  expect(() => parsePredictionReductionEvidence({ order: { ...order(), ...change } }, expected)).toThrow();
});
test('missing fees remain unknown; a terminal partial does not require full quantity', () => {
  const row: any = { ...order(), state: 'ORDER_STATE_CANCELED', leavesQuantity: 0 };
  delete row.commissionNotionalTotalCollected;
  expect(parsePredictionReductionEvidence({ order: row }, expected)).toMatchObject({ terminal: true, quantity: .5, fees: null });
});
const prior = { appliedQuantity: .5, appliedProceeds: .4, appliedFees: .01, terminal: false };
const next = { state: 'ORDER_STATE_PARTIALLY_FILLED', terminal: false, quantity: 1, proceeds: .8, fees: .02 };
test('replay has zero effect and a late known fee can resolve unknown commission', () => {
  expect(() => assertReductionProgress(prior, { ...next, quantity: .5, proceeds: .4, fees: .01 }, .7)).not.toThrow();
  expect(() => assertReductionProgress({ ...prior, appliedFees: null, terminal: true },
    { ...next, quantity: .5, proceeds: .4, fees: .01, terminal: true }, .7)).not.toThrow();
});
test.each([
  { quantity: .4 }, { proceeds: .3 }, { proceeds: .74 }, { proceeds: 1 }, { fees: 0 }, { fees: null },
])('refuses cumulative regressions and incremental price violations %j', change => {
  expect(() => assertReductionProgress(prior, { ...next, ...change }, .7)).toThrow();
});
test('a terminal observation cannot reopen or acquire a larger fill later without review', () => {
  expect(() => assertReductionProgress({ ...prior, terminal: true }, next, .7)).toThrow();
});
test('partial/full cumulative projections conserve opening basis and never double count losses', () => {
  const opening = { quantity: 2.5, notional: 1.5, fees: .05 };
  const first = { appliedQuantity: .5, appliedProceeds: .25, appliedFees: .01 };
  const partial = projectPredictionHolding(opening, [first]);
  expect(partial.remainingQuantity).toBe(2); expect(partial.remainingBasis).toBeCloseTo(1.24);
  expect(partial.realizedPnl).toBeCloseTo(-.07);
  expect(projectPredictionHolding(opening, [first])).toEqual(partial);
  const full = projectPredictionHolding(opening, [first, { appliedQuantity: 2, appliedProceeds: 1, appliedFees: .04 }]);
  expect(full.remainingQuantity).toBe(0); expect(full.remainingBasis).toBeCloseTo(0); expect(full.realizedPnl).toBeCloseTo(-.35);
  expect(() => projectPredictionHolding(opening, [first, { ...first, appliedQuantity: 2.1 }])).toThrow();
});
test('unknown fee keeps P&L unknown while retaining confirmed remaining quantity and basis', () => {
  expect(projectPredictionHolding({ quantity: 2, notional: 1, fees: .04 }, [
    { appliedQuantity: .5, appliedProceeds: .4, appliedFees: null },
  ])).toMatchObject({ remainingQuantity: 1.5, realizedPnl: null });
  expect(projectPredictionHolding({ quantity: 2, notional: 1, fees: .04 }, [
    { appliedQuantity: 0, appliedProceeds: 0, appliedFees: null },
  ]).realizedPnl).toBe(0);
});
