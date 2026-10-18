import { randomUUID } from 'crypto';

// Diagnostic evidence only: no account data, market text, provider errors or
// execution authority. Retain at most the latest run and last completed run.
const categories = [
  'market_not_open', 'no_two_sided_quote', 'spread_too_wide', 'price_extreme',
  'resolution_near', 'event_in_progress', 'book_unavailable', 'book_not_open',
  'no_two_sided_book', 'low_open_interest', 'low_volume', 'insufficient_depth',
  'llm_budget_exhausted', 'already_held', 'reused_skip', 'model_unavailable',
  'stale_news', 'edge_below_costs', 'exposure_cap', 'position_cap', 'kelly_size_small',
  'venue_minimum', 'depth_share_limit', 'unfillable_size', 'slippage', 'kill_switch',
  'daily_loss_stop', 'paper_order_resting', 'paper_write_failed', 'placement_refused', 'other',
] as const;
type SkipCategory = typeof categories[number];
type Counts = { listed: number; candidates: number; estimated: number; reused: number; paperEntries: number };
type SummaryInput = { listed?: unknown; candidates?: unknown; estimated?: unknown; reused?: unknown;
  entries?: unknown; skips?: unknown; entriesBlocked?: unknown };
type Normalized = { counts: Counts; skipCounts: Record<SkipCategory, number>;
  entriesBlocked: SkipCategory | null; truncated: boolean };
export type ScanRunEvidence = Normalized & { runId: string; status: 'running' | 'completed' | 'failed';
  startedAt: string; finishedAt: string | null; failureCode: 'scan-failed' | null };

const exactReasons = new Map<string, SkipCategory>([
  ['market not open', 'market_not_open'], ['no two-sided quote', 'no_two_sided_quote'],
  ['spread too wide', 'spread_too_wide'], ['price too close to 0/1', 'price_extreme'],
  ['price too close to #/#', 'price_extreme'],
  ['too close to resolution', 'resolution_near'], ['event already in progress', 'event_in_progress'],
  ['no book', 'book_unavailable'], ['no two-sided book', 'no_two_sided_book'],
  ['open interest too low', 'low_open_interest'], ['volume too low', 'low_volume'],
  ['book too thin', 'insufficient_depth'], ['LLM budget for this scan used', 'llm_budget_exhausted'],
  ['already holding (re-estimated for exits)', 'already_held'], ['reused SKIP decision', 'reused_skip'],
  ['no LLM estimate (no edge without evidence)', 'model_unavailable'],
  ['near resolution with stale/no news', 'stale_news'],
  ['edge below fees + half-spread + min edge', 'edge_below_costs'],
  ['exposure cap reached (event/category/total)', 'exposure_cap'], ['Kelly size below $1', 'kelly_size_small'],
  ['Kelly size below $#', 'kelly_size_small'], ['size below venue minimum', 'venue_minimum'],
  ['book cannot fill the size', 'unfillable_size'], ['edge gone after slippage', 'slippage'],
  ['kill switch active', 'kill_switch'], ['paper order already resting on this market', 'paper_order_resting'],
  ['trade write failed', 'paper_write_failed'], ['order write failed', 'paper_write_failed'],
  ['placement refused', 'placement_refused'], ['already holding an open bet on this market', 'already_held'],
]);

function category(reason: unknown): SkipCategory {
  if (typeof reason !== 'string' || reason.length > 256) return 'other';
  const exact = exactReasons.get(reason);
  if (exact) return exact;
  if (/^spread [\d.#]+pt > max$/.test(reason)) return 'spread_too_wide';
  if (reason.startsWith('book state ')) return 'book_not_open';
  if (reason.startsWith('daily loss stop hit (')) return 'daily_loss_stop';
  if (reason.startsWith('at POLYMARKET_MAX_OPEN')) return 'position_cap';
  if (reason.startsWith('would exceed POLYMARKET_MAX_TOTAL_EXPOSURE_USD')) return 'exposure_cap';
  if (/^size [\d#]+ > [\d#]+% of usable depth \([\d#]+\)$/.test(reason)) return 'depth_share_limit';
  return 'other';
}

export function normalizeScanSummary(input: SummaryInput = {}): Normalized {
  let truncated = false;
  const count = (value: unknown): number => {
    if (value === undefined) return 0;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) { truncated = true; return 0; }
    if (!Number.isSafeInteger(value) || value > 1_000_000) truncated = true;
    return Math.min(1_000_000, Math.floor(value));
  };
  const counts = { listed: count(input.listed), candidates: count(input.candidates), estimated: count(input.estimated),
    reused: count(input.reused), paperEntries: count(input.entries) };
  const skipCounts = Object.fromEntries(categories.map(key => [key, 0])) as Record<SkipCategory, number>;
  if (input.skips && typeof input.skips === 'object' && !Array.isArray(input.skips)) {
    let visited = 0;
    for (const reason in input.skips) {
      if (!Object.prototype.hasOwnProperty.call(input.skips, reason)) continue;
      if (++visited > 128) { truncated = true; break; }
      const key = category(reason);
      const sum = skipCounts[key] + count((input.skips as Record<string, unknown>)[reason]);
      if (sum > 1_000_000) truncated = true;
      skipCounts[key] = Math.min(1_000_000, sum);
    }
  } else if (input.skips != null) truncated = true;
  const entriesBlocked = input.entriesBlocked == null ? null : category(input.entriesBlocked);
  return { counts, skipCounts, entriesBlocked, truncated };
}

function copy(run: ScanRunEvidence | null): ScanRunEvidence | null {
  return run ? { ...run, counts: { ...run.counts }, skipCounts: { ...run.skipCounts } } : null;
}

export function createPolymarketScanEvidence() {
  const processInstanceId = randomUUID();
  const processStartedAt = new Date().toISOString();
  let latestRun: ScanRunEvidence | null = null;
  let lastCompleted: ScanRunEvidence | null = null;
  return {
    start(): string | null {
      if (latestRun?.status === 'running') return null;
      const runId = randomUUID();
      latestRun = { runId, status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
        failureCode: null, ...normalizeScanSummary() };
      return runId;
    },
    finish(runId: string | null, status: 'completed' | 'failed', summary: SummaryInput): ScanRunEvidence | null {
      if (!runId || latestRun?.runId !== runId || latestRun.status !== 'running') return null;
      latestRun = { runId, status, startedAt: latestRun.startedAt,
        finishedAt: new Date(Math.max(Date.now(), Date.parse(latestRun.startedAt))).toISOString(),
        failureCode: status === 'failed' ? 'scan-failed' : null, ...normalizeScanSummary(summary) };
      if (status === 'completed') lastCompleted = copy(latestRun);
      return copy(latestRun);
    },
    read() {
      return { schemaVersion: 1 as const, scope: 'process-local' as const, processInstanceId, processStartedAt,
        previousProcessHistoryAvailable: false as const, latestRun: copy(latestRun), lastCompleted: copy(lastCompleted) };
    },
  };
}

export const polymarketScanEvidence = createPolymarketScanEvidence();
export const getPolymarketScanEvidence = () => polymarketScanEvidence.read();
