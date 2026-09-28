import { logger } from '../../utils/logger';
import { isPlaceholderKey } from '../../utils/apiKeys';

export interface CryptoEvaluation {
  symbol: string;
  venue: 'BINANCE_US' | 'COINBASE' | 'ALPACA_CRYPTO' | 'UNAUTHENTICATED';
  currentPrice: number;
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  canExecute: boolean;
  readOnlyReason?: string;
  minimumSizeUSD: number;
  makerFeeBps: number;
  takerFeeBps: number;
  volatility24hPct: number;
  fundingRatePct?: number;
}

export class CryptoTradingEngine {
  private hasAuthenticatedVenue = false;
  private venueName: 'BINANCE_US' | 'COINBASE' | 'ALPACA_CRYPTO' | 'UNAUTHENTICATED' = 'UNAUTHENTICATED';

  constructor() {
    this.detectVenue();
  }

  private detectVenue() {
    const binanceKey = process.env.BINANCE_API_KEY;
    const binanceSecret = process.env.BINANCE_SECRET_KEY;
    if (binanceKey && binanceSecret && !isPlaceholderKey(binanceKey) && !isPlaceholderKey(binanceSecret)) {
      this.hasAuthenticatedVenue = true;
      this.venueName = 'BINANCE_US';
      logger.info('🔐 Authenticated Crypto Venue active: Binance US');
    } else {
      this.hasAuthenticatedVenue = false;
      this.venueName = 'UNAUTHENTICATED';
      logger.info('ℹ️ No authenticated crypto venue configured. Crypto engine operating in STRICT READ-ONLY MODE.');
    }
  }

  /**
   * Evaluates crypto market conditions. Strictly blocks execution if no authenticated venue.
   */
  evaluateAsset(symbol: string, currentPrice: number, change24hPct: number): CryptoEvaluation {
    const cleanSym = symbol.toUpperCase().trim();

    const evaluation: CryptoEvaluation = {
      symbol: cleanSym,
      venue: this.venueName,
      currentPrice,
      direction: change24hPct > 1.5 ? 'BUY' : (change24hPct < -1.5 ? 'SELL' : 'NEUTRAL'),
      canExecute: this.hasAuthenticatedVenue,
      minimumSizeUSD: 10.0, // Standard minimum order size on Binance US
      makerFeeBps: 10,      // 0.10% maker fee
      takerFeeBps: 20,      // 0.20% taker fee
      volatility24hPct: Math.abs(change24hPct),
    };

    if (!this.hasAuthenticatedVenue) {
      evaluation.canExecute = false;
      evaluation.readOnlyReason = 'No authenticated crypto broker credentials present; crypto execution locked to read-only analysis';
    }

    return evaluation;
  }
}

export const cryptoEngine = new CryptoTradingEngine();
