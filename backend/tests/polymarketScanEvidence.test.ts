import { createPolymarketScanEvidence, normalizeScanSummary } from '../src/services/polymarketScanEvidence';

const summary = { listed: 200, candidates: 15, estimated: 0, reused: 5, entries: 0,
  skips: { 'no LLM estimate (no edge without evidence)': 4, 'LLM budget for this scan used': 6,
    'reused SKIP decision': 5, 'spread #pt > max': 185 } };

test('new process has no scan history and completion is not execution readiness', () => {
  const evidence = createPolymarketScanEvidence();
  expect(evidence.read()).toMatchObject({ scope: 'process-local', previousProcessHistoryAvailable: false, latestRun: null, lastCompleted: null });
  const id = evidence.start()!;
  expect(evidence.read().latestRun).toMatchObject({ runId: id, status: 'running', finishedAt: null });
  evidence.finish(id, 'completed', summary);
  expect(evidence.read().latestRun).toMatchObject({ status: 'completed', counts: {
    listed: 200, candidates: 15, estimated: 0, reused: 5, paperEntries: 0,
  }, skipCounts: { model_unavailable: 4, llm_budget_exhausted: 6, reused_skip: 5, spread_too_wide: 185 } });
  expect(evidence.read().lastCompleted).toEqual(evidence.read().latestRun);
  expect(createPolymarketScanEvidence().read()).toMatchObject({ latestRun: null, lastCompleted: null });
});

test('concurrent starts and stale finishes cannot replace active evidence', () => {
  const evidence = createPolymarketScanEvidence();
  const first = evidence.start()!;
  expect(evidence.start()).toBeNull();
  evidence.finish('unknown', 'failed', summary);
  expect(evidence.read().latestRun).toMatchObject({ runId: first, status: 'running' });
  evidence.finish(first, 'completed', summary);
  const second = evidence.start()!;
  evidence.finish(first, 'failed', summary);
  expect(evidence.read().latestRun).toMatchObject({ runId: second, status: 'running' });
});

test('failure retains the previous completed scan separately without leaking an error', () => {
  const evidence = createPolymarketScanEvidence();
  const first = evidence.start()!;
  evidence.finish(first, 'completed', summary);
  const second = evidence.start()!;
  evidence.finish(second, 'failed', { listed: 2, skips: { 'provider secret and market question': 1 } });
  const readback = evidence.read();
  expect(readback.latestRun).toMatchObject({ status: 'failed', failureCode: 'scan-failed', counts: { listed: 2 } });
  expect(readback.lastCompleted).toMatchObject({ runId: first, status: 'completed' });
  expect(JSON.stringify(readback)).not.toMatch(/secret|question/);
});

test('readback owns its nested data and cannot mutate stored counts', () => {
  const evidence = createPolymarketScanEvidence();
  evidence.finish(evidence.start()!, 'completed', summary);
  const result = evidence.read();
  result.latestRun!.counts.listed = 1;
  result.latestRun!.skipCounts.other = 999;
  result.lastCompleted!.counts.listed = 3;
  expect(evidence.read().latestRun!.counts.listed).toBe(200);
  expect(evidence.read().lastCompleted!.counts.listed).toBe(200);
  expect(evidence.read().latestRun!.skipCounts.other).toBe(0);
});

test('numeric and category bounds are explicit and raw strings never become keys', () => {
  const skips: Record<string, number> = { 'book state SECRET_TOKEN': 3, 'secret raw error': 2,
    'daily loss stop hit ($-999.00 ≤ -$10)': 1 };
  for (let i = 0; i < 200; i++) skips[`untrusted ${i}`] = 1;
  const normalized = normalizeScanSummary({ listed: Infinity, candidates: -1, estimated: 1.5,
    reused: 2_000_000, entries: NaN, entriesBlocked: 'secret error', skips });
  expect(normalized.counts).toEqual({ listed: 0, candidates: 0, estimated: 1, reused: 1_000_000, paperEntries: 0 });
  expect(normalized.truncated).toBe(true);
  expect(normalized.entriesBlocked).toBe('other');
  expect(normalized.skipCounts.book_not_open).toBe(3);
  expect(Object.keys(normalized.skipCounts).length).toBeLessThan(40);
  expect(JSON.stringify(normalized)).not.toMatch(/SECRET|secret|untrusted|999\.00/);
});

test.each([
  ['kill switch active', 'kill_switch'],
  ['daily loss stop hit ($-12.00 ≤ -$10)', 'daily_loss_stop'],
  ['at POLYMARKET_MAX_OPEN (10/10)', 'position_cap'],
  ['size 123 > 20% of usable depth (44)', 'depth_share_limit'],
  ['would exceed POLYMARKET_MAX_TOTAL_EXPOSURE_USD ($99 > $10)', 'exposure_cap'],
])('normalizes %s to a fixed category', (reason, category) => {
  expect(normalizeScanSummary({ entriesBlocked: reason }).entriesBlocked).toBe(category);
});
