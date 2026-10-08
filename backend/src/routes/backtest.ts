/**
 * BACKTESTING ROUTES
 * REST API endpoints for running and retrieving backtest results
 */

import { Router, Request, Response } from 'express';
import { runBacktest, evaluateBacktestResults, backtestConfigSchema } from '../trading/backtestingEngine';
import { historicalRange } from '../trading/historicalBars';
import { logger } from '../utils/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

/**
 * POST /api/backtest/run
 * Start a new backtest with given parameters
 */
router.post('/run', async (req: Request, res: Response) => {
  try {
    const parsed = backtestConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid backtest configuration', issues: parsed.error.issues });
    try { historicalRange(parsed.data.startDate, parsed.data.endDate); }
    catch { return res.status(400).json({ error: 'Dates must identify 1–366 completed UTC days' }); }
    logger.info('Starting dated research replay', { strategy: parsed.data.strategy, symbols: parsed.data.symbols });
    const results = await runBacktest(parsed.data);

    // Evaluate go/no-go decision
    const evaluation = evaluateBacktestResults(results);

    res.json({
      success: true,
      results,
      evaluation,
      recommendation: evaluation.canGoLive
        ? 'Current qualification passed; review the registered evidence before release'
        : 'Unqualified research simulation — not a live deployment authorization',
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
    status: 'available',
    jobTracking: false,
    message: 'Synchronous research endpoint; active and completed jobs are not tracked by this status response.',
  });
});

/**
 * POST /api/backtest/validate
 * Validate backtest configuration without running full backtest
 */
router.post('/validate', (req: Request, res: Response) => {
  try {
    const parsed = backtestConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ valid: false, issues: parsed.error.issues });
    historicalRange(parsed.data.startDate, parsed.data.endDate);

    res.json({
      valid: true,
      config: parsed.data,
      message: 'Research configuration is valid; provider coverage and live qualification are not established.',
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
        description: 'Percentage of profitable trades; does not establish expectancy or statistical significance',
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
      'Metric thresholds alone cannot authorize live trading. Verified leakage, trial-count/statistical correction, walk-forward, costs, execution, accounting and current health evidence are required.',
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
      note: 'Requires a verified periodic return series, matching risk-free units, sufficient observations and correction for strategy selection. Currently unavailable in this replay.',
    },
    winRate: {
      name: 'Win Rate (%)',
      formula: '(Winning Trades / Total Trades) × 100',
      interpretation: {
        '<50%': 'Fewer winning trades; net expectancy depends on payoff sizes and all costs',
        '50-55%': 'Win frequency alone cannot establish breakeven or an edge',
        '55-60%': 'More winning trades; losses and costs can still exceed wins',
        '>60%': 'High win frequency does not establish sustainable or statistically significant profit',
      },
      note: 'Evaluate net win/loss payoffs, costs, sample uncertainty and out-of-sample evidence together.',
    },
    maxDrawdown: {
      name: 'Max Drawdown (%)',
      formula: 'Worst Peak-to-Trough decline / Peak value',
      interpretation: {
        '>40%': 'Unacceptable risk - too much capital lost',
        '20-40%': 'Risky but might be acceptable',
        '10-20%': 'Manageable risk for active trading',
        '<10%': 'Small observed historical drawdown; future loss and gap risk can be larger',
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
