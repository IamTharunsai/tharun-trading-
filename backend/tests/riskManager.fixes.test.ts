jest.mock('../src/utils/prisma', () => ({ prisma: { trade: {}, position: {} } }));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../src/services/correlationService', () => ({ correlationService: { shouldAddAssetToPortfolio: jest.fn().mockResolvedValue({ shouldAdd: true }) } }));
const killSwitch = jest.fn();
jest.mock('../src/agents/orchestrator', () => ({ activateKillSwitch: () => killSwitch(), isKillSwitchActive: () => false }));
const tradeFailed = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/services/alertService', () => ({ alert: { tradeFailed: (...a: any[]) => tradeFailed(...a) } }));

import { validateTradeSignal } from '../src/trading/riskManager';
import { normalizeConfidence } from '../src/utils/confidence';

const sig = (over: any = {}) => ({
  asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 70,
  entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110, positionSizePct: 5,
  reasoning: '', agentDecisionId: '', ...over,
}) as any;
const pf = (over: any = {}) => ({
  totalValue: 1000, cashBalance: 900, invested: 100, pnlDay: 0, pnlDayPct: 0, pnlTotal: 0, pnlTotalPct: 0,
  pnlWeekPct: 0, positions: [], openPositions: 0, tradesExecutedToday: 0, drawdownFromPeak: 0, ...over,
}) as any;

const ENV_KEYS = ['DAILY_LOSS_LIMIT_PCT', 'WEEKLY_DRAWDOWN_LIMIT_PCT', 'MAX_DRAWDOWN_ALL_TIME_PCT', 'CASH_RESERVE_PCT', 'MAX_POSITION_SIZE_PCT', 'MAX_TRADES_PER_DAY', 'MAX_OPEN_POSITIONS', 'MIN_AGENT_CONFIDENCE'];
beforeEach(() => { ENV_KEYS.forEach(k => delete process.env[k]); tradeFailed.mockClear(); killSwitch.mockClear(); });
const flush = () => new Promise(r => setTimeout(r, 0));

describe('confidence scale', () => {
  it('normalises 0-1 fractions and 0-100 percents to 0-100', () => {
    expect(normalizeConfidence(0.6)).toBe(60);
    expect(normalizeConfidence(60)).toBe(60);
    expect(normalizeConfidence(250)).toBe(100);
    expect(normalizeConfidence(undefined)).toBe(0);
  });

  it('a 0-100 confidence is no longer inflated into an automatic approval', async () => {
    // Old bug: confidence 30 (0-100) → "300 of 10 votes" → HIGH_CONVICTION.
    const r = await validateTradeSignal(sig({ confidence: 30 }), pf());
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/MIN_AGENT_CONFIDENCE/);
  });

  it('a 0-1 confidence is read as a fraction', async () => {
    expect((await validateTradeSignal(sig({ confidence: 0.7 }), pf())).approved).toBe(true);
    expect((await validateTradeSignal(sig({ confidence: 0.3 }), pf())).approved).toBe(false);
  });
});

describe('env risk settings are actually enforced', () => {
  it('DAILY_LOSS_LIMIT_PCT (default 3%) blocks new entries', async () => {
    expect((await validateTradeSignal(sig(), pf({ pnlDayPct: -3.5 }))).approved).toBe(false);
    process.env.DAILY_LOSS_LIMIT_PCT = '5';
    expect((await validateTradeSignal(sig(), pf({ pnlDayPct: -3.5 }))).approved).toBe(true);
  });

  it('MAX_DRAWDOWN_ALL_TIME_PCT trips the kill switch', async () => {
    process.env.MAX_DRAWDOWN_ALL_TIME_PCT = '10';
    const r = await validateTradeSignal(sig(), pf({ drawdownFromPeak: 12 }));
    expect(r.approved).toBe(false);
    expect(killSwitch).toHaveBeenCalled();
  });

  it('MAX_OPEN_POSITIONS caps concurrent positions', async () => {
    process.env.MAX_OPEN_POSITIONS = '2';
    const r = await validateTradeSignal(sig(), pf({ positions: [{ asset: 'MSFT' }, { asset: 'NVDA' }] }));
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/Max open positions/);
  });

  it('MAX_POSITION_SIZE_PCT clamps the size instead of passing it through', async () => {
    process.env.MAX_POSITION_SIZE_PCT = '4';
    const r = await validateTradeSignal(sig({ positionSizePct: 9 }), pf());
    expect(r.approved).toBe(true);
    expect(r.adjustedSize).toBe(4);
  });

  it('CASH_RESERVE_PCT is measured after the trade', async () => {
    process.env.CASH_RESERVE_PCT = '50';
    const r = await validateTradeSignal(sig({ positionSizePct: 10 }), pf({ cashBalance: 550 }));
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/Cash reserve/);
  });

  it('fails closed on a broken portfolio read', async () => {
    expect((await validateTradeSignal(sig(), pf({ totalValue: NaN }))).approved).toBe(false);
  });

  it('HOLD is never approved', async () => {
    expect((await validateTradeSignal(sig({ direction: 'HOLD' }), pf())).approved).toBe(false);
  });
});

describe('alerting (operator-precedence fix)', () => {
  it('does not alert for an approved trade or a soft (confidence) rejection', async () => {
    await validateTradeSignal(sig(), pf());
    await validateTradeSignal(sig({ confidence: 10 }), pf());
    await flush();
    expect(tradeFailed).not.toHaveBeenCalled();
  });

  it('alerts on a hard risk-limit rejection', async () => {
    await validateTradeSignal(sig(), pf({ pnlWeekPct: -20 }));
    await flush(); await flush();
    expect(tradeFailed).toHaveBeenCalledTimes(1);
  });
});
