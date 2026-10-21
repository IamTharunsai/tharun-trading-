// Real scheduler registration/wrappers with every business I/O dependency mocked.
// No listeners, broker clients, provider network, timers or orders are started.
jest.mock('node-cron', () => ({ __esModule: true, default: { schedule: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/services/marketData', () => ({ CRYPTO_ASSETS: Array.from({ length: 15 }, (_, i) => `C${String(i).padStart(2, '0')}`), buildMarketSnapshot: jest.fn().mockResolvedValue(null),
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
jest.mock('../src/trading/predictionRecovery', () => ({ recoverPredictionOrders: jest.fn().mockResolvedValue({ outcome: 'NO_PENDING_ORDERS', unresolved: 0 }) }));
jest.mock('../src/services/universeService', () => ({ universe: { swingCandidates: jest.fn().mockReturnValue([]) } }));
jest.mock('../src/services/sentimentService', () => ({ isSentimentEnabled: () => false }));
jest.mock('../src/trading/accountScope', () => ({ getVerifiedAccountScope: jest.fn().mockResolvedValue({
  accountId: 'scope-fixture', mode: 'paper', broker: { listTradableCryptoAssetsVerified: jest.fn().mockResolvedValue(
    Array.from({ length: 15 }, (_, i) => `C${String(i).padStart(2, '0')}`)) },
}) }));

type Runtime = import('../src/jobs/schedulerRuntime').SchedulerRuntime;
let runtime: Runtime;
let schedule: jest.Mock;
let init: () => void;
const originalVenue = process.env.POLYMARKET_VENUE;
const originalInterval = process.env.POLYMARKET_SCAN_EVERY_MIN;
const originalCryptoCadence = process.env.CRYPTO_SCAN_EVERY_MIN;
const originalCryptoLimit = process.env.CRYPTO_DEBATES_PER_SCAN;
beforeEach(() => {
  jest.resetModules(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  process.env.POLYMARKET_VENUE = 'us'; process.env.POLYMARKET_SCAN_EVERY_MIN = '15';
  delete process.env.CRYPTO_SCAN_EVERY_MIN; delete process.env.CRYPTO_DEBATES_PER_SCAN;
  runtime = require('../src/jobs/schedulerRuntime').schedulerRuntime;
  schedule = require('node-cron').default.schedule;
  init = require('../src/jobs/scheduler').initScheduler;
});
afterEach(() => {
  jest.useRealTimers();
  if (originalVenue === undefined) delete process.env.POLYMARKET_VENUE; else process.env.POLYMARKET_VENUE = originalVenue;
  if (originalInterval === undefined) delete process.env.POLYMARKET_SCAN_EVERY_MIN; else process.env.POLYMARKET_SCAN_EVERY_MIN = originalInterval;
  if (originalCryptoCadence === undefined) delete process.env.CRYPTO_SCAN_EVERY_MIN; else process.env.CRYPTO_SCAN_EVERY_MIN = originalCryptoCadence;
  if (originalCryptoLimit === undefined) delete process.env.CRYPTO_DEBATES_PER_SCAN; else process.env.CRYPTO_DEBATES_PER_SCAN = originalCryptoLimit;
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
    ['prediction_order_recovery', '*/30 * * * * *'],
    ['held_position_research', '* * * * *'], ['swing_market_open', '35 9 * * 1-5', 'America/New_York'],
    ['swing_late_morning', '0 11 * * 1-5', 'America/New_York'], ['swing_midday', '0 13 * * 1-5', 'America/New_York'],
    ['intraday_scan', '*/2 9-15 * * 1-5', 'America/New_York'], ['intraday_exits', '* 9-15 * * 1-5', 'America/New_York'],
    ['intraday_flatten', '50 15 * * 1-5', 'America/New_York'], ['broker_sync', '*/60 * * * * *'],
    ['crypto_scan', '* * * * *'], ['open_stock_prices', '*/60 * * * * *'], ['stop_loss_monitor', '*/10 * * * * *'],
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
  expect(schedule).toHaveBeenCalledTimes(26);
  expect(runtime.snapshot()).toMatchObject({ lifecycle: 'registered', status: 'starting' });
  expect(runtime.snapshot().jobs.every(job => job.started === 0)).toBe(true);
  schedule.mock.calls[25][1](); expect(runtime.snapshot().observer.status).toBe('recent');
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

test('missing crypto snapshots are failures, with no invented orders and at most two sequential attempts', async () => {
  init(); await callback('crypto_scan')();
  expect(last('crypto_scan')).toMatchObject({ lastOutcome: 'caught_failure', lastReason: 'NO_MARKET_SNAPSHOT' });
  expect(require('../src/services/marketData').buildMarketSnapshot.mock.calls.map(([asset]: string[]) => asset)).toEqual(['C00', 'C01']);
  expect(require('../src/trading/executionEngine').executeTradeSignal).not.toHaveBeenCalled();
});

test('weekend crypto cadence rotates beyond the former first ten, including after candidate errors', async () => {
  jest.setSystemTime(new Date('2026-10-18T02:00:00Z')); init();
  const snapshot = require('../src/services/marketData').buildMarketSnapshot;
  snapshot.mockRejectedValueOnce(new Error('private-provider-error'));
  for (let i = 0; i < 8; i++) { await callback('crypto_scan')(); await jest.advanceTimersByTimeAsync(15 * 60000); }
  expect(snapshot.mock.calls.map(([asset]: string[]) => asset)).toEqual([
    ...Array.from({ length: 15 }, (_, i) => `C${String(i).padStart(2, '0')}`), 'C00',
  ]);
  expect(require('../src/trading/executionEngine').executeTradeSignal).not.toHaveBeenCalled();
});

test('overlapping crypto callbacks cannot duplicate even the first account read; lock releases after failure', async () => {
  init(); const read = require('../src/trading/accountScope').getVerifiedAccountScope;
  let reject!: (error: Error) => void;
  read.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const first = callback('crypto_scan')(); await callback('crypto_scan')();
  expect(read).toHaveBeenCalledTimes(1); expect(last('crypto_scan').lastReason).toBe('ALREADY_RUNNING');
  reject(new Error('secret-account-response')); await first;
  expect(last('crypto_scan').lastReason).toBe('BROKER_EVIDENCE_UNAVAILABLE');
  await jest.advanceTimersByTimeAsync(15 * 60000); await callback('crypto_scan')();
  expect(require('../src/services/marketData').buildMarketSnapshot).toHaveBeenCalledTimes(2);
});

test('crypto candidates are sequential and a slow first snapshot cannot start a second provider pipeline', async () => {
  init(); const snapshot = require('../src/services/marketData').buildMarketSnapshot;
  let release!: (value: null) => void; let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  snapshot.mockImplementationOnce(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const pending = callback('crypto_scan')(); await entered;
  expect(snapshot).toHaveBeenCalledTimes(1);
  release(null); await pending; expect(snapshot).toHaveBeenCalledTimes(2);
});

test('cadence supports seven-minute intervals, suppresses early ticks and rejects malformed config before reads', async () => {
  process.env.CRYPTO_SCAN_EVERY_MIN = '7'; process.env.CRYPTO_DEBATES_PER_SCAN = '1'; init();
  const read = require('../src/trading/accountScope').getVerifiedAccountScope;
  await callback('crypto_scan')(); const calls = read.mock.calls.length;
  await jest.advanceTimersByTimeAsync(6 * 60000); await callback('crypto_scan')();
  expect(read).toHaveBeenCalledTimes(calls); expect(last('crypto_scan').lastReason).toBe('CRYPTO_SCAN_NOT_DUE');
  await jest.advanceTimersByTimeAsync(60000); await callback('crypto_scan')();
  expect(require('../src/services/marketData').buildMarketSnapshot.mock.calls.map(([asset]: string[]) => asset)).toEqual(['C00', 'C01']);
  process.env.CRYPTO_DEBATES_PER_SCAN = '100'; await callback('crypto_scan')();
  expect(last('crypto_scan').lastReason).toBe('CRYPTO_SCAN_CONFIG_INVALID');
});

test('kill switch prevents all crypto I/O and a mid-read kill prevents candidate dispatch', async () => {
  init(); const killed = require('../src/agents/orchestrator').isKillSwitchActive;
  const read = require('../src/trading/accountScope').getVerifiedAccountScope;
  killed.mockReturnValue(true); await callback('crypto_scan')(); expect(read).not.toHaveBeenCalled();
  killed.mockReturnValue(false); const scope = await read(); read.mockClear();
  scope.broker.listTradableCryptoAssetsVerified.mockImplementationOnce(async () => { killed.mockReturnValue(true); return ['C00']; });
  await callback('crypto_scan')();
  expect(require('../src/services/marketData').buildMarketSnapshot).not.toHaveBeenCalled();
  expect(last('crypto_scan').lastReason).toBe('KILL_SWITCH_ACTIVE');
});

test('missing broker instruments never fall back to the static data universe', async () => {
  init(); const read = require('../src/trading/accountScope').getVerifiedAccountScope; const scope = await read();
  scope.broker.listTradableCryptoAssetsVerified.mockResolvedValueOnce(['UNSUPPORTED_DATA_ASSET']);
  await callback('crypto_scan')();
  expect(last('crypto_scan').lastReason).toBe('NO_CANDIDATES');
  expect(require('../src/services/marketData').buildMarketSnapshot).not.toHaveBeenCalled();
});

test.each(['account', 'mode', 'broker'])('%s switch aborts the old tick and resets rotation for the next scope', async changed => {
  init(); const read = require('../src/trading/accountScope').getVerifiedAccountScope; const old = await read(); read.mockClear();
  const next = { ...old,
    ...(changed === 'account' ? { accountId: 'another-fixture' } : {}),
    ...(changed === 'mode' ? { mode: 'live' } : {}),
    ...(changed === 'broker' ? { broker: { listTradableCryptoAssetsVerified: jest.fn().mockResolvedValue(['C00', 'C01']) } } : {}),
  };
  read.mockResolvedValueOnce(old).mockResolvedValueOnce(old).mockResolvedValue(next);
  await callback('crypto_scan')();
  const snapshot = require('../src/services/marketData').buildMarketSnapshot;
  expect(snapshot.mock.calls.map(([asset]: string[]) => asset)).toEqual(['C00']);
  expect(last('crypto_scan').lastReason).toBe('ACCOUNT_SCOPE_CHANGED');
  await jest.advanceTimersByTimeAsync(15 * 60000); await callback('crypto_scan')();
  expect(snapshot.mock.calls.map(([asset]: string[]) => asset)).toEqual(['C00', 'C00', 'C01']);
});

test('actual crypto callback reaches shared committee and real unknown-risk gate blocks execution', async () => {
  init(); const snapshot = require('../src/services/marketData').buildMarketSnapshot;
  snapshot.mockImplementation(async (asset: string) => ({ asset, market: 'crypto', price: 100,
    indicators: { bollingerBands: { upper: 110, lower: 90, middle: 100 }, macd: {} } }));
  require('../src/trading/preDebateGate').preDebateGate.mockReturnValue({ pass: true });
  require('../src/services/regimeDetector').detectMarketRegime.mockResolvedValue({ regime: 'TRENDING_BULL' });
  const council = require('../src/agents/debateEngine').runInvestmentCommitteeDebate;
  council.mockImplementation(async () => ({ executionApproved: true, finalDecision: 'BUY', decisionId: 'fixture-decision',
    finalConfidence: 80, positionSizePct: 1, stopLossPrice: 95, takeProfitPrice: 110, masterSynthesis: 'fixture', agentVotes: [] }));
  require('../src/services/portfolio').getPortfolioState.mockResolvedValue({ accountId: 'scope-fixture', brokerMode: 'paper', positions: [], totalValue: 100000, riskDataComplete: false });
  const risk = require('../src/trading/riskManager').validateTradeSignal;
  risk.mockImplementation(jest.requireActual('../src/trading/riskManager').validateTradeSignal);
  await callback('crypto_scan')();
  expect(council).toHaveBeenCalledTimes(2); expect(risk).toHaveBeenCalledTimes(2);
  expect(await risk.mock.results[0].value).toMatchObject({ approved: false, reason: expect.stringContaining('RISK_BASELINE_UNAVAILABLE') });
  expect(require('../src/trading/executionEngine').executeTradeSignal).not.toHaveBeenCalled();
});

test('a shared-path execution stops this tick, advances rotation, and never becomes an extra entry next tick', async () => {
  init(); const snapshot = require('../src/services/marketData').buildMarketSnapshot;
  snapshot.mockImplementation(async (asset: string) => ({ asset, market: 'crypto', price: 100,
    indicators: { bollingerBands: { upper: 110, lower: 90, middle: 100 }, macd: {} } }));
  require('../src/trading/preDebateGate').preDebateGate.mockReturnValue({ pass: true });
  require('../src/services/regimeDetector').detectMarketRegime.mockResolvedValue({ regime: 'TRENDING_BULL' });
  require('../src/agents/debateEngine').runInvestmentCommitteeDebate.mockImplementation(async () => ({
    executionApproved: true, finalDecision: 'BUY', decisionId: 'fixture-decision', finalConfidence: 80,
    positionSizePct: 1, stopLossPrice: 95, takeProfitPrice: 110, masterSynthesis: 'fixture', agentVotes: [],
  }));
  require('../src/trading/riskManager').validateTradeSignal.mockResolvedValue({ approved: true, adjustedSize: 1 });
  const execute = require('../src/trading/executionEngine').executeTradeSignal; execute.mockResolvedValue(true);
  await callback('crypto_scan')(); expect(execute).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(15 * 60000); await callback('crypto_scan')();
  expect(execute).toHaveBeenCalledTimes(2);
  expect(snapshot.mock.calls.map(([asset]: string[]) => asset)).toEqual(['C00', 'C01']);
  expect(execute.mock.calls.every(([signal]: any[]) => signal.market === 'crypto' && signal.agentDecisionId === 'fixture-decision')).toBe(true);
});

test('international mode preserves dynamic prediction cadence and has no US-only callbacks', () => {
  process.env.POLYMARKET_VENUE = 'intl'; process.env.POLYMARKET_SCAN_EVERY_MIN = '20'; init();
  expect(last('prediction_scan').expression).toBe('*/20 * * * *');
  expect(runtime.snapshot().jobs).toHaveLength(22);
  expect(runtime.snapshot().jobs.some(job => job.id === 'prediction_paper_upkeep')).toBe(false);
});

test('prediction recovery stays registered in international mode and runs while ENTRY is killed', async () => {
  process.env.POLYMARKET_VENUE = 'intl'; init();
  require('../src/agents/orchestrator').isKillSwitchActive.mockReturnValue(true);
  await callback('prediction_order_recovery')();
  const recovery = require('../src/trading/predictionRecovery').recoverPredictionOrders;
  expect(recovery).toHaveBeenCalledTimes(1);
  expect(last('prediction_order_recovery').lastOutcome).toBe('callback_returned');
  recovery.mockResolvedValueOnce({ outcome: 'RECOVERY_INCOMPLETE', unresolved: 1 });
  await callback('prediction_order_recovery')();
  expect(last('prediction_order_recovery').lastReason).toBe('BROKER_RECONCILIATION_INCOMPLETE');
});
