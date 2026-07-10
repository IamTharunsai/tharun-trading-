import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { updateStockMemory } from './stockMemoryService';
import { extractResponseText } from '../utils/anthropicText';

// Weight applied to a suspended agent's vote — reduced, not silenced, so a
// single bad stretch can't create a no-quorum deadlock, but a persistently
// wrong voice stops dominating the confidence average and Kelly sizing.
const SUSPENDED_AGENT_WEIGHT = 0.25;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface AgentLesson {
  agentId: number;
  agentName: string;
  tradeId: string;
  asset: string;
  originalVote: string;
  originalConfidence: number;
  originalReasoning: string;
  tradeOutcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  pnlPct: number;
  exitReason: string;
  lesson: string;
  whatWorked: string;
  whatFailed: string;
  setupType: string;
  marketConditionAtEntry: string;
  confidenceAdjustment: number;
  shouldAvoidSetupIn: string[];
  shouldFavorSetupIn: string[];
}

export interface AgentPerformanceMetrics {
  agentId: number;
  agentName: string;
  totalPredictions: number;
  correctPredictions: number;
  accuracyPct: number;
  avgConfidenceWhenRight: number;
  avgConfidenceWhenWrong: number;
  calibrationScore: number;
  bestSetup: string;
  worstSetup: string;
  bestMarketCondition: string;
  worstMarketCondition: string;
  currentWeightMultiplier: number;
  suspended: boolean;
  suspensionReason?: string;
  last20Accuracy: number;
  streak: number;
  updatedAt: Date;
}

export async function runPostTradeAnalysis(tradeId: string): Promise<void> {
  logger.info(`\n🎓 POST-TRADE LEARNING — Trade: ${tradeId}`);

  try {
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: { agentDecision: true }
    });

    if (!trade || trade.status !== 'CLOSED') {
      logger.warn(`Trade ${tradeId} not found or not closed`);
      return;
    }

    const outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' =
      (trade.pnl || 0) > 0.5 ? 'WIN' :
      (trade.pnl || 0) < -0.5 ? 'LOSS' : 'BREAKEVEN';

    const pnlPct = trade.pnlPct || 0;
    const agentVotes = (trade.agentDecision?.agentVotes as any[]) || [];
    const marketSnapshot = trade.agentDecision?.marketSnapshot as any;

    logger.info(`📊 Trade: ${trade.asset} ${trade.type} — ${outcome} (${pnlPct.toFixed(2)}%)`);
    logger.info(`📝 Running lessons for ${agentVotes.length} agents...`);

    const lessonPromises = agentVotes.map(async (agentVote: any) => {
      return generateAgentLesson(agentVote, trade, outcome, pnlPct, marketSnapshot);
    });

    const lessons = await Promise.all(lessonPromises);
    const validLessons = lessons.filter(Boolean) as AgentLesson[];

    for (const lesson of validLessons) {
      await saveAgentLesson(lesson);
    }

    await updateAgentMetrics(validLessons);
    await checkAndSuspendUnderperformers();

    // Update stock-level memory
    const holdHours = trade.closedAt && trade.openedAt
      ? (new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()) / 3600000
      : 0;
    const topLesson = validLessons[0];
    await updateStockMemory(
      trade.asset,
      outcome,
      pnlPct,
      holdHours,
      topLesson?.setupType || 'unknown',
      topLesson?.lesson || `${outcome} trade`,
      trade.type
    );

    logger.info(`✅ Post-trade learning complete: ${validLessons.length} lessons`);

  } catch (error) {
    logger.error('Post-trade analysis failed', { error, tradeId });
  }
}

async function generateAgentLesson(
  agentVote: any,
  trade: any,
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN',
  pnlPct: number,
  marketSnapshot: any
): Promise<AgentLesson | null> {

  const agentId = agentVote.agentId;
  const agentName = agentVote.agentName;

  const agentWasRight =
    (outcome === 'WIN' && agentVote.vote === trade.type) ||
    (outcome === 'LOSS' && agentVote.vote !== trade.type && agentVote.vote !== 'HOLD') ||
    (outcome === 'LOSS' && agentVote.vote === 'HOLD');

  try {
    const prompt = `You are ${agentName}, reviewing your prediction for learning.

PREDICTION:
Asset: ${trade.asset}
Vote: ${agentVote.vote} (${agentVote.confidence}%)
Reasoning: "${agentVote.reasoning}"

RESULT:
Direction: ${trade.type}
Outcome: ${outcome} (${pnlPct.toFixed(2)}%)
Were you right? ${agentWasRight ? 'YES' : 'NO'}

Respond in JSON:
{
  "lesson": "<key lesson>",
  "whatWorked": "<what was right>",
  "whatFailed": "<what was wrong>",
  "setupType": "<setup type>",
  "marketConditionAtEntry": "<market condition>",
  "confidenceAdjustment": <-20 to 20>,
  "shouldAvoidSetupIn": ["<condition>"],
  "shouldFavorSetupIn": ["<condition>"]
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });

    const parsed = JSON.parse(extractResponseText(response.content).replace(/```json\n?|\n?```/g, '').trim());

    const lesson: AgentLesson = {
      agentId,
      agentName,
      tradeId: trade.id,
      asset: trade.asset,
      originalVote: agentVote.vote,
      originalConfidence: agentVote.confidence,
      originalReasoning: agentVote.reasoning,
      tradeOutcome: outcome,
      pnlPct,
      exitReason: trade.exitReason || '',
      lesson: parsed.lesson,
      whatWorked: parsed.whatWorked,
      whatFailed: parsed.whatFailed,
      setupType: parsed.setupType || 'unknown',
      marketConditionAtEntry: parsed.marketConditionAtEntry || '',
      confidenceAdjustment: Math.min(20, Math.max(-20, parsed.confidenceAdjustment || 0)),
      shouldAvoidSetupIn: parsed.shouldAvoidSetupIn || [],
      shouldFavorSetupIn: parsed.shouldFavorSetupIn || [],
    };

    logger.info(`  📖 ${agentName}: ${agentWasRight ? '✅' : '❌'}`);
    return lesson;

  } catch (err) {
    logger.error(`Lesson generation failed for ${agentName}`, { err });
    return null;
  }
}

async function saveAgentLesson(lesson: AgentLesson): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: {
        level: 'INFO',
        service: `agent-learning-${lesson.agentId}`,
        message: `Lesson: ${lesson.lesson}`,
        metadata: lesson as any
      }
    });
  } catch (err) {
    logger.error('Failed to save lesson', { err });
  }
}

async function updateAgentMetrics(lessons: AgentLesson[]): Promise<void> {
  const byAgent = new Map<number, AgentLesson[]>();
  for (const lesson of lessons) {
    if (!byAgent.has(lesson.agentId)) byAgent.set(lesson.agentId, []);
    byAgent.get(lesson.agentId)!.push(lesson);
  }

  for (const [agentId, agentLessons] of byAgent.entries()) {
    try {
      const historicalLogs = await prisma.systemLog.findMany({
        where: { service: `agent-learning-${agentId}` },
        orderBy: { timestamp: 'desc' },
        take: 100
      });

      const allLessons = historicalLogs.map(l => l.metadata as any).filter(Boolean);
      const last20 = allLessons.slice(0, 20);
      const wasRight = (l: any) =>
        (l.tradeOutcome === 'WIN' && l.originalVote !== 'HOLD') ||
        (l.tradeOutcome === 'LOSS' && l.originalVote === 'HOLD');
      const correctLast20 = last20.filter(wasRight).length;
      const last20Accuracy = last20.length > 0 ? (correctLast20 / last20.length) * 100 : 50;

      // Brier score: mean squared error between stated confidence (as a
      // probability) and the binary outcome — the standard calibration metric
      // (same one used in weather forecasting). 0 = perfectly calibrated,
      // 0.25 = no better than always guessing 50/50, 1 = maximally overconfident
      // and wrong. Converted to a 0-100 score where higher is better calibrated.
      const brierScore = last20.length > 0
        ? last20.reduce((sum: number, l: any) => {
            const statedProb = (l.originalConfidence || 50) / 100;
            return sum + Math.pow(statedProb - (wasRight(l) ? 1 : 0), 2);
          }, 0) / last20.length
        : 0.25;
      const calibrationScore = Math.round((1 - brierScore) * 100);

      logger.info(`  📊 ${agentLessons[0].agentName}: ${last20Accuracy.toFixed(1)}% accuracy | ${calibrationScore}/100 calibration (last 20)`);

      await prisma.marketEvent.create({
        data: {
          asset: 'SYSTEM',
          eventType: `AGENT_ACCURACY_${agentId}`,
          data: {
            agentId,
            agentName: agentLessons[0].agentName,
            last20Accuracy,
            calibrationScore,
            totalLessons: allLessons.length,
            suspended: last20Accuracy < 45 && last20.length >= 10
          } as any
        }
      });

    } catch (err) {
      logger.error(`Metrics update failed for agent ${agentId}`, { err });
    }
  }
}

async function checkAndSuspendUnderperformers(): Promise<void> {
  try {
    const recentMetrics = await prisma.marketEvent.findMany({
      where: { eventType: { startsWith: 'AGENT_ACCURACY_' } },
      orderBy: { timestamp: 'desc' },
      take: 20
    });

    for (const metric of recentMetrics) {
      const data = metric.data as any;
      if (data.last20Accuracy < 45 && data.totalLessons >= 10 && !data.suspended) {
        logger.warn(`⚠️ SUSPENDED: ${data.agentName} — ${data.last20Accuracy.toFixed(1)}%`);
      }
    }
  } catch (err) {
    logger.error('Suspension check failed', { err });
  }
}

// Both suspension weights and calibration scores read the latest-per-agent
// record off the same AGENT_ACCURACY_* events — fetched together in every
// debate's round-3 vote tally (always called as a pair, see debateEngine.ts),
// so one shared query replaces what were two identical round-trips.
async function getLatestAgentMetrics(): Promise<Map<number, any>> {
  const latest = new Map<number, any>();
  try {
    const recentMetrics = await prisma.marketEvent.findMany({
      where: { eventType: { startsWith: 'AGENT_ACCURACY_' } },
      orderBy: { timestamp: 'desc' },
      take: 40,
    });
    for (const metric of recentMetrics) {
      const data = metric.data as any;
      const agentId = data?.agentId;
      if (!agentId || latest.has(agentId)) continue;
      latest.set(agentId, data);
    }
  } catch (err) {
    logger.warn('Failed to load agent metrics', { err });
  }
  return latest;
}

// Per-agent vote weight derived from suspension status — 1.0 for a healthy
// agent, SUSPENDED_AGENT_WEIGHT for one whose last-20 accuracy dropped below
// 45%. Read by the debate engine to weight the confidence average and Kelly
// sizing, closing the loop that checkAndSuspendUnderperformers previously
// only logged.
export async function getAgentSuspensionWeights(): Promise<Record<number, number>> {
  const weights: Record<number, number> = {};
  for (const [agentId, data] of await getLatestAgentMetrics()) {
    weights[agentId] = data?.suspended ? SUSPENDED_AGENT_WEIGHT : 1;
  }
  return weights;
}

// Per-agent calibration score (0-100, see calculateAgentMetrics's Brier-score
// comment) — defaults to 75 (the "no evidence of miscalibration" baseline,
// equivalent to Brier=0.25/always-guessing-50%) for agents with no lesson
// history yet, so a brand-new agent isn't penalized for lack of data.
export async function getAgentCalibrationScores(): Promise<Record<number, number>> {
  const scores: Record<number, number> = {};
  for (const [agentId, data] of await getLatestAgentMetrics()) {
    if (data?.calibrationScore === undefined) continue;
    scores[agentId] = data.calibrationScore;
  }
  return scores;
}

export async function generateWeeklyReport(): Promise<string> {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [trades, decisions] = await Promise.all([
      prisma.trade.findMany({ where: { openedAt: { gte: weekAgo } }, orderBy: { openedAt: 'desc' } }),
      prisma.agentDecision.findMany({ where: { timestamp: { gte: weekAgo } }, orderBy: { timestamp: 'desc' } })
    ]);

    const closedTrades = trades.filter(t => t.status === 'CLOSED');
    const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const winners = closedTrades.filter(t => (t.pnl || 0) > 0);
    const winRate = closedTrades.length > 0 ? (winners.length / closedTrades.length * 100).toFixed(1) : '0';

    const reportPrompt = `Generate a weekly report.

WEEK:
Total trades: ${trades.length}
Closed: ${closedTrades.length}
P&L: $${totalPnl.toFixed(2)}
Win rate: ${winRate}%
Decisions: ${decisions.length}

Write 3 paragraphs covering performance, lessons, and next week strategy.`;

    let report = '';
    for (let attempt = 0; attempt < 2 && !report; attempt++) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-5',
          max_tokens: 800,
          messages: [{ role: 'user', content: reportPrompt }]
        });
        report = extractResponseText(response.content);
      } catch (err) {
        if (attempt === 1) throw err;
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    const dateStr = new Date().toISOString().split('T')[0];
    await prisma.dailyJournal.upsert({
      where: { date: `weekly-${dateStr}` },
      create: { date: `weekly-${dateStr}`, summary: report, totalTrades: trades.length, pnlDay: totalPnl, pnlDayPct: 0 },
      update: { summary: report }
    });

    logger.info('📊 Weekly report generated');
    return report;

  } catch (error) {
    logger.error('Weekly report failed', { error });
    return 'Failed';
  }
}
