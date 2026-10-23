import { getPolymarketScanEvidence } from './polymarketScanEvidence';
import { polymarketLiveAllowed, liveTradingConfirmed } from '../trading/liveGate';

/** Describes the connected runtime, independently of live-money flags. */
export function getPolymarketRuntimeStatus() {
  const liveGate = liveTradingConfirmed(process.env);
  let polymarketGate = { allowed: false, reason: 'Not checked' };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const killSwitchActive: boolean = require('../agents/orchestrator').isKillSwitchActive();
    polymarketGate = polymarketLiveAllowed(process.env, killSwitchActive);
  } catch {
    polymarketGate = polymarketLiveAllowed(process.env, true);
  }

  const mode = polymarketGate.allowed ? ('live' as const) : ('paper' as const);

  if (polymarketGate.allowed) {
    return {
      mode,
      scanEvidence: getPolymarketScanEvidence(),
      liveReadiness: {
        ready: true as const,
        code: 'live-ready' as const,
        reason: 'Live prediction trading is active.',
      },
    };
  }

  // Determine the most helpful reason code
  let code: string;
  if (!liveGate.allowed) {
    code = liveGate.reason.includes('LIVE_TRADING_CONFIRMED')
      ? 'missing-live-confirmation'
      : 'trading-mode-not-live';
  } else {
    code = polymarketGate.reason.includes('kill switch')
      ? 'kill-switch-active'
      : polymarketGate.reason.includes('POLYMARKET_US_LIVE')
      ? 'polymarket-us-live-not-set'
      : 'runtime-not-connected';
  }

  return {
    mode,
    scanEvidence: getPolymarketScanEvidence(),
    liveReadiness: {
      ready: false as const,
      code,
      reason: polymarketGate.reason,
    },
  };
}
