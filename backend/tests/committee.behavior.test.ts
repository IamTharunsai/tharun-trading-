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

import { prisma } from '../src/utils/prisma';
import { getForecast } from '../src/services/kronosService';
import { routedMessagesCreate } from '../src/utils/llmRouter';

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
  indicators: {
    rsi14: 55, macd: { value: 0.2, signal: 0.1, histogram: 0.1 }, stochasticK: 60, stochasticD: 58,
    bollingerBands: { upper: 105, middle: 100, lower: 95 }, ema9: 101, ema21: 99, ema200: 90,
    sma50: 95, sma200: 90, vwap: 100, atr14: 1, week52High: 110, week52Low: 80, distanceFrom52wHigh: 9,
    fibonacci: { r236: 103, r382: 100, r500: 95, r618: 90, r786: 85 }, isAboveSma50: true,
    isAboveSma200: true, isSma50AboveSma200: true, volumeRatio: 1.1, volumeAvg20: 900, obv: 100,
  },
}) as any;
const portfolio = { totalValue: 100000, cashBalance: 60000, invested: 40000, pnlDay: 0, pnlDayPct: 0, pnlWeekPct: 0, pnlTotal: 0, positions: [], dailyLossToday: 0, tradesExecutedToday: 0, drawdownFromPeak: 0 };

describe('real committee behavior with dummy providers', () => {
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

  it('uses the forecast and same evidence in opening, final voting and synthesis, then returns its saved decision ID', async () => {
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
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
    expect(JSON.stringify(prisma.agentDecision.create.mock.calls[0][0].data.marketSnapshot)).toContain('AAPL');
  });

  it('cannot approve when the current decision fails to persist', async () => {
    (prisma.agentDecision.create as jest.Mock).mockRejectedValueOnce(new Error('fixture database unavailable'));
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.executionApproved).toBe(false);
    expect(result.decisionId).toBeUndefined();
    expect(result.positionSizePct).toBe(0);
    expect(result.blockReason).toMatch(/persist|storage/i);
  });

  it('treats malformed vote enums and confidence as unavailable research, never valid consensus', async () => {
    (routedMessagesCreate as jest.Mock).mockImplementation((params: any) => params.model.includes('sonnet') ? defaultReply(params) : reply({ vote: 'LEVERAGE', finalVote: 'LEVERAGE', confidence: 'NaN', openingArgument: 'invalid', finalReason: 'invalid' }));
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.executionApproved).toBe(false);
    expect(result.agentVotes.every((v: any) => v.vote === 'HOLD' && Number.isFinite(v.confidence))).toBe(true);
  });

  it('does not use a master response with an invalid direction', async () => {
    (routedMessagesCreate as jest.Mock).mockImplementation((params: any) => params.model.includes('sonnet') ? reply({ finalDecision: 'ALL_IN', confidence: 100, synthesis: 'invalid', blockReason: null }) : defaultReply(params));
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.finalDecision).toBe('HOLD');
    expect(result.executionApproved).toBe(false);
  });

  it('forces the quantitative forecaster to abstain when no real forecast exists', async () => {
    (getForecast as jest.Mock).mockResolvedValueOnce(null);
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.agentVotes.find((v: any) => v.agentId === 14).vote).toBe('HOLD');
  });

  it('runs all specialists with actual held context but persists no execution authority', async () => {
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    const holding = { id: 'holding-1', asset: 'AAPL', market: 'stocks', side: 'BUY', quantity: 3,
      entryPrice: 99, stopLossPrice: 97, takeProfitPrice: 105, openedAt: new Date('2025-01-01T00:00:00Z') };
    const context = { positionId: holding.id, asset: holding.asset, side: 'BUY', quantity: 3,
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
  });
  it('rejects canceled research before any paid council call', async () => {
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    const controller = new AbortController(); controller.abort(new Error('fixture canceled'));
    await expect(runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL', undefined, 'COUNCIL', undefined, { signal: controller.signal })).rejects.toThrow('fixture canceled');
    expect(routedMessagesCreate).not.toHaveBeenCalled();
  });

  it('rejects changed-input checkpoints even when their age is fresh', async () => {
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValue({ status: 'ROUND1_DONE', updatedAt: new Date(), inputFingerprint: 'different-input', round1Results: [{ agentId: 1, vote: 'SELL', confidence: 99 }] });
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.agentVotes).toHaveLength(14);
    expect(result.agentVotes.find((v: any) => v.agentId === 1).vote).toBe('BUY');
  });

  it('enforces the default daily-loss gate despite unanimous high-confidence research', async () => {
    delete process.env.DAILY_LOSS_LIMIT_PCT;
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
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
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.executionApproved).toBe(false);
    expect(result.blockReason).toMatch(/risk reviewer/i);
  });
});
