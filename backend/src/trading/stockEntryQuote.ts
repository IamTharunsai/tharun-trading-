import axios from 'axios';
import type { AlpacaBroker } from '../services/alpacaBroker';
import { getActiveMode, getTradingBroker, getTradingCredentials, BrokerMode } from './brokerRouter';
import type { StockEntryQuote } from './stockEntryPolicy';

// Internal binding; never serialize/log credentials or this object.
export interface StockQuoteBinding { broker: AlpacaBroker; mode: BrokerMode; apiKey: string; secret: string; }
export function bindStockQuote(mode: BrokerMode, broker: AlpacaBroker): StockQuoteBinding {
  const credentials = getTradingCredentials();
  if (!credentials || credentials.mode !== mode || getTradingBroker() !== broker) throw new Error('STOCK_ENTRY_ACCOUNT_CHANGED');
  return { broker, ...credentials };
}
export function assertStockQuoteBinding(binding: StockQuoteBinding) {
  const current = getTradingCredentials();
  if (!current || current.mode !== binding.mode || getActiveMode() !== binding.mode || getTradingBroker() !== binding.broker
    || current.apiKey !== binding.apiKey || current.secret !== binding.secret) throw new Error('STOCK_ENTRY_ACCOUNT_CHANGED');
}

/** https://docs.alpaca.markets/us/v1.4.2/reference/stocklatestquotesingle-1
 * IEX venue observations, not SIP/NBBO or a guaranteed market-order fill. */
export async function readStockEntryQuote(symbol: string, binding: StockQuoteBinding): Promise<StockEntryQuote> {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new Error('STOCK_ENTRY_SYMBOL_INVALID');
  assertStockQuoteBinding(binding);
  const requestedAt = Date.now();
  let response;
  try {
    response = await axios.get(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`, {
      headers: { 'APCA-API-KEY-ID': binding.apiKey, 'APCA-API-SECRET-KEY': binding.secret },
      params: { feed: 'iex', currency: 'USD' }, maxRedirects: 0, maxContentLength: 16384,
      timeout: 3000, signal: AbortSignal.timeout(4000),
    });
  } catch { throw new Error('STOCK_ENTRY_QUOTE_UNAVAILABLE'); }
  const receivedAt = Date.now();
  assertStockQuoteBinding(binding);
  const raw = response.data;
  if (receivedAt < requestedAt || raw?.symbol !== symbol || !raw.quote || typeof raw.quote.t !== 'string') throw new Error('STOCK_ENTRY_QUOTE_INVALID');
  return { symbol, source: 'Alpaca IEX', bid: raw.quote.bp, ask: raw.quote.ap,
    observedAt: Date.parse(raw.quote.t), receivedAt };
}
