import Anthropic from '@anthropic-ai/sdk';
import { AGENTS_25, Agent } from './agents25';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { getIO } from '../websocket/server';
import { MarketSnapshot, PortfolioState } from './types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ═══════════════════════════════════════════════════════════════════════════
// THARUN AUTO TRADING PLATFORM
// COMPLETE 12-STAGE ANALYSIS PIPELINE
// This is the most thorough stock analysis process possible
// ═══════════════════════════════════════════════════════════════════════════

export interface StageResult {
  stage: number;
  stageName: string;
  status: 'PASS' | 'FAIL' | 'WARNING' | 'PENDING';
  findings: string;
  chartData?: any; // lines, zones, annotations to draw on chart
  recommendation: 'CONTINUE' | 'ABORT' | 'CAUTION';
  agentsInvolved: number[];
  timeMs: number;
}

export interface FullAnalysis {
  analysisId: string;
  asset: string;
  market: string;
  startTime: number;
  stages: StageResult[];
  finalDecision: 'BUY' | 'SELL' | 'HOLD';
  finalConfidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSizePct: number;
  riskRewardRatio: number;
  masterSynthesis: string;
  chartAnnotations: ChartAnnotation[];
  totalTimeMs: number;
  agentVotes: any[];
  passedStages: number;
  failedStages: number;
}

export interface ChartAnnotation {
  type: 'LINE' | 'ZONE' | 'ARROW' | 'LABEL' | 'FIBONACCI' | 'PATTERN';
  color: string;
  label: string;
  price?: number;
  priceFrom?: number;
  priceTo?: number;
  timeFrom?: number;
  timeTo?: number;
  style?: 'solid' | 'dashed' | 'dotted';
  fibLevels?: number[]; // [0.236, 0.382, 0.5, 0.618, 0.786]
}

// ── THE 12 STAGES ─────────────────────────────────────────────────────────────

const ANALYSIS_STAGES = [
  {
    stage: 1,
    name: '🌍 Macro Environment Check',
    description: 'Is the global macro environment favorable for this trade?',
    agents: [13, 16], // Macro Strategist + Intermarket Analyst
    mandatory: true,  // if this FAILS, abort immediately
  },
  {
    stage: 2,
    name: '📰 News & Catalyst Screen',
    description: 'Any breaking news, earnings, or events that change the analysis?',
    agents: [14, 15], // News Catalyst + Geopolitical
    mandatory: false,
  },
  {
    stage: 3,
    name: '🏦 Institutional & Sector Flow',
    description: 'Where is institutional money flowing? Is this sector in favor?',
    agents: [10, 12], // Sector Rotation + Institutional Tracker
    mandatory: false,
  },
  {
    stage: 4,
    name: '💼 Fundamental Quality Gate',
    description: 'Is this asset fundamentally worthy of buying?',
    agents: [8, 9, 11], // Fundamental + Earnings + Crypto Native
    mandatory: false,
  },
  {
    stage: 5,
    name: '🌊 Multi-Timeframe Trend Alignment',
    description: 'Monthly → Weekly → Daily → Hourly trend all agree?',
    agents: [5], // Multi-Timeframe Analyst
    mandatory: true,
  },
  {
    stage: 6,
    name: '🎯 Key Level Identification',
    description: 'Where are the major support/resistance levels and are we at one?',
    agents: [6], // S/R Expert
    mandatory: true,
    producesChartAnnotations: true,
  },
  {
    stage: 7,
    name: '📊 Pattern Recognition',
    description: 'Is there a tradeable chart pattern present?',
    agents: [1, 7], // Chart Master + Elliott Wave
    mandatory: false,
    producesChartAnnotations: true,
  },
  {
    stage: 8,
    name: '📉 Indicator Confirmation',
    description: 'Do RSI, MACD, Bollinger, EMA all confirm the trade direction?',
    agents: [2, 3], // Indicator King + Candlestick Oracle
    mandatory: true,
    producesChartAnnotations: true,
  },
  {
    stage: 9,
    name: '📈 Volume & Smart Money Verification',
    description: 'Is volume confirming? Is smart money moving in this direction?',
    agents: [4, 22], // Volume Whisperer + Whale Intelligence
    mandatory: true,
  },
  {
    stage: 10,
    name: '🧠 Sentiment & Psychology Check',
    description: 'Is market sentiment positioned for the move? Not too crowded?',
    agents: [21, 23], // Sentiment Oracle + Pattern Recognition AI
    mandatory: false,
  },
  {
    stage: 11,
    name: '🔒 Risk Management Validation',
    description: 'Risk Commander, Execution, Stop Loss, and Portfolio checks',
    agents: [17, 18, 19, 20], // All 4 risk agents
    mandatory: true, // Risk Commander has veto
  },
  {
    stage: 12,
    name: '👑 Investment Committee Final Vote',
    description: 'Master Coordinator synthesis + Devil\'s Advocate challenge',
    agents: [24, 25], // Master Coordinator + Devil's Advocate
    mandatory: true,
  }
];

// ── MAIN PIPELINE FUNCTION ─────────────────────────────────────────────────────

export async function runFullAnalysisPipeline(
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  marketRegime: string
): Promise<FullAnalysis> {

  const io = getIO();
  const analysisId = `analysis_${Date.now()}`;
  const startTime = Date.now();
  const stages: StageResult[] = [];
  const chartAnnotations: ChartAnnotation[] = [];
  const allAgentVotes: any[] = [];

  logger.info(`\n${'═'.repeat(70)}`);
  logger.info(`🔬 FULL ANALYSIS PIPELINE — ${snapshot.asset} @ $${snapshot.price}`);
  logger.info(`📊 Market Regime: ${marketRegime} | Portfolio: $${portfolio.totalValue.toFixed(2)}`);
  logger.info(`${'═'.repeat(70)}\n`);

  io?.emit('analysis:start', { analysisId, asset: snapshot.asset, price: snapshot.price, totalStages: 12 });

  let shouldAbort = false;

  for (const stageDef of ANALYSIS_STAGES) {
    if (shouldAbort) {
      stages.push({
        stage: stageDef.stage,
        stageName: stageDef.name,
        status: 'PENDING',
        findings: 'Skipped — earlier mandatory stage failed',
        recommendation: 'ABORT',
        agentsInvolved: stageDef.agents,
        timeMs: 0
      });
      continue;
    }

    const stageStart = Date.now();
    logger.info(`\n${stageDef.name}`);
    io?.emit('analysis:stage-start', { stage: stageDef.stage, name: stageDef.name, analysisId });

    try {
      const stageResult = await runStage(
        stageDef, snapshot, portfolio, marketRegime, allAgentVotes, stages
      );

      stages.push(stageResult);

      if (stageResult.chartData?.annotations) {
        chartAnnotations.push(...stageResult.chartData.annotations);
      }

      if (stageResult.agentsInvolved) {
        allAgentVotes.push(...(stageResult as any).votes || []);
      }

      if (stageDef.mandatory && stageResult.status === 'FAIL') {
        logger.warn(`  ⛔ MANDATORY STAGE FAILED — aborting pipeline`);
        shouldAbort = true;
      }

      io?.emit('analysis:stage-complete', { stage: stageDef.stage, result: stageResult, analysisId });

    } catch (err) {
      logger.error(`Stage ${stageDef.stage} failed with error`, { err });
      stages.push({
        stage: stageDef.stage,
        stageName: stageDef.name,
        status: 'WARNING',
        findings: 'Stage encountered an error — defaulting to HOLD for safety',
        recommendation: 'CAUTION',
        agentsInvolved: stageDef.agents,
        timeMs: Date.now() - stageStart
      });
    }
  }

  // ── COMPILE FINAL RESULTS ─────────────────────────────────────────────────

  const passedStages = stages.filter(s => s.status === 'PASS').length;
  const failedStages = stages.filter(s => s.status === 'FAIL').length;
  const warningStages = stages.filter(s => s.status === 'WARNING').length;

  // Get the final decision from Stage 12 (Master Coordinator)
  const masterStage = stages.find(s => s.stage === 12);
  const masterData = (masterStage as any)?.masterData || {};

  // Add standard chart annotations for stop/target
  if (masterData.decision !== 'HOLD' && masterData.entryPrice) {
    chartAnnotations.push(
      { type: 'LINE', color: '#22c55e', label: `Entry: $${masterData.entryPrice?.toFixed(2)}`, price: masterData.entryPrice, style: 'solid' },
      { type: 'LINE', color: '#ef4444', label: `Stop Loss: $${masterData.stopLoss?.toFixed(2)}`, price: masterData.stopLoss, style: 'dashed' },
      { type: 'LINE', color: '#3b82f6', label: `Target: $${masterData.takeProfit?.toFixed(2)}`, price: masterData.takeProfit, style: 'dashed' },
      { type: 'ZONE', color: '#22c55e', label: 'Entry Zone', priceFrom: masterData.entryPrice * 0.998, priceTo: masterData.entryPrice * 1.002 }
    );
  }

  const analysis: FullAnalysis = {
    analysisId,
    asset: snapshot.asset,
    market: snapshot.market,
    startTime,
    stages,
    finalDecision: masterData.decision || (shouldAbort ? 'HOLD' : 'HOLD'),
    finalConfidence: masterData.confidence || 0,
    entryPrice: masterData.entryPrice || snapshot.price,
    stopLoss: masterData.stopLoss || snapshot.price * 0.97,
    takeProfit: masterData.takeProfit || snapshot.price * 1.06,
    positionSizePct: masterData.positionSizePct || 0,
    riskRewardRatio: masterData.riskReward || 0,
    masterSynthesis: masterData.synthesis || 'Analysis complete',
    chartAnnotations,
    totalTimeMs: Date.now() - startTime,
    agentVotes: allAgentVotes,
    passedStages,
    failedStages
  };

  logger.info(`\n${'═'.repeat(70)}`);
  logger.info(`✅ ANALYSIS COMPLETE: ${analysis.asset}`);
  logger.info(`   Decision: ${analysis.finalDecision} | Confidence: ${analysis.finalConfidence}%`);
  logger.info(`   Stages: ${passedStages} passed, ${failedStages} failed, ${warningStages} warnings`);
  logger.info(`   Time: ${(analysis.totalTimeMs / 1000).toFixed(1)} seconds`);
  logger.info(`${'═'.repeat(70)}\n`);

  io?.emit('analysis:complete', { analysisId, analysis });

  // Save to database
  try {
    await prisma.agentDecision.create({
      data: {
        asset: snapshot.asset,
        signal: analysis.finalDecision,
        finalVote: analysis.finalDecision,
        totalVotes: allAgentVotes.length,
        goVotes: allAgentVotes.filter((v: any) => v.vote !== 'HOLD').length,
        noGoVotes: allAgentVotes.filter((v: any) => v.vote === 'HOLD').length,
        avgConfidence: analysis.finalConfidence,
        executed: false,
        agentVotes: allAgentVotes as any,
        marketSnapshot: { ...snapshot, analysisStages: stages, chartAnnotations } as any,
      }
    });
  } catch (dbErr) {
    logger.error('Failed to save analysis to DB', { dbErr });
  }

  return analysis;
}

// ── INDIVIDUAL STAGE RUNNER ────────────────────────────────────────────────────

async function runStage(
  stageDef: typeof ANALYSIS_STAGES[0],
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  regime: string,
  previousVotes: any[],
  previousStages: StageResult[]
): Promise<StageResult> {

  const stageStart = Date.now();
  const agents = stageDef.agents.map(id => AGENTS_25.find(a => a.id === id)!).filter(Boolean);

  const context = buildStageContext(snapshot, portfolio, regime, previousStages);
  const votes: any[] = [];

  // Run all agents in this stage in parallel
  const agentPromises = agents.map(async (agent) => {
    try {
      const stageInstruction = buildStageInstruction(stageDef.stage, agent, snapshot);
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 700,
        system: agent.systemPrompt,
        messages: [{
          role: 'user',
          content: `STAGE ${stageDef.stage}: ${stageDef.description}\n\n${context}\n\n${stageInstruction}`
        }]
      });

      const content = response.content[0];
      if (content.type !== 'text') return null;

      const text = content.text.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(text);
    } catch (err) {
      logger.error(`Agent ${agent.id} failed in stage ${stageDef.stage}`, { err });
      return { vote: 'HOLD', confidence: 0, findings: 'Agent error', recommendation: 'CAUTION' };
    }
  });

  const agentResults = (await Promise.all(agentPromises)).filter(Boolean);
  votes.push(...agentResults.map((r: any, i) => ({ agentId: agents[i]?.id, agentName: agents[i]?.name, ...r })));

  // Aggregate stage results
  const passVotes = agentResults.filter((r: any) => r.recommendation === 'CONTINUE').length;
  const failVotes = agentResults.filter((r: any) => r.recommendation === 'ABORT').length;
  const cautionVotes = agentResults.filter((r: any) => r.recommendation === 'CAUTION').length;

  let status: 'PASS' | 'FAIL' | 'WARNING';
  if (failVotes > 0 || (cautionVotes >= agentResults.length * 0.7)) {
    status = 'FAIL';
  } else if (cautionVotes > 0) {
    status = 'WARNING';
  } else {
    status = 'PASS';
  }

  // Check for Risk Commander veto (Stage 11)
  if (stageDef.stage === 11) {
    const riskCmdr = agentResults.find((_: any, i: number) => agents[i]?.id === 17) as any;
    if (riskCmdr?.vote === 'HOLD' || riskCmdr?.recommendation === 'ABORT') {
      status = 'FAIL';
    }
  }

  // Combine all findings
  const combinedFindings = agentResults
    .map((r: any, i) => `${agents[i]?.name}: ${r.findings || r.analysis || ''}`)
    .join(' | ');

  // Extract chart annotations if this stage produces them
  const chartAnnotations: ChartAnnotation[] = [];
  agentResults.forEach((r: any) => {
    if (r.chartLines) chartAnnotations.push(...r.chartLines);
  });

  // Special handling for Stage 12 (Master Coordinator)
  let masterData = {};
  if (stageDef.stage === 12) {
    const masterResult = agentResults.find((_: any, i: number) => agents[i]?.id === 24) as any;
    if (masterResult) {
      masterData = {
        decision: masterResult.finalDecision || 'HOLD',
        confidence: masterResult.confidence || 0,
        entryPrice: masterResult.entryPrice || snapshot.price,
        stopLoss: masterResult.stopLoss || snapshot.price * 0.97,
        takeProfit: masterResult.takeProfit || snapshot.price * 1.06,
        positionSizePct: masterResult.positionSizePct || 1,
        riskReward: masterResult.riskReward || 2,
        synthesis: masterResult.synthesis || ''
      };
    }
  }

  return {
    stage: stageDef.stage,
    stageName: stageDef.name,
    status,
    findings: combinedFindings,
    chartData: chartAnnotations.length > 0 ? { annotations: chartAnnotations } : undefined,
    recommendation: status === 'PASS' ? 'CONTINUE' : status === 'FAIL' ? 'ABORT' : 'CAUTION',
    agentsInvolved: stageDef.agents,
    timeMs: Date.now() - stageStart,
    votes,
    masterData
  } as any;
}

function buildStageContext(snapshot: MarketSnapshot, portfolio: PortfolioState, regime: string, previous: StageResult[]): string {
  const prevSummary = previous.length > 0
    ? `\nPREVIOUS STAGES:\n${previous.map(s => `${s.stageName}: ${s.status} — ${s.findings.slice(0, 100)}`).join('\n')}`
    : '';
  return `ASSET: ${snapshot.asset} @ $${snapshot.price} | Change 24h: ${snapshot.priceChangePct24h.toFixed(2)}%
REGIME: ${regime} | RSI: ${snapshot.indicators.rsi14.toFixed(1)} | MACD: ${snapshot.indicators.macd.histogram > 0 ? 'BULL' : 'BEAR'}
EMA200: $${snapshot.indicators.ema200.toFixed(2)} | Price ${snapshot.price > snapshot.indicators.ema200 ? 'ABOVE' : 'BELOW'} EMA200
Portfolio Value: $${portfolio.totalValue.toFixed(2)} | Daily P&L: ${portfolio.pnlDayPct.toFixed(2)}%${prevSummary}`;
}

function buildStageInstruction(stage: number, agent: Agent, snapshot: MarketSnapshot): string {
  const base = `You are in Stage ${stage} of a 12-stage analysis pipeline for ${snapshot.asset}.

Analyze your specific specialty domain for this asset. If Stage ${stage} is a MANDATORY gate, be extra rigorous.

For chart annotations (if applicable), include chartLines array with exact prices.

Respond ONLY in valid JSON:
{
  "vote": "BUY"|"SELL"|"HOLD",
  "confidence": 0-100,
  "findings": "<2-3 sentence summary of what you found>",
  "recommendation": "CONTINUE"|"CAUTION"|"ABORT",
  "keyInsight": "<the single most important insight from your analysis>",
  "riskFlag": "<any red flag you see, or null>",
  "chartLines": [{"type":"LINE","color":"#hex","label":"<name>","price":<number>,"style":"solid|dashed"}]
}`;
  return base;
}
