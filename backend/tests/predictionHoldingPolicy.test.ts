import { planPredictionHoldingReduction, assertPredictionHoldingPolicy, predictionMarketPolicyFingerprint } from '../src/trading/predictionHoldingPolicy';
import type { VenueMarket, VenueBook } from '../src/services/predictionVenue';
const now = 1800000000000;
const thresholds = { tpBuffer: .01, exitEdge: .02, evidenceShift: .1 };
const holding = { openingExecutionId: 'opening', credentialScopeKey: 'grant', marketSlug: 'market', side: 'YES' as const,
  remainingQuantity: 5, openingQuantity: 5, openingNotional: 2.5 };
const market: VenueMarket = { venue: 'polymarket_us', id: 'market', question: 'fixture', category: 'general', open: true,
  executionMetadataVerified: true, tickSize: .01, minQty: .01, feeCoefficient: .0695 };
const book: VenueBook = { bids: [{ price: .3, size: 1.269 }], asks: [{ price: .31, size: 10 }], state: 'MARKET_STATE_OPEN', fetchedAt: now };
const forecast = { id: 'latest', venue: 'polymarket_us', marketSlug: 'market', fairProb: .2, llmProb: .2,
  evidenceWeight: .8, createdAt: new Date(now - 1000), resolvedAt: null };
const entryForecast = { ...forecast, id: 'entry', fairProb: .8, llmProb: .8, createdAt: new Date(now - 10000) };
const snapshot = { scopeKey: 'grant', identity: 'identity', observedAt: now, cash: 100, buyingPower: 100,
  positions: { market: { netPositionDecimal: '5', expired: false } }, openOrders: [] };
const input = () => ({ holding, market, book, forecast, entryForecast, snapshot, thresholds, now });

test('edge flip chooses only executable owned depth rounded down and stable persistent decision key', () => {
  const first = planPredictionHoldingReduction(input());
  expect(first).toMatchObject({ status: 'REDUCTION_READY', reason: 'edge_flipped', quantity: 1.26, sideMinPrice: .3 });
  expect(planPredictionHoldingReduction(input())).toEqual(first);
  const dust = planPredictionHoldingReduction({ ...input(), snapshot: { ...snapshot,
    positions: { market: { netPositionDecimal: '4.999999995', expired: false } } }, book: { ...book, bids: [{ price: .3, size: 100 }] } });
  expect(dust.status).toBe('REDUCTION_READY');
  if (dust.status === 'REDUCTION_READY') expect(dust.quantity).toBeLessThanOrEqual(4.999999995);
});
test('NO sells complement YES asks and use a valid YES grid even when one is not divisible by tick', () => {
  const no = { ...input(), holding: { ...holding, side: 'NO' as const }, forecast: { ...forecast, fairProb: .9 },
    snapshot: { ...snapshot, positions: { market: { netPositionDecimal: '-5', expired: false } } },
    book: { ...book, bids: [{ price: .19, size: 10 }], asks: [{ price: .2, size: 1.269 }] } };
  expect(planPredictionHoldingReduction(no)).toMatchObject({ status: 'REDUCTION_READY', quantity: 1.26, sideMinPrice: .8 });
  const odd = planPredictionHoldingReduction({ ...no, market: { ...market, tickSize: .03 },
    book: { ...book, bids: [{ price: .3, size: 10 }], asks: [{ price: .33, size: 10 }] } });
  expect(odd.status).toBe('REDUCTION_READY');
  if (odd.status === 'REDUCTION_READY') expect((1 - odd.sideMinPrice) / .03).toBeCloseTo(Math.round((1 - odd.sideMinPrice) / .03));
});
test('convergence requires net fee allowance; deterioration and unchanged thesis preserve existing policy ordering', () => {
  const neutral = { ...forecast, fairProb: .6 }, base = { ...entryForecast, fairProb: .6 };
  const common = { ...input(), market: { ...market, feeCoefficient: .04 }, forecast: neutral, entryForecast: base };
  expect(planPredictionHoldingReduction({ ...common, book: { ...book, bids: [{ price: .59, size: 10 }], asks: [{ price: .61, size: 10 }] } }).status).toBe('HOLD');
  expect(planPredictionHoldingReduction({ ...common, book: { ...book, bids: [{ price: .6, size: 10 }], asks: [{ price: .61, size: 10 }] } })).toMatchObject({ reason: 'tp_converged' });
  expect(planPredictionHoldingReduction({ ...input(), forecast: { ...forecast, fairProb: .65 } })).toMatchObject({ reason: 'evidence_changed' });
  expect(planPredictionHoldingReduction({ ...input(), forecast: { ...forecast, fairProb: .8 } }).status).toBe('HOLD');
});
test.each([
  { venue: 'international' }, { marketSlug: 'other' }, { fairProb: NaN }, { llmProb: null }, { evidenceWeight: 0 },
  { createdAt: new Date(now - 300001) }, { createdAt: new Date(now + 1001) }, { resolvedAt: new Date(now) },
])('does not invent forecast evidence for %j', change => {
  expect(planPredictionHoldingReduction({ ...input(), forecast: { ...forecast, ...change } }).status).toBe('BLOCKED');
});
test.each([
  { fetchedAt: now - 5001 }, { state: 'MARKET_STATE_CLOSED' }, { bids: [{ price: Infinity, size: 1 }] },
  { asks: [{ price: .3, size: NaN }] }, { bids: [{ price: .5, size: 1 }] }, { bids: [] },
])('rejects stale, crossed or nonfinite executable evidence %j', change => {
  expect(planPredictionHoldingReduction({ ...input(), book: { ...book, ...change } }).status).toBe('BLOCKED');
});
test.each([
  { netPositionDecimal: '6', expired: false }, { netPositionDecimal: '4', expired: false }, { netPositionDecimal: '5', expired: true },
])('manual differences or settlement cannot become readiness %j', position => {
  expect(planPredictionHoldingReduction({ ...input(), snapshot: { ...snapshot, positions: { market: position } } }).status).toBe('BLOCKED');
});
test('new book receipt cannot extend original policy expiry', async () => {
  const plan = planPredictionHoldingReduction(input()); expect(plan.status).toBe('REDUCTION_READY');
  if (plan.status !== 'REDUCTION_READY') throw new Error('Fixture plan unavailable');
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 5001);
  try {
    await expect(assertPredictionHoldingPolicy({}, plan.policyEvidence, { id: 'opening', predictionId: 'entry' },
      { remainingQuantity: 5 }, plan, predictionMarketPolicyFingerprint(market))).rejects.toThrow('AUTHORITY_CHANGED');
  } finally { clock.mockRestore(); }
});
