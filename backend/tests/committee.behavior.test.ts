jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: class { messages = { create: jest.fn() }; } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/utils/prisma', () => ({ prisma: {
  agentDecision: { create: jest.fn() },
  debateCheckpoint: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({}) },
  companyFundamentals: { findUnique: jest.fn().mockResolvedValue(null) },
} }));
jest.mock('../src/websocket/server', () => ({ getIO: jest.fn(() => ({ emit: jest.fn() })) }));
jest.mock('../src/services/fundamentalsService', () => ({ getFundamentalsSummary: jest.fn().mockResolvedValue('Fixture fundamentals: supplied revenue 100'), fetchAndStoreFundamentals: jest.fn(), fetchAndStoreAnnualReports: jest.fn() }));
jest.mock('../src/services/stockMemoryService', () => ({ getStockMemorySummary: jest.fn().mockResolvedValue('first analysis'), getRegimeMatchedLessons: jest.fn().mockResolvedValue(''), recordDebate: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/deepAnalysisService', () => ({ fetchDeepAnalysis: jest.fn().mockResolvedValue(null), formatDeepAnalysisForAgents: jest.fn() }));
jest.mock('../src/services/agentActivityMonitor', () => ({ agentActivityMonitor: { logVote: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../src/services/geopoliticalDataService', () => ({ classifySectors: jest.fn(() => []), geopoliticalDataService: {
  getHighImpactNews: jest.fn(() => []), getRecentNews: jest.fn(() => [{ title: 'AAPL fixture earnings observation', sectorsAffected: [] }]),
  generateMarketSentimentSummary: jest.fn(() => ({ overallSentiment: 'neutral', positiveNews: 1, negativeNews: 0 })),
  getActiveGeopoliticalEvents: jest.fn(() => []),
} }));
jest.mock('../src/services/selfLearning', () => ({ getAgentSuspensionWeights: jest.fn().mockResolvedValue({}), getAgentCalibrationScores: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/services/intermarketService', () => ({ intermarketService: { getIntermarketAnalysis: jest.fn().mockResolvedValue(null) } }));
jest.mock('../src/services/fredService', () => ({ getMacroSnapshot: jest.fn().mockResolvedValue({ fixture: true }), macroLine: jest.fn(() => 'Fixture macro observation: policy rate 4%') }));
jest.mock('../src/services/optionsFlowService', () => ({ optionsFlowService: { analyzeOptionsFlow: jest.fn().mockResolvedValue({ callPutRatio: 1.2, sentiment: 'BULLISH', confidence: 80, callVolume: 200, putVolume: 100, unusualActivity: [] }) } }));
jest.mock('../src/services/kronosService', () => ({ getForecast: jest.fn() }));
jest.mock('../src/utils/llmRouter', () => ({ routedMessagesCreate: jest.fn(), providerFor: jest.fn(() => 'ollama') }));
// The committee only needs the current mode here; broker clients and network
// sentiment are separate contracts, not dependencies of these dummy-provider tests.
jest.mock('../src/trading/brokerRouter', () => ({ getActiveMode: jest.fn(() => 'paper') }));
jest.mock('../src/services/sentimentService', () => ({
  isSentimentEnabled: jest.fn(() => false),
  getSentiment: jest.fn(),
  evaluateSentimentGate: jest.fn(),
}));

import { prisma } from '../src/utils/prisma';
import { getForecast } from '../src/services/kronosService';
import { routedMessagesCreate } from '../src/utils/llmRouter';
import { getIO } from '../src/websocket/server';
import { getFundamentalsSummary } from '../src/services/fundamentalsService';
import { teamSessionRegistry } from '../src/services/teamSessions';
// Load and transform the real committee before Jest starts an individual test's
// five-second deadline. Cold TypeScript loading is not committee execution.
import { runInvestmentCommitteeDebate, getLlmSpendToday } from '../src/agents/debateEngine';
import type { PositionResearchContext } from '../src/agents/debateEngine';
import type { TradeSignal } from '../src/agents/types';
import { authorizePersistedDecision } from '../src/trading/decisionAuthority';

const reply = (data: any) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], provider: 'ollama', model: 'fixture', usage: { input_tokens: 1, output_tokens: 1 } });
const defaultReply = (params: any) => {
  if (params.model.includes('sonnet')) return reply({ finalDecision: 'BUY', confidence: 80, synthesis: 'Fixture evidence supports the proposed direction.', blockReason: null, positionSizeRecommendation: 1 });
  const user = JSON.stringify(params.messages);
  if (user.includes('Final vote?')) return reply({ finalVote: 'BUY', confidence: 80, changedMind: false, finalReason: 'Supplied fixture evidence' });
  if (String(params.system).includes('"challenge"')) return reply({ challenge: 'Fixture challenge' });
  if (String(params.system).includes('"rebuttal"')) return reply({ rebuttal: 'Fixture response' });
  return reply({ vote: 'BUY', confidence: 80, openingArgument: 'Supplied fixture observations', keyFactors: ['fixture'], riskWarnings: [] });
};

const snapshot = () => ({
  asset: 'AAPL', market: 'stocks', price: 100, priceChange24h: 1, priceChangePct24h: 1,
  volume24h: 1000, volumeChange: 1, high24h: 102, low24h: 98, bidPrice: 99.99, askPrice: 100.01, spread: 0.02,
  timestamp: Date.now(), candles: Array.from({ length: 256 }, (_, i) => ({ open: 100, high: 101, low: 99, close: 100, volume: 1000, timestamp: Date.now() - (256 - i) * 3600000 })),
  dataEvidence: { source: 'Alpaca IEX', timeframe: '1Day', completedBars: 256, priceObservedAt: Date.now(), quoteObservedAt: Date.now(), receivedAt: Date.now() },
  indicators: {
    rsi14: 55, macd: { value: 0.2, signal: 0.1, histogram: 0.1 }, stochasticK: 60, stochasticD: 58,
    bollingerBands: { upper: 105, middle: 100, lower: 95 }, ema9: 101, ema21: 99, ema200: 90,
    sma50: 95, sma200: 90, vwap: 100, atr14: 1, week52High: 110, week52Low: 80, distanceFrom52wHigh: 9,
    fibonacci: { r236: 103, r382: 100, r500: 95, r618: 90, r786: 85 }, isAboveSma50: true,
    isAboveSma200: true, isSma50AboveSma200: true, volumeRatio: 1.1, volumeAvg20: 900, obv: 100,
  },
}) as any;
const portfolio = { totalValue: 100000, cashBalance: 60000, invested: 40000, pnlDay: 0, pnlDayPct: 0, pnlWeekPct: 0, pnlTotal: 0, positions: [], dailyLossToday: 0, tradesExecutedToday: 0, drawdownFromPeak: 0,
  // Council approval requires complete adjusted evidence; raw NAV alone cannot
  // establish the daily loss baseline. The real loss gate stays enabled.
  riskDataComplete: true };

describe('real committee behavior with dummy providers', () => {
  it('permits old observed evidence for manual research but never promotes it into ENTRY', async () => {
    const input = snapshot(); input.dataEvidence.priceObservedAt -= 3 * 86400000; input.dataEvidence.quoteObservedAt -= 3 * 86400000;
    await expect(runInvestmentCommitteeDebate(input, portfolio, 'TRENDING_BULL')).rejects.toThrow('STOCK_ENTRY_SOURCE');
    const result = await runInvestmentCommitteeDebate(input, portfolio, 'TRENDING_BULL', undefined, 'COUNCIL', undefined, undefined, 'RESEARCH');
    expect(result.executionApproved).toBe(false); expect(result.purpose).toBe('RESEARCH');
  });
  it('refuses ENTRY when observation ages out during paid research even though assembly is current', async () => {
    const input = snapshot();
    (routedMessagesCreate as jest.Mock).mockImplementation(async (params: any) => {
      input.dataEvidence.priceObservedAt = Date.now() - 300001;
      return defaultReply(params);
    });
    const result = await runInvestmentCommitteeDebate(input, portfolio, 'TRENDING_BULL');
    expect(result.executionApproved).toBe(false); expect(result.blockReason).toContain('exchange observations expired');
  });
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LLM_AGENT_DELAY_MS = '0';
    process.env.LLM_AGENT_CONCURRENCY = '3';
    process.env.LLM_DAILY_BUDGET_USD = '100';
    (prisma.agentDecision.create as jest.Mock).mockResolvedValue({ id: 'current-decision' });
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValue(null);
    (getForecast as jest.Mock).mockResolvedValue({ symbol: 'AAPL', predictedClose: [101, 102, 103, 104, 105], lowerBand: [100, 101, 102, 103, 104], upperBand: [102, 103, 104, 105, 106], meanReturn: 0.05 });
    (routedMessagesCreate as jest.Mock).mockImplementation(defaultReply);
  });

  it('retains reported generation usage when structured responses are refused', async () => {
    const before = getLlmSpendToday();
    (routedMessagesCreate as jest.Mock).mockRejectedValue(Object.assign(new Error('schema_invalid'), {
      code: 'schema_invalid', reportedUsage: { model: 'claude-haiku-4-5-20251001', provider: 'anthropic', usage: { input_tokens: 100, output_tokens: 20 } },
    }));
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    const observedCalls = (routedMessagesCreate as jest.Mock).mock.calls.length;
    expect(observedCalls).toBe(28);
    expect(getLlmSpendToday().calls - before.calls).toBe(observedCalls);
    expect(getLlmSpendToday().usd - before.usd).toBeCloseTo(observedCalls * 0.0002, 8);
    expect(result.executionApproved).toBe(false);
  });

  it('persists research-only purpose and refuses replay despite unanimous valid BUY research', async () => {
    const input = snapshot();
    const result = await runInvestmentCommitteeDebate(input, portfolio, 'TRENDING_BULL', undefined, 'COUNCIL', undefined, undefined, 'RESEARCH');
    expect(result.finalDecision).toBe('BUY');
    expect(result.agentVotes).toHaveLength(14);
    expect(result.purpose).toBe('RESEARCH');
    expect(result.executionApproved).toBe(false);
    expect(result.positionSizePct).toBe(0);
    const requests = (routedMessagesCreate as jest.Mock).mock.calls;
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(call => call[2]?.structured === true && typeof call[2]?.validateText === 'function')).toBe(true);
    expect(() => requests[0][2].validateText('{"vote":"INVALID"}')).toThrow();
    const saved = (prisma.agentDecision.create as jest.Mock).mock.calls[0][0].data;
    expect(saved.marketSnapshot.purpose).toBe('RESEARCH');
    expect(saved.marketSnapshot.executionPlan).toMatchObject({ purpose: 'RESEARCH', approved: false, positionSizePct: 0 });
    // Even a caller clearing the human-readable block and inflating plan flags
    // cannot turn the stored research-purpose decision into order authority.
    const forged = { ...saved, id: result.decisionId, timestamp: new Date(), executed: false, executionReason: null,
      marketSnapshot: { ...saved.marketSnapshot, executionPlan: { ...saved.marketSnapshot.executionPlan, approved: true, positionSizePct: 1 } } };
    const signal: TradeSignal = { asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: result.finalConfidence,
      entryPrice: input.price, stopLossPrice: result.stopLossPrice, takeProfitPrice: result.takeProfitPrice,
      positionSizePct: 1, reasoning: 'attempted research replay', agentDecisionId: result.decisionId! };
    expect(() => authorizePersistedDecision(forged, signal, 'paper')).toThrow();
  });

  it('uses the forecast and same evidence in opening, final voting and synthesis, then returns its saved decision ID', async () => {
    const input = snapshot();
    const result = await runInvestmentCommitteeDebate(input, portfolio, 'TRENDING_BULL');
    expect(getForecast).toHaveBeenCalledWith('AAPL', input.candles, 5);
    expect(result.decisionId).toBe('current-decision');
    expect(result.agentVotes).toHaveLength(14);
    expect(result.executionApproved).toBe(true);
    const finalCall = (routedMessagesCreate as jest.Mock).mock.calls.find(([p]) => JSON.stringify(p.messages).includes('Final vote?'))![0];
    const masterCall = (routedMessagesCreate as jest.Mock).mock.calls.find(([p]) => p.model.includes('sonnet'))![0];
    expect(JSON.stringify(finalCall.messages)).toContain('105.00');
    expect(JSON.stringify(masterCall.messages)).toContain('105.00');
    expect(JSON.stringify((prisma.agentDecision.create as jest.Mock).mock.calls[0][0].data.marketSnapshot)).toContain('AAPL');
    const observed = teamSessionRegistry.snapshot().sessions.find(s => s.id === result.id)!;
    expect(observed).toMatchObject({ status: 'complete', purpose: 'ENTRY', market: 'stocks', marketSnapshotAt: input.timestamp,
      exchangeObservedAt: null, result: { decisionId: result.decisionId, tradeExecution: 'not-observed' } });
    expect(Object.keys(observed.agents)).toHaveLength(14);
    expect(observed.entries.filter(e => e.kind === 'analyzing').every(e => e.round === 1)).toBe(true);
    expect(observed.entries.filter(e => e.kind === 'final-vote')).toHaveLength(14);
    expect(observed.coordinator?.lastObservation.kind).toBe('coordinator');
    const transport = (getIO as jest.Mock).mock.results.slice(-1)[0].value;
    expect(transport.emit.mock.calls.find(([event]: [string]) => event === 'debate:complete')[1].sessionObservation.sequence).toBe(observed.lastSequence);
  });

  it('cannot approve when the current decision fails to persist', async () => {
    (prisma.agentDecision.create as jest.Mock).mockRejectedValueOnce(new Error('fixture database unavailable'));
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.executionApproved).toBe(false);
    expect(result.decisionId).toBeUndefined();
    expect(result.positionSizePct).toBe(0);
    expect(result.blockReason).toMatch(/persist|storage/i);
  });

  it('treats malformed vote enums and confidence as unavailable research, never valid consensus', async () => {
    (routedMessagesCreate as jest.Mock).mockImplementation((params: any) => params.model.includes('sonnet') ? defaultReply(params) : reply({ vote: 'LEVERAGE', finalVote: 'LEVERAGE', confidence: 'NaN', openingArgument: 'invalid', finalReason: 'invalid' }));
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.executionApproved).toBe(false);
    expect(result.agentVotes.every((v: any) => v.vote === 'HOLD' && Number.isFinite(v.confidence))).toBe(true);
  });

  it('does not use a master response with an invalid direction', async () => {
    (routedMessagesCreate as jest.Mock).mockImplementation((params: any) => params.model.includes('sonnet') ? reply({ finalDecision: 'ALL_IN', confidence: 100, synthesis: 'invalid', blockReason: null }) : defaultReply(params));
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.finalDecision).toBe('HOLD');
    expect(result.executionApproved).toBe(false);
    expect(teamSessionRegistry.snapshot().sessions.find(s => s.id === result.id)!.entries.some(e => e.errorCode === 'coordinator_unavailable')).toBe(true);
  });

  it('forces the quantitative forecaster to abstain when no real forecast exists', async () => {
    (getForecast as jest.Mock).mockResolvedValueOnce(null);
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.agentVotes.find((v: any) => v.agentId === 14)!.vote).toBe('HOLD');
  });

  it('runs all specialists with actual held context but persists no execution authority', async () => {
    const observedBefore = teamSessionRegistry.snapshot().counters.acceptedEvents;
    const holding = { id: 'holding-1', asset: 'AAPL', market: 'stocks', side: 'BUY', quantity: 3,
      entryPrice: 99, stopLossPrice: 97, takeProfitPrice: 105, openedAt: new Date('2025-01-01T00:00:00Z') };
    const context: PositionResearchContext = { positionId: holding.id, asset: holding.asset, side: 'BUY', quantity: 3,
      entryPrice: holding.entryPrice, stopLossPrice: holding.stopLossPrice, takeProfitPrice: holding.takeProfitPrice,
      accountId: 'paper-account', brokerMode: 'paper', openedAt: holding.openedAt.toISOString() };
    const result = await runInvestmentCommitteeDebate(snapshot(), { ...portfolio, accountId: 'paper-account',
      brokerMode: 'paper', positions: [holding] }, 'TRENDING_BULL', undefined, 'COUNCIL', context);
    expect(result.agentVotes).toHaveLength(14);
    expect(result.purpose).toBe('POSITION_REVIEW');
    expect(result.executionApproved).toBe(false); expect(result.positionSizePct).toBe(0);
    expect(result.decisionId).toBe('current-decision');
    expect(JSON.stringify((prisma.agentDecision.create as jest.Mock).mock.calls[0][0])).toContain('POSITION_REVIEW');
    expect((prisma.agentDecision.create as jest.Mock).mock.calls[0][0].data.horizon).toBe('POSITION_REVIEW');
    expect(result.stopLossPrice).toBe(97); expect(result.takeProfitPrice).toBe(105);
    expect(JSON.stringify((prisma.agentDecision.create as jest.Mock).mock.calls[0][0])).toContain('holding-1');
    const finalCall = (routedMessagesCreate as jest.Mock).mock.calls.find(([p]) => JSON.stringify(p.messages).includes('Final vote?'))![0];
    expect(JSON.stringify(finalCall.messages)).toContain('POSITION_REVIEW');
    expect(teamSessionRegistry.snapshot().sessions.some(s => s.id === result.id)).toBe(false);
    expect(teamSessionRegistry.snapshot().counters.acceptedEvents).toBe(observedBefore);
    expect(getIO).not.toHaveBeenCalled();
  });
  it('rejects canceled research before any paid council call', async () => {
    const controller = new AbortController(); controller.abort(new Error('fixture canceled'));
    await expect(runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL', undefined, 'COUNCIL', undefined, { signal: controller.signal })).rejects.toThrow('fixture canceled');
    expect(routedMessagesCreate).not.toHaveBeenCalled();
  });

  it('rejects changed-input checkpoints even when their age is fresh', async () => {
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValue({ status: 'ROUND1_DONE', updatedAt: new Date(), inputFingerprint: 'different-input', round1Results: [{ agentId: 1, vote: 'SELL', confidence: 99 }] });
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.agentVotes).toHaveLength(14);
    expect(result.agentVotes.find((v: any) => v.agentId === 1)!.vote).toBe('BUY');
  });

  it('enforces the default daily-loss gate despite unanimous high-confidence research', async () => {
    delete process.env.DAILY_LOSS_LIMIT_PCT;
    const result = await runInvestmentCommitteeDebate(snapshot(), { ...portfolio, pnlDayPct: -3 }, 'TRENDING_BULL');
    expect(result.executionApproved).toBe(false);
    expect(result.blockReason).toMatch(/daily loss/i);
  });

  it('does not grant an automatic trade when the risk reviewer abstains', async () => {
    (routedMessagesCreate as jest.Mock).mockImplementation((params: any) => {
      if (JSON.stringify(params.system).includes('THE RISK MANAGER') && JSON.stringify(params.messages).includes('Final vote?')) {
        return reply({ finalVote: 'HOLD', confidence: 80, finalReason: 'Unresolved fixture risk', changedMind: true });
      }
      return defaultReply(params);
    });
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.executionApproved).toBe(false);
    expect(result.blockReason).toMatch(/risk reviewer/i);
  });

  it('records concurrent same-asset ENTRY and manual RESEARCH as distinct actual sessions', async () => {
    const input = snapshot();
    const [entry, research] = await Promise.all([
      runInvestmentCommitteeDebate(input, portfolio, 'TRENDING_BULL'),
      runInvestmentCommitteeDebate(input, portfolio, 'TRENDING_BULL', undefined, 'COUNCIL', undefined, undefined, 'RESEARCH'),
    ]);
    expect(entry.id).not.toBe(research.id);
    for (const result of [entry, research]) {
      const session = teamSessionRegistry.snapshot().sessions.find(s => s.id === result.id)!;
      expect(session.purpose).toBe(result.purpose); expect(session.status).toBe('complete');
      expect(session.entries.filter(e => e.kind === 'final-vote')).toHaveLength(14);
    }
  });

  it('records actual challenge and response with source agent IDs', async () => {
    (routedMessagesCreate as jest.Mock).mockImplementation((params: any) => {
      if (JSON.stringify(params.messages).includes('What is your counter-argument?')) {
        return reply({ vote: 'SELL', confidence: 80, openingArgument: 'Fixture dissent', keyFactors: ['fixture'], riskWarnings: [] });
      }
      return defaultReply(params);
    });
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    const observed = teamSessionRegistry.snapshot().sessions.find(s => s.id === result.id)!;
    expect(observed.entries.find(e => e.kind === 'challenge')).toMatchObject({ agentId: 10, content: 'Fixture challenge' });
    expect(observed.entries.find(e => e.kind === 'rebuttal')).toMatchObject({ agentId: 1, content: 'Fixture response' });
  });

  it('marks observed opening/final and storage failures using safe codes', async () => {
    (routedMessagesCreate as jest.Mock).mockRejectedValue(Object.assign(new Error('PRIVATE_PROVIDER_DETAIL'), { code: 'schema_invalid' }));
    (prisma.agentDecision.create as jest.Mock).mockRejectedValueOnce(new Error('PRIVATE_DATABASE_DETAIL'));
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    const observed = teamSessionRegistry.snapshot().sessions.find(s => s.id === result.id)!;
    const codes = observed.entries.map(e => e.errorCode);
    expect(codes).toContain('opening_unavailable'); expect(codes).toContain('final_unavailable');
    expect(codes).toContain('decision_persistence_failed');
    expect(observed.result?.committeeApproved).toBe(false); expect(observed.result?.decisionId).toBeUndefined();
    expect(JSON.stringify(observed)).not.toContain('PRIVATE_');
  });

  it('reports an actually rejected session and preserves the original rejection identity', async () => {
    const failure = new Error('PRIVATE_PREPARATION_DETAIL');
    (getFundamentalsSummary as jest.Mock).mockRejectedValueOnce(failure);
    const before = teamSessionRegistry.snapshot().counters.acceptedEvents;
    await expect(runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL')).rejects.toBe(failure);
    const observed = teamSessionRegistry.snapshot().sessions[0];
    expect(observed.status).toBe('failed'); expect(observed.entries[observed.entries.length - 1]).toMatchObject({ errorCode: 'session_failed', fatal: true });
    expect(teamSessionRegistry.snapshot().counters.acceptedEvents).toBe(before + 2);
    expect(JSON.stringify(observed)).not.toContain('PRIVATE_PREPARATION_DETAIL');
  });

  it('does not replay saved checkpoint specialist receipts as newly observed work', async () => {
    const input = snapshot();
    await runInvestmentCommitteeDebate(input, portfolio, 'TRENDING_BULL');
    const saved = (prisma.debateCheckpoint.upsert as jest.Mock).mock.calls.slice(-1)[0][0].create;
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValueOnce({ ...saved, updatedAt: new Date() });
    const resumed = await runInvestmentCommitteeDebate(input, portfolio, 'TRENDING_BULL');
    const observed = teamSessionRegistry.snapshot().sessions.find(s => s.id === resumed.id)!;
    expect(observed.resumedFromCheckpoint).toBe(true); expect(observed.checkpointStage).toBe('ROUND2_DONE');
    expect(observed.entries.some(e => e.kind === 'analyzing' || e.kind === 'opening-vote' || e.kind === 'challenge')).toBe(false);
    expect(observed.entries.filter(e => e.kind === 'final-vote')).toHaveLength(14);
  });
});
