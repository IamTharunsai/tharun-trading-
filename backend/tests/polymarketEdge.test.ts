// Polymarket US edge engine: filters, planning, paper execution, exits and the
// scorecard. In-memory fake DB + fake venue + mocked LLM — no network, and the
// real-money order function must never be called.

// ── tiny in-memory Prisma fake ──────────────────────────────────────────────
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let seq = 0;
const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, cond]) => {
  const v = row[k];
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('not' in cond) return cond.not === null ? v != null : v !== cond.not;
    if ('gte' in cond) return v != null && new Date(v).getTime() >= new Date(cond.gte).getTime();
    return true;
  }
  return cond === null ? v == null : v === cond;
});
const order = (rows: Row[], orderBy?: Row) => {
  if (!orderBy) return rows;
  const [k, dir] = Object.entries(orderBy)[0];
  return [...rows].sort((a, b) => {
    const av = a[k] instanceof Date ? a[k].getTime() : a[k], bv = b[k] instanceof Date ? b[k].getTime() : b[k];
    return (av > bv ? 1 : av < bv ? -1 : 0) * (dir === 'desc' ? -1 : 1);
  });
};
const model = (name: string) => {
  tables[name] = tables[name] || [];
  const t = () => tables[name];
  return {
    findMany: jest.fn(async (a: any = {}) => order(t().filter(r => matches(r, a.where)), a.orderBy).slice(0, a.take ?? 1e9)),
    findFirst: jest.fn(async (a: any = {}) => order(t().filter(r => matches(r, a.where)), a.orderBy)[0] ?? null),
    count: jest.fn(async (a: any = {}) => t().filter(r => matches(r, a.where)).length),
    create: jest.fn(async (a: any) => { const r = { id: `${name}-${++seq}`, createdAt: new Date(Date.now() + seq), ...a.data }; t().push(r); return r; }),
    update: jest.fn(async (a: any) => { const r = t().find(x => x.id === a.where.id); if (!r) throw new Error('nf'); Object.assign(r, a.data); return r; }),
    updateMany: jest.fn(async (a: any) => { const rs = t().filter(r => matches(r, a.where)); rs.forEach(r => Object.assign(r, a.data)); return { count: rs.length }; }),
    deleteMany: jest.fn(async (a: any = {}) => { const keep = t().filter(r => !matches(r, a.where)); const n = t().length - keep.length; tables[name] = keep; return { count: n }; }),
  };
};
const fakeDb: any = { trade: model('trade'), polymarketPrediction: model('polymarketPrediction'), polymarketPaperOrder: model('polymarketPaperOrder'), prediction: model('prediction') };
jest.mock('../src/utils/prisma', () => ({ prisma: fakeDb }));

const llm = jest.fn();
jest.mock('../src/services/polymarket', () => ({
  estimateProbabilityWithLLM: (...a: any[]) => llm(...a),
  checkPolymarketExposure: async (slug: string) => {
    const open = tables.trade.filter(t => t.asset === 'POLYMARKET' && t.status === 'OPEN');
    if (open.some(t => t.brokerOrderId === slug)) return { ok: false, reason: 'already holding an open bet on this market', openCount: open.length, openExposureUsd: 0 };
    if (open.length >= Number(process.env.POLYMARKET_MAX_OPEN || 10)) return { ok: false, reason: 'at POLYMARKET_MAX_OPEN', openCount: open.length, openExposureUsd: 0 };
    return { ok: true, reason: 'ok', openCount: open.length, openExposureUsd: 0 };
  },
}));
const querySentiment = jest.fn();
jest.mock('../src/services/sentimentService', () => ({ getQuerySentiment: (...a: any[]) => querySentiment(...a) }));
const killSwitch = jest.fn(() => false);
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => killSwitch() }));
const realOrder = jest.fn();
jest.mock('../src/services/polymarketUS', () => ({ placePolymarketUSOrder: (...a: any[]) => realOrder(...a), polymarketUSVenue: null }));
jest.mock('axios');
import axios from 'axios';
import * as E from '../src/services/polymarketEdge';
import type { PredictionVenue, VenueBook, VenueMarket } from '../src/services/predictionVenue';

// ── fixtures ────────────────────────────────────────────────────────────────
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const mkt = (over: Partial<VenueMarket> = {}): VenueMarket => ({
  venue: 'polymarket_us', id: 'mkt-a', question: 'Will A win?', category: 'sports', eventId: 'event-1',
  endDate: inDays(10), marketType: 'futures', open: true, bestBid: 0.40, bestAsk: 0.41,
  feeCoefficient: 0.0695, tickSize: 0.001, minQty: 1, ...over,
});
const bookOf = (bid = 0.40, ask = 0.41, size = 5000, over: Partial<VenueBook> = {}): VenueBook => ({
  bids: [{ price: bid, size }, { price: bid - 0.01, size }],
  asks: [{ price: ask, size }, { price: ask + 0.01, size }],
  state: 'MARKET_STATE_OPEN', openInterest: 50_000, volume: 500_000, fetchedAt: Date.now(), ...over,
});
function venueWith(markets: VenueMarket[], books: Record<string, VenueBook | null>, settle: Record<string, number | null> = {}): PredictionVenue {
  return {
    id: 'polymarket_us',
    listMarkets: jest.fn(async () => markets),
    getBook: jest.fn(async (id: string) => books[id] ?? null),
    getPriceHistory: jest.fn(async () => []),
    getSettlement: jest.fn(async (id: string) => settle[id] ?? null),
  };
}
const ENV_KEYS = Object.keys(process.env).filter(k => k.startsWith('POLYMARKET_'));
beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(tables)) tables[k].length = 0;
  ENV_KEYS.forEach(k => delete process.env[k]);
  Object.keys(process.env).filter(k => k.startsWith('POLYMARKET_')).forEach(k => delete process.env[k]);
  killSwitch.mockReturnValue(false);
  querySentiment.mockResolvedValue({ score: 0.2, mentions: 4, freshestHours: 2, headlines: ['[gdelt] A looks strong', '[gdelt] A injury news', '[gdelt] A favored', '[gdelt] A wins again'], scorer: 'lexicon' });
  llm.mockResolvedValue({ pYes: 0.62, confidence: 85, reasoning: 'news supports A', riskFactors: [], recommendedSide: 'YES', headlines: [] });
  E.__resetCalibrationCache();
});
afterAll(() => { expect(realOrder).not.toHaveBeenCalled(); expect((axios as any).post).not.toHaveBeenCalled(); });

const cfg = () => E.readEdgeConfig();
const noExposure = (): E.ExposureSnapshot => ({ totalUsd: 0, byEvent: {}, byCategory: {}, slugs: new Set(), openCount: 0 });
const fair = (f: number, ev = 0.8): E.FairEstimate => ({ fair: f, rawFair: f, evidenceWeight: ev, llmProb: f, llmConfidence: 80, headlineCount: 4, freshestHours: 2, sentimentScore: null, sentimentMentions: 0, momentum: null });

// ── filters ─────────────────────────────────────────────────────────────────
describe('filters', () => {
  it('pre-filter skips wide spreads, near resolution, extremes and in-play games', () => {
    expect(E.preFilterMarket(mkt(), cfg())).toBeNull();
    expect(E.preFilterMarket(mkt({ bestBid: 0.30, bestAsk: 0.40 }), cfg())).toMatch(/spread/);
    expect(E.preFilterMarket(mkt({ endDate: new Date(Date.now() + 3_600_000).toISOString() }), cfg())).toMatch(/resolution/);
    expect(E.preFilterMarket(mkt({ bestBid: 0.01, bestAsk: 0.02 }), cfg())).toMatch(/0\/1/);
    expect(E.preFilterMarket(mkt({ marketType: 'moneyline', gameStartTime: new Date(Date.now() - 60_000).toISOString() }), cfg())).toMatch(/in progress/);
    expect(E.preFilterMarket(mkt({ open: false }), cfg())).toMatch(/not open/);
  });

  it('liquidity filter needs open interest, volume and depth', () => {
    expect(E.liquidityFilter(bookOf(), cfg())).toBeNull();
    expect(E.liquidityFilter(bookOf(0.4, 0.41, 5000, { openInterest: 10 }), cfg())).toMatch(/open interest/);
    expect(E.liquidityFilter(bookOf(0.4, 0.41, 5000, { volume: 10 }), cfg())).toMatch(/volume/);
    expect(E.liquidityFilter(bookOf(0.4, 0.41, 20), cfg())).toMatch(/thin/);
  });
});

// ── planning ────────────────────────────────────────────────────────────────
describe('planEntry', () => {
  it('skips when the edge does not beat fees + half-spread + min edge', () => {
    const r = E.planEntry(mkt(), bookOf(), fair(0.44), cfg(), noExposure());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/edge below/);
  });

  it('limit mode: buys YES one tick inside the spread, Kelly-sized and capped at the max order', () => {
    const r = E.planEntry(mkt(), bookOf(0.40, 0.42), fair(0.60), cfg(), noExposure());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({ side: 'YES', mode: 'limit', price: 0.401, feePerShare: 0 });
    expect(r.plan.usd).toBeLessThanOrEqual(5); // POLYMARKET_US_MAX_ORDER_USD default
    expect(r.plan.shares).toBe(Math.floor(5 / 0.401));
  });

  it('taker mode: walks the book and pays the taker fee; buys NO when fair is low', () => {
    process.env.POLYMARKET_ORDER_MODE = 'taker';
    const r = E.planEntry(mkt(), bookOf(0.40, 0.41), fair(0.20), cfg(), noExposure());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.side).toBe('NO');
    expect(r.plan.price).toBeCloseTo(0.60); // NO ask = 1 − YES bid
    expect(r.plan.feePerShare).toBeCloseTo(0.0695 * 0.6 * 0.4);
  });

  it('enforces per-event, per-category and total exposure caps', () => {
    const ex = noExposure(); ex.byEvent['event-1'] = 9.5;
    const r = E.planEntry(mkt(), bookOf(0.40, 0.42), fair(0.60), cfg(), ex);
    expect(r.ok).toBe(false);
    const ex2 = noExposure(); ex2.byCategory.sports = 30;
    expect(E.planEntry(mkt(), bookOf(0.40, 0.42), fair(0.60), cfg(), ex2).ok).toBe(false);
    const ex3 = noExposure(); ex3.totalUsd = 50; // 50% of the $100 default bankroll
    expect(E.planEntry(mkt(), bookOf(0.40, 0.42), fair(0.60), cfg(), ex3).ok).toBe(false);
  });

  it('skips when the size is too large a share of usable depth', () => {
    const r = E.planEntry(mkt(), bookOf(0.40, 0.42, 20), fair(0.60), cfg(), noExposure());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/depth/);
  });

  it('skips when Kelly × evidence is below $1', () => {
    const r = E.planEntry(mkt(), bookOf(0.40, 0.42), fair(0.60, 0.01), cfg(), noExposure());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/below \$1/);
  });
});

// ── scan end-to-end (paper) ─────────────────────────────────────────────────
describe('runPolymarketEdgeScan', () => {
  it('stores every prediction, rests a PAPER limit order, never sends a real order', async () => {
    const v = venueWith([mkt(), mkt({ id: 'mkt-b', question: 'Will B win?', bestBid: 0.30, bestAsk: 0.45 })], { 'mkt-a': bookOf(0.40, 0.42) });
    const s = await E.runPolymarketEdgeScan({ venue: v });
    expect(s.entries).toBe(1);
    expect(tables.polymarketPrediction).toHaveLength(1);
    const p = tables.polymarketPrediction[0];
    expect(p).toMatchObject({ marketSlug: 'mkt-a', decision: 'YES', llmProb: 0.62, headlineCount: 4 });
    expect(p.fairProb).toBeGreaterThan(p.marketMid);
    expect(p.fairProb).toBeLessThan(0.62); // shrunk toward the market
    expect(tables.polymarketPaperOrder).toHaveLength(1);
    expect(tables.polymarketPaperOrder[0]).toMatchObject({ status: 'OPEN', side: 'YES', predictionId: p.id });
    expect(tables.trade).toHaveLength(0); // limit order has not filled yet
    expect(s.skips[Object.keys(s.skips).find(k => k.includes('spread'))!]).toBe(1);
    expect(llm.mock.calls[0][0].headlines).toHaveLength(4); // sentiment headlines fed to the LLM
  });

  it('records a SKIP (and no order) when no LLM is available', async () => {
    llm.mockResolvedValue(null);
    const s = await E.runPolymarketEdgeScan({ venue: venueWith([mkt()], { 'mkt-a': bookOf(0.40, 0.42) }) });
    expect(s.entries).toBe(0);
    expect(tables.polymarketPrediction[0]).toMatchObject({ decision: 'SKIP', llmProb: null });
    expect(tables.polymarketPrediction[0].skipReason).toMatch(/no LLM/);
    expect(tables.polymarketPaperOrder).toHaveLength(0);
  });

  it('daily loss stop blocks new entries but still scores the market', async () => {
    tables.trade.push({ id: 't0', asset: 'POLYMARKET', status: 'CLOSED', closedAt: new Date(), pnl: -12, metadata: {} });
    const s = await E.runPolymarketEdgeScan({ venue: venueWith([mkt()], { 'mkt-a': bookOf(0.40, 0.42) }) });
    expect(s.entriesBlocked).toMatch(/daily loss/);
    expect(s.entries).toBe(0);
    expect(tables.polymarketPrediction[0].decision).toBe('SKIP');
  });

  it('skips near-resolution markets whose news is stale', async () => {
    querySentiment.mockResolvedValue({ score: 0, mentions: 2, freshestHours: 48, headlines: ['[gdelt] old', '[gdelt] older'], scorer: 'lexicon' });
    await E.runPolymarketEdgeScan({ venue: venueWith([mkt({ endDate: inDays(1) })], { 'mkt-a': bookOf(0.40, 0.42) }) });
    expect(tables.polymarketPrediction[0].skipReason).toMatch(/stale/);
  });

  it('reuses a recent estimate instead of calling the LLM again', async () => {
    const v = venueWith([mkt()], { 'mkt-a': bookOf(0.40, 0.42) });
    llm.mockResolvedValue(null);
    await E.runPolymarketEdgeScan({ venue: v });
    await E.runPolymarketEdgeScan({ venue: v });
    expect(llm).toHaveBeenCalledTimes(1);
  });
});

// ── paper orders ────────────────────────────────────────────────────────────
describe('paper limit orders', () => {
  it('fill only when the market trades through the limit', () => {
    const o = { side: 'YES' as const, limitPrice: 0.41, createdAt: new Date(Date.now() - 60_000) };
    expect(E.limitWouldFill(o, bookOf(0.40, 0.42))).toBe(false);
    expect(E.limitWouldFill(o, bookOf(0.40, 0.41))).toBe(false); // touching is not trading through
    expect(E.limitWouldFill(o, bookOf(0.39, 0.405))).toBe(true);
    expect(E.limitWouldFill(o, bookOf(0.40, 0.42, 5000, { lastTrade: 0.40, lastTradeAt: Date.now() }))).toBe(true);
    expect(E.limitWouldFill(o, bookOf(0.40, 0.42, 5000, { lastTrade: 0.40, lastTradeAt: Date.now() - 3_600_000 }))).toBe(false); // trade before the order
    const no = { side: 'NO' as const, limitPrice: 0.58, createdAt: new Date() };
    expect(E.limitWouldFill(no, bookOf(0.425, 0.43))).toBe(true); // NO ask = 0.575 < 0.58
  });

  it('processPaperOrders fills, expires and cancels', async () => {
    const base = { venue: 'polymarket_us', category: 'sports', side: 'YES', shares: 10, status: 'OPEN', createdAt: new Date(Date.now() - 60_000) };
    tables.polymarketPaperOrder.push(
      { id: 'o-fill', marketSlug: 'm1', limitPrice: 0.41, expiresAt: new Date(Date.now() + 600_000), ...base },
      { id: 'o-exp', marketSlug: 'm2', limitPrice: 0.41, expiresAt: new Date(Date.now() - 1), ...base },
      { id: 'o-edge', marketSlug: 'm3', limitPrice: 0.41, expiresAt: new Date(Date.now() + 600_000), ...base },
    );
    tables.polymarketPrediction.push({ id: 'p3', marketSlug: 'm3', fairProb: 0.43, createdAt: new Date() });
    const v = venueWith([], { m1: bookOf(0.39, 0.40), m3: bookOf(0.39, 0.40) });
    const r = await E.processPaperOrders(v);
    expect(r).toEqual({ filled: 1, expired: 1, canceled: 1 });
    const t = tables.trade[0];
    expect(t).toMatchObject({ asset: 'POLYMARKET', type: 'BUY', entryPrice: 0.41, quantity: 10, fees: 0, brokerOrderId: 'm1', brokerConfirmed: false });
    expect(t.metadata).toMatchObject({ venue: 'polymarket_us', paper: true, orderMode: 'limit' });
  });
});

// ── exits ───────────────────────────────────────────────────────────────────
describe('exits', () => {
  const c = () => E.readEdgeConfig();
  it('decideExit: take profit at fair, cut on edge flip or evidence change', () => {
    expect(E.decideExit({ side: 'YES', entryPrice: 0.40, exitPrice: 0.55, fairNowYes: 0.55, fairAtEntrySide: 0.55, cfg: c() })).toEqual({ exit: true, reason: 'tp_converged' });
    expect(E.decideExit({ side: 'YES', entryPrice: 0.40, exitPrice: 0.35, fairNowYes: 0.36, fairAtEntrySide: 0.55, cfg: c() })).toEqual({ exit: true, reason: 'edge_flipped' });
    expect(E.decideExit({ side: 'YES', entryPrice: 0.40, exitPrice: 0.40, fairNowYes: 0.43, fairAtEntrySide: 0.56, cfg: c() })).toEqual({ exit: true, reason: 'evidence_changed' });
    expect(E.decideExit({ side: 'YES', entryPrice: 0.40, exitPrice: 0.42, fairNowYes: 0.55, fairAtEntrySide: 0.55, cfg: c() })).toEqual({ exit: false });
    expect(E.decideExit({ side: 'NO', entryPrice: 0.40, exitPrice: 0.50, fairNowYes: 0.49, fairAtEntrySide: 0.55, cfg: c() })).toEqual({ exit: true, reason: 'tp_converged' });
  });

  it('managePolymarketPositions honours resolution, then take-profit with the exit fee', async () => {
    const md = { venue: 'polymarket_us', paper: true, fairAtEntry: 0.55, feeCoefficient: 0.0695 };
    tables.trade.push(
      { id: 'won', asset: 'POLYMARKET', status: 'OPEN', type: 'SELL', brokerOrderId: 'r1', entryPrice: 0.40, quantity: 10, fees: 0.1, metadata: md },
      { id: 'tp', asset: 'POLYMARKET', status: 'OPEN', type: 'BUY', brokerOrderId: 'r2', entryPrice: 0.40, quantity: 10, fees: 0, metadata: md },
      { id: 'legacy', asset: 'POLYMARKET', status: 'OPEN', type: 'BUY', brokerOrderId: 'cond', entryPrice: 0.4, quantity: 1, metadata: {} },
    );
    tables.polymarketPrediction.push({ id: 'p', marketSlug: 'r2', fairProb: 0.55, createdAt: new Date() });
    const v = venueWith([], { r2: bookOf(0.58, 0.59) }, { r1: 0 }); // r1 resolved NO
    const r = await E.managePolymarketPositions(v);
    expect(r).toEqual({ resolved: 1, exited: 1 });
    const won = tables.trade.find(t => t.id === 'won')!;
    expect(won).toMatchObject({ status: 'CLOSED', exitPrice: 1, exitReason: 'market_resolved' });
    expect(won.pnl).toBeCloseTo((1 - 0.40) * 10 - 0.1);
    const tp = tables.trade.find(t => t.id === 'tp')!;
    expect(tp).toMatchObject({ status: 'CLOSED', exitReason: 'tp_converged', exitPrice: 0.58 });
    const exitFee = Math.round(0.0695 * 0.58 * 0.42 * 10 * 100) / 100;
    expect(tp.pnl).toBeCloseTo((0.58 - 0.40) * 10 - exitFee);
    expect(tables.trade.find(t => t.id === 'legacy')!.status).toBe('OPEN'); // not ours
  });
});

// ── resolution + scorecard ──────────────────────────────────────────────────
describe('scorecard', () => {
  it('resolves predictions from venue settlements', async () => {
    tables.polymarketPrediction.push(
      { id: 'a1', venue: 'polymarket_us', marketSlug: 's1', outcome: null, createdAt: new Date() },
      { id: 'a2', venue: 'polymarket_us', marketSlug: 's1', outcome: null, createdAt: new Date() },
      { id: 'b1', venue: 'polymarket_us', marketSlug: 's2', outcome: null, createdAt: new Date() },
    );
    const n = await E.resolvePolymarketPredictions({ venue: venueWith([], {}, { s1: 1 }) });
    expect(n).toBe(1);
    expect(tables.polymarketPrediction.filter(r => r.outcome === 1)).toHaveLength(2);
    expect(tables.polymarketPrediction.find(r => r.id === 'b1')!.outcome).toBeNull();
  });

  it('compares model vs market Brier, buckets calibration, and reports paper P&L after fees', async () => {
    for (let i = 0; i < 60; i++) {
      const yes = i % 2 === 0;
      tables.polymarketPrediction.push({
        id: `p${i}`, venue: 'polymarket_us', marketSlug: `m${i}`, llmProb: 0.5, marketMid: 0.5,
        fairProb: yes ? 0.7 : 0.3, rawFair: yes ? 0.7 : 0.3, outcome: yes ? 1 : 0, netEdge: 0.06, createdAt: new Date(),
      });
    }
    tables.trade.push(
      { id: 'w', asset: 'POLYMARKET', status: 'CLOSED', quantity: 10, entryPrice: 0.4, pnl: 5.9, fees: 0.1, exitReason: 'market_resolved', metadata: { venue: 'polymarket_us', predictionId: 'p0' }, openedAt: new Date() },
      { id: 'l', asset: 'POLYMARKET', status: 'CLOSED', quantity: 10, entryPrice: 0.4, pnl: -4.1, fees: 0.1, exitReason: 'edge_flipped', metadata: { venue: 'polymarket_us', predictionId: 'p1' }, openedAt: new Date() },
    );
    const s = await E.computeScorecard();
    expect(s.predictions).toMatchObject({ total: 60, resolved: 60, withModel: 60 });
    expect(s.model.brier).toBeCloseTo(0.09);
    expect(s.market.brier).toBeCloseTo(0.25);
    expect(s.brierSkillVsMarket).toBeCloseTo(1 - 0.09 / 0.25);
    expect(s.calibration[7].count).toBe(30);
    expect(s.trades).toMatchObject({ closed: 2, wins: 1, pnlAfterFeesUsd: 1.8, feesUsd: 0.2 });
    expect(s.trades.avgExpectedNetEdge).toBeCloseTo(0.06);
    expect(s.trades.byExitReason.edge_flipped.n).toBe(1);
    expect(s.verdict).toMatch(/beats the market/);
  });

  it('says there is not enough evidence with few resolved predictions', async () => {
    const s = await E.computeScorecard();
    expect(s.verdict).toMatch(/Not enough evidence/);
  });
});
