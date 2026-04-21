import { Router, Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { agentActivityMonitor } from '../services/agentActivityMonitor';
import { geopoliticalDataService } from '../services/geopoliticalDataService';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

export const agentMonitorRouter = Router();
agentMonitorRouter.use(requireAuth);

/**
 * GET /api/monitor/activities
 * Get all agent activities (real-time)
 */
agentMonitorRouter.get('/activities', async (req: AuthRequest, res: Response) => {
  try {
    const agentId = req.query.agentId ? parseInt(req.query.agentId as string) : undefined;
    const activityType = req.query.type as string;
    const recent = req.query.recent ? parseInt(req.query.recent as string) : undefined;

    let activities;
    if (recent) {
      activities = agentActivityMonitor.getRecentActivities(recent);
    } else {
      activities = agentActivityMonitor.getActivities(agentId, activityType);
    }

    return res.json({
      count: activities.length,
      activities: activities.slice(0, 100) // Limit to last 100
    });
  } catch (error: any) {
    logger.error('Failed to get activities', { error: error.message });
    return res.status(500).json({ error: 'Failed to get activities' });
  }
});

/**
 * GET /api/monitor/activities/summary
 * Get agent activity summary
 */
agentMonitorRouter.get('/activities/summary', async (req: AuthRequest, res: Response) => {
  try {
    const summary = agentActivityMonitor.getActivitySummaryByAgent();
    return res.json(summary);
  } catch (error: any) {
    logger.error('Failed to get activity summary', { error: error.message });
    return res.status(500).json({ error: 'Failed to get activity summary' });
  }
});

/**
 * GET /api/monitor/learning
 * Get what agents have learned
 */
agentMonitorRouter.get('/learning', async (req: AuthRequest, res: Response) => {
  try {
    const stats = agentActivityMonitor.getLearningStats();
    return res.json(stats);
  } catch (error: any) {
    logger.error('Failed to get learning stats', { error: error.message });
    return res.status(500).json({ error: 'Failed to get learning stats' });
  }
});

/**
 * GET /api/monitor/news
 * Get recent news/information
 */
agentMonitorRouter.get('/news', async (req: AuthRequest, res: Response) => {
  try {
    const minutes = req.query.minutes ? parseInt(req.query.minutes as string) : 60;
    const category = req.query.category as string;

    const news = geopoliticalDataService.getRecentNews(minutes, category);
    return res.json({
      count: news.length,
      news: news.slice(0, 50)
    });
  } catch (error: any) {
    logger.error('Failed to get news', { error: error.message });
    return res.status(500).json({ error: 'Failed to get news' });
  }
});

/**
 * GET /api/monitor/news/high-impact
 * Get high-impact news only
 */
agentMonitorRouter.get('/news/high-impact', async (req: AuthRequest, res: Response) => {
  try {
    const minutes = req.query.minutes ? parseInt(req.query.minutes as string) : 60;
    const news = geopoliticalDataService.getHighImpactNews(minutes);
    return res.json({
      count: news.length,
      news
    });
  } catch (error: any) {
    logger.error('Failed to get high-impact news', { error: error.message });
    return res.status(500).json({ error: 'Failed to get high-impact news' });
  }
});

/**
 * GET /api/monitor/geopolitics
 * Get geopolitical events
 */
agentMonitorRouter.get('/geopolitics', async (req: AuthRequest, res: Response) => {
  try {
    const hours = req.query.hours ? parseInt(req.query.hours as string) : 24;
    const events = geopoliticalDataService.getActiveGeopoliticalEvents(hours);
    
    const critical = events.filter(e => e.severity === 'CRITICAL' || e.severity === 'HIGH');

    return res.json({
      totalEvents: events.length,
      criticalEvents: critical.length,
      events: events.slice(0, 50),
      critical
    });
  } catch (error: any) {
    logger.error('Failed to get geopolitical events', { error: error.message });
    return res.status(500).json({ error: 'Failed to get geopolitical events' });
  }
});

/**
 * GET /api/monitor/sentiment
 * Get market sentiment based on news/events
 */
agentMonitorRouter.get('/sentiment', async (req: AuthRequest, res: Response) => {
  try {
    const sentiment = geopoliticalDataService.generateMarketSentimentSummary();
    return res.json(sentiment);
  } catch (error: any) {
    logger.error('Failed to get market sentiment', { error: error.message });
    return res.status(500).json({ error: 'Failed to get market sentiment' });
  }
});

/**
 * GET /api/monitor/context
 * Get full learning context (everything agents see)
 */
agentMonitorRouter.get('/context', async (req: AuthRequest, res: Response) => {
  try {
    const context = geopoliticalDataService.getLearningContext();
    return res.json(context);
  } catch (error: any) {
    logger.error('Failed to get learning context', { error: error.message });
    return res.status(500).json({ error: 'Failed to get learning context' });
  }
});

/**
 * GET /api/monitor/recent-decisions
 * Recent agent decisions from DB (works even after server restart)
 */
agentMonitorRouter.get('/recent-decisions', async (req: AuthRequest, res: Response) => {
  try {
    const decisions = await prisma.agentDecision.findMany({
      orderBy: { timestamp: 'desc' },
      take: 20,
    });
    // Flatten into activity-style records
    const activities: any[] = [];
    for (const d of decisions) {
      const votes: any[] = (d.agentVotes as any[]) || [];
      for (const v of votes) {
        activities.push({
          timestamp: new Date(d.timestamp).getTime(),
          agentId: v.agentId || 0,
          agentName: v.agentName || 'Unknown',
          activityType: 'VOTING',
          source: `${d.asset} — Round 3`,
          content: `Vote: ${v.finalVote || v.vote} — ${(v.finalReason || v.openingArgument || '').slice(0, 200)}`,
          confidence: v.confidence ? v.confidence / 100 : undefined,
          impact: (v.confidence || 0) >= 75 ? 'HIGH' : (v.confidence || 0) >= 50 ? 'MEDIUM' : 'LOW',
        });
      }
    }
    activities.sort((a, b) => b.timestamp - a.timestamp);
    return res.json({ count: activities.length, activities: activities.slice(0, 100) });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to get recent decisions' });
  }
});

/**
 * GET /api/monitor/status
 * Overall system status — what's running, how many positions open
 */
agentMonitorRouter.get('/status', async (_req: AuthRequest, res: Response) => {
  try {
    const [openPositions, todayTrades, recentDecisions] = await Promise.all([
      prisma.position.count({ where: { status: 'OPEN' } }),
      prisma.trade.count({ where: { openedAt: { gte: new Date(new Date().setHours(0,0,0,0)) } } }),
      prisma.agentDecision.count({ where: { timestamp: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } } }),
    ]);
    return res.json({
      openPositions,
      todayTrades,
      recentDebates: recentDecisions,
      schedulerRunning: true,
      uptime: Math.floor(process.uptime()),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to get status' });
  }
});

export default agentMonitorRouter;
