/**
 * AGENT ACTIVITY LOGGER
 * Real-time tracking of all agent activities, decisions, and reasoning
 * Provides complete transparency into what agents are doing and why
 */

import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface AgentActivity {
  id: string;
  timestamp: Date;
  agentId: number;
  agentName: string;
  activityType: 'analysis' | 'vote' | 'debate' | 'chat' | 'learning' | 'signal' | 'price_check' | 'resource_fetch';
  asset: string;
  decision: 'BUY' | 'SELL' | 'HOLD' | 'RESEARCH' | null;
  confidence: number; // 0-100
  reasoning: string;
  dataPoints: Record<string, any>;
  resultingAction?: string;
  status: 'pending' | 'completed' | 'error';
  executionTimeMs: number;
  relatedActivities?: string[]; // IDs of related agent activities
}

export interface AgentActivityFeed {
  totalActivities: number;
  lastHourActivities: AgentActivity[];
  recentVotes: AgentActivity[];
  activeDebate?: AgentActivity[];
  agentStatus: Record<number, {
    lastActivity: AgentActivity;
    activitiesLastHour: number;
    accuracyLast20: number;
  }>;
}

/**
 * Log a single agent activity with full context
 */
export async function logAgentActivity(activity: Omit<AgentActivity, 'id' | 'timestamp'>): Promise<AgentActivity> {
  const now = new Date();
  const id = `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const fullActivity: AgentActivity = {
    id,
    timestamp: now,
    ...activity,
    executionTimeMs: activity.executionTimeMs || 0
  };

  try {
    // Store in database
    await prisma.systemLog.create({
      data: {
        level: activity.status === 'error' ? 'ERROR' : 'INFO',
        service: `agent-${activity.agentId}`,
        message: `${activity.activityType}: ${activity.asset}`,
        metadata: fullActivity as any
      }
    });

    // Store in Redis for fast access (live feed)
    const feedKey = `agent:feed:${now.toISOString().split('T')[0]}`;
    const feed = await getActivityFeed();
    feed.lastHourActivities.unshift(fullActivity);
    feed.lastHourActivities = feed.lastHourActivities.slice(0, 500); // Keep last 500

  } catch (err) {
    logger.error('Failed to log agent activity', { err, activityId: id });
  }

  return fullActivity;
}

/**
 * Get real-time agent activity feed
 */
export async function getActivityFeed(): Promise<AgentActivityFeed> {
  try {
    const oneHourAgo = new Date(Date.now() - 3600000);

    // Get recent activities
    const activities = await prisma.systemLog.findMany({
      where: {
        timestamp: { gte: oneHourAgo },
        service: { startsWith: 'agent-' }
      },
      orderBy: { timestamp: 'desc' },
      take: 200
    });

    const parsedActivities: AgentActivity[] = activities
      .map(log => {
        try {
          return typeof log.metadata === 'string'
            ? JSON.parse(log.metadata)
            : log.metadata;
        } catch {
          return null;
        }
      })
      .filter((a): a is AgentActivity => a !== null);

    // Get recent votes
    const recentVotes = parsedActivities
      .filter(a => a.activityType === 'vote' && a.decision)
      .slice(0, 20);

    // Get active debates
    const activeDebate = parsedActivities
      .filter(a => a.activityType === 'debate' && a.status === 'pending')
      .slice(0, 20);

    // Build agent status
    const agentStatus: Record<number, any> = {};
    for (let agentId = 1; agentId <= 10; agentId++) {
      const agentActivities = parsedActivities.filter(a => a.agentId === agentId);
      const lastActivity = agentActivities[0];
      const activitiesLastHour = agentActivities.length;

      agentStatus[agentId] = {
        lastActivity: lastActivity || null,
        activitiesLastHour,
        accuracyLast20: await getAgentAccuracy(agentId)
      };
    }

    return {
      totalActivities: parsedActivities.length,
      lastHourActivities: parsedActivities.slice(0, 100),
      recentVotes,
      activeDebate,
      agentStatus
    };
  } catch (err) {
    logger.error('Failed to get activity feed', { err });
    return {
      totalActivities: 0,
      lastHourActivities: [],
      recentVotes: [],
      activeDebate: [],
      agentStatus: {}
    };
  }
}

/**
 * Get detailed activity trace for a specific agent
 */
export async function getAgentActivityTrace(agentId: number, hours: number = 24): Promise<AgentActivity[]> {
  try {
    const since = new Date(Date.now() - hours * 3600000);

    const logs = await prisma.systemLog.findMany({
      where: {
        service: `agent-${agentId}`,
        timestamp: { gte: since }
      },
      orderBy: { timestamp: 'desc' },
      take: 500
    });

    return logs
      .map(log => {
        try {
          return typeof log.metadata === 'string'
            ? JSON.parse(log.metadata)
            : log.metadata;
        } catch {
          return null;
        }
      })
      .filter((a): a is AgentActivity => a !== null);
  } catch (err) {
    logger.error('Failed to get agent trace', { agentId, err });
    return [];
  }
}

/**
 * Get agent accuracy from recent trades
 */
async function getAgentAccuracy(agentId: number): Promise<number> {
  try {
    const lessons = await prisma.systemLog.findMany({
      where: {
        service: `agent-learning-${agentId}`
      },
      take: 20,
      orderBy: { timestamp: 'desc' }
    });

    if (lessons.length === 0) return 50;

    const correct = lessons.filter(l => {
      const meta = typeof l.metadata === 'string' ? JSON.parse(l.metadata) : l.metadata;
      return meta.correct === true;
    }).length;

    return Math.round((correct / lessons.length) * 100);
  } catch {
    return 50;
  }
}

/**
 * Stream real-time agent activity as it happens (for WebSocket)
 */
export async function subscribeToAgentActivity(
  callback: (activity: AgentActivity) => void,
  filters?: { agentId?: number; assetOnly?: string; activityTypeOnly?: string }
) {
  // In a real system, this would use Redis Pub/Sub or Socket.io
  // For now, return a simple polling mechanism
  const pollInterval = setInterval(async () => {
    const feed = await getActivityFeed();
    for (const activity of feed.lastHourActivities) {
      if (filters?.agentId && activity.agentId !== filters.agentId) continue;
      if (filters?.assetOnly && activity.asset !== filters.assetOnly) continue;
      if (filters?.activityTypeOnly && activity.activityType !== filters.activityTypeOnly) continue;

      callback(activity);
    }
  }, 1000);

  return () => clearInterval(pollInterval); // Return unsubscribe function
}

/**
 * Generate a detailed activity summary for an agent
 */
export async function generateAgentActivitySummary(agentId: number, hours: number = 24): Promise<string> {
  try {
    const activities = await getAgentActivityTrace(agentId, hours);

    if (activities.length === 0) {
      return `Agent ${agentId} had no activity in the last ${hours} hours.`;
    }

    const summary = {
      totalActivities: activities.length,
      byType: {} as Record<string, number>,
      votes: { BUY: 0, SELL: 0, HOLD: 0 },
      topAssets: {} as Record<string, number>,
      averageConfidence: 0,
      topReasons: [] as string[]
    };

    let totalConfidence = 0;
    const reasoningMap = new Map<string, number>();

    for (const activity of activities) {
      summary.byType[activity.activityType] = (summary.byType[activity.activityType] || 0) + 1;

      if (activity.decision && activity.decision in summary.votes) {
        summary.votes[activity.decision as keyof typeof summary.votes]++;
      }

      summary.topAssets[activity.asset] = (summary.topAssets[activity.asset] || 0) + 1;
      totalConfidence += activity.confidence;

      // Extract key reasons
      const reasoning = activity.reasoning.substring(0, 100);
      reasoningMap.set(reasoning, (reasoningMap.get(reasoning) || 0) + 1);
    }

    summary.averageConfidence = Math.round(totalConfidence / activities.length);
    summary.topReasons = Array.from(reasoningMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason]) => reason);

    return `
Agent Activity Summary (Last ${hours}h):
- Total Activities: ${summary.totalActivities}
- By Type: ${Object.entries(summary.byType).map(([k, v]) => `${k}(${v})`).join(', ')}
- Votes: ${summary.votes.BUY} BUY, ${summary.votes.SELL} SELL, ${summary.votes.HOLD} HOLD
- Top Assets: ${Object.entries(summary.topAssets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([asset, count]) => `${asset}(${count})`)
      .join(', ')}
- Avg Confidence: ${summary.averageConfidence}%
- Key Themes: ${summary.topReasons.join('; ')}
    `.trim();
  } catch (err) {
    logger.error('Failed to generate summary', { agentId, err });
    return `Failed to generate summary for Agent ${agentId}`;
  }
}

/**
 * Export detailed agent activity report
 */
export async function exportAgentActivityReport(agentId: number, format: 'json' | 'csv' = 'json'): Promise<string> {
  try {
    const activities = await getAgentActivityTrace(agentId, 24);

    if (format === 'json') {
      return JSON.stringify(activities, null, 2);
    }

    // CSV format
    const headers = [
      'Timestamp',
      'Agent',
      'Activity Type',
      'Asset',
      'Decision',
      'Confidence',
      'Status',
      'Execution Time (ms)',
      'Reasoning'
    ];

    const rows = activities.map(a => [
      a.timestamp.toISOString(),
      a.agentName,
      a.activityType,
      a.asset,
      a.decision || 'N/A',
      a.confidence,
      a.status,
      a.executionTimeMs,
      `"${a.reasoning.replace(/"/g, '""')}"` // Escape quotes for CSV
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    return csv;
  } catch (err) {
    logger.error('Failed to export report', { agentId, err });
    return '';
  }
}

export default {
  logAgentActivity,
  getActivityFeed,
  getAgentActivityTrace,
  subscribeToAgentActivity,
  generateAgentActivitySummary,
  exportAgentActivityReport
};
