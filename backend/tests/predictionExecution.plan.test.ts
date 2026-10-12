jest.mock('../src/utils/prisma', () => ({ prisma: {} }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false }));
jest.mock('../src/services/polymarketUS', () => ({}));
jest.mock('../src/utils/logger', () => ({ logger: {} }));
import { planLivePrediction, predictionAccountExposure } from '../src/trading/predictionExecution';
const now = Date.now();
const forecast = () => ({ id: 'p', venue: 'polymarket_us', marketSlug: 'm', side: 'YES', decision: 'YES',
  fairProb: .8, llmProb: .8, evidenceWeight: 1, createdAt: new Date(now) });
const market = () => ({ venue: 'polymarket_us' as const, id: 'm', question: 'm', category: 'general', open: true,
  feeCoefficient: .0695, tickSize: .001, minQty: 1, executionMetadataVerified: true });
const book = () => ({ bids: [{ price: .49, size: 100 }], asks: [{ price: .5, size: 100 }],
  state: 'MARKET_STATE_OPEN', fetchedAt: now });
const account = () => ({ scopeKey: 's', identity: 'i', cash: 100, buyingPower: 100, positions: {} as Record<string, any>, openOrders: [] as any[], observedAt: now });
const risk = { maxPositionSizePct: 5, maxRiskPerTradePct: 5, dailyLossLimitPct: 3 };
beforeEach(() => { process.env.POLYMARKET_US_MAX_ORDER_USD = '5'; delete process.env.POLYMARKET_MIN_EDGE; delete process.env.POLYMARKET_KELLY_FRACTION; });
test('sizes using available cash and fee-inclusive worst loss, with a five-second deadline', () => {
  const p = planLivePrediction(forecast(), market(), book(), account(), risk, now);
  expect(p.quantity).toBe(5); expect(p.reservedUsd).toBe(2.59);
  expect(p.planExpiresAt.getTime()).toBe(now + 5000);
  expect(p.planNetEdge).toBeCloseTo(.282625);
});
test('NO uses the executable complement bid and correct payout probability', () => {
  const f = { ...forecast(), side: 'NO', decision: 'NO', fairProb: .2 };
  const b = { ...book(), bids: [{ price: .6, size: 100 }], asks: [{ price: .62, size: 100 }] };
  const p = planLivePrediction(f, market(), b, account(), risk, now);
  expect(p.sideLimitPrice).toBeCloseTo(.4);
  expect(p.reservedUsd).toBeLessThanOrEqual(3);
});
test('a $10 account with a 3% budget cannot buy a $0.50 minimum lot', () => {
  expect(() => planLivePrediction(forecast(), market(), book(), { ...account(), cash: 10, buyingPower: 10 }, risk, now)).toThrow(/minimum quantity/);
});
test.each([
  ['stale forecast', () => ({ f: { ...forecast(), createdAt: new Date(now - 300001) } })],
  ['absent exchange fees', () => ({ m: { ...market(), executionMetadataVerified: false } })],
  ['stale book', () => ({ b: { ...book(), fetchedAt: now - 5001 } })],
  ['off-tick ask', () => ({ b: { ...book(), asks: [{ price: .5001, size: 10 }] } })],
  ['closed market', () => ({ m: { ...market(), open: false } })],
  ['crossed book', () => ({ b: { ...book(), bids: [{ price: .51, size: 10 }] } })],
  ['unknown position', () => ({ a: { ...account(), positions: { other: { netPosition: null } } } })],
  ['broker pending order', () => ({ a: { ...account(), openOrders: [{ id: 'pending' }] } })],
  ['settlement not reconciled', () => ({ a: { ...account(), positions: { other: { netPosition: '1', expired: true } } } })],
  ['insufficient net edge', () => ({ f: { ...forecast(), fairProb: .51 } })],
])('refuses %s', (_name, changes) => {
  const c: any = changes();
  expect(() => planLivePrediction(c.f ?? forecast(), c.m ?? market(), c.b ?? book(), c.a ?? account(), risk, now)).toThrow();
});
test('signed cost basis cannot inflate bankroll or remove short exposure', () => {
  const a = { ...account(), positions: { other: { netPosition: '-4', expired: false, cost: { value: '-1000000', currency: 'USD' } } } };
  expect(predictionAccountExposure(a).cost).toBe(4);
  expect(() => planLivePrediction(forecast(), market(), book(), a, risk, now)).toThrow(/minimum quantity/);
});
test('top-of-book liquidity reduces size', () => {
  expect(planLivePrediction(forecast(), market(), { ...book(), asks: [{ price: .5, size: 2 }] }, account(), risk, now).quantity).toBe(2);
});
