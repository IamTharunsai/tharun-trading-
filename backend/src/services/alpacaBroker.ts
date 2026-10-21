/**
 * ALPACA API INTEGRATION
 * Paper + Live trading mode for stocks and crypto
 * Docs: https://docs.alpaca.markets/
 */

import axios, { AxiosInstance } from 'axios';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { logger } from '../utils/logger';
import { isPlaceholderKey } from '../utils/apiKeys';
import { ACTIVITY_HISTORY_START, parseActivityHistory, ActivityHistoryObservation } from './capitalActivityHistory';

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

export interface AlpacaOrder {
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

export interface AlpacaActivity {
  id: string;
  activity_type: string;
  order_id?: string;
  side?: string;
  symbol?: string;
  currency?: string;
  qty?: string;
  price?: string;
  net_amount?: string;
  transaction_time?: string;
  date?: string;
  status?: string;
}

export interface AlpacaPortfolioHistory {
  timestamp: number[];
  equity: number[];
  timeframe: string;
  cashflow: Record<string, number[]>;
  // Returned P&L/base values are intentionally not used by risk accounting.
}

interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: string;
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
  async getAccount(signal?: AbortSignal): Promise<AlpacaAccount> {
    try {
      const response = signal ? await this.client.get('/v2/account', { signal }) : await this.client.get('/v2/account');
      return response.data;
    } catch (error: any) {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        logger.warn('Alpaca: Account authentication failed (401/403); broker evidence unavailable.');
      } else {
        logger.error('Alpaca: Failed to get account', { error: error?.message || error });
      }
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
    return this.getOrderVerified(orderId);
  }

  // https://docs.alpaca.markets/us/reference/getorderbyorderid-1
  // An unavailable response is not a missing order. Always fetch the actual
  // nested family when recovering bracket executions.
  async getOrderVerified(orderId: string): Promise<AlpacaOrder | null> {
    try {
      const response = await this.client.get(`/v2/orders/${encodeURIComponent(orderId)}`, { params: { nested: true } });
      if (!response.data?.id || response.data.id !== orderId) throw new Error('INVALID_BROKER_ORDER_IDENTITY');
      return response.data;
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  }

  // https://docs.alpaca.markets/us/reference/getaccountactivities-2
  // Filters use creation time, not effective/settlement dates. Unfiltered scans
  // target daily overlapping windows, widening for older ranges within the
  // request budget. Order-filtered recovery preserves its original interval.
  // maxPages is the TOTAL HTTP budget, including empty windows.
  async listActivitiesVerified(after: string, until: string, maxPages = 20, orderId?: string): Promise<AlpacaActivity[]> {
    const start = Date.parse(after); const end = Date.parse(until);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end
      || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('INVALID_BROKER_ACTIVITY_RANGE');
    const day = 86400000; const overlap = 1000; const maxWindows = 32;
    const windowBudget = orderId ? 1 : Math.min(maxWindows, maxPages);
    // width*N - overlap*(N-1) >= requested span, so sparse old ranges
    // remain readable without an unconditional maximum lookback date.
    const width = Math.max(day, Math.ceil((end - start + (windowBudget - 1) * overlap) / windowBudget));
    const activities = new Map<string, AlpacaActivity>();
    let requests = 0; let windows = 0;
    const deadline = performance.now() + 25000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000); timer.unref();
    const remaining = () => {
      const ms = Math.floor(deadline - performance.now());
      if (ms <= 0 || controller.signal.aborted) throw new Error('BROKER_ACTIVITY_DEADLINE_EXCEEDED');
      return ms;
    };
    try {
      for (let from = start; from < end;) {
        if (++windows > maxWindows) throw new Error('BROKER_ACTIVITY_WINDOW_BOUND_EXCEEDED');
        const to = Math.min(from + width, end);
        const seen = new Set<string>();
        let pageToken: string | undefined;
        for (;;) {
          if (requests++ >= maxPages) throw new Error('BROKER_ACTIVITY_SCAN_BOUND_EXCEEDED');
          const response = await this.client.get('/v2/account/activities', {
            params: { after: new Date(from).toISOString(), until: new Date(to).toISOString(),
              direction: 'asc', page_size: 100, page_token: pageToken, order_id: orderId },
            timeout: Math.min(10000, remaining()), signal: controller.signal,
          });
          remaining();
          if (!Array.isArray(response.data) || response.data.length > 100) throw new Error('INVALID_BROKER_ACTIVITIES');
          for (const activity of response.data) {
            if (typeof activity?.id !== 'string' || !activity.id || typeof activity.activity_type !== 'string'
              || !activity.activity_type || seen.has(activity.id)) throw new Error('INVALID_BROKER_ACTIVITY_PAGE');
            seen.add(activity.id);
            const previous = activities.get(activity.id);
            if (previous && !isDeepStrictEqual(previous, activity)) throw new Error('BROKER_ACTIVITY_CONFLICT');
            activities.set(activity.id, activity);
            if (activities.size > 10000) throw new Error('BROKER_ACTIVITY_RECORD_BOUND_EXCEEDED');
          }
          if (response.data.length < 100) break;
          pageToken = response.data[response.data.length - 1].id;
        }
        if (to === end) break;
        from = to - overlap;
      }
      remaining(); // Validation/deduplication time also belongs to this read.
      return [...activities.values()];
    } finally { clearTimeout(timer); }
  }

  // https://docs.alpaca.markets/us/reference/getaccountportfoliohistory-1
  // Explicit ALL is essential: NONE/omission cannot establish capital coverage.
  /** Complete finite Trading SSE read bound to this verified account. No orders. */
  async getActivityHistoryVerified(accountId: string, until: string): Promise<ActivityHistoryObservation> {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 30000);
    let stream: any;
    try {
      const account = await this.getAccount(controller.signal);
      const created = Date.parse(account.created_at), cutoff = Date.parse(until);
      if (account.id !== accountId || account.currency !== 'USD' || !Number.isFinite(created)
        || created < ACTIVITY_HISTORY_START + 1000 || !Number.isFinite(cutoff) || cutoff <= created || cutoff > Date.now()) {
        throw new Error('ACTIVITY_HISTORY_ACCOUNT_UNAVAILABLE');
      }
      controller.signal.throwIfAborted();
      const response = await this.client.get('/v2beta1/events/activities', { params: {
        since: new Date(created - 1000).toISOString(), until,
      }, responseType: 'stream', headers: { Accept: 'text/event-stream', 'Accept-Encoding': 'identity' },
      decompress: false, maxRedirects: 0, timeout: 30000, signal: controller.signal });
      stream = response.data;
      if (response.status !== 200 || !String(response.headers?.['content-type']).toLowerCase().startsWith('text/event-stream')
        || (response.headers?.['content-encoding'] && response.headers['content-encoding'] !== 'identity')) throw new Error('ACTIVITY_HISTORY_RESPONSE_INVALID');
      const observation = await parseActivityHistory(stream, { accountId, accountCreatedAt: account.created_at,
        since: new Date(created - 1000).toISOString(), until }, controller.signal);
      const after = await this.getAccount(controller.signal);
      controller.signal.throwIfAborted();
      if (after.id !== account.id || after.created_at !== account.created_at || after.currency !== 'USD') throw new Error('ACTIVITY_HISTORY_ACCOUNT_CHANGED');
      return observation;
    } finally { clearTimeout(deadline); stream?.destroy(); }
  }

  async getPortfolioHistoryVerified(start: string, end: string): Promise<AlpacaPortfolioHistory> {
    const response = await this.client.get('/v2/account/portfolio/history', { params: {
      start, end, timeframe: '5Min', intraday_reporting: 'continuous', pnl_reset: 'no_reset', cashflow_types: 'ALL',
    } });
    return response.data;
  }

  /** Official Trading API recovery key; a transport failure must not mean no order. */
  async getOrderByClientOrderId(clientOrderId: string): Promise<AlpacaOrder | null> {
    try {
      const response = await this.client.get('/v2/orders:by_client_order_id', { params: { client_order_id: clientOrderId } });
      return response.data;
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      throw error;
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

  /** Unavailable evidence must never be represented as a flat account. */
  async listPositionsVerified(): Promise<AlpacaPosition[]> {
    const response = await this.client.get('/v2/positions');
    if (!Array.isArray(response.data)) throw new Error('Broker positions response is not an array');
    return response.data;
  }

  async listOrdersVerified(status: 'open' | 'closed' | 'all' = 'open', limit = 500): Promise<AlpacaOrder[]> {
    const response = await this.client.get('/v2/orders', { params: { status, limit, nested: true } });
    if (!Array.isArray(response.data)) throw new Error('Broker orders response is not an array');
    return response.data;
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

  /** Cancel every open order on the account (used by the kill switch). */
  async cancelAllOrders(): Promise<void> {
    await this.client.delete('/v2/orders');
    logger.warn('🛑 Alpaca: all open orders cancelled');
  }

  /** Liquidate every position and cancel open orders (used by the kill switch). */
  async closeAllPositions(): Promise<any[]> {
    const response = await this.client.delete('/v2/positions', { params: { cancel_orders: true } });
    logger.warn('🛑 Alpaca: all positions liquidated');
    return response.data || [];
  }

  /**
   * Flatten one symbol: cancel its open orders first (bracket legs would
   * otherwise hold the shares and block the close), then liquidate what is
   * left. Returns null when there was no position at the broker.
   */
  async flattenSymbol(symbol: string): Promise<AlpacaOrder | null> {
    const open = await this.getOrders('open', 500);
    const norm = (x: string) => String(x || '').replace('/', '').toUpperCase();
    for (const o of open.filter(o => norm(o.symbol) === norm(symbol))) {
      await this.cancelOrder(o.id).catch(() => {});
    }
    const pos = await this.getPosition(symbol);
    if (!pos) return null;
    return this.closePosition(symbol);
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
    } catch (error: any) {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        logger.warn('Alpaca: Credentials rejected (401/403); account verification failed.');
      } else {
        logger.error('❌ Alpaca authentication failed', { error: error?.message || error });
      }
      return false;
    }
  }

  /**
   * Get portfolio value + cash
   */
  async getPortfolioSummary(): Promise<{
    account_id: string;
    currency: string;
    last_equity: number;
    portfolio_value: number;
    cash: number;
    buying_power: number;
    equity: number;
  } | null> {
    // Verify this account on each observation. A failure on another account,
    // or an earlier failure on this one, must not permanently disable recovery.
    try {
      const account = await this.getAccount();
      return {
          account_id: account.id,
          currency: account.currency,
          last_equity: Number(account.last_equity),
        portfolio_value: parseFloat(account.portfolio_value),
        cash: parseFloat(account.cash),
        buying_power: parseFloat(account.buying_power),
        equity: parseFloat(account.equity),
      };
    } catch (error: any) {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        logger.warn('Alpaca: Authentication failed (401/403); portfolio remains unavailable.');
      } else {
        logger.error('Alpaca: Failed to get portfolio summary', { error: error?.message || error });
      }
      return null;
    }
  }
}

/**
 * @deprecated Use getTradingBroker() from trading/brokerRouter.
 * The paperMode argument is IGNORED: it used to let callers build a live
 * client from ALPACA_API_KEY + raw TRADING_MODE, bypassing the
 * LIVE_TRADING_CONFIRMED gate. The router decides paper vs live now.
 */
export function createAlpacaBroker(_paperMode: boolean = true): AlpacaBroker | null {
  // Lazy require avoids an import cycle (brokerRouter imports this module).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getTradingBroker } = require('../trading/brokerRouter');
  return getTradingBroker();
}
