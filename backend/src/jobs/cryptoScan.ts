import type { AccountScope } from '../trading/accountScope';
import type { SchedulerReason } from './schedulerRuntime';

type Dependencies = {
  scope: () => Promise<AccountScope>;
  killed: () => boolean;
  supportedAssets: readonly string[];
  debate: (asset: string, expectedScope: AccountScope) => Promise<{ tradeExecuted?: boolean } | null | undefined>;
  skip: (reason: SchedulerReason) => void;
  failure: (reason: SchedulerReason) => void;
  observe: (counts: { eligible: number; attempted: number; failed: number; executed: number }) => void;
  now?: () => number;
  env?: () => { CRYPTO_SCAN_EVERY_MIN?: string; CRYPTO_DEBATES_PER_SCAN?: string };
};

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}
const sameScope = (a: AccountScope, b: AccountScope) => a.accountId === b.accountId && a.mode === b.mode && a.broker === b.broker;

/** One current-process scanner. No I/O at construction; no cross-process lease
 * or claim that a completed callback means a qualified/submitted/filled order. */
export function createContinuousCryptoScan(deps: Dependencies): () => Promise<void> {
  let running = false;
  let lastStartedAt: number | null = null;
  let rotationScope: AccountScope | null = null;
  let lastAsset: string | null = null;
  const supported = new Set(deps.supportedAssets);
  const now = deps.now ?? Date.now;
  return async () => {
    if (running) { deps.skip('ALREADY_RUNNING'); return; }
    if (deps.killed()) { deps.skip('KILL_SWITCH_ACTIVE'); return; }
    const env = deps.env?.() ?? process.env;
    const cadence = boundedInteger(env.CRYPTO_SCAN_EVERY_MIN, 15, 5, 60);
    const limit = boundedInteger(env.CRYPTO_DEBATES_PER_SCAN, 2, 1, 5);
    if (cadence === null || limit === null) { deps.failure('CRYPTO_SCAN_CONFIG_INVALID'); return; }
    const startedAt = now();
    if (lastStartedAt !== null && startedAt >= lastStartedAt && startedAt - lastStartedAt < cadence * 60000) {
      deps.skip('CRYPTO_SCAN_NOT_DUE'); return;
    }
    running = true; lastStartedAt = startedAt;
    const counts = { eligible: 0, attempted: 0, failed: 0, executed: 0 };
    try {
      const scope = await deps.scope();
      if (!rotationScope || !sameScope(rotationScope, scope)) { rotationScope = scope; lastAsset = null; }
      const reported = await scope.broker.listTradableCryptoAssetsVerified();
      const assets = [...new Set(reported.filter(asset => supported.has(asset)))].sort();
      counts.eligible = assets.length;
      if (!assets.length) { deps.skip('NO_CANDIDATES'); return; }
      const successor = lastAsset === null ? 0 : assets.findIndex(asset => asset > lastAsset!);
      const start = successor < 0 ? 0 : successor;
      for (let i = 0; i < Math.min(limit, assets.length); i++) {
        if (deps.killed()) { deps.skip('KILL_SWITCH_ACTIVE'); break; }
        const current = await deps.scope();
        if (!sameScope(scope, current)) {
          rotationScope = null; lastAsset = null;
          deps.skip('ACCOUNT_SCOPE_CHANGED'); break;
        }
        if (deps.killed()) { deps.skip('KILL_SWITCH_ACTIVE'); break; }
        const asset = assets[(start + i) % assets.length];
        lastAsset = asset; // HOLD, failure and a trade all advance fair rotation.
        counts.attempted++;
        try {
          const transcript = await deps.debate(asset, scope);
          if (transcript?.tradeExecuted === true) { counts.executed++; break; }
        } catch { counts.failed++; deps.failure('CAUGHT_DEPENDENCY_FAILURE'); }
      }
    } catch { deps.failure('BROKER_EVIDENCE_UNAVAILABLE'); }
    finally {
      running = false;
      try { deps.observe(counts); } catch { /* observation cannot change admission */ }
    }
  };
}
