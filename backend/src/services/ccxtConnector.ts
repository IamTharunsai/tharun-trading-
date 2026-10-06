/**
 * INTEGRATION: freqtrade → APEX
 * CCXT-based Unified Crypto Exchange Connector
 *
 * freqtrade ref: https://github.com/freqtrade/freqtrade
 * CCXT ref: https://github.com/ccxt/ccxt
 * APEX file location: backend/src/services/ccxtConnector.ts
 *
 * Supported exchanges: Binance, Coinbase Advanced, Bybit, Kraken, OKX
 *
 * Install: npm install ccxt
 *
 * Features:
 * - Unified OHLCV fetch (maps freqtrade's DataHandler pattern)
 * - Market order + limit order execution
 * - Balance queries
 * - Open order management
 * - Symbol normalization (BTC/USDT → same format regardless of exchange)
 * - Rate limit handling (respects exchange ratelimit)
 */

// NOTE: Install ccxt with: npm install ccxt
// Types reference: https://docs.ccxt.com/
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ccxt = require('ccxt');

export type ExchangeId = 'binance' | 'coinbaseadvanced' | 'bybit' | 'kraken' | 'okx';

export interface CCXTConfig {
  exchangeId: ExchangeId;
  apiKey: string;
  secret: string;
  password?: string;   // Required for OKX
  sandbox?: boolean;   // Use testnet (Binance/Bybit support this)
}

export interface OHLCVBar {
  timestamp: number;   // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Balance {
  currency: string;
  free: number;
  used: number;
  total: number;
}

export interface OrderResult {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  price: number | undefined;
  amount: number;
  filled: number;
  status: 'open' | 'closed' | 'canceled';
  cost: number;        // price * filled
  fee: { currency: string; cost: number } | undefined;
  timestamp: number;
}

export interface Ticker {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume24h: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
}

export class CCXTConnector {
  private exchange: any;
  private readonly exchangeId: ExchangeId;

  constructor(config: CCXTConfig) {
    this.exchangeId = config.exchangeId;

    const ExchangeClass = ccxt[config.exchangeId];
    if (!ExchangeClass) {
      throw new Error(`Exchange '${config.exchangeId}' not supported by CCXT`);
    }

    this.exchange = new ExchangeClass({
      apiKey: config.apiKey,
      secret: config.secret,
      password: config.password,
      enableRateLimit: true,  // freqtrade pattern: always respect rate limits
      options: {
        defaultType: 'spot',
        adjustForTimeDifference: true,
      },
    });

    if (config.sandbox) {
      this.exchange.setSandboxMode(true);
    }
  }

  /**
   * Normalize symbol to CCXT format (e.g. "BTCUSDT" → "BTC/USDT")
   */
  private normalizeSymbol(symbol: string): string {
    // Already normalized
    if (symbol.includes('/')) return symbol;
    // Common quote currencies
    const quotes = ['USDT', 'USD', 'USDC', 'BTC', 'ETH', 'BNB'];
    for (const q of quotes) {
      if (symbol.endsWith(q)) {
        return `${symbol.slice(0, -q.length)}/${q}`;
      }
    }
    return symbol;
  }

  /**
   * Fetch OHLCV candlesticks (freqtrade DataHandler equivalent)
   * @param symbol  e.g. "BTC/USDT" or "BTCUSDT"
   * @param timeframe  e.g. "1d", "4h", "1h", "15m", "5m", "1m"
   * @param limit  number of bars (max varies by exchange, typically 500-1000)
   * @param since  optional Unix ms timestamp to start from
   */
  async fetchOHLCV(
    symbol: string,
    timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' = '1d',
    limit = 200,
    since?: number,
  ): Promise<OHLCVBar[]> {
    const sym = this.normalizeSymbol(symbol);

    try {
      await this.exchange.loadMarkets();
      const raw: [number, number, number, number, number, number][] = await this.exchange.fetchOHLCV(
        sym, timeframe, since, limit
      );

      return raw.map(([ts, o, h, l, c, v]) => ({
        timestamp: ts,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v,
      }));
    } catch (err: any) {
      throw new Error(`[CCXT] fetchOHLCV ${sym}@${timeframe} on ${this.exchangeId}: ${err.message}`);
    }
  }

  /**
   * Fetch live ticker
   */
  async fetchTicker(symbol: string): Promise<Ticker> {
    const sym = this.normalizeSymbol(symbol);
    try {
      const t = await this.exchange.fetchTicker(sym);
      return {
        symbol: sym,
        bid: t.bid ?? t.last,
        ask: t.ask ?? t.last,
        last: t.last,
        volume24h: t.quoteVolume ?? t.baseVolume,
        change24hPct: t.percentage ?? 0,
        high24h: t.high ?? t.last,
        low24h: t.low ?? t.last,
      };
    } catch (err: any) {
      throw new Error(`[CCXT] fetchTicker ${sym}: ${err.message}`);
    }
  }

  /**
   * Fetch multiple tickers (more efficient than N individual calls)
   */
  async fetchTickers(symbols: string[]): Promise<Ticker[]> {
    const syms = symbols.map(s => this.normalizeSymbol(s));
    try {
      const tickers = await this.exchange.fetchTickers(syms);
      return syms
        .filter(s => tickers[s])
        .map(s => {
          const t = tickers[s];
          return {
            symbol: s,
            bid: t.bid ?? t.last,
            ask: t.ask ?? t.last,
            last: t.last,
            volume24h: t.quoteVolume ?? t.baseVolume,
            change24hPct: t.percentage ?? 0,
            high24h: t.high ?? t.last,
            low24h: t.low ?? t.last,
          };
        });
    } catch (err: any) {
      throw new Error(`[CCXT] fetchTickers: ${err.message}`);
    }
  }

  /**
   * Get account balances (all currencies with non-zero balance)
   */
  async fetchBalance(): Promise<Balance[]> {
    try {
      const raw = await this.exchange.fetchBalance();
      return Object.entries(raw.total as Record<string, number>)
        .filter(([, total]) => total > 0)
        .map(([currency, total]) => ({
          currency,
          free: (raw.free as Record<string, number>)[currency] ?? 0,
          used: (raw.used as Record<string, number>)[currency] ?? 0,
          total,
        }));
    } catch (err: any) {
      throw new Error(`[CCXT] fetchBalance on ${this.exchangeId}: ${err.message}`);
    }
  }

  /**
   * Place a market order (freqtrade create_order equivalent)
   */
  async createMarketOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amountInBase: number,
  ): Promise<OrderResult> {
    const sym = this.normalizeSymbol(symbol);
    try {
      const order = await this.exchange.createMarketOrder(sym, side, amountInBase);
      return this.mapOrder(order);
    } catch (err: any) {
      throw new Error(`[CCXT] createMarketOrder ${side} ${amountInBase} ${sym}: ${err.message}`);
    }
  }

  /**
   * Place a limit order
   */
  async createLimitOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amountInBase: number,
    price: number,
  ): Promise<OrderResult> {
    const sym = this.normalizeSymbol(symbol);
    try {
      const order = await this.exchange.createLimitOrder(sym, side, amountInBase, price);
      return this.mapOrder(order);
    } catch (err: any) {
      throw new Error(`[CCXT] createLimitOrder ${side} ${amountInBase} ${sym} @ ${price}: ${err.message}`);
    }
  }

  /**
   * Cancel an open order
   */
  async cancelOrder(orderId: string, symbol: string): Promise<void> {
    const sym = this.normalizeSymbol(symbol);
    try {
      await this.exchange.cancelOrder(orderId, sym);
    } catch (err: any) {
      throw new Error(`[CCXT] cancelOrder ${orderId} ${sym}: ${err.message}`);
    }
  }

  /**
   * Fetch open orders for a symbol
   */
  async fetchOpenOrders(symbol?: string): Promise<OrderResult[]> {
    const sym = symbol ? this.normalizeSymbol(symbol) : undefined;
    try {
      const orders = await this.exchange.fetchOpenOrders(sym);
      return orders.map((o: any) => this.mapOrder(o));
    } catch (err: any) {
      throw new Error(`[CCXT] fetchOpenOrders: ${err.message}`);
    }
  }

  /**
   * Fetch a specific order by ID
   */
  async fetchOrder(orderId: string, symbol: string): Promise<OrderResult> {
    const sym = this.normalizeSymbol(symbol);
    try {
      const order = await this.exchange.fetchOrder(orderId, sym);
      return this.mapOrder(order);
    } catch (err: any) {
      throw new Error(`[CCXT] fetchOrder ${orderId} ${sym}: ${err.message}`);
    }
  }

  private mapOrder(o: any): OrderResult {
    return {
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      price: o.price,
      amount: o.amount,
      filled: o.filled ?? 0,
      status: o.status,
      cost: o.cost ?? (o.price ?? 0) * (o.filled ?? 0),
      fee: o.fee ? { currency: o.fee.currency, cost: o.fee.cost } : undefined,
      timestamp: o.timestamp,
    };
  }

  /**
   * Check if the exchange supports a symbol (before placing orders)
   */
  async hasSymbol(symbol: string): Promise<boolean> {
    const sym = this.normalizeSymbol(symbol);
    await this.exchange.loadMarkets();
    return sym in this.exchange.markets;
  }

  /**
   * Get top crypto by volume (for APEX's CryptoBoard panel)
   * Returns symbols with 24h volume sorted descending
   */
  async fetchTopByVolume(quoteAsset = 'USDT', limit = 20): Promise<Ticker[]> {
    try {
      await this.exchange.loadMarkets();
      const allTickers = await this.exchange.fetchTickers();
      return Object.values(allTickers as Record<string, any>)
        .filter((t: any) => t.symbol?.endsWith(`/${quoteAsset}`) && (t.quoteVolume ?? 0) > 0)
        .sort((a: any, b: any) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0))
        .slice(0, limit)
        .map((t: any) => ({
          symbol: t.symbol,
          bid: t.bid ?? t.last,
          ask: t.ask ?? t.last,
          last: t.last,
          volume24h: t.quoteVolume,
          change24hPct: t.percentage ?? 0,
          high24h: t.high ?? t.last,
          low24h: t.low ?? t.last,
        }));
    } catch (err: any) {
      throw new Error(`[CCXT] fetchTopByVolume: ${err.message}`);
    }
  }
}

/**
 * Factory: creates a connector from environment variables
 *
 * Required env vars (set one exchange's keys):
 *   CCXT_EXCHANGE=binance        (or coinbaseadvanced, bybit, kraken, okx)
 *   CCXT_API_KEY=your_api_key
 *   CCXT_SECRET=your_secret
 *   CCXT_PASSWORD=your_passphrase  (OKX only)
 *   CCXT_SANDBOX=true              (optional, use testnet)
 */
export function createCCXTConnector(): CCXTConnector {
  const exchangeId = (process.env.CCXT_EXCHANGE ?? 'binance') as ExchangeId;
  const apiKey = process.env.CCXT_API_KEY ?? '';
  const secret = process.env.CCXT_SECRET ?? '';
  const password = process.env.CCXT_PASSWORD;
  const sandbox = process.env.CCXT_SANDBOX === 'true';

  if (!apiKey || !secret) {
    throw new Error('[CCXT] CCXT_API_KEY and CCXT_SECRET env vars are required');
  }

  return new CCXTConnector({ exchangeId, apiKey, secret, password, sandbox });
}

/**
 * READ-ONLY connector (no API keys — public endpoints only)
 * For fetching OHLCV, tickers, orderbook depth without credentials
 */
export function createPublicCCXTConnector(exchangeId: ExchangeId = 'binance'): CCXTConnector {
  return new CCXTConnector({
    exchangeId,
    apiKey: '',
    secret: '',
  });
}

/*
 * ENV VARS TO ADD to .env / .env.example:
 *
 * # CCXT Crypto Exchange (for crypto trading)
 * CCXT_EXCHANGE=binance           # binance | coinbaseadvanced | bybit | kraken | okx
 * CCXT_API_KEY=your_api_key
 * CCXT_SECRET=your_api_secret
 * CCXT_PASSWORD=                  # Only required for OKX
 * CCXT_SANDBOX=false              # Set to true to use exchange testnet
 *
 * USAGE EXAMPLE:
 *
 * // In backend/src/trading/executionEngine.ts, add crypto execution:
 * import { createCCXTConnector, createPublicCCXTConnector } from '../services/ccxtConnector';
 *
 * // Fetch OHLCV for CryptoBoard (no auth needed):
 * const publicExchange = createPublicCCXTConnector('binance');
 * const btcBars = await publicExchange.fetchOHLCV('BTC/USDT', '1d', 90);
 *
 * // Execute a trade (auth required):
 * const exchange = createCCXTConnector();
 * const order = await exchange.createMarketOrder('ETH/USDT', 'buy', 0.1);
 *
 * // Get top 20 by volume for CryptoBoard:
 * const top20 = await publicExchange.fetchTopByVolume('USDT', 20);
 */
