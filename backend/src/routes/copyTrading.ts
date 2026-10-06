import { Router, Request, Response } from 'express';
import { copyTradingEngine } from '../services/copyTradingEngine';
import { requireAuth } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// All routes require authenticated session
router.use(requireAuth);

/**
 * GET /api/copy-trading/strategies
 * Returns verified institutional master strategies available for mirroring
 */
router.get('/strategies', (_req: Request, res: Response) => {
  try {
    const strategies = copyTradingEngine.getStrategies();
    res.json({ success: true, strategies });
  } catch (err: any) {
    logger.error('Failed to get copy trading strategies', { err: err?.message || err });
    res.status(500).json({ error: 'Failed to get copy trading strategies' });
  }
});

/**
 * GET /api/copy-trading/followers
 * Returns registered follower accounts & paper mirroring configurations
 */
router.get('/followers', (_req: Request, res: Response) => {
  try {
    const followers = copyTradingEngine.getFollowers();
    res.json({ success: true, followers });
  } catch (err: any) {
    logger.error('Failed to get copy trading followers', { err: err?.message || err });
    res.status(500).json({ error: 'Failed to get copy trading followers' });
  }
});

/**
 * POST /api/copy-trading/followers
 * Register new follower account with independent risk limits
 */
router.post('/followers', (req: Request, res: Response) => {
  try {
    const {
      name,
      accountType,
      allocatedCapitalUSD,
      maxAllocationPct,
      slippageCeilingBps,
      maxDelaySeconds,
      stopLossMultiplier,
      dailyMaxLossUSD,
      subscribedStrategyIds
    } = req.body;

    if (!name || typeof allocatedCapitalUSD !== 'number') {
      return res.status(400).json({ error: 'Name and allocatedCapitalUSD are required' });
    }

    const follower = copyTradingEngine.createFollower({
      name,
      accountType,
      allocatedCapitalUSD,
      maxAllocationPct,
      slippageCeilingBps,
      maxDelaySeconds,
      stopLossMultiplier,
      dailyMaxLossUSD,
      subscribedStrategyIds: Array.isArray(subscribedStrategyIds) ? subscribedStrategyIds : []
    });

    res.status(201).json({ success: true, follower });
  } catch (err: any) {
    logger.error('Failed to create copy trading follower', { err: err?.message || err });
    res.status(500).json({ error: 'Failed to create copy follower' });
  }
});

/**
 * PATCH /api/copy-trading/followers/:id
 * Update risk settings or strategy subscriptions
 */
router.patch('/followers/:id', (req: Request, res: Response) => {
  try {
    const updated = copyTradingEngine.updateFollower(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Follower account not found' });
    }
    res.json({ success: true, follower: updated });
  } catch (err: any) {
    logger.error('Failed to update copy follower', { err: err?.message || err });
    res.status(500).json({ error: 'Failed to update copy follower' });
  }
});

/**
 * POST /api/copy-trading/followers/:id/toggle
 * Toggle active copying state (Pause / Resume)
 */
router.post('/followers/:id/toggle', (req: Request, res: Response) => {
  try {
    const updated = copyTradingEngine.toggleFollowerStatus(req.params.id);
    if (!updated) {
      return res.status(404).json({ error: 'Follower account not found' });
    }
    res.json({ success: true, follower: updated });
  } catch (err: any) {
    logger.error('Failed to toggle follower status', { err: err?.message || err });
    res.status(500).json({ error: 'Failed to toggle follower status' });
  }
});

/**
 * DELETE /api/copy-trading/followers/:id
 * Remove follower configuration
 */
router.delete('/followers/:id', (req: Request, res: Response) => {
  try {
    const success = copyTradingEngine.deleteFollower(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Follower account not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Failed to delete follower', { err: err?.message || err });
    res.status(500).json({ error: 'Failed to delete follower' });
  }
});

/**
 * GET /api/copy-trading/audit-log
 * Returns immutable audit log of mirrored executions & slippage checks
 */
router.get('/audit-log', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const logs = copyTradingEngine.getAuditLogs(limit);
    res.json({ success: true, logs });
  } catch (err: any) {
    logger.error('Failed to get copy trading audit log', { err: err?.message || err });
    res.status(500).json({ error: 'Failed to get copy trading audit log' });
  }
});

export default router;
