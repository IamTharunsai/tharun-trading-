import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { updateStockMemory } from './stockMemoryService';

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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') return null;

    const parsed = JSON.parse(content.text.replace(/```json\n?|\n?```/g, '').trim());

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
      const correctLast20 = last20.filter((l: any) =>
        (l.tradeOutcome === 'WIN' && l.originalVote !== 'HOLD') ||
        (l.tradeOutcome === 'LOSS' && l.originalVote === 'HOLD')
      ).length;
      const last20Accuracy = last20.length > 0 ? (correctLast20 / last20.length) * 100 : 50;

      logger.info(`  📊 ${agentLessons[0].agentName}: ${last20Accuracy.toFixed(1)}% (last 20)`);

      await prisma.marketEvent.create({
        data: {
          asset: 'SYSTEM',
          eventType: `AGENT_ACCURACY_${agentId}`,
          data: {
            agentId,
            agentName: agentLessons[0].agentName,
            last20Accuracy,
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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: reportPrompt }]
    });

    const report = response.content[0].type === 'text' ? response.content[0].text : 'Failed';

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
