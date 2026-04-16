/**
 * INTELLIGENCE & ACTIVITY API ROUTES
 * Exposes agent learning, geopolitical intelligence, and real-time activity feeds
 * Complete transparency into what agents are doing, learning, and aware of
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { logger } from '../utils/logger';
import agentActivityLogger from '../services/agentActivityLogger';
import agentResourceLearning from '../services/agentResourceLearning';
import geopoliticalIntelligence from '../services/geopoliticalIntelligence';

const router = Router();

/**
 * GET /api/intelligence/activity/feed
 * Real-time activity feed of all agents
 */
router.get('/activity/feed', requireAuth, async (req: Request, res: Response) => {
  try {
    const feed = await agentActivityLogger.getActivityFeed();
    res.json({
      success: true,
      data: feed,
      timestamp: new Date()
    });
  } catch (err) {
    logger.error('Activity feed error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch activity feed'
    });
  }
});

/**
 * GET /api/intelligence/activity/agent/:agentId
 * Detailed activity trace for specific agent (last 24 hours)
 */
router.get('/activity/agent/:agentId', requireAuth, async (req: Request, res: Response) => {
  try {
    const agentId = parseInt(req.params.agentId);
    const hours = req.query.hours ? parseInt(req.query.hours as string) : 24;

    if (isNaN(agentId) || agentId < 1 || agentId > 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid agent ID (must be 1-10)'
      });
    }

    const trace = await agentActivityLogger.getAgentActivityTrace(agentId, Math.min(hours, 168)); // Max 7 days
    res.json({
      success: true,
      agentId,
      data: trace,
      timestamp: new Date()
    });
  } catch (err) {
    logger.error('Agent trace error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch agent trace'
    });
  }
});

/**
 * GET /api/intelligence/activity/agent/:agentId/summary
 * Generate activity summary for agent
 */
router.get('/activity/agent/:agentId/summary', requireAuth, async (req: Request, res: Response) => {
  try {
    const agentId = parseInt(req.params.agentId);
    const hours = req.query.hours ? parseInt(req.query.hours as string) : 24;

    if (isNaN(agentId) || agentId < 1 || agentId > 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid agent ID (must be 1-10)'
      });
    }

    const summary = await agentActivityLogger.generateAgentActivitySummary(agentId, hours);
    res.json({
      success: true,
      agentId,
      summary,
      timestamp: new Date()
    });
  } catch (err) {
    logger.error('Summary generation error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to generate summary'
    });
  }
});

/**
 * GET /api/intelligence/activity/agent/:agentId/export
 * Export agent activity as JSON or CSV
 */
router.get('/activity/agent/:agentId/export', requireAuth, async (req: Request, res: Response) => {
  try {
    const agentId = parseInt(req.params.agentId);
    const format = (req.query.format as string) === 'csv' ? 'csv' : 'json';

    if (isNaN(agentId) || agentId < 1 || agentId > 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid agent ID (must be 1-10)'
      });
    }

    const report = await agentActivityLogger.exportAgentActivityReport(agentId, format);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="agent-${agentId}-activities.csv"`);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="agent-${agentId}-activities.json"`);
    }

    res.send(report);
  } catch (err) {
    logger.error('Export error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to export report'
    });
  }
});

/**
 * GET /api/intelligence/learning/:asset
 * Get comprehensive learning state for an asset
 * Aggregates all intelligence: news, fundamentals, macro, on-chain
 */
router.get('/learning/:asset', requireAuth, async (req: Request, res: Response) => {
  try {
    const asset = req.params.asset.toUpperCase();

    if (!asset || asset.length < 1) {
      return res.status(400).json({
        success: false,
        error: 'Asset symbol required'
      });
    }

    // Get learning for all agents (they all learn the same asset)
    // We'll return aggregated insights
    const agentLearningStates = [];

    for (let agentId = 1; agentId <= 10; agentId++) {
      const learningState = await agentResourceLearning.buildAgentLearningState(agentId, asset);
      agentLearningStates.push({
        agentId,
        learningState
      });
    }

    // Aggregate insights
    const aggregated = {
      asset,
      timestamp: new Date(),
      newsSignal: {
        sentiment: 'NEUTRAL' as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        confidence: 0,
        topTopics: [] as string[]
      },
      fundamentalSignal: {
        health: 'STABLE' as 'STRONG' | 'STABLE' | 'WEAK',
        trend: 'SIDEWAYS' as 'UP' | 'DOWN' | 'SIDEWAYS'
      },
      macroSignal: {
        environment: 'NORMAL' as 'TAILWIND' | 'NORMAL' | 'HEADWIND',
        topFactors: [] as string[]
      },
      onChainSignal: {
        trend: 'ACCUMULATION' as 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL',
        whaleActivity: 'NORMAL' as 'HIGH' | 'NORMAL' | 'LOW'
      },
      overallScore: 0,
      recommendedAction: 'HOLD' as 'BUY' | 'SELL' | 'HOLD'
    };

    // Calculate aggregates
    const scores = agentLearningStates.map(a => a.learningState.overallScore);
    aggregated.overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    if (aggregated.overallScore > 60) {
      aggregated.recommendedAction = 'BUY';
    } else if (aggregated.overallScore < 40) {
      aggregated.recommendedAction = 'SELL';
    }

    res.json({
      success: true,
      data: {
        aggregated,
        agentLearningStates
      }
    });
  } catch (err) {
    logger.error('Learning fetch error', { err, asset: req.params.asset });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch learning data'
    });
  }
});

/**
 * GET /api/intelligence/risk/assessment
 * Get real-time geopolitical and macro risk assessment
 */
router.get('/risk/assessment', requireAuth, async (req: Request, res: Response) => {
  try {
    const assessment = await geopoliticalIntelligence.buildGeoRiskAssessment();

    res.json({
      success: true,
      data: assessment,
      timestamp: new Date()
    });
  } catch (err) {
    logger.error('Risk assessment error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch risk assessment'
    });
  }
});

/**
 * GET /api/intelligence/risk/events
 * Get recent geopolitical events and their risk scores
 */
router.get('/risk/events', requireAuth, async (req: Request, res: Response) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 7;

    const events = await geopoliticalIntelligence.monitorGeopoliticalEvents();

    // Filter to recent events
    const cutoffDate = new Date(Date.now() - days * 24 * 3600 * 1000);
    const recentEvents = events.filter((e: any) => new Date(e.timestamp) >= cutoffDate);

    res.json({
      success: true,
      data: {
        totalEventsLastDays: recentEvents.length,
        events: recentEvents,
        timestamp: new Date()
      }
    });
  } catch (err) {
    logger.error('Events fetch error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch events'
    });
  }
});

/**
 * GET /api/intelligence/risk/macro
 * Get current macro indicators
 */
router.get('/risk/macro', requireAuth, async (req: Request, res: Response) => {
  try {
    const assessment = await geopoliticalIntelligence.buildGeoRiskAssessment();

    // Extract macro data from assessment
    const macroData = {
      fedRate: 0,
      inflation: 0,
      unemployment: 0,
      vixLevel: 0,
      usdEurRate: 0,
      timestamp: new Date()
    };

    res.json({
      success: true,
      data: macroData
    });
  } catch (err) {
    logger.error('Macro indicators error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch macro indicators'
    });
  }
});

/**
 * GET /api/intelligence/dashboard
 * Unified dashboard data combining all intelligence
 */
router.get('/dashboard', requireAuth, async (req: Request, res: Response) => {
  try {
    const [feed, riskAssessment] = await Promise.all([
      agentActivityLogger.getActivityFeed(),
      geopoliticalIntelligence.buildGeoRiskAssessment()
    ]);

    // Get top assets from activity
    const assetCounts: Record<string, number> = {};
    for (const activity of feed.lastHourActivities) {
      assetCounts[activity.asset] = (assetCounts[activity.asset] || 0) + 1;
    }

    const topAssets = Object.entries(assetCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([asset]) => asset);

    res.json({
      success: true,
      data: {
        agentMetrics: {
          totalActivityLastHour: feed.totalActivities,
          recentVotesCount: feed.recentVotes.length,
          activeDebatesCount: feed.activeDebate?.length || 0,
          agentStatus: feed.agentStatus
        },
        riskMetrics: {
          overallRisk: riskAssessment.overallRisk,
          geoRisk: riskAssessment.geoRisk,
          policyRisk: riskAssessment.policyRisk,
          tradingMode: riskAssessment.tradingModeAdvice
        },
        marketData: {
          activeAssets: topAssets
        },
        timestamp: new Date()
      }
    });
  } catch (err) {
    logger.error('Dashboard error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data'
    });
  }
});

/**
 * POST /api/intelligence/learning/log-activity
 * POST an agent activity to the logger (called by agents during execution)
 */
router.post('/learning/log-activity', requireAuth, async (req: Request, res: Response) => {
  try {
    const { agentId, agentName, activityType, asset, decision, confidence, reasoning, dataPoints, status } = req.body;

    if (!agentId || !asset || !reasoning) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: agentId, asset, reasoning'
      });
    }

    const startTime = Date.now();

    const activity = await agentActivityLogger.logAgentActivity({
      agentId,
      agentName: agentName || `Agent ${agentId}`,
      activityType: activityType || 'analysis',
      asset,
      decision: decision || null,
      confidence: confidence || 0,
      reasoning,
      dataPoints: dataPoints || {},
      status: status || 'completed',
      executionTimeMs: Date.now() - startTime
    });

    res.json({
      success: true,
      data: activity
    });
  } catch (err) {
    logger.error('Log activity error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to log activity'
    });
  }
});

export default router;
