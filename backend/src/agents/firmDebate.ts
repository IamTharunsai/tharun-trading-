/**
 * INTEGRATION: TradingAgents → APEX
 * 7-Agent Firm Structure: Fundamentals → Sentiment → News → Technical Analyst
 *   → Bull Researcher → Bear Researcher → Trader → Risk Manager → Portfolio Manager
 *
 * TradingAgents ref: https://github.com/tauricresearch/tradingagents
 * APEX file location: backend/src/agents/firmDebate.ts
 *
 * Key improvements over current debate engine:
 * 1. Explicit Bull vs Bear researcher roles (adversarial quality boost)
 * 2. Portfolio Manager as final arbitrator (not just vote counting)
 * 3. Point-in-time SEC EDGAR data (avoids look-ahead bias)
 * 4. Structured reasoning chains between analyst layers
 */

import type { AgentVote } from './types';

export interface FirmDebateInput {
  asset: string;
  price: number;
  marketData: MarketSnapshot;
  fundamentals: FundamentalsData;
  news: NewsItem[];
  secFilings: SECFiling[];
}

export interface FirmDebateOutput {
  recommendation: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidence: number;
  positionSizePct: number;
  pmRationale: string;
  bullCase: string;
  bearCase: string;
  agentVotes: AgentVote[];
  riskFlags: string[];
}

/**
 * Layer 1: Research Analysts — gather information in parallel
 */
async function runResearchLayer(input: FirmDebateInput): Promise<{
  fundamentalReport: string;
  sentimentScore: number;
  newsSummary: string;
  technicalSignals: TechnicalSignals;
}> {
  // Run all 4 research agents in parallel
  const [fundamentalReport, sentimentResult, newsSummary, technicalSignals] = await Promise.all([
    analyzeFundamentals(input),
    analyzeSentiment(input),
    analyzeNews(input),
    analyzeTechnicals(input),
  ]);

  return {
    fundamentalReport,
    sentimentScore: sentimentResult,
    newsSummary,
    technicalSignals,
  };
}

/**
 * Layer 2: Bull/Bear Researchers — adversarial analysis
 * This is the key improvement from TradingAgents: explicit adversarial roles
 */
async function runAdversarialLayer(
  input: FirmDebateInput,
  researchContext: Awaited<ReturnType<typeof runResearchLayer>>,
): Promise<{ bullCase: string; bearCase: string; bullConfidence: number; bearConfidence: number }> {
  const [bull, bear] = await Promise.all([
    // Bull Researcher: find every reason to buy
    callLLM({
      role: 'BULL_RESEARCHER',
      prompt: buildBullPrompt(input, researchContext),
      temperature: 0.7,
    }),
    // Bear Researcher: find every reason to avoid / sell
    callLLM({
      role: 'BEAR_RESEARCHER',
      prompt: buildBearPrompt(input, researchContext),
      temperature: 0.7,
    }),
  ]);

  return {
    bullCase: bull.content,
    bearCase: bear.content,
    bullConfidence: bull.confidence,
    bearConfidence: bear.confidence,
  };
}

/**
 * Layer 3: Trader — synthesizes all research into a recommendation
 */
async function runTraderLayer(
  input: FirmDebateInput,
  research: Awaited<ReturnType<typeof runResearchLayer>>,
  adversarial: Awaited<ReturnType<typeof runAdversarialLayer>>,
): Promise<{ signal: 'BUY' | 'SELL' | 'HOLD'; confidence: number; rationale: string }> {
  const response = await callLLM({
    role: 'TRADER',
    prompt: buildTraderPrompt(input, research, adversarial),
    temperature: 0.3, // lower temp for decisive trading decisions
  });

  return {
    signal: parseSignal(response.content),
    confidence: response.confidence,
    rationale: response.content,
  };
}

/**
 * Layer 4: Risk Manager — veto or approve with adjusted sizing
 */
async function runRiskLayer(
  input: FirmDebateInput,
  traderDecision: Awaited<ReturnType<typeof runTraderLayer>>,
  portfolioState: PortfolioState,
): Promise<{ approved: boolean; adjustedSizePct: number; riskFlags: string[] }> {
  const riskFlags: string[] = [];

  // Hard risk checks (rule-based, not LLM)
  if (portfolioState.weeklyDrawdownPct >= 5) {
    riskFlags.push(`WEEKLY_DRAWDOWN_GATE: -${portfolioState.weeklyDrawdownPct.toFixed(1)}%`);
    return { approved: false, adjustedSizePct: 0, riskFlags };
  }

  if (portfolioState.openPositionCount >= portfolioState.maxPositions) {
    riskFlags.push(`MAX_POSITIONS: ${portfolioState.openPositionCount} slots full`);
    return { approved: false, adjustedSizePct: 0, riskFlags };
  }

  if (traderDecision.signal === 'HOLD') {
    return { approved: true, adjustedSizePct: 0, riskFlags };
  }

  // Dynamic position sizing based on confidence (Kelly-inspired)
  const baseSize = 5; // 5% of portfolio
  const confidenceMultiplier = traderDecision.confidence / 100;
  const adjustedSize = Math.min(baseSize * confidenceMultiplier * 2, 10); // max 10%

  return { approved: true, adjustedSizePct: adjustedSize, riskFlags };
}

/**
 * Layer 5: Portfolio Manager — final arbiter
 * Reviews everything and makes the final call. Can override Trader if portfolio context demands.
 */
async function runPortfolioManagerLayer(
  input: FirmDebateInput,
  allContext: {
    research: Awaited<ReturnType<typeof runResearchLayer>>;
    adversarial: Awaited<ReturnType<typeof runAdversarialLayer>>;
    traderDecision: Awaited<ReturnType<typeof runTraderLayer>>;
    riskDecision: Awaited<ReturnType<typeof runRiskLayer>>;
    portfolioState: PortfolioState;
  },
): Promise<{ finalSignal: FirmDebateOutput['recommendation']; pmRationale: string; confidence: number }> {
  const response = await callLLM({
    role: 'PORTFOLIO_MANAGER',
    prompt: buildPMPrompt(input, allContext),
    temperature: 0.2,
  });

  return {
    finalSignal: parsePMSignal(response.content),
    pmRationale: response.content,
    confidence: response.confidence,
  };
}

/**
 * Main firm debate orchestrator
 */
export async function runFirmDebate(
  input: FirmDebateInput,
  portfolioState: PortfolioState,
): Promise<FirmDebateOutput> {
  console.log(`[FIRM DEBATE] Starting 7-agent debate for ${input.asset}`);

  try {
    // Layer 1: Research (parallel)
    const research = await runResearchLayer(input);

    // Layer 2: Adversarial (parallel)
    const adversarial = await runAdversarialLayer(input, research);

    // Layer 3: Trader synthesis
    const traderDecision = await runTraderLayer(input, research, adversarial);

    // Layer 4: Risk check
    const riskDecision = await runRiskLayer(input, traderDecision, portfolioState);

    // Layer 5: PM final call
    const allContext = { research, adversarial, traderDecision, riskDecision, portfolioState };
    const pmDecision = await runPortfolioManagerLayer(input, allContext);

    // Build agent vote array for compatibility with existing debate system
    const agentVotes: AgentVote[] = [
      { agentId: 'firm-fundamentals', agentName: 'Fundamentals Analyst', signal: traderDecision.signal, confidence: 70, reasoning: research.fundamentalReport.slice(0, 200), tier: 2 },
      { agentId: 'firm-sentiment', agentName: 'Sentiment Analyst', signal: traderDecision.signal, confidence: research.sentimentScore, reasoning: `Sentiment score: ${research.sentimentScore}`, tier: 2 },
      { agentId: 'firm-news', agentName: 'News Analyst', signal: traderDecision.signal, confidence: 65, reasoning: research.newsSummary.slice(0, 200), tier: 2 },
      { agentId: 'firm-technical', agentName: 'Technical Analyst', signal: traderDecision.signal, confidence: research.technicalSignals.overallScore, reasoning: `RSI=${research.technicalSignals.rsi}, MACD=${research.technicalSignals.macdSignal}`, tier: 1 },
      { agentId: 'firm-bull', agentName: 'Bull Researcher', signal: 'BUY', confidence: adversarial.bullConfidence, reasoning: adversarial.bullCase.slice(0, 200), tier: 2 },
      { agentId: 'firm-bear', agentName: 'Bear Researcher', signal: 'SELL', confidence: adversarial.bearConfidence, reasoning: adversarial.bearCase.slice(0, 200), tier: 2 },
      { agentId: 'firm-trader', agentName: 'Trader', signal: traderDecision.signal, confidence: traderDecision.confidence, reasoning: traderDecision.rationale.slice(0, 200), tier: 3 },
    ];

    return {
      recommendation: riskDecision.approved ? pmDecision.finalSignal : 'HOLD',
      confidence: pmDecision.confidence,
      positionSizePct: riskDecision.adjustedSizePct,
      pmRationale: pmDecision.pmRationale,
      bullCase: adversarial.bullCase,
      bearCase: adversarial.bearCase,
      agentVotes,
      riskFlags: riskDecision.riskFlags,
    };

  } catch (err) {
    console.error(`[FIRM DEBATE] Error for ${input.asset}:`, err);
    // Return HOLD on error rather than failing
    return {
      recommendation: 'HOLD',
      confidence: 0,
      positionSizePct: 0,
      pmRationale: `Firm debate failed: ${(err as Error).message}`,
      bullCase: '',
      bearCase: '',
      agentVotes: [],
      riskFlags: ['DEBATE_ERROR'],
    };
  }
}

// ---- Prompt builders ----
function buildBullPrompt(input: FirmDebateInput, research: any): string {
  return `You are a BULL RESEARCHER. Your job is to find the STRONGEST possible case for buying ${input.asset}.

Current price: $${input.price}
Fundamentals: ${research.fundamentalReport}
News: ${research.newsSummary}
Technicals: RSI=${research.technicalSignals.rsi}, Trend=${research.technicalSignals.trend}

Build the MOST COMPELLING bull case. Focus on:
- Earnings growth & revenue acceleration
- Competitive advantages & market position
- Technical setup & momentum
- Catalysts (earnings, product launches, M&A)
- Risk/reward asymmetry

End with confidence score (0-100).`;
}

function buildBearPrompt(input: FirmDebateInput, research: any): string {
  return `You are a BEAR RESEARCHER. Your job is to find EVERY risk and reason to avoid ${input.asset}.

Current price: $${input.price}
Fundamentals: ${research.fundamentalReport}
News: ${research.newsSummary}
Technicals: RSI=${research.technicalSignals.rsi}, Trend=${research.technicalSignals.trend}

Build the STRONGEST bear case. Focus on:
- Valuation concerns & multiple compression risk
- Competitive threats & market share loss
- Macro headwinds (rates, recession risk)
- Technical breakdown signals
- Regulatory / legal risks

End with confidence score (0-100).`;
}

function buildTraderPrompt(input: FirmDebateInput, research: any, adversarial: any): string {
  return `You are a PROFESSIONAL TRADER. Based on this research, make a clear trading decision.

Asset: ${input.asset} @ $${input.price}

BULL CASE: ${adversarial.bullCase}
BEAR CASE: ${adversarial.bearCase}
TECHNICAL: ${JSON.stringify(research.technicalSignals)}
SENTIMENT: ${research.sentimentScore}/100

Your job: Weigh both cases and output BUY/SELL/HOLD with confidence (0-100) and rationale.
Be decisive. The PM will review your call.`;
}

function buildPMPrompt(input: FirmDebateInput, context: any): string {
  return `You are the PORTFOLIO MANAGER. Final decision authority.

Asset: ${input.asset}
Trader says: ${context.traderDecision.signal} (${context.traderDecision.confidence}% confidence)
Risk says: ${context.riskDecision.approved ? 'APPROVED' : 'VETOED'} | Size: ${context.riskDecision.adjustedSizePct}%
Risk flags: ${context.riskDecision.riskFlags.join(', ') || 'none'}

Portfolio: ${context.portfolioState.openPositionCount} positions open, ${context.portfolioState.weeklyDrawdownPct.toFixed(2)}% weekly DD

Review all of the above. Your output: STRONG_BUY / BUY / HOLD / SELL / STRONG_SELL.
Consider portfolio context and risk capacity.`;
}

// ---- Stubs ----
async function analyzeFundamentals(input: FirmDebateInput): Promise<string> { return `P/E: healthy, Revenue growing YoY`; }
async function analyzeSentiment(input: FirmDebateInput): Promise<number> { return 65; }
async function analyzeNews(input: FirmDebateInput): Promise<string> { return `No major news`; }
async function analyzeTechnicals(input: FirmDebateInput): Promise<TechnicalSignals> { return { rsi: 55, macdSignal: 'bullish', trend: 'up', overallScore: 65 }; }
async function callLLM(params: any): Promise<{ content: string; confidence: number }> { return { content: 'LLM response', confidence: 60 }; }
function parseSignal(text: string): 'BUY' | 'SELL' | 'HOLD' { return text.includes('BUY') ? 'BUY' : text.includes('SELL') ? 'SELL' : 'HOLD'; }
function parsePMSignal(text: string): FirmDebateOutput['recommendation'] {
  if (text.includes('STRONG_BUY')) return 'STRONG_BUY';
  if (text.includes('STRONG_SELL')) return 'STRONG_SELL';
  if (text.includes('BUY')) return 'BUY';
  if (text.includes('SELL')) return 'SELL';
  return 'HOLD';
}

interface TechnicalSignals { rsi: number; macdSignal: string; trend: string; overallScore: number; }
interface MarketSnapshot { price: number; volume: number; change1d: number; }
interface FundamentalsData { pe: number; revenue: number; eps: number; }
interface NewsItem { headline: string; sentiment: number; date: Date; }
interface SECFiling { type: string; date: Date; summary: string; }
interface PortfolioState { weeklyDrawdownPct: number; openPositionCount: number; maxPositions: number; cashBalance: number; }
