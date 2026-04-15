/**
 * ALPACA API INTEGRATION
 * Paper + Live trading mode for stocks and crypto
 * Docs: https://docs.alpaca.markets/
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

interface AlpacaOrderRequest {
  symbol: string;
  qty?: number;
  notional?: number; // Dollar amount instead of shares
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  time_in_force?: 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
  trail_price?: number;
  trail_percent?: number;
  extended_hours?: boolean;
  client_order_id?: string;
  order_class?: 'simple' | 'bracket' | 'oco';
  take_profit?: { limit_price: number };
  stop_loss?: { stop_price: number; limit_price?: number };
}

interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string;
  expired_at: string;
  canceled_at: string;
  failed_at: string;
  replaced_at: string;
  replaced_by: string;
  replaces: string;
  asset_id: string;
  symbol: string;
  asset_class: string;
  qty: number;
  filled_qty: number;
  filled_avg_price: number;
  order_class: string;
  order_type: string;
  type: string;
  side: 'buy' | 'sell';
  time_in_force: string;
  limit_price: number;
  stop_price: number;
  status: 'pending_new' | 'accepted' | 'partially_filled' | 'filled' | 'done_for_day' | 'canceled' | 'replaced' | 'pending_cancel' | 'pending_replace' | 'stopped' | 'rejected' | 'suspended' | 'expired';
  extended_hours: boolean;
  legs: any[];
}

interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_fill_price: string;
  qty: string;
  side: 'long' | 'short';
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  buying_power: string;
  regt_buying_power: string;
  daytrading_buying_power: string;
  cash: string;
  portfolio_value: string;
  long_market_value: string;
  short_market_value: string;
  equity: string;
  last_equity: string;
  multiplier: string;
  shorting_enabled: boolean;
  created_at: string;
}

export class AlpacaBroker {
  private client: AxiosInstance;
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private paperMode: boolean;

  constructor(apiKey: string, apiSecret: string, paperMode: boolean = true) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.paperMode = paperMode;
    this.baseUrl = paperMode
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'APCA-API-KEY-ID': this.apiKey,
        'APCA-API-SECRET-KEY': this.apiSecret,
      },
      timeout: 10000,
    });
  }

  /**
   * Get account summary
   */
  async getAccount(): Promise<AlpacaAccount> {
    try {
      const response = await this.client.get('/v2/account');
      return response.data;
    } catch (error) {
      logger.error('Alpaca: Failed to get account', { error });
      throw error;
    }
  }

  /**
   * Get all open positions
   */
  async getPositions(): Promise<AlpacaPosition[]> {
    try {
      const response = await this.client.get('/v2/positions');
      return response.data;
    } catch (error) {
      logger.error('Alpaca: Failed to get positions', { error });
      return [];
    }
  }

  /**
   * Get specific position
   */
  async getPosition(symbol: string): Promise<AlpacaPosition | null> {
    try {
      const response = await this.client.get(`/v2/positions/${symbol}`);
      return response.data;
    } catch (error) {
      if ((error as any).response?.status === 404) {
        return null; // Position doesn't exist
      }
      logger.error('Alpaca: Failed to get position', { symbol, error });
      throw error;
    }
  }

  /**
   * Place order
   */
  async createOrder(orderRequest: AlpacaOrderRequest): Promise<AlpacaOrder> {
    try {
      const response = await this.client.post('/v2/orders', {
        symbol: orderRequest.symbol,
        qty: orderRequest.qty,
        notional: orderRequest.notional,
        side: orderRequest.side,
        type: orderRequest.type || 'market',
        time_in_force: orderRequest.time_in_force || 'day',
        limit_price: orderRequest.limit_price,
        stop_price: orderRequest.stop_price,
        trail_price: orderRequest.trail_price,
        trail_percent: orderRequest.trail_percent,
        extended_hours: orderRequest.extended_hours || false,
        client_order_id: orderRequest.client_order_id,
        order_class: orderRequest.order_class,
        take_profit: orderRequest.take_profit,
        stop_loss: orderRequest.stop_loss,
      });
      logger.info('✅ Order placed', { symbol: orderRequest.symbol, side: orderRequest.side, qty: orderRequest.qty });
      return response.data;
    } catch (error) {
      logger.error('Alpaca: Failed to place order', { order: orderRequest, error });
      throw error;
    }
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<AlpacaOrder | null> {
    try {
      const response = await this.client.get(`/v2/orders/${orderId}`);
      return response.data;
    } catch (error) {
      logger.error('Alpaca: Failed to get order', { orderId, error });
      return null;
    }
  }

  /**
   * Get all orders (open + closed)
   */
  async getOrders(status: 'open' | 'closed' | 'all' = 'open', limit: number = 100): Promise<AlpacaOrder[]> {
    try {
      const response = await this.client.get('/v2/orders', {
        params: {
          status,
          limit,
        },
      });
      return response.data;
    } catch (error) {
      logger.error('Alpaca: Failed to get orders', { error });
      return [];
    }
  }

  /**
   * Cancel order by ID
   */
  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.client.delete(`/v2/orders/${orderId}`);
      logger.info('✅ Order cancelled', { orderId });
    } catch (error) {
      logger.error('Alpaca: Failed to cancel order', { orderId, error });
      throw error;
    }
  }

  /**
   * Close position (sell all)
   */
  async closePosition(symbol: string): Promise<AlpacaOrder> {
    try {
      const response = await this.client.delete(`/v2/positions/${symbol}`);
      logger.info('✅ Position closed', { symbol });
      return response.data;
    } catch (error) {
      logger.error('Alpaca: Failed to close position', { symbol, error });
      throw error;
    }
  }

  /**
   * Get market data (bars/candles)
   * Requires separate data subscription
   */
  async getHistoricalBars(
    symbol: string,
    timeframe: '1m' | '5m' | '15m' | '1h' | '1d',
    limit: number = 100
  ): Promise<any[]> {
    try {
      const response = await this.client.get('/v2/stocks/{symbol}/bars', {
        params: {
          timeframe,
          limit,
        },
      });
      return response.data?.bars || [];
    } catch (error) {
      logger.warn('Alpaca: Market data endpoint requires paid subscription', { symbol });
      return [];
    }
  }

  /**
   * Get latest quote
   */
  async getQuote(symbol: string): Promise<any> {
    try {
      const response = await this.client.get(`/v2/stocks/${symbol}/quotes/latest`);
      return response.data?.quote;
    } catch (error) {
      logger.warn('Alpaca: Quote endpoint requires paid subscription', { symbol });
      return null;
    }
  }

  /**
   * Validate API credentials
   */
  async validateCredentials(): Promise<boolean> {
    try {
      const account = await this.getAccount();
      logger.info(`✅ Alpaca authenticated as ${account.account_number} (${this.paperMode ? 'PAPER' : 'LIVE'})`);
      return true;
    } catch (error) {
      logger.error('❌ Alpaca authentication failed', { error });
      return false;
    }
  }

  /**
   * Get portfolio value + cash
   */
  async getPortfolioSummary(): Promise<{
    portfolio_value: number;
    cash: number;
    buying_power: number;
    equity: number;
  } | null> {
    try {
      const account = await this.getAccount();
      return {
        portfolio_value: parseFloat(account.portfolio_value),
        cash: parseFloat(account.cash),
        buying_power: parseFloat(account.buying_power),
        equity: parseFloat(account.equity),
      };
    } catch (error) {
      logger.error('Alpaca: Failed to get portfolio summary', { error });
      return null;
    }
  }
}

/**
 * Factory function to create Alpaca broker instance
 */
export function createAlpacaBroker(paperMode: boolean = true): AlpacaBroker | null {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_API_SECRET;

  if (!apiKey || !apiSecret) {
    logger.warn('⚠️ Alpaca API credentials not configured. Paper mode only.');
    return null;
  }

  return new AlpacaBroker(apiKey, apiSecret, paperMode);
}
