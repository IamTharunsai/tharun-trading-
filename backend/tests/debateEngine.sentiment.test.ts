const decisionCreate = jest.fn().mockResolvedValue({ id: 'dec-1' });
jest.mock('../src/utils/prisma', () => ({ prisma: { agentDecision: { create: (...a: any[]) => decisionCreate(...a) } } }));
const getSentiment = jest.fn();
let enabled = true;
jest.mock('../src/services/sentimentService', () => {
  const actual = jest.requireActual('../src/services/sentimentService');
  return { ...actual, isSentimentEnabled: () => enabled, getSentiment: (...a: any[]) => getSentiment(...a) };
});
import { runInvestmentCommitteeDebate } from '../src/agents/debateEngine';

// RSI 20 + bullish MACD → technical BUY with high confidence.
const snap = (rsi = 20) => ({
  asset: 'AAPL', market: 'stocks', price: 100, priceChangePct24h: 1, volume24h: 1e6,
  indicators: { rsi14: rsi, macd: { value: 1, signal: 0.5, histogram: 0.5 }, volumeAvg20: 1e6, ema21: 99, sma50: 95, atr14: 2 },
}) as any;
const sent = (score: number, mentionCount = 12) => ({
  asset: 'AAPL', market: 'stocks', score, confidence: 0.6, mentionCount, filteredOut: 0, volumeZScore: 0.5, baselineSamples: 10,
  sourceCounts: { alpaca: mentionCount }, freshnessMinutes: 20, scorer: 'lexicon', headlines: ['h1'], computedAt: '',
});

beforeEach(() => { jest.clearAllMocks(); enabled = true; });

describe('committee + sentiment', () => {
  it('baseline (sentiment disabled): technical BUY is approved and logged as an AgentDecision', async () => {
    enabled = false;
    const t = await runInvestmentCommitteeDebate(snap(), { weeklyDrawdownPct: 0 }, 'TRENDING_BULL', {});
    expect(t.finalDecision).toBe('BUY');
    expect(t.executionApproved).toBe(true);
    expect(getSentiment).not.toHaveBeenCalled();
    expect(t.agentDecisionId).toBe('dec-1');
    expect(decisionCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ asset: 'AAPL', signal: 'BUY', regime: 'TRENDING_BULL' }));
  });

  it('strongly negative sentiment vetoes the BUY and is recorded on the AgentDecision', async () => {
    getSentiment.mockResolvedValue(sent(-0.6));
    const t = await runInvestmentCommitteeDebate(snap(), { weeklyDrawdownPct: 0 }, 'TRENDING_BULL', {});
    expect(t.finalDecision).toBe('BUY');
    expect(t.executionApproved).toBe(false);
    expect(t.positionSizePct).toBe(0);
    expect(t.sentiment?.veto).toBe(true);
    const data = decisionCreate.mock.calls[0][0].data;
    expect(data.executionReason).toMatch(/VETO BUY/);
    expect(data.marketSnapshot.sentiment).toEqual(expect.objectContaining({ veto: true, score: -0.6 }));
    expect(data.agentVotes.some((v: any) => v.agentId === 'sentiment-x-news')).toBe(true);
  });

  it('agreeing sentiment scales size up (≤1.25x), disagreeing scales it down', async () => {
    enabled = false;
    const base = (await runInvestmentCommitteeDebate(snap(), {}, 'R', {})).positionSizePct;
    enabled = true;
    getSentiment.mockResolvedValue(sent(0.8));
    const up = (await runInvestmentCommitteeDebate(snap(), {}, 'R', {})).positionSizePct;
    getSentiment.mockResolvedValue(sent(-0.2));
    const down = (await runInvestmentCommitteeDebate(snap(), {}, 'R', {})).positionSizePct;
    expect(up).toBeCloseTo(base * 1.25, 5);
    expect(down).toBeLessThan(base);
    expect(down).toBeGreaterThanOrEqual(base * 0.5);
  });

  it('sentiment never creates a trade: on a technical HOLD it is not even fetched', async () => {
    getSentiment.mockResolvedValue(sent(0.95, 100));
    const t = await runInvestmentCommitteeDebate(snap(50), {}, 'RANGING', {});
    expect(t.finalDecision).toBe('HOLD');
    expect(t.executionApproved).toBe(false);
    expect(getSentiment).not.toHaveBeenCalled();
  });

  it('a sentiment outage does not block the technical decision', async () => {
    getSentiment.mockRejectedValue(new Error('all sources down'));
    const t = await runInvestmentCommitteeDebate(snap(), {}, 'R', {});
    expect(t.executionApproved).toBe(true);
    expect(t.sentiment).toBeNull();
  });
});
