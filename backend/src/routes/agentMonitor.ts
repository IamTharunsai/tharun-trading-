import { Router, Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { agentActivityMonitor } from '../services/agentActivityMonitor';
import { geopoliticalDataService } from '../services/geopoliticalDataService';
import { logger } from '../utils/logger';

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
 * WebSocket events (emitted from agentActivityMonitor)
 * 'agent:gathering' - Agent gathering data
 * 'agent:learning' - Agent learning from sources
 * 'agent:analyzing' - Agent analyzing market
 * 'agent:voting' - Agent voting
 * 'agent:trading' - Agent executing trade
 */

export default agentMonitorRouter;
