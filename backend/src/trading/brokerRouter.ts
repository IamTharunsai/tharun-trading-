// ── BROKER ROUTER ─────────────────────────────────────────────────────────────
// ONE place that decides which Alpaca account an order goes to.
//
// Before this existed, three different code paths each picked keys their own
// way (executionEngine used ALPACA_API_KEY + raw TRADING_MODE, config.ts used
// ALPACA_LIVE_* with a fail-closed rule, accountManager used keys typed into
// Settings). A "live" order could therefore be routed with paper keys, and keys
// entered in Settings were never used for trading at all.
//
// Rules (fail-closed):
//   • trading/liveGate.ts is the only source of truth for paper vs live
//     (TRADING_MODE=live + LIVE_TRADING_CONFIRMED phrase + live keys).
//   • services/alpacaBroker.createAlpacaBroker() now delegates here too, so no
//     code path can construct a live client on its own.
//   • live  → only ALPACA_LIVE_API_KEY / ALPACA_LIVE_SECRET_KEY are ever used.
//   • paper → keys connected in Settings (paper only), else ALPACA_PAPER_* / ALPACA_API_KEY.
import { AlpacaBroker } from '../services/alpacaBroker';
import { appConfig } from '../utils/config';
import { isPlaceholderKey } from '../utils/apiKeys';
import { getAlpacaMode } from './liveGate';

export type BrokerMode = 'paper' | 'live';

export function getActiveMode(): BrokerMode {
  return getAlpacaMode();
}

let cached: { key: string; broker: AlpacaBroker } | null = null;

export function getTradingBroker(): AlpacaBroker | null {
  const mode = getActiveMode();
  let apiKey: string | undefined;
  let secret: string | undefined;

  if (mode === 'live') {
    apiKey = appConfig.ALPACA.liveApiKey;
    secret = appConfig.ALPACA.liveSecretKey;
  } else {
    try {
      // Lazy require avoids an import cycle (accountManager → portfolio → …)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { accountManager } = require('../services/accountManager');
      const st = accountManager?.getAlpacaState?.();
      if (st?.connected && st.paperMode && st.apiKey && st.secretKey) {
        apiKey = st.apiKey;
        secret = st.secretKey;
      }
    } catch { /* fall through to env */ }
    apiKey = apiKey || appConfig.ALPACA.paperApiKey;
    secret = secret || appConfig.ALPACA.paperSecretKey;
  }

  if (isPlaceholderKey(apiKey) || isPlaceholderKey(secret)) return null;

  const cacheKey = `${mode}:${apiKey}`;
  if (cached?.key !== cacheKey) {
    cached = { key: cacheKey, broker: new AlpacaBroker(apiKey!, secret!, mode === 'paper') };
  }
  return cached.broker;
}
