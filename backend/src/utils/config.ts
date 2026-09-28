import crypto from 'crypto';
import { logger } from './logger';

export type TradingMode = 'paper' | 'live';

export interface ValidatedConfig {
  PORT: number;
  TRADING_MODE: TradingMode;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  OWNER_EMAIL: string;
  ALPACA: {
    paperApiKey?: string;
    paperSecretKey?: string;
    paperBaseUrl: string;
    liveApiKey?: string;
    liveSecretKey?: string;
    liveBaseUrl: string;
    isPaperConfigured: boolean;
    isLiveConfigured: boolean;
    activeMode: TradingMode;
  };
  POLYMARKET: {
    walletAddress?: string;
    clobApiUrl: string;
    gammaApiUrl: string;
    isConfigured: boolean;
  };
  DATABASE: {
    url?: string;
    sqlitePath: string;
  };
  RISK: {
    maxPositionSizePct: number;
    maxRiskPerTradePct: number;
    dailyLossLimitPct: number;
    weeklyLossLimitPct: number;
    cashReservePct: number;
    maxDrawdownLimitPct: number;
  };
}

/**
 * Strips inline comments, e.g. "paper # trading mode" -> "paper"
 */
function cleanEnvValue(val: string | undefined): string | undefined {
  if (val === undefined || val === null) return undefined;
  const stripped = val.split('#')[0].trim();
  // Strip surrounding quotes if any
  return stripped.replace(/^["']|["']$/g, '');
}

function parseTradingMode(raw: string | undefined): TradingMode {
  const cleaned = cleanEnvValue(raw)?.toLowerCase();
  if (cleaned === 'live') {
    return 'live';
  }
  // Default to paper for maximum safety; fail-closed against accidental live execution
  return 'paper';
}

function isNonEmptyRealKey(val: string | undefined): boolean {
  if (!val) return false;
  const cleaned = cleanEnvValue(val);
  if (!cleaned) return false;
  const placeholders = [
    'your_', 'placeholder', 'dummy', 'change_me', 'sample', 'xxx', 'test_key', 'api_key_here'
  ];
  return !placeholders.some(p => cleaned.toLowerCase().includes(p));
}

export function validateConfig(): ValidatedConfig {
  const tradingMode = parseTradingMode(process.env.TRADING_MODE);

  // Core security variables
  // SECURITY: no hard-coded fallback secrets. A public default JWT secret lets
  // anyone forge an owner token. In production we refuse to boot without real
  // secrets; in dev/test we use a random per-process secret (tokens die on restart).
  const isProd = process.env.NODE_ENV === 'production';
  const requireSecret = (name: string): string => {
    const v = cleanEnvValue(process.env[name]);
    if (v && v.length >= 32) return v;
    if (isProd) {
      throw new Error(`${name} must be set to a random value of at least 32 characters in production`);
    }
    logger.warn(`⚠️ ${name} missing/short — using an ephemeral random value (dev only)`);
    return crypto.randomBytes(48).toString('hex');
  };
  const jwtSecret = requireSecret('JWT_SECRET');
  const encryptionKey = requireSecret('ENCRYPTION_KEY');
  const ownerEmail = cleanEnvValue(process.env.OWNER_EMAIL) || '';

  // Separate paper and live credentials cleanly
  const alpacaPaperKey = cleanEnvValue(process.env.ALPACA_PAPER_API_KEY || process.env.ALPACA_API_KEY);
  const alpacaPaperSecret = cleanEnvValue(process.env.ALPACA_PAPER_SECRET_KEY || process.env.ALPACA_SECRET_KEY);
  const alpacaPaperBaseUrl = cleanEnvValue(process.env.ALPACA_PAPER_BASE_URL) || 'https://paper-api.alpaca.markets';

  const alpacaLiveKey = cleanEnvValue(process.env.ALPACA_LIVE_API_KEY);
  const alpacaLiveSecret = cleanEnvValue(process.env.ALPACA_LIVE_SECRET_KEY);
  const alpacaLiveBaseUrl = cleanEnvValue(process.env.ALPACA_LIVE_BASE_URL) || 'https://api.alpaca.markets';

  const isPaperConfigured = isNonEmptyRealKey(alpacaPaperKey) && isNonEmptyRealKey(alpacaPaperSecret);
  const isLiveConfigured = isNonEmptyRealKey(alpacaLiveKey) && isNonEmptyRealKey(alpacaLiveSecret);

  // Fail-closed safety rule: Never enable live mode simply because live credentials exist.
  // Live mode requires BOTH explicit TRADING_MODE=live AND verified live credentials.
  let activeMode: TradingMode = 'paper';
  if (tradingMode === 'live') {
    if (isLiveConfigured) {
      activeMode = 'live';
      logger.warn('⚠️ LIVE TRADING MODE ENABLED with authenticated Alpaca Live credentials.');
    } else {
      logger.warn('⚠️ TRADING_MODE was set to "live" but live credentials are missing/invalid. Falling back strictly to PAPER.');
      activeMode = 'paper';
    }
  }

  // Polymarket endpoints
  const polyWallet = cleanEnvValue(process.env.POLYMARKET_WALLET_ADDRESS);
  const polyClobUrl = cleanEnvValue(process.env.POLYMARKET_CLOB_URL) || 'https://clob.polymarket.com';
  const polyGammaUrl = cleanEnvValue(process.env.POLYMARKET_GAMMA_URL) || 'https://gamma-api.polymarket.com';

  const config: ValidatedConfig = {
    PORT: Number(cleanEnvValue(process.env.PORT)) || 3000,
    TRADING_MODE: activeMode,
    JWT_SECRET: jwtSecret,
    ENCRYPTION_KEY: encryptionKey,
    OWNER_EMAIL: ownerEmail,
    ALPACA: {
      paperApiKey: alpacaPaperKey,
      paperSecretKey: alpacaPaperSecret,
      paperBaseUrl: alpacaPaperBaseUrl,
      liveApiKey: alpacaLiveKey,
      liveSecretKey: alpacaLiveSecret,
      liveBaseUrl: alpacaLiveBaseUrl,
      isPaperConfigured,
      isLiveConfigured,
      activeMode,
    },
    POLYMARKET: {
      walletAddress: polyWallet,
      clobApiUrl: polyClobUrl,
      gammaApiUrl: polyGammaUrl,
      isConfigured: !!polyWallet && polyWallet.startsWith('0x') && polyWallet.length === 42,
    },
    DATABASE: {
      url: cleanEnvValue(process.env.DATABASE_URL),
      sqlitePath: process.env.SQLITE_DB_PATH || 'backend/data/apex_trading.db',
    },
    RISK: {
      maxPositionSizePct: Number(cleanEnvValue(process.env.MAX_POSITION_SIZE_PCT)) || 15,
      maxRiskPerTradePct: Number(cleanEnvValue(process.env.MAX_RISK_PER_TRADE_PCT)) || 2,
      dailyLossLimitPct: Number(cleanEnvValue(process.env.DAILY_LOSS_LIMIT_PCT)) || 3,
      weeklyLossLimitPct: Number(cleanEnvValue(process.env.WEEKLY_DRAWDOWN_LIMIT_PCT)) || 6,
      cashReservePct: Number(cleanEnvValue(process.env.CASH_RESERVE_PCT)) || 20,
      maxDrawdownLimitPct: Number(cleanEnvValue(process.env.MAX_DRAWDOWN_ALL_TIME_PCT)) || 10,
    }
  };

  return config;
}

export const appConfig = validateConfig();

/**
 * Returns safe provider configuration summary without exposing sensitive API secrets
 */
export function getSafeProviderStatus() {
  return {
    tradingMode: appConfig.TRADING_MODE,
    alpaca: {
      paperConfigured: appConfig.ALPACA.isPaperConfigured,
      liveConfigured: appConfig.ALPACA.isLiveConfigured,
      activeEnvironment: appConfig.ALPACA.activeMode,
      baseUrl: appConfig.ALPACA.activeMode === 'live' ? appConfig.ALPACA.liveBaseUrl : appConfig.ALPACA.paperBaseUrl,
    },
    polymarket: {
      configured: appConfig.POLYMARKET.isConfigured,
      walletAddress: appConfig.POLYMARKET.walletAddress ? `${appConfig.POLYMARKET.walletAddress.slice(0, 6)}...${appConfig.POLYMARKET.walletAddress.slice(-4)}` : null,
      clobUrl: appConfig.POLYMARKET.clobApiUrl,
      gammaUrl: appConfig.POLYMARKET.gammaApiUrl,
    },
    persistence: {
      engine: 'SQLite (node:sqlite WAL)',
      storageReady: true,
    }
  };
}
