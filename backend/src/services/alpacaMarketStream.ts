import WebSocket from 'ws';
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { appConfig } from '../utils/config';
import { getIO } from '../websocket/server';

export interface MarketQuote {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  spread: number;
  timestamp: string;
  receivedAt: number;
  latencyMs: number;
  isStale: boolean;
  marketSession: 'REGULAR' | 'PRE_MARKET' | 'POST_MARKET' | 'CLOSED';
  feedType: 'SIP' | 'IEX' | 'DELAYED';
}

export interface TradeUpdateEvent {
  event: 'new' | 'fill' | 'partial_fill' | 'canceled' | 'expired' | 'rejected' | 'replaced';
  executionId?: string;
  order: any;
  timestamp: string;
  price?: number;
  qty?: number;
}

export class AlpacaMarketStreamService {
  private dataWs: WebSocket | null = null;
  private tradeWs: WebSocket | null = null;
  private subscribedSymbols: Set<string> = new Set<string>() // filled from open positions + live most-actives, never a fixed list;
  private maxSubscriptionBudget = 30; // Max real-time symbols to manage memory and budget
  private quotesCache = new Map<string, MarketQuote>();
  private processedEventIds = new Set<string>();
  private lastHeartbeat = Date.now();
  private reconnectAttempts = 0;
  private isConnecting = false;
  private feedType: 'SIP' | 'IEX' = 'IEX';

  constructor() {
    this.detectFeedEntitlement();
  }

  private detectFeedEntitlement() {
    // If live credentials configured, default to SIP if available; otherwise IEX
    if (appConfig.ALPACA.isLiveConfigured) {
      this.feedType = 'SIP';
    } else {
      this.feedType = 'IEX';
    }
    logger.info(`📡 Alpaca WebSocket stream configured for ${this.feedType} feed.`);
  }

  /**
   * Determine whether US equity market is currently Regular, Pre-market, Post-market, or Closed
   */
  static classifyMarketHours(): 'REGULAR' | 'PRE_MARKET' | 'POST_MARKET' | 'CLOSED' {
    const now = new Date();
    // Convert to US Eastern Time (UTC-4 in EDT or UTC-5 in EST)
    const nyTimeStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nyTime = new Date(nyTimeStr);
    const day = nyTime.getDay();

    if (day === 0 || day === 6) return 'CLOSED'; // Weekend

    const hour = nyTime.getHours();
    const minute = nyTime.getMinutes();
    const timeInMins = hour * 60 + minute;

    if (timeInMins >= 240 && timeInMins < 570) {
      return 'PRE_MARKET'; // 4:00 AM - 9:30 AM ET
    }
    if (timeInMins >= 570 && timeInMins < 960) {
      return 'REGULAR'; // 9:30 AM - 4:00 PM ET
    }
    if (timeInMins >= 960 && timeInMins < 1200) {
      return 'POST_MARKET'; // 4:00 PM - 8:00 PM ET
    }
    return 'CLOSED';
  }

  /**
   * Connect to Alpaca real-time market data WebSocket
   */
  startStream() {
    const apiKey = appConfig.ALPACA.paperApiKey || process.env.ALPACA_API_KEY;
    const apiSecret = appConfig.ALPACA.paperSecretKey || process.env.ALPACA_SECRET_KEY;

    if (!apiKey || !apiSecret) {
      logger.warn('Alpaca credentials not configured — WebSocket stream running in passive poll mode');
      return;
    }

    if (this.isConnecting) return;
    this.isConnecting = true;

    const dataUrl = `wss://stream.data.alpaca.markets/v2/${this.feedType.toLowerCase()}`;
    const tradeUrl = `${appConfig.ALPACA.paperBaseUrl.replace('https://', 'wss://')}/stream`;

    try {
      this.dataWs = new WebSocket(dataUrl);

      this.dataWs.on('open', () => {
        logger.info(`🔌 Alpaca data WebSocket connected to ${dataUrl}`);
        this.dataWs?.send(JSON.stringify({
          action: 'auth',
          key: apiKey,
          secret: apiSecret
        }));
      });

      this.dataWs.on('message', (data: WebSocket.Data) => {
        this.handleDataMessage(data);
      });

      this.dataWs.on('error', (err) => {
        logger.warn('Alpaca data WebSocket error', { error: err.message });
      });

      this.dataWs.on('close', () => {
        logger.warn('Alpaca data WebSocket closed. Reconnecting with jitter...');
        this.scheduleReconnect();
      });

      // Also connect to Trading Stream for order updates
      this.tradeWs = new WebSocket(tradeUrl);

      this.tradeWs.on('open', () => {
        logger.info(`🔌 Alpaca trading WebSocket connected to ${tradeUrl}`);
        this.tradeWs?.send(JSON.stringify({
          action: 'authenticate',
          data: {
            key_id: apiKey,
            secret_key: apiSecret
          }
        }));
      });

      this.tradeWs.on('message', (data: WebSocket.Data) => {
        this.handleTradeMessage(data);
      });

      this.tradeWs.on('close', () => {
        logger.warn('Alpaca trading WebSocket closed.');
      });
    } catch (err: any) {
      logger.error('Failed to initialize Alpaca WebSocket connections', { error: err.message });
      this.scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  private handleDataMessage(raw: WebSocket.Data) {
    try {
      const messages = JSON.parse(raw.toString());
      if (!Array.isArray(messages)) return;

      const now = Date.now();

      for (const msg of messages) {
        if (msg.T === 'success' && msg.msg === 'authenticated') {
          logger.info('✅ Alpaca Data Stream authenticated successfully.');
          this.reconnectAttempts = 0;
          this.resubscribeSymbols();
          continue;
        }

        // Quote event: { T: 'q', S: 'AAPL', bp: 150.2, ap: 150.25, bs: 100, as: 200, t: '2026-09-26T14:30:00Z' }
        if (msg.T === 'q') {
          const providerTs = new Date(msg.t).getTime();
          const latencyMs = Math.max(0, now - providerTs);
          const bidPrice = Number(msg.bp) || 0;
          const askPrice = Number(msg.ap) || 0;
          const spread = parseFloat(Math.abs(askPrice - bidPrice).toFixed(4));
          const isStale = latencyMs > 5000; // > 5 seconds is flagged stale

          const quote: MarketQuote = {
            symbol: msg.S,
            bidPrice,
            askPrice,
            bidSize: Number(msg.bs) || 0,
            askSize: Number(msg.as) || 0,
            spread,
            timestamp: msg.t,
            receivedAt: now,
            latencyMs,
            isStale,
            marketSession: AlpacaMarketStreamService.classifyMarketHours(),
            feedType: this.feedType
          };

          this.quotesCache.set(msg.S, quote);
          getIO()?.emit('quote:update', quote);
        }
      }
    } catch {}
  }

  private handleTradeMessage(raw: WebSocket.Data) {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.stream === 'authorization' && msg.data?.status === 'authorized') {
        logger.info('✅ Alpaca Trade Stream authorized. Listening for trade_updates...');
        this.tradeWs?.send(JSON.stringify({
          action: 'listen',
          data: { streams: ['trade_updates'] }
        }));
        return;
      }

      if (msg.stream === 'trade_updates' && msg.data) {
        const tradeUpdate: TradeUpdateEvent = {
          event: msg.data.event,
          executionId: msg.data.execution_id,
          order: msg.data.order,
          timestamp: msg.data.timestamp,
          price: msg.data.price ? parseFloat(msg.data.price) : undefined,
          qty: msg.data.qty ? parseFloat(msg.data.qty) : undefined,
        };

        const eventKey = `${tradeUpdate.order?.id}-${tradeUpdate.event}-${tradeUpdate.timestamp}`;
        if (this.processedEventIds.has(eventKey)) {
          logger.warn(`Ignored duplicate trade update event: ${eventKey}`);
          return;
        }
        this.processedEventIds.add(eventKey);

        logger.info(`📢 Alpaca trade_update received: ${tradeUpdate.event} for order ${tradeUpdate.order?.id} (${tradeUpdate.order?.symbol})`);
        getIO()?.emit('trade:update', tradeUpdate);
      }
    } catch {}
  }

  private resubscribeSymbols() {
    if (!this.dataWs || this.dataWs.readyState !== WebSocket.OPEN) return;
    const symbols = Array.from(this.subscribedSymbols).slice(0, this.maxSubscriptionBudget);
    if (symbols.length === 0) return;
    this.dataWs.send(JSON.stringify({
      action: 'subscribe',
      quotes: symbols
    }));
    logger.info(`📡 Subscribed to real-time quotes for: ${symbols.join(', ')}`);
  }

  subscribe(symbol: string) {
    const clean = symbol.toUpperCase().trim();
    if (!this.subscribedSymbols.has(clean)) {
      if (this.subscribedSymbols.size >= this.maxSubscriptionBudget) {
        const oldest = this.subscribedSymbols.values().next().value;
        if (oldest) this.subscribedSymbols.delete(oldest);
      }
      this.subscribedSymbols.add(clean);
      this.resubscribeSymbols();
    }
  }

  getLatestQuote(symbol: string): MarketQuote | null {
    return this.quotesCache.get(symbol.toUpperCase()) || null;
  }

  private scheduleReconnect() {
    this.reconnectAttempts++;
    // Exponential backoff with secure jitter between 100ms and 1500ms
    const jitter = crypto.randomInt(100, 1500);
    const delay = Math.min(30000, Math.pow(2, this.reconnectAttempts) * 1000 + jitter);
    setTimeout(() => {
      this.startStream();
    }, delay);
  }
}

export const alpacaMarketStream = new AlpacaMarketStreamService();
