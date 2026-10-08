// ── LIVE-MONEY GATE ───────────────────────────────────────────────────────────
// The ONE place that decides whether any code path may touch real money.
//
// Before this existed, executionEngine read the raw TRADING_MODE env var and
// ALPACA_API_KEY (skipping the LIVE_TRADING_CONFIRMED phrase), and the
// Polymarket scanner / Money Greed agent went live on POLYMARKET_US_LIVE=true
// (or merely on a key being present) alone.
//
// Rules (fail-closed, read at call time so a changed env is honoured):
//   • Live trading of ANY kind requires TRADING_MODE=live AND
//     LIVE_TRADING_CONFIRMED=I_ACCEPT_REAL_MONEY_RISK.
//   • Alpaca live additionally requires ALPACA_LIVE_API_KEY/SECRET.
//   • Polymarket live additionally requires POLYMARKET_US_LIVE=true and the
//     kill switch being off. POLYMARKET_US_LIVE on its own is never enough.
//   • Anything else → paper.
import { isPlaceholderKey } from '../utils/apiKeys';

export const LIVE_CONFIRM_PHRASE = 'I_ACCEPT_REAL_MONEY_RISK';

export type TradingMode = 'paper' | 'live';

export interface GateDecision {
  allowed: boolean;
  reason: string;
}

function clean(val: string | undefined): string {
  if (val === undefined || val === null) return '';
  return String(val).split('#')[0].trim().replace(/^["']|["']$/g, '');
}

/** TRADING_MODE=live AND the exact confirmation phrase. Venue-independent. */
export function liveTradingConfirmed(env: NodeJS.ProcessEnv = process.env): GateDecision {
  if (clean(env.TRADING_MODE).toLowerCase() !== 'live') {
    return { allowed: false, reason: 'TRADING_MODE is not "live"' };
  }
  if (clean(env.LIVE_TRADING_CONFIRMED) !== LIVE_CONFIRM_PHRASE) {
    return { allowed: false, reason: `LIVE_TRADING_CONFIRMED is not set to ${LIVE_CONFIRM_PHRASE}` };
  }
  return { allowed: true, reason: 'live trading confirmed' };
}

/** Alpaca live = confirmed live mode + real ALPACA_LIVE_* keys. */
export function alpacaLiveAllowed(env: NodeJS.ProcessEnv = process.env): GateDecision {
  const base = liveTradingConfirmed(env);
  if (!base.allowed) return base;
  const key = clean(env.ALPACA_LIVE_API_KEY);
  const secret = clean(env.ALPACA_LIVE_SECRET_KEY);
  if (isPlaceholderKey(key) || isPlaceholderKey(secret)) {
    return { allowed: false, reason: 'ALPACA_LIVE_API_KEY / ALPACA_LIVE_SECRET_KEY missing' };
  }
  return { allowed: true, reason: 'Alpaca live allowed' };
}

export function getAlpacaMode(env: NodeJS.ProcessEnv = process.env): TradingMode {
  return alpacaLiveAllowed(env).allowed ? 'live' : 'paper';
}

/**
 * Polymarket live = confirmed live mode + POLYMARKET_US_LIVE=true + kill switch off.
 * killSwitchActive is injected so this module has no DB/orchestrator imports.
 */
export function polymarketLiveAllowed(
  env: NodeJS.ProcessEnv = process.env,
  killSwitchActive?: boolean,
): GateDecision {
  const base = liveTradingConfirmed(env);
  if (!base.allowed) return { allowed: false, reason: `Polymarket live blocked: ${base.reason}` };
  if (clean(env.POLYMARKET_US_LIVE).toLowerCase() !== 'true') {
    return { allowed: false, reason: 'Polymarket live blocked: POLYMARKET_US_LIVE is not "true"' };
  }
  let ks = killSwitchActive;
  if (ks === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ks = require('../agents/orchestrator').isKillSwitchActive();
    } catch {
      ks = true; // can't verify → fail closed
    }
  }
  if (ks) return { allowed: false, reason: 'Polymarket live blocked: kill switch active' };
  return { allowed: true, reason: 'Polymarket live allowed' };
}

/**
 * Max notional per Polymarket order. Two names existed in the codebase:
 * POLYMARKET_US_MAX_ORDER_USD (.env.example, polymarketUS.ts) and
 * POLYMARKET_MAX_BET_USD (polymarket.ts). Both are honoured; the US name wins.
 */
export function getPolymarketMaxOrderUsd(env: NodeJS.ProcessEnv = process.env): number {
  for (const name of ['POLYMARKET_US_MAX_ORDER_USD', 'POLYMARKET_MAX_BET_USD']) {
    if (env[name] === undefined) continue;
    const n = Number(clean(env[name]));
    if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid Polymarket US order limit');
    return n;
  }
  return 5;
}
