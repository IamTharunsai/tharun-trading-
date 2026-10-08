// ── PREDICTION VENUE INTERFACE ───────────────────────────────────────────────
// The Polymarket edge engine talks to a venue only through this read-only
// interface, so another venue (e.g. international Polymarket/CLOB) can be
// added later by implementing it. Only Polymarket US is implemented today
// (services/polymarketUS.ts → polymarketUSVenue).
//
// Deliberately NOT part of the interface: placing or cancelling real orders.
// Real orders stay in each venue module behind trading/liveGate.ts.
import type { Book } from '../trading/predictionMath';

export type VenueId = 'polymarket_us';

export interface VenueMarket {
  venue: VenueId;
  id: string;              // venue market key (Polymarket US: market slug)
  question: string;        // full question shown to the model
  outcomeLabel?: string;   // e.g. team name for multi-outcome events
  description?: string;    // resolution rules (untrusted text)
  category: string;        // e.g. sports, politics
  eventId?: string;        // markets in the same event are correlated
  eventTitle?: string;
  endDate?: string;        // ISO
  gameStartTime?: string;  // ISO, sports only
  marketType?: string;     // futures, moneyline, election, …
  open: boolean;           // tradable right now
  bestBid?: number;        // YES bid
  bestAsk?: number;        // YES ask
  feeCoefficient: number;  // taker Θ
  tickSize: number;
  minQty: number;
}

export interface VenueBook extends Book {
  state?: string;
  lastTrade?: number;      // YES price of the last trade
  lastTradeAt?: number;    // ms epoch of the last trade
  openInterest?: number;
  volume?: number;         // cumulative shares traded
  fetchedAt: number;
}

export interface VenuePricePoint { t: number; p: number } // unix seconds, YES mid

export interface PredictionVenue {
  id: VenueId;
  listMarkets(max: number): Promise<VenueMarket[]>;
  getBook(marketId: string): Promise<VenueBook | null>;
  getPriceHistory(marketId: string): Promise<VenuePricePoint[]>;
  /** YES settlement value 0..1, or null while unsettled / unknown. */
  getSettlement(marketId: string): Promise<number | null>;
}
