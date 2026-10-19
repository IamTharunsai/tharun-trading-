import { getPolymarketScanEvidence } from './polymarketScanEvidence';

/** Describes the connected runtime, independently of live-money flags. */
export function getPolymarketRuntimeStatus() {
  return {
    mode: 'paper' as const,
    scanEvidence: getPolymarketScanEvidence(),
    liveReadiness: {
      ready: false as const,
      code: 'runtime-not-connected' as const,
      reason: 'Live prediction trading is unavailable. Scheduled trades are simulated.',
    },
  };
}
