// Real scheduler registration/wrappers with every business I/O dependency mocked.
// No listeners, broker clients, provider network, timers or orders are started.
jest.mock('node-cron', () => ({ __esModule: true, default: { schedule: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/services/marketData', () => ({ CRYPTO_ASSETS: ['BTC'], buildMarketSnapshot: jest.fn().mockResolvedValue(null),
  getCurrentPrices: jest.fn().mockReturnValue({}), getNextStockBatch: jest.fn().mockReturnValue([]), getTotalStockCount: jest.fn(), refreshOpenPositionStockPrices: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/deepAnalysisService', () => ({ refreshFundamentalsForSymbol: jest.fn() }));
jest.mock('../src/services/stockScreener', () => ({ runDailyScreen: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/agents/debateEngine', () => ({ runInvestmentCommitteeDebate: jest.fn() }));
jest.mock('../src/services/regimeDetector', () => ({ detectMarketRegime: jest.fn() }));
jest.mock('../src/trading/executionEngine', () => ({ executeTradeSignal: jest.fn(), markToMarketOpenPositions: jest.fn().mockResolvedValue(undefined), reconcileExecutionIntents: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/trading/riskManager', () => ({ validateTradeSignal: jest.fn(), checkStopLosses: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/selfLearning', () => ({ runPostTradeAnalysis: jest.fn(), generateWeeklyReport: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn().mockResolvedValue({ positions: [], riskDataComplete: true }) }));
jest.mock('../src/services/cashFlowRisk', () => ({ recordPortfolioObservation: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/trading/positionExits', () => ({ reconcilePositionExits: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/journalGenerator', () => ({ generateDailyJournal: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/prisma', () => ({ prisma: { position: { findMany: jest.fn().mockResolvedValue([]) }, trade: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } } }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: jest.fn().mockReturnValue(false) }));
jest.mock('../src/trading/preDebateGate', () => ({ preDebateGate: jest.fn() }));
jest.mock('../src/services/polymarket', () => ({ scanPolymarketOpportunities: jest.fn(), placePolymarketBet: jest.fn(), pollPolymarketResolutions: jest.fn().mockResolvedValue(undefined), isPolymarketScanRunning: jest.fn().mockReturnValue(false) }));
jest.mock('../src/services/positionResearch', () => ({ reviewOpenPositions: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/trading/intradayEngine', () => ({ runIntradayScan: jest.fn(), manageIntradayExits: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/brokerSync', () => ({ syncBrokerPositions: jest.fn().mockResolvedValue({ imported: [], updated: [], closed: [], activityEvidence: 'RECENT_ACTIVITY_RETAINED_HISTORY_NOT_CERTIFIED' }) }));
jest.mock('../src/trading/killLiquidation', () => ({ liquidateCurrentAccount: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/polymarketEdge', () => ({ isEdgeScanRunning: jest.fn().mockReturnValue(false), runPolymarketEdgeScan: jest.fn().mockResolvedValue({}), processPaperOrders: jest.fn(), managePolymarketPositions: jest.fn(), resolvePolymarketPredictions: jest.fn(), logScorecardSummary: jest.fn() }));
jest.mock('../src/services/polymarketUS', () => ({ polymarketUSVenue: {} }));
jest.mock('../src/services/universeService', () => ({ universe: { swingCandidates: jest.fn().mockReturnValue([]) } }));

type Runtime = import('../src/jobs/schedulerRuntime').SchedulerRuntime;
let runtime: Runtime;
let schedule: jest.Mock;
let init: () => void;
const originalVenue = process.env.POLYMARKET_VENUE;
const originalInterval = process.env.POLYMARKET_SCAN_EVERY_MIN;
beforeEach(() => {
  jest.resetModules(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  process.env.POLYMARKET_VENUE = 'us'; process.env.POLYMARKET_SCAN_EVERY_MIN = '15';
  runtime = require('../src/jobs/schedulerRuntime').schedulerRuntime;
  schedule = require('node-cron').default.schedule;
  init = require('../src/jobs/scheduler').initScheduler;
});
afterEach(() => {
  jest.useRealTimers();
  if (originalVenue === undefined) delete process.env.POLYMARKET_VENUE; else process.env.POLYMARKET_VENUE = originalVenue;
  if (originalInterval === undefined) delete process.env.POLYMARKET_SCAN_EVERY_MIN; else process.env.POLYMARKET_SCAN_EVERY_MIN = originalInterval;
});
function callback(id: string): () => Promise<unknown> {
  const index = runtime.snapshot().jobs.findIndex(job => job.id === id);
  if (index < 0) throw new Error(`Missing fixture callback ${id}`);
  return schedule.mock.calls[index][1];
}
const last = (id: string) => runtime.snapshot().jobs.find(job => job.id === id)!;

test('registers original business schedules/timezones exactly once, without invoking them at boot', () => {
  init(); init();
  const expected: Array<[string, string, string?]> = [
    ['held_position_research', '* * * * *'], ['swing_market_open', '35 9 * * 1-5', 'America/New_York'],
    ['swing_late_morning', '0 11 * * 1-5', 'America/New_York'], ['swing_midday', '0 13 * * 1-5', 'America/New_York'],
    ['intraday_scan', '*/2 9-15 * * 1-5', 'America/New_York'], ['intraday_exits', '* 9-15 * * 1-5', 'America/New_York'],
    ['intraday_flatten', '50 15 * * 1-5', 'America/New_York'], ['broker_sync', '*/60 * * * * *'],
    ['crypto_daily', '0 8 * * *', 'America/New_York'], ['open_stock_prices', '*/60 * * * * *'], ['stop_loss_monitor', '*/10 * * * * *'],
    ['portfolio_snapshot', '*/5 * * * *'], ['market_regime', '0 * * * *'], ['daily_journal', '59 23 * * *'],
    ['weekly_report', '0 8 * * 0'], ['fundamentals_refresh', '0 2 * * *'], ['prediction_scan', '*/15 * * * *'],
    ['prediction_resolution', '*/30 * * * *'], ['prediction_paper_upkeep', '*/5 * * * *'], ['prediction_score_resolution', '17 * * * *'],
    ['prediction_scorecard', '0 9 * * *'], ['post_trade_learning', '*/2 * * * *'], ['mark_to_market', '*/5 * * * *'], ['ledger_integrity', '0 6 * * *'],
  ];
  expect(runtime.snapshot().jobs.map(job => [job.id, job.expression, job.timezone])).toEqual(expected.map(([id, expression, timezone]) => [id, expression, timezone ?? 'SYSTEM_DEFAULT']));
  expected.forEach(([, expression, timezone], index) => {
    expect(schedule.mock.calls[index][0]).toBe(expression);
    expect(schedule.mock.calls[index][2]).toEqual(timezone ? { timezone } : undefined);
  });
  expect(schedule).toHaveBeenCalledTimes(25);
  expect(runtime.snapshot()).toMatchObject({ lifecycle: 'registered', status: 'starting' });
  expect(runtime.snapshot().jobs.every(job => job.started === 0)).toBe(true);
  schedule.mock.calls[24][1](); expect(runtime.snapshot().observer.status).toBe('recent');
  expect(require('../src/trading/executionEngine').executeTradeSignal).not.toHaveBeenCalled();
});

test('partial initialization failure is truthful, propagates unchanged and never pretends online', () => {
  const error = new Error('fixture registration failure');
  schedule.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw error; });
  expect(init).toThrow(error);
  expect(runtime.snapshot()).toMatchObject({ lifecycle: 'failed', status: 'offline', initializationFailure: 'INIT_FAILED' });
  expect(schedule).toHaveBeenCalledTimes(2);
});

test('caught research/provider failure is observed while existing catch-and-continue semantics remain', async () => {
  init(); require('../src/services/positionResearch').reviewOpenPositions.mockRejectedValueOnce(new Error('secret provider text'));
  await expect(callback('held_position_research')()).resolves.toBeUndefined();
  expect(last('held_position_research')).toMatchObject({ lastOutcome: 'caught_failure', lastReason: 'CAUGHT_DEPENDENCY_FAILURE', failed: 1 });
  expect(JSON.stringify(runtime.snapshot())).not.toContain('secret');
  await callback('held_position_research')();
  expect(last('held_position_research')).toMatchObject({ lastOutcome: 'callback_returned', returned: 1, failed: 1 });
});

test('internally returned broker evidence failure differs from successfully retained recent activity', async () => {
  init(); await callback('broker_sync')();
  expect(last('broker_sync').lastOutcome).toBe('callback_returned');
  require('../src/services/brokerSync').syncBrokerPositions.mockResolvedValueOnce({ skipped: 'sensitive broker response' });
  await callback('broker_sync')();
  expect(last('broker_sync')).toMatchObject({ lastOutcome: 'caught_failure', lastReason: 'BROKER_EVIDENCE_UNAVAILABLE' });
});

test('stop monitor continues its later work after a caught reconciliation failure', async () => {
  init(); require('../src/trading/positionExits').reconcilePositionExits.mockRejectedValueOnce(new Error('fixture'));
  await callback('stop_loss_monitor')();
  expect(require('../src/trading/riskManager').checkStopLosses).toHaveBeenCalledTimes(1);
  expect(last('stop_loss_monitor').lastOutcome).toBe('caught_failure');
});

test('snapshot retains incomplete risk evidence without suppressing NAV recording', async () => {
  init(); require('../src/services/portfolio').getPortfolioState.mockResolvedValueOnce({ positions: [], riskDataComplete: false });
  await callback('portfolio_snapshot')();
  expect(require('../src/services/cashFlowRisk').recordPortfolioObservation).toHaveBeenCalledTimes(1);
  expect(last('portfolio_snapshot')).toMatchObject({ lastOutcome: 'caught_failure', lastReason: 'RISK_EVIDENCE_INCOMPLETE' });
});

test('prediction kill switch, overlapping scan and caught rejection are different observed outcomes', async () => {
  init(); const guard = require('../src/agents/orchestrator').isKillSwitchActive;
  const edge = require('../src/services/polymarketEdge'); guard.mockReturnValueOnce(true);
  await callback('prediction_scan')();
  expect(last('prediction_scan')).toMatchObject({ lastOutcome: 'skipped', lastReason: 'KILL_SWITCH_ACTIVE' });
  expect(edge.runPolymarketEdgeScan).not.toHaveBeenCalled();
  edge.isEdgeScanRunning.mockReturnValueOnce(true); await callback('prediction_scan')();
  expect(last('prediction_scan').lastReason).toBe('ALREADY_RUNNING');
  edge.runPolymarketEdgeScan.mockRejectedValueOnce(new Error('provider429?key=secret')); await callback('prediction_scan')();
  expect(last('prediction_scan').lastOutcome).toBe('caught_failure');
});

test('internally caught intraday error and stale/disabled last scan never imply a successful new scan', async () => {
  init(); const scan = require('../src/trading/intradayEngine').runIntradayScan;
  scan.mockResolvedValueOnce({ at: new Date().toISOString(), note: 'error: sensitive details' });
  await callback('intraday_scan')(); expect(last('intraday_scan').lastReason).toBe('INTRADAY_FAILED');
  scan.mockResolvedValueOnce({ at: '2026-10-16T12:00:00Z' });
  await callback('intraday_scan')(); expect(last('intraday_scan')).toMatchObject({ lastOutcome: 'skipped', lastReason: 'INTRADAY_NOT_RUN' });
});

test('missing snapshots in a crypto mini-batch are failures, with no invented orders or changed loop cap', async () => {
  init(); const pending = callback('crypto_daily')();
  await jest.runAllTimersAsync(); await pending;
  expect(last('crypto_daily')).toMatchObject({ lastOutcome: 'caught_failure', lastReason: 'NO_MARKET_SNAPSHOT' });
  expect(require('../src/trading/executionEngine').executeTradeSignal).not.toHaveBeenCalled();
});

test('international mode preserves dynamic prediction cadence and has no US-only callbacks', () => {
  process.env.POLYMARKET_VENUE = 'intl'; process.env.POLYMARKET_SCAN_EVERY_MIN = '20'; init();
  expect(last('prediction_scan').expression).toBe('*/20 * * * *');
  expect(runtime.snapshot().jobs).toHaveLength(21);
  expect(runtime.snapshot().jobs.some(job => job.id === 'prediction_paper_upkeep')).toBe(false);
});
