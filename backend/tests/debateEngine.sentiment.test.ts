const getSentiment = jest.fn();
let enabled = true;
jest.mock('../src/services/sentimentService', () => ({ ...jest.requireActual('../src/services/sentimentService'), isSentimentEnabled: () => enabled, getSentiment: (...args: any[]) => getSentiment(...args) }));
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
    jest.clearAllMocks(); enabled = true; getSentiment.mockResolvedValue(null);
    process.env.LLM_AGENT_DELAY_MS = '0';
    process.env.LLM_AGENT_CONCURRENCY = '3';
    process.env.LLM_DAILY_BUDGET_USD = '100';
    (prisma.agentDecision.create as jest.Mock).mockResolvedValue({ id: 'current-decision' });
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValue(null);
    (getForecast as jest.Mock).mockResolvedValue({ symbol: 'AAPL', predictedClose: [101, 102, 103, 104, 105], lowerBand: [100, 101, 102, 103, 104], upperBand: [102, 103, 104, 105, 106], meanReturn: 0.05 });
    (routedMessagesCreate as jest.Mock).mockImplementation(defaultReply);
  });

  it('logs an approved full-council decision when sentiment is disabled', async () => {
    enabled = false;
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.executionApproved).toBe(true);
    expect(result.decisionId).toBe('current-decision');
    expect(result.agentVotes).toHaveLength(14);
    expect(getSentiment).not.toHaveBeenCalled();
  });
  const sent = (score: number) => ({ score, mentionCount: 12, volumeZScore: 0.5, freshnessMinutes: 20, headlines: ['Fixture sourced headline'] });
  it('negative sourced sentiment vetoes BUY without adding votes and is persisted', async () => {
    getSentiment.mockResolvedValue(sent(-0.6));
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    const result = await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL');
    expect(result.executionApproved).toBe(false);
    expect(result.positionSizePct).toBe(0);
    expect(result.agentVotes).toHaveLength(14);
    expect((prisma.agentDecision.create as jest.Mock).mock.calls[0][0].data.marketSnapshot.sentiment.veto).toBe(true);
  });
  it('positive sentiment cannot enlarge the risk-bounded allocation and weaker sentiment reduces it', async () => {
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    enabled = false;
    const base = (await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL')).positionSizePct;
    enabled = true; getSentiment.mockResolvedValue(sent(0.8));
    expect((await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL')).positionSizePct).toBe(base);
    getSentiment.mockResolvedValue(sent(-0.2));
    expect((await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL')).positionSizePct).toBeLessThan(base);
  });
  it('sentiment alone cannot turn an all-HOLD council into an entry', async () => {
    getSentiment.mockResolvedValue(sent(0.95));
    (routedMessagesCreate as jest.Mock).mockImplementation((params: any) => {
      const response = defaultReply(params); const parsed = JSON.parse(response.content[0].text);
      if (parsed.vote) parsed.vote = 'HOLD'; if (parsed.finalVote) parsed.finalVote = 'HOLD'; if (parsed.finalDecision) parsed.finalDecision = 'HOLD';
      return reply(parsed);
    });
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    expect((await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL')).executionApproved).toBe(false);
  });
  it('sentiment outage cannot replace or fabricate the council evidence', async () => {
    getSentiment.mockRejectedValue(new Error('fixture outage'));
    const { runInvestmentCommitteeDebate } = require('../src/agents/debateEngine');
    expect((await runInvestmentCommitteeDebate(snapshot(), portfolio, 'TRENDING_BULL')).executionApproved).toBe(true);
  });
});