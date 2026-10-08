const prismaMock = {
  trade: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn(), update: jest.fn() },
  prediction: { deleteMany: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}) },
};
jest.mock('../src/utils/prisma', () => ({ prisma: prismaMock }));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false }));
const placeUS = jest.fn().mockResolvedValue({ id: 'us-order-1' });
jest.mock('../src/services/polymarketUS', () => ({ placePolymarketUSOrder: (...a: any[]) => placeUS(...a) }));
jest.mock('axios');
import axios from 'axios';
import { placePolymarketBet, checkPolymarketExposure } from '../src/services/polymarket';

const analysis = (over: any = {}) => ({
  question: 'Will X happen?', marketImpliedProbability: 0.4, ourEstimatedProbability: 0.6, edge: 0.2,
  confidence: 70, recommendedSide: 'YES', betSizeUSD: 4, expectedProfitUSD: 1, reasoning: '', riskFactors: [],
  resolutionDate: new Date().toISOString(), daysToResolution: 5, conditionId: 'cond-1', ...over,
}) as any;

const LIVE_ENV = { TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK', POLYMARKET_US_LIVE: 'true' };
const saved = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...saved };
  ['POLYMARKET_MAX_OPEN', 'POLYMARKET_MAX_TOTAL_EXPOSURE_USD', 'POLYMARKET_US_MAX_ORDER_USD', 'POLYMARKET_MAX_BET_USD', 'TRADING_MODE', 'LIVE_TRADING_CONFIRMED', 'POLYMARKET_US_LIVE'].forEach(k => delete process.env[k]);
  prismaMock.trade.findMany.mockResolvedValue([]);
});

describe('de-dupe and exposure caps', () => {
  it('never opens a second bet on the same market', async () => {
    prismaMock.trade.findMany.mockResolvedValue([{ brokerOrderId: 'cond-1', entryPrice: 0.4, quantity: 10 }]);
    const r = await placePolymarketBet(analysis(), 'cond-1', true);
    expect(r.success).toBe(false);
    expect(prismaMock.trade.create).not.toHaveBeenCalled();
  });

  it('honours POLYMARKET_MAX_OPEN', async () => {
    process.env.POLYMARKET_MAX_OPEN = '2';
    prismaMock.trade.findMany.mockResolvedValue([{ brokerOrderId: 'a' }, { brokerOrderId: 'b' }]);
    expect((await checkPolymarketExposure('cond-1', 1)).ok).toBe(false);
  });

  it('honours the optional USD exposure cap', async () => {
    process.env.POLYMARKET_MAX_TOTAL_EXPOSURE_USD = '10';
    prismaMock.trade.findMany.mockResolvedValue([{ brokerOrderId: 'a', entryPrice: 0.5, quantity: 16 }]); // $8 open
    expect((await checkPolymarketExposure('cond-1', 4)).ok).toBe(false);
    expect((await checkPolymarketExposure('cond-1', 2)).ok).toBe(true);
  });

  it('caps each bet at POLYMARKET_US_MAX_ORDER_USD / POLYMARKET_MAX_BET_USD', async () => {
    process.env.POLYMARKET_MAX_BET_USD = '2';
    await placePolymarketBet(analysis({ betSizeUSD: 50 }), 'cond-1', true);
    const data = prismaMock.trade.create.mock.calls[0][0].data;
    expect(data.entryPrice * data.quantity).toBeCloseTo(2);
  });
});

describe('live gate for Polymarket', () => {
  it('POLYMARKET_US_LIVE=true alone books PAPER and sends nothing', async () => {
    process.env.POLYMARKET_US_LIVE = 'true';
    const r = await placePolymarketBet(analysis({ marketSlug: 'us-slug' }), 'cond-1', false);
    expect(r.success).toBe(false);
    expect(prismaMock.trade.create).not.toHaveBeenCalled();
    expect(placeUS).not.toHaveBeenCalled();
    expect((axios as any).post).not.toHaveBeenCalled();
  });

  it('even with the full gate, scanner markets without a US slug stay paper', async () => {
    Object.assign(process.env, LIVE_ENV);
    const r = await placePolymarketBet(analysis(), 'cond-1', false);
    expect(r.success).toBe(false);
    expect(prismaMock.trade.create).not.toHaveBeenCalled();
    expect(placeUS).not.toHaveBeenCalled();
  });

  it('legacy research cannot authorize live US execution or fabricate accepted-order fills', async () => {
    Object.assign(process.env, LIVE_ENV);
    const r = await placePolymarketBet(analysis({ marketSlug: 'us-slug' }), 'cond-1', false);
    expect(r.success).toBe(false);
    expect(placeUS).not.toHaveBeenCalled();
    expect(prismaMock.trade.create).not.toHaveBeenCalled();
    expect((axios as any).post).not.toHaveBeenCalled(); // no hand-built CLOB order
  });

  it('isPaper=true (what the scheduler passes) is always paper', async () => {
    Object.assign(process.env, LIVE_ENV);
    await placePolymarketBet(analysis({ marketSlug: 'us-slug' }), 'cond-1', true);
    expect(placeUS).not.toHaveBeenCalled();
  });
});

describe('scanPolymarketOpportunities', () => {
  it('does not place bets itself, and refuses to run twice at once', async () => {
    let release: (v: any) => void = () => {};
    (axios as any).get.mockImplementation(() => new Promise(r => { release = r; }));
    const mod = require('../src/services/polymarket');
    const first = mod.scanPolymarketOpportunities(1000);
    expect(mod.isPolymarketScanRunning()).toBe(true);
    expect(await mod.scanPolymarketOpportunities(1000)).toEqual([]); // overlapping tick skipped
    release({ data: [] });
    await expect(first).rejects.toThrow('No prediction research');
    expect(mod.isPolymarketScanRunning()).toBe(false);
    expect(prismaMock.trade.create).not.toHaveBeenCalled();
  });
});
