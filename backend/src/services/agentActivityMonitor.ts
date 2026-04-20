import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { getIO } from '../websocket/server';

/**
 * AGENT ACTIVITY MONITOR
 * Tracks and broadcasts all agent activities in real-time
 * - News/paper gathering
 * - Learning from sources
 * - Decision making process
 * - Trade recommendations
 * - Geopolitical analysis
 */

export interface AgentActivity {
  timestamp: number;
  agentId: number;
  agentName: string;
  activityType: 'GATHERING' | 'LEARNING' | 'ANALYZING' | 'VOTING' | 'TRADING';
  source?: string; // External source (news, paper, geopolitical data)
  content: string;
  dataPoints?: any;
  confidence?: number;
  impact?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface AgentInsight {
  agentId: number;
  agentName: string;
  insights: string[];
  sourceType: 'NEWS' | 'PAPER' | 'GEOPOLITICAL' | 'TECHNICAL' | 'FUNDAMENTAL';
  timestamp: number;
}

class AgentActivityMonitor {
  private activities: AgentActivity[] = [];
  private maxActivities = 1000;

  /**
   * Log agent gathering information from external sources
   */
  async logGathering(
    agentId: number,
    agentName: string,
    source: string,
    content: string,
    dataPoints?: any[]
  ) {
    const activity: AgentActivity = {
      timestamp: Date.now(),
      agentId,
      agentName,
      activityType: 'GATHERING',
      source,
      content,
      dataPoints
    };

    this.activities.push(activity);
    if (this.activities.length > this.maxActivities) {
      this.activities.shift();
    }

    // Broadcast to WebSocket clients
    const io = getIO();
    io?.emit('agent:gathering', activity);

    // Log to database
    await this.saveActivity(activity);
    logger.info(`📚 ${agentName} gathering from ${source}`, { source, content: content.slice(0, 100) });
  }

  /**
   * Log agent learning from gathered resources
   */
  async logLearning(
    agentId: number,
    agentName: string,
    sourceType: 'NEWS' | 'PAPER' | 'GEOPOLITICAL' | 'TECHNICAL' | 'FUNDAMENTAL',
    insights: string[],
    confidence: number
  ) {
    const activity: AgentActivity = {
      timestamp: Date.now(),
      agentId,
      agentName,
      activityType: 'LEARNING',
      source: sourceType,
      content: `Learned from ${sourceType}: ${insights.join('; ')}`,
      confidence
    };

    this.activities.push(activity);
    if (this.activities.length > this.maxActivities) {
      this.activities.shift();
    }

    const io = getIO();
    io?.emit('agent:learning', activity);

    await this.saveActivity(activity);
    logger.info(`🧠 ${agentName} learning: ${sourceType}`, { confidence, insightCount: insights.length });
  }

  /**
   * Log agent analysis of market data
   */
  async logAnalyzing(
    agentId: number,
    agentName: string,
    asset: string,
    analysis: string,
    indicators: any,
    confidence: number
  ) {
    const activity: AgentActivity = {
      timestamp: Date.now(),
      agentId,
      agentName,
      activityType: 'ANALYZING',
      source: `${asset} Analysis`,
      content: analysis,
      dataPoints: indicators,
      confidence
    };

    this.activities.push(activity);
    if (this.activities.length > this.maxActivities) this.activities.shift();

    const io = getIO();
    io?.emit('agent:analyzing', activity);

    await this.saveActivity(activity);
    logger.info(`🔍 ${agentName} analyzing ${asset}`, { confidence });
  }

  /**
   * Log agent voting decision
   */
  async logVote(
    agentId: number,
    agentName: string,
    asset: string,
    vote: 'BUY' | 'SELL' | 'HOLD',
    reasoning: string,
    confidence: number,
    round: number
  ) {
    const impact = confidence > 0.8 ? 'HIGH' : confidence > 0.6 ? 'MEDIUM' : 'LOW';
    
    const activity: AgentActivity = {
      timestamp: Date.now(),
      agentId,
      agentName,
      activityType: 'VOTING',
      source: `${asset} - Round ${round}`,
      content: `Vote: ${vote} - ${reasoning}`,
      confidence,
      impact
    };

    this.activities.push(activity);
    if (this.activities.length > this.maxActivities) this.activities.shift();

    const io = getIO();
    io?.emit('agent:voting', { ...activity, vote });

    await this.saveActivity(activity);
    logger.info(`🗳️ ${agentName} voting ${vote} on ${asset}`, { confidence, round });
  }

  /**
   * Log trade execution from agent recommendation
   */
  async logTradeExecution(
    agentId: number,
    agentName: string,
    asset: string,
    action: 'BUY' | 'SELL',
    amount: number,
    price: number,
    reasoning: string
  ) {
    const activity: AgentActivity = {
      timestamp: Date.now(),
      agentId,
      agentName,
      activityType: 'TRADING',
      source: 'Trade Execution',
      content: `${action} ${amount} ${asset} @ $${price.toFixed(2)}: ${reasoning}`,
      dataPoints: { action, amount, price, asset }
    };

    this.activities.push(activity);
    this.activities.shift();

    const io = getIO();
    io?.emit('agent:trading', { ...activity, action, amount, price });

    await this.saveActivity(activity);
    logger.info(`💰 ${agentName} executing ${action}: ${amount} ${asset} @ $${price}`, {});
  }

  /**
   * Get all activities with optional filtering
   */
  getActivities(agentId?: number, activityType?: string): AgentActivity[] {
    let filtered = [...this.activities];

    if (agentId) {
      filtered = filtered.filter(a => a.agentId === agentId);
    }

    if (activityType) {
      filtered = filtered.filter(a => a.activityType === activityType);
    }

    return filtered.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get real-time activity stream (for last N seconds)
   */
  getRecentActivities(secondsBack: number = 60): AgentActivity[] {
    const cutoff = Date.now() - secondsBack * 1000;
    return this.activities.filter(a => a.timestamp > cutoff);
  }

  /**
   * Get activity summary by agent
   */
  getActivitySummaryByAgent(): Record<number, any> {
    const summary: Record<number, any> = {};

    this.activities.forEach(activity => {
      if (!summary[activity.agentId]) {
        summary[activity.agentId] = {
          agentId: activity.agentId,
          name: activity.agentName,
          activityCount: 0,
          byType: {},
          recentActivities: []
        };
      }

      summary[activity.agentId].activityCount++;
      summary[activity.agentId].byType[activity.activityType] = 
        (summary[activity.agentId].byType[activity.activityType] || 0) + 1;
      summary[activity.agentId].recentActivities.push(activity);
    });

    return summary;
  }

  /**
   * Save activity to database
   */
  private async saveActivity(activity: AgentActivity) {
    try {
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          service: `agent-activity-${activity.agentId}`,
          message: activity.content,
          metadata: activity as any
        }
      });
    } catch (err) {
      logger.warn('Failed to save agent activity', { error: String(err) });
    }
  }

  /**
   * Get statistics on what agents are learning
   */
  getLearningStats() {
    const learningActivities = this.activities.filter(a => a.activityType === 'LEARNING');
    const gatheringActivities = this.activities.filter(a => a.activityType === 'GATHERING');

    return {
      totalLearning: learningActivities.length,
      totalGathering: gatheringActivities.length,
      learningBySource: this.countByProperty(learningActivities, 'source'),
      gatheringBySource: this.countByProperty(gatheringActivities, 'source'),
      averageConfidence: this.getAverageConfidence(learningActivities)
    };
  }

  private countByProperty(activities: AgentActivity[], property: string): Record<string, number> {
    const counts: Record<string, number> = {};
    activities.forEach(a => {
      const value = (a as any)[property] || 'unknown';
      counts[value] = (counts[value] || 0) + 1;
    });
    return counts;
  }

  private getAverageConfidence(activities: AgentActivity[]): number {
    if (activities.length === 0) return 0;
    const total = activities.reduce((sum, a) => sum + (a.confidence || 0), 0);
    return total / activities.length;
  }
}

export const agentActivityMonitor = new AgentActivityMonitor();
