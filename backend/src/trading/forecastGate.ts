import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

/**
 * Forecast gate (AUDIT.md finding 3; 03-trading-quant.md §2.2).
 *
 * Before this gate, a recorded forecast could never stop a trade: Kronos fed
 * exactly one LLM agent as prose, and no execution/risk code compared order
 * direction to forecast direction. The gate closes that hole in the stock /
 * crypto execution path: before an order is placed, the latest unexpired
 * recorded forecast per source (Kronos, council) for the asset is checked,
 * and an entry whose side opposes any of them is blocked.
 *
 * Properties:
 *  - Controlled by FORECAST_GATE_ENABLED, default ON. Only an explicit
 *    false/0/off/no disables it.
 *  - "Unexpired" means created and not yet matured (maturesAt > now) — the
 *    same ForecastRecord rows the scorecard (services/forecastScorecard.ts)
 *    later scores, so a blocking forecast is always measurable evidence.
 *  - A trade's own council call is not independent evidence against itself:
 *    rows whose decisionId equals the signal's persisted AgentDecision are
 *    excluded. Other decisions' calls, and every Kronos forecast, count.
 *  - FLAT forecasts never block (they assert no direction to oppose).
 *  - Lookup failure (e.g. the ForecastRecord table not yet migrated) fails
 *    OPEN with a loud log: this gate guards against recorded opposing
 *    evidence, it is not a qualification gate, and an auxiliary table outage
 *    must not silently halt all trading. A found opposition, by contrast,
 *    is a hard block.
 */

const db = prisma as any;

export type ForecastGateTradeSide = 'BUY' | 'SELL';

export function isForecastGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.FORECAST_GATE_ENABLED;
  if (raw === undefined) return true;
  return !['false', '0', 'off', 'no'].includes(String(raw).trim().toLowerCase());
}

export function forecastOpposesTrade(forecastDirection: string, side: ForecastGateTradeSide): boolean {
  return (side === 'BUY' && forecastDirection === 'DOWN')
    || (side === 'SELL' && forecastDirection === 'UP');
}

export interface ForecastGateVerdict {
  allowed: boolean;
  reason: string;
  opposing?: Array<{ source: string; direction: string; createdAt: string; maturesAt: string }>;
}

/** Pure evaluation over ForecastRecord-shaped rows: latest unexpired row per
 * source wins; any opposition blocks. Exported for fixture tests. */
export function evaluateForecastGate(
  rows: any[],
  side: ForecastGateTradeSide,
  opts: { excludeDecisionId?: string | null; now?: number } = {},
): ForecastGateVerdict {
  const now = opts.now ?? Date.now();
  const latestBySource = new Map<string, any>();
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;
    if (opts.excludeDecisionId && row.decisionId && row.decisionId === opts.excludeDecisionId) continue;
    const created = new Date(row.createdAt).getTime();
    const matures = new Date(row.maturesAt).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(matures)) continue;
    if (created > now || matures <= now) continue; // future-dated or expired
    const prior = latestBySource.get(row.source);
    if (!prior || created > new Date(prior.createdAt).getTime()) latestBySource.set(row.source, row);
  }
  const opposing = [...latestBySource.values()]
    .filter(row => forecastOpposesTrade(row.direction, side))
    .map(row => ({
      source: String(row.source), direction: String(row.direction),
      createdAt: new Date(row.createdAt).toISOString(), maturesAt: new Date(row.maturesAt).toISOString(),
    }));
  if (opposing.length === 0) return { allowed: true, reason: 'No unexpired recorded forecast opposes this entry' };
  const first = opposing[0];
  return {
    allowed: false,
    reason: `FORECAST_GATE_OPPOSED: ${first.source} forecast ${first.direction} recorded ${first.createdAt} (matures ${first.maturesAt}) opposes ${side} entry`,
    opposing,
  };
}

export async function checkForecastGate(args: {
  asset: string;
  direction: string;
  decisionId?: string | null;
  now?: number;
}): Promise<ForecastGateVerdict> {
  if (!isForecastGateEnabled()) return { allowed: true, reason: 'FORECAST_GATE_DISABLED' };
  if (args.direction !== 'BUY' && args.direction !== 'SELL') {
    return { allowed: true, reason: 'Forecast gate applies to BUY/SELL entries only' };
  }
  const now = args.now ?? Date.now();
  let rows: any[] = [];
  try {
    if (typeof db.forecastRecord?.findMany !== 'function') {
      return { allowed: true, reason: 'No forecast records available to gate on' };
    }
    rows = await db.forecastRecord.findMany({
      where: { asset: args.asset, maturesAt: { gt: new Date(now) } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  } catch (err: any) {
    logger.error('forecast_gate_lookup_failed', { asset: args.asset, error: err?.message || 'unknown' });
    return { allowed: true, reason: 'FORECAST_GATE_LOOKUP_FAILED' };
  }
  const verdict = evaluateForecastGate(rows || [], args.direction, { excludeDecisionId: args.decisionId ?? null, now });
  if (!verdict.allowed) logger.warn('forecast_gate_blocked', { asset: args.asset, direction: args.direction, reason: verdict.reason });
  return verdict;
}
