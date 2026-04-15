import { Anthropic } from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

const client = new Anthropic();

// Run post-trade analysis to extract lessons and improve agents
export async function analyzeTradeOutcome(tradeId: string): Promise<boolean> {
  try {
    logger.info(`Starting post-trade analysis for trade: ${tradeId}`);

    // Get the trade details
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: { agentDecision: true }
    });

    if (!trade) {
      logger.error(`Trade not found: ${tradeId}`);
      return false;
    }

    if (trade.status !== 'CLOSED') {
      logger.warn(`Trade not closed yet: ${tradeId}, status: ${trade.status}`);
      return false;
    }

    if (!trade.agentDecision) {
      logger.warn(`No agent decision found for trade: ${tradeId}`);
      return false;
    }

    // Extract agent votes from the decision
    const agentVotes = (trade.agentDecision.agentVotes as any) || [];
    const exitPrice = trade.exitPrice || 0;
    const entryPrice = trade.entryPrice;
    const actualOutcome =
      exitPrice > entryPrice ? 'UP' : exitPrice < entryPrice ? 'DOWN' : 'SIDEWAYS';

    logger.info(`Trade ${tradeId}: Entry ${entryPrice}, Exit ${exitPrice}, Outcome: ${actualOutcome}`);

    // For each agent that voted, create a lesson
    for (const agentVote of agentVotes) {
      const { agentId, agentName, signal, confidence } = agentVote;

      // Determine if agent was correct
      const agentPredictedCorrectly =
        (signal === 'BUY' && actualOutcome === 'UP') ||
        (signal === 'SELL' && actualOutcome === 'DOWN') ||
        (signal === 'HOLD' && actualOutcome === 'SIDEWAYS');

      // Generate AI analysis of why the agent was right/wrong
      const lessonReasoning = await generateAgentLesson(
        agentName,
        trade.asset,
        signal,
        actualOutcome,
        trade.agentDecision.marketSnapshot as any,
        agentPredictedCorrectly,
        confidence
      );

      // Calculate new confidence weight
      const newConfidence = calculateNewConfidence(confidence || 0.5, agentPredictedCorrectly);

      // Save lesson to database
      const lesson = await prisma.agentLesson.create({
        data: {
          agentId: agentId || 'unknown',
          agentName: agentName || 'Unknown Agent',
          asset: trade.asset,
          setupType: signal || 'UNKNOWN',
          prediction: signal || 'UNKNOWN',
          outcome: actualOutcome,
          correct: agentPredictedCorrectly,
          reasoning: lessonReasoning,
          confidenceScore: confidence || 0.5,
          newWeighting: newConfidence,
          tradeId: trade.id,
          performanceImpact: calculatePerformanceImpact(
            confidence || 0.5,
            agentPredictedCorrectly,
            trade.pnl || 0
          )
        }
      });

      logger.info(`Lesson created for ${agentName}: ${lesson.id}, correct: ${agentPredictedCorrectly}`);

      // Update agent's confidence on this setup type
      await updateAgentConfidence(agentId || 'unknown', newConfidence);
    }

    return true;
  } catch (err) {
    logger.error(`Error in analyzeTradeOutcome: ${err}`);
    return false;
  }
}

// Generate AI-powered lesson from trade outcome
async function generateAgentLesson(
  agentName: string,
  asset: string,
  prediction: string,
  outcome: string,
  marketSnapshot: any,
  wasCorrect: boolean,
  confidence: number
): Promise<string> {
  try {
    const prompt = `You are analyzing a trade outcome to extract lessons for an AI trading agent.

Agent: ${agentName}
Asset: ${asset}
Agent's Prediction: ${prediction}
Actual Outcome: ${outcome}
Was Agent Correct: ${wasCorrect ? 'YES' : 'NO'}
Agent's Confidence: ${(confidence * 100).toFixed(1)}%

Market Context at Time of Trade:
${JSON.stringify(marketSnapshot, null, 2)}

Please provide a brief 2-3 sentence analysis of:
1. Why the agent's prediction was ${wasCorrect ? 'correct' : 'incorrect'}
2. What market signals it should have focused on ${wasCorrect ? 'more' : 'differently'}
3. How it can improve for next time

Format: Clear, actionable insight for the agent's future decision-making.`;

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const reasoning =
      response.content[0].type === 'text'
        ? response.content[0].text
        : 'No analysis generated';

    return reasoning;
  } catch (err) {
    logger.error(`Error generating agent lesson: ${err}`);
    return 'Lesson analysis failed';
  }
}

// Calculate new confidence weight based on correctness
function calculateNewConfidence(currentConfidence: number, wasCorrect: boolean): number {
  // Bayesian update - increase if correct, decrease if wrong
  const alpha = 0.15; // Learning rate

  if (wasCorrect) {
    // Increase confidence, but cap at 0.95
    return Math.min(currentConfidence + alpha, 0.95);
  } else {
    // Decrease confidence, but floor at 0.15
    return Math.max(currentConfidence - alpha * 2, 0.15);
  }
}

// Calculate how much this trade impacted the agent's overall performance
function calculatePerformanceImpact(confidence: number, wasCorrect: boolean, pnl: number): number {
  // Higher impact if high confidence (edge case scenarios)
  const confidenceImpact = confidence * 100;
  const outcomeMultiplier = wasCorrect ? 1 : -1.5; // Wrong trades are penalized more

  return (confidenceImpact * outcomeMultiplier) / 100;
}

// Update agent's overall confidence and tracking
async function updateAgentConfidence(agentId: string, newConfidenceWeight: number): Promise<void> {
  try {
    // Get or create agent performance record
    let performance = await prisma.agentPerformance.findUnique({
      where: { agentId }
    });

    if (!performance) {
      performance = await prisma.agentPerformance.create({
        data: {
          agentId,
          agentName: agentId,
          avgConfidence: newConfidenceWeight
        }
      });
    } else {
      // Update average confidence (weighted toward new data)
      const updatedAvgConfidence =
        performance.avgConfidence * 0.9 + newConfidenceWeight * 0.1;

      // Check if agent should be suspended for poor performance
      const recentLessons = await prisma.agentLesson.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' },
        take: 20
      });

      const winCount = recentLessons.filter((l: any) => l.correct).length;
      const accuracy = recentLessons.length > 0 ? winCount / recentLessons.length : 0;

      let status = performance.status;
      if (accuracy < 0.5 && recentLessons.length >= 20) {
        status = 'SUSPENDED';
        logger.warn(
          `Agent ${agentId} suspended due to low accuracy: ${(accuracy * 100).toFixed(1)}%`
        );
      } else if (status === 'SUSPENDED' && accuracy > 0.6) {
        status = 'ACTIVE';
        logger.info(`Agent ${agentId} reactivated after improving accuracy to ${(accuracy * 100).toFixed(1)}%`);
      }

      await prisma.agentPerformance.update({
        where: { agentId },
        data: {
          avgConfidence: updatedAvgConfidence,
          lessonsLearned: recentLessons.length,
          accuracy: accuracy * 100,
          status,
          lastUpdated: new Date()
        }
      });
    }
  } catch (err) {
    logger.error(`Error updating agent confidence: ${err}`);
  }
}

// Generate weekly performance report for all agents (run on Sunday)
export async function generateWeeklyAgentReports(): Promise<void> {
  try {
    logger.info('Starting weekly agent performance reports');

    // Get all agents
    const agents = await prisma.agentPerformance.findMany();

    for (const agent of agents) {
      // Get lessons from past 7 days
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const lessons = await prisma.agentLesson.findMany({
        where: {
          agentId: agent.agentId,
          createdAt: { gte: weekAgo }
        }
      });

      if (lessons.length === 0) continue;

      const wins = lessons.filter((l: any) => l.correct).length;
      const losses = lessons.filter((l: any) => !l.correct).length;
      const winRate = (wins / lessons.length) * 100;

      // Generate report
      const report = await generateWeeklyReport(
        agent.agentName,
        winRate,
        wins,
        losses,
        lessons
      );

      // Save report
      await prisma.agentPerformance.update({
        where: { agentId: agent.agentId },
        data: {
          weeklyReport: {
            generatedAt: new Date().toISOString(),
            winRate,
            totalTrades: lessons.length,
            report
          }
        }
      });

      logger.info(`Weekly report generated for ${agent.agentName}: ${winRate.toFixed(1)}% win rate`);
    }
  } catch (err) {
    logger.error(`Error generating weekly reports: ${err}`);
  }
}

// Generate AI-powered weekly report
async function generateWeeklyReport(
  agentName: string,
  winRate: number,
  wins: number,
  losses: number,
  lessons: any[]
): Promise<string> {
  try {
    const bestSetups = lessons
      .filter(l => l.correct)
      .map(l => l.setupType)
      .slice(0, 3)
      .join(', ');

    const worstSetups = lessons
      .filter(l => !l.correct)
      .map(l => l.setupType)
      .slice(0, 3)
      .join(', ');

    const prompt = `Generate a brief weekly performance summary for a trading agent:

Agent: ${agentName}
Period: Last 7 days
Win Rate: ${winRate.toFixed(1)}%
Wins: ${wins}, Losses: ${losses}
Best performing setups: ${bestSetups}
Worst performing setups: ${worstSetups}

Generate a 3-4 sentence professional summary covering:
1. Overall performance assessment
2. What worked well
3. Areas for improvement
4. Recommendation for next week

Keep it concise and actionable.`;

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    return response.content[0].type === 'text' ? response.content[0].text : 'Report generation failed';
  } catch (err) {
    logger.error(`Error generating weekly report: ${err}`);
    return 'Report generation failed';
  }
}

export default {
  analyzeTradeOutcome,
  generateWeeklyAgentReports
};
