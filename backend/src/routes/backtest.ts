/**
 * BACKTESTING ROUTES
 * REST API endpoints for running and retrieving backtest results
 */

import { Router, Request, Response } from 'express';
import { runBacktest, evaluateBacktestResults, BacktestConfig } from '../trading/backtestingEngine';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

const router = Router();

/**
 * POST /api/backtest/run
 * Start a new backtest with given parameters
 */
router.post('/run', async (req: Request, res: Response) => {
  try {
    const config: BacktestConfig = {
      startDate: req.body.startDate || '2025-10-15',
      endDate: req.body.endDate || '2026-04-15',
      initialCapital: req.body.initialCapital || 100000,
      symbols: req.body.symbols || ['AAPL', 'BTC/USDT', 'ETH/USDT'],
      riskPerTrade: req.body.riskPerTrade || 1,
      maxPositionSize: req.body.maxPositionSize || 10,
      brokerFeesPct: req.body.brokerFeesPct || 0.1,
    };

    logger.info('Starting backtest...', config);
    const results = await runBacktest(config);

    // Evaluate go/no-go decision
    const evaluation = evaluateBacktestResults(results);

    res.json({
      success: true,
      results,
      evaluation,
      recommendation: evaluation.canGoLive
        ? '✅ SAFE TO DEPLOY - All metrics meet requirements'
        : '❌ DO NOT DEPLOY - Issues detected',
    });
  } catch (error) {
    logger.error('Backtest failed', { error });
    res.status(500).json({ error: 'Backtest execution failed' });
  }
});

/**
 * GET /api/backtest/status
 * Get status of running backtest or last completed backtest
 */
router.get('/status', (req: Request, res: Response) => {
  res.json({
    status: 'ready',
    message: 'No active backtest running. Use POST /api/backtest/run to start.',
  });
});

/**
 * POST /api/backtest/validate
 * Validate backtest configuration without running full backtest
 */
router.post('/validate', (req: Request, res: Response) => {
  try {
    const config = req.body;

    // Basic validation
    const errors: string[] = [];

    if (!config.startDate) errors.push('startDate is required');
    if (!config.endDate) errors.push('endDate is required');
    if (config.initialCapital && config.initialCapital < 1000) {
      errors.push('initialCapital must be >= $1,000');
    }
    if (!config.symbols || config.symbols.length === 0) {
      errors.push('symbols array must not be empty');
    }

    if (errors.length > 0) {
      return res.status(400).json({ valid: false, errors });
    }

    res.json({
      valid: true,
      config: {
        ...config,
        riskPerTrade: config.riskPerTrade || 1,
        maxPositionSize: config.maxPositionSize || 10,
        brokerFeesPct: config.brokerFeesPct || 0.1,
      },
      message: 'Configuration is valid. Ready to run backtest.',
    });
  } catch (error) {
    res.status(400).json({ valid: false, error: 'Invalid configuration' });
  }
});

/**
 * GET /api/backtest/requirements
 * Get go-live requirements and thresholds
 */
router.get('/requirements', (req: Request, res: Response) => {
  res.json({
    goLiveRequirements: {
      sharpeRatio: {
        target: '>1.5',
        description: 'Volatility-adjusted returns. Higher is better.',
        current: 'Run backtest to see',
      },
      winRate: {
        target: '>55%',
        description: 'Percentage of profitable trades',
        current: 'Run backtest to see',
      },
      maxDrawdown: {
        target: '<20%',
        description: 'Worst peak-to-trough decline',
        current: 'Run backtest to see',
      },
      profitFactor: {
        target: '>1.8',
        description: 'Total wins / Total losses. Higher is better.',
        current: 'Run backtest to see',
      },
    },
    recommendation:
      '✅ GO LIVE IF all metrics meet targets. ❌ IMPROVE AGENTS if any metric misses.',
  });
});

/**
 * GET /api/backtest/guides
 * Get detailed interpretation guides for metrics
 */
router.get('/guide', (req: Request, res: Response) => {
  res.json({
    sharpeRatio: {
      name: 'Sharpe Ratio',
      formula: '(Average Return - Risk-Free Rate) / Return Volatility',
      interpretation: {
        '<1': 'Poor - too much volatility for returns achieved',
        '1-1.5': 'Acceptable but not great',
        '1.5-2': 'Good - strong risk-adjusted returns',
        '>2': 'Excellent - exceptional risk-adjusted performance',
      },
      note: 'Higher is always better. We target > 1.5',
    },
    winRate: {
      name: 'Win Rate (%)',
      formula: '(Winning Trades / Total Trades) × 100',
      interpretation: {
        '<50%': 'Losing strategy - more losses than wins',
        '50-55%': 'Breakeven or slight edge',
        '55-60%': 'Good edge - sustainable strategy',
        '>60%': 'Strong edge - but verify not overfitted',
      },
      note: 'We target > 55% to ensure statistical edge',
    },
    maxDrawdown: {
      name: 'Max Drawdown (%)',
      formula: 'Worst Peak-to-Trough decline / Peak value',
      interpretation: {
        '>40%': 'Unacceptable risk - too much capital lost',
        '20-40%': 'Risky but might be acceptable',
        '10-20%': 'Manageable risk for active trading',
        '<10%': 'Conservative - very safe',
      },
      note: 'We target < 20% to avoid catastrophic loss',
    },
    profitFactor: {
      name: 'Profit Factor',
      formula: 'Total Winning $ / Total Losing $',
      interpretation: {
        '<1': 'Losing strategy',
        '1-1.2': 'Break-even after fees',
        '1.2-1.8': 'Profitable but borderline',
        '>1.8': 'Strong profitability',
      },
      note: 'We target > 1.8 for account growth',
    },
  });
});

export default router;
