/** Describes the connected runtime, independently of live-money flags. */
export function getPolymarketRuntimeStatus() {
  return {
    mode: 'paper' as const,
    liveReadiness: {
      ready: false as const,
      code: 'runtime-not-connected' as const,
      reason: 'Live prediction trading is unavailable. Scheduled trades are simulated.',
    },
  };
}
