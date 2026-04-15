/**
 * BINANCE API INTEGRATION
 * Crypto trading via REST API (no WebSocket for simplicity)
 * Docs: https://binance-docs.github.io/apidocs/
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger';

interface BinanceOrderRequest {
  symbol: string; // e.g., BTCUSDT
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'STOP_LOSS_LIMIT' | 'TAKE_PROFIT' | 'TAKE_PROFIT_LIMIT';
  quantity: number;
  price?: number; // Required for LIMIT orders
  stopPrice?: number; // For STOP_LOSS orders
  timeInForce?: 'GTC' | 'IOC' | 'FOK'; // Good Till Cancel, Immediate or Cancel, Fill or Kill
  newClientOrderId?: string;
}

interface BinanceOrder {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'PENDING_CANCEL' | 'REJECTED' | 'EXPIRED' | 'EXPIRED_IN_MATCH';
  timeInForce: string;
  type: string;
  side: string;
  fills?: any[];
}

interface BinancePosition {
  asset: string;
  free: string;
  locked: string;
}

interface BinanceAccountInfo {
  balances: BinancePosition[];
  totalAssetOfBtc: string;
}

interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: string;
  takerBuyQuoteAssetVolume: string;
}

export class BinanceBroker {
  private client: AxiosInstance;
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string = 'https://api.binance.com/api';
  private testnetUrl: string = 'https://testnet.binance.vision/api';
  private testnet: boolean;

  constructor(apiKey: string, apiSecret: string, testnet: boolean = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.testnet = testnet;

    this.client = axios.create({
      baseURL: testnet ? this.testnetUrl : this.baseUrl,
      timeout: 10000,
    });
  }

  /**
   * Sign request with HMAC SHA256
   */
  private sign(queryString: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
  }

  /**
   * Get account information (balances)
   */
  async getAccount(): Promise<BinanceAccountInfo> {
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = this.sign(queryString);

      const response = await this.client.get('/v3/account', {
        params: {
          timestamp,
          signature,
        },
        headers: {
          'X-MBX-APIKEY': this.apiKey,
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Binance: Failed to get account', { error });
      throw error;
    }
  }

  /**
   * Get balance for specific asset
   */
  async getBalance(asset: string): Promise<{ free: number; locked: number } | null> {
    try {
      const account = await this.getAccount();
      const balance = account.balances.find((b) => b.asset === asset);

      if (!balance) return null;

      return {
        free: parseFloat(balance.free),
        locked: parseFloat(balance.locked),
      };
    } catch (error) {
      logger.error('Binance: Failed to get balance', { asset, error });
      return null;
    }
  }

  /**
   * Place order
   */
  async createOrder(orderRequest: BinanceOrderRequest): Promise<BinanceOrder> {
    try {
      const timestamp = Date.now();
      const params: any = {
        symbol: orderRequest.symbol,
        side: orderRequest.side,
        type: orderRequest.type,
        quantity: orderRequest.quantity,
        timestamp,
      };

      if (orderRequest.price) params.price = orderRequest.price;
      if (orderRequest.stopPrice) params.stopPrice = orderRequest.stopPrice;
      if (orderRequest.timeInForce) params.timeInForce = orderRequest.timeInForce;
      if (orderRequest.newClientOrderId) params.newClientOrderId = orderRequest.newClientOrderId;

      const queryString = new URLSearchParams(params).toString();
      const signature = this.sign(queryString);

      const response = await this.client.post(
        '/v3/order',
        {},
        {
          params: { ...params, signature },
          headers: {
            'X-MBX-APIKEY': this.apiKey,
          },
        }
      );

      logger.info('✅ Binance order placed', {
        symbol: orderRequest.symbol,
        side: orderRequest.side,
        qty: orderRequest.quantity,
      });
      return response.data;
    } catch (error) {
      logger.error('Binance: Failed to place order', { order: orderRequest, error });
      throw error;
    }
  }

  /**
   * Get order status
   */
  async getOrder(symbol: string, orderId: number): Promise<BinanceOrder | null> {
    try {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${timestamp}`;
      const signature = this.sign(queryString);

      const response = await this.client.get('/v3/order', {
        params: {
          symbol,
          orderId,
          timestamp,
          signature,
        },
        headers: {
          'X-MBX-APIKEY': this.apiKey,
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Binance: Failed to get order', { symbol, orderId, error });
      return null;
    }
  }

  /**
   * Cancel order
   */
  async cancelOrder(symbol: string, orderId: number): Promise<BinanceOrder> {
    try {
      const timestamp = Date.now();
      const params = { symbol, orderId, timestamp };
      const queryString = new URLSearchParams(params as any).toString();
      const signature = this.sign(queryString);

      const response = await this.client.delete('/v3/order', {
        params: { ...params, signature },
        headers: {
          'X-MBX-APIKEY': this.apiKey,
        },
      });

      logger.info('✅ Binance order cancelled', { symbol, orderId });
      return response.data;
    } catch (error) {
      logger.error('Binance: Failed to cancel order', { symbol, orderId, error });
      throw error;
    }
  }

  /**
   * Get all open orders
   */
  async getOpenOrders(symbol?: string): Promise<BinanceOrder[]> {
    try {
      const timestamp = Date.now();
      const params: any = { timestamp };
      if (symbol) params.symbol = symbol;

      const queryString = new URLSearchParams(params).toString();
      const signature = this.sign(queryString);

      const response = await this.client.get('/v3/openOrders', {
        params: { ...params, signature },
        headers: {
          'X-MBX-APIKEY': this.apiKey,
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Binance: Failed to get open orders', { error });
      return [];
    }
  }

  /**
   * Get historical klines (candles)
   */
  async getHistoricalKlines(
    symbol: string,
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
    limit: number = 100
  ): Promise<BinanceKline[]> {
    try {
      const response = await this.client.get('/v3/klines', {
        params: {
          symbol,
          interval,
          limit,
        },
      });

      return response.data.map((kline: any[]) => ({
        openTime: kline[0],
        open: kline[1],
        high: kline[2],
        low: kline[3],
        close: kline[4],
        volume: kline[5],
        closeTime: kline[6],
        quoteAssetVolume: kline[7],
        numberOfTrades: kline[8],
        takerBuyBaseAssetVolume: kline[9],
        takerBuyQuoteAssetVolume: kline[10],
      }));
    } catch (error) {
      logger.error('Binance: Failed to get klines', { symbol, error });
      return [];
    }
  }

  /**
   * Get 24h ticker (price, volume, changes)
   */
  async get24hTicker(symbol: string): Promise<any> {
    try {
      const response = await this.client.get('/v3/ticker/24hr', {
        params: { symbol },
      });
      return response.data;
    } catch (error) {
      logger.error('Binance: Failed to get 24h ticker', { symbol, error });
      return null;
    }
  }

  /**
   * Get funding rate (for perpetual futures)
   */
  async getFundingRate(symbol: string): Promise<number | null> {
    try {
      const response = await this.client.get('https://fapi.binance.com/fapi/v1/fundingRate', {
        params: {
          symbol,
          limit: 1,
        },
      });

      if (response.data && response.data[0]) {
        return parseFloat(response.data[0].fundingRate);
      }
      return null;
    } catch (error) {
      logger.warn('Binance: Funding rate requires Futures API', { symbol });
      return null;
    }
  }

  /**
   * Validate API credentials
   */
  async validateCredentials(): Promise<boolean> {
    try {
      const account = await this.getAccount();
      logger.info(`✅ Binance authenticated (${this.testnet ? 'TESTNET' : 'LIVE'})`);
      logger.info(`   Total BTC value: ${account.totalAssetOfBtc}`);
      return true;
    } catch (error) {
      logger.error('❌ Binance authentication failed', { error });
      return false;
    }
  }

  /**
   * Get portfolio value in USDT
   */
  async getPortfolioValueUSDT(): Promise<number> {
    try {
      const account = await this.getAccount();
      const usdtBalance = account.balances.find((b) => b.asset === 'USDT');

      if (!usdtBalance) {
        logger.warn('⚠️ USDT balance not found');
        return 0;
      }

      // This is a simplified calculation — doesn't include alt-coin values
      return parseFloat(usdtBalance.free) + parseFloat(usdtBalance.locked);
    } catch (error) {
      logger.error('Binance: Failed to calculate portfolio value', { error });
      return 0;
    }
  }
}

/**
 * Factory function to create Binance broker instance
 */
export function createBinanceBroker(testnet: boolean = true): BinanceBroker | null {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  if (!apiKey || !apiSecret) {
    logger.warn('⚠️ Binance API credentials not configured. Testnet only.');
    return null;
  }

  return new BinanceBroker(apiKey, apiSecret, testnet);
}
