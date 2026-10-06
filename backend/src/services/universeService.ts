// ── UNIVERSE SERVICE ──────────────────────────────────────────────────────────
// The single source of truth for "which symbols exist, what sector they are in,
// and which ones are worth looking at right now". Nothing in the platform should
// carry a hand-written ticker list any more — pickers, scanners and agents all
// read from here.
//
// Sources (all free):
//   1. Nasdaq public screener  — every US-listed stock (NYSE/NASDAQ/AMEX, ~7,000)
//      with REAL sector, industry, market cap, last price, % change and volume,
//      in ONE request. Refreshed every 6 hours.
//   2. Alpaca /v2/assets       — which of those are actually tradable / fractionable.
//   3. Alpaca screener         — intraday most-actives + top movers (real time),
//      refreshed every 5 minutes during market hours.
//   4. Crypto list from marketData (Binance feed).
// If Nasdaq is unreachable we degrade to Alpaca's asset list (no sectors), and
// say so via `source` — we never invent sectors or prices.
import axios from 'axios';
import { logger } from '../utils/logger';
import { appConfig } from '../utils/config';

export interface UniverseSymbol {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  market: 'stocks' | 'crypto';
  tradable: boolean;
  fractionable: boolean;
  isEtf: boolean;
}

export interface UniverseCategory {
  id: string;
  label: string;
  group: 'dynamic' | 'sector' | 'cap' | 'etf' | 'crypto' | 'portfolio';
  count: number;
}

const NASDAQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

// Nasdaq's sector names → the labels the UI shows.
const SECTOR_LABELS: Record<string, string> = {
  'Technology': 'Technology',
  'Health Care': 'Healthcare',
  'Finance': 'Financials',
  'Consumer Discretionary': 'Consumer Discretionary',
  'Consumer Staples': 'Consumer Staples',
  'Industrials': 'Industrials',
  'Energy': 'Energy',
  'Utilities': 'Utilities',
  'Real Estate': 'Real Estate',
  'Basic Materials': 'Materials',
  'Telecommunications': 'Communication Services',
  'Miscellaneous': 'Other',
};

function num(v: any): number | null {
  if (v === null || v === undefined || v === '' || v === 'NA') return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

class UniverseService {
  private stocks = new Map<string, UniverseSymbol>();
  private movers: { mostActive: string[]; gainers: string[]; losers: string[]; at: string | null; live: boolean } = { mostActive: [], gainers: [], losers: [], at: null, live: false };
  private source = 'NOT_SYNCED';
  private syncedAt: string | null = null;
  private syncing: Promise<void> | null = null;
  private timers: NodeJS.Timeout[] = [];
  private cryptoSymbols: string[] = [];
  private cryptoPrices: () => Record<string, number> = () => ({});

  setCrypto(symbols: string[], priceFn: () => Record<string, number>) {
    this.cryptoSymbols = symbols;
    this.cryptoPrices = priceFn;
  }

  start() {
    if (this.timers.length) return;
    this.sync().catch(() => {});
    this.timers.push(setInterval(() => this.sync().catch(() => {}), 6 * 60 * 60 * 1000));
    this.timers.push(setInterval(() => this.refreshMovers().catch(() => {}), 5 * 60 * 1000));
  }

  stop() { this.timers.forEach(clearInterval); this.timers = []; }

  status() {
    return { source: this.source, syncedAt: this.syncedAt, stocks: this.stocks.size, moversAt: this.movers.at };
  }

  /** Test hook: load rows directly. */
  load(rows: UniverseSymbol[], source = 'TEST') {
    this.stocks = new Map(rows.map(r => [r.symbol, r]));
    this.source = source;
    this.syncedAt = new Date().toISOString();
  }

  async sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      const started = Date.now();
      const [nasdaq, etfs, alpaca] = await Promise.all([
        this.fetchNasdaqStocks().catch(err => { logger.warn('Universe: Nasdaq stock screener failed', { error: err?.message }); return [] as UniverseSymbol[]; }),
        this.fetchNasdaqEtfs().catch(() => [] as UniverseSymbol[]),
        this.fetchAlpacaAssets().catch(err => { logger.warn('Universe: Alpaca assets failed', { error: err?.message }); return new Map<string, any>(); }),
      ]);

      const next = new Map<string, UniverseSymbol>();
      for (const row of [...nasdaq, ...etfs]) next.set(row.symbol, row);

      // Mark tradability from Alpaca; add Alpaca-only symbols (no sector known).
      for (const [sym, a] of alpaca) {
        const row = next.get(sym);
        if (row) {
          row.tradable = Boolean(a.tradable);
          row.fractionable = Boolean(a.fractionable);
          if (/ETF|TRUST|FUND/i.test(a.name || '')) row.isEtf = row.isEtf || /ETF/i.test(a.name || '');
        } else if (a.tradable) {
          next.set(sym, {
            symbol: sym, name: a.name || sym, sector: null, industry: null, marketCap: null,
            price: null, changePct: null, volume: null, market: 'stocks',
            tradable: true, fractionable: Boolean(a.fractionable), isEtf: /\bETF\b/i.test(a.name || ''),
          });
        }
      }
      if (alpaca.size === 0) {
        // Without Alpaca we cannot confirm tradability; keep listed stocks as candidates.
        for (const row of next.values()) row.tradable = true;
      }

      if (next.size > 0) {
        this.stocks = next;
        this.source = nasdaq.length > 0 ? (alpaca.size > 0 ? 'NASDAQ_SCREENER+ALPACA' : 'NASDAQ_SCREENER') : 'ALPACA_ASSETS';
        this.syncedAt = new Date().toISOString();
        this.rebuildMoversFromSnapshot();
        logger.info(`🌐 Universe synced: ${next.size} symbols (${this.source}) in ${Date.now() - started}ms`);
      }
      await this.refreshMovers().catch(() => {});
    })().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async fetchNasdaqStocks(): Promise<UniverseSymbol[]> {
    const res = await axios.get('https://api.nasdaq.com/api/screener/stocks', {
      params: { tableonly: 'true', download: 'true' }, headers: NASDAQ_HEADERS, timeout: 30000,
    });
    const rows: any[] = res.data?.data?.rows || [];
    return rows
      .filter(r => r?.symbol && !/[\^/ ]/.test(r.symbol))
      .map(r => {
        const sector = r.sector ? (SECTOR_LABELS[r.sector] || r.sector) : null;
        return {
          symbol: String(r.symbol).trim().toUpperCase(),
          name: String(r.name || r.symbol).replace(/\s+(Common Stock|Class [A-C] Common Stock|Ordinary Shares|American Depositary Shares).*$/i, '').trim(),
          sector, industry: r.industry || null,
          marketCap: num(r.marketCap), price: num(r.lastsale), changePct: num(r.pctchange), volume: num(r.volume),
          market: 'stocks' as const, tradable: false, fractionable: false, isEtf: false,
        };
      });
  }

  private async fetchNasdaqEtfs(): Promise<UniverseSymbol[]> {
    const res = await axios.get('https://api.nasdaq.com/api/screener/etf', {
      params: { tableonly: 'true', download: 'true' }, headers: NASDAQ_HEADERS, timeout: 30000,
    });
    const rows: any[] = res.data?.data?.data?.rows || res.data?.data?.rows || [];
    return rows.filter(r => r?.symbol).map(r => ({
      symbol: String(r.symbol).trim().toUpperCase(),
      name: String(r.companyName || r.name || r.symbol),
      sector: 'ETF', industry: null, marketCap: null,
      price: num(r.lastSalePrice || r.lastsale), changePct: num(r.percentageChange || r.pctchange), volume: null,
      market: 'stocks' as const, tradable: false, fractionable: false, isEtf: true,
    }));
  }

  private alpacaHeaders() {
    return { 'APCA-API-KEY-ID': appConfig.ALPACA.paperApiKey || '', 'APCA-API-SECRET-KEY': appConfig.ALPACA.paperSecretKey || '' };
  }

  private async fetchAlpacaAssets(): Promise<Map<string, any>> {
    const out = new Map<string, any>();
    if (!appConfig.ALPACA.isPaperConfigured) return out;
    const res = await axios.get(`${appConfig.ALPACA.paperBaseUrl}/v2/assets`, {
      params: { status: 'active', asset_class: 'us_equity' }, headers: this.alpacaHeaders(), timeout: 30000,
    });
    for (const a of res.data || []) {
      const sym = String(a.symbol || '').toUpperCase();
      if (sym && !sym.includes('/') && !sym.includes('.')) out.set(sym, a);
    }
    return out;
  }

  /** Real-time intraday leaders from Alpaca's screener (falls back to the Nasdaq snapshot). */
  async refreshMovers(): Promise<void> {
    if (!appConfig.ALPACA.isPaperConfigured) return;
    const base = 'https://data.alpaca.markets/v1beta1/screener/stocks';
    const [active, movers] = await Promise.all([
      axios.get(`${base}/most-actives`, { params: { by: 'volume', top: 100 }, headers: this.alpacaHeaders(), timeout: 15000 }).then(r => r.data).catch(() => null),
      axios.get(`${base}/movers`, { params: { top: 50 }, headers: this.alpacaHeaders(), timeout: 15000 }).then(r => r.data).catch(() => null),
    ]);
    const clean = (list: any[] | undefined) => (list || []).map((x: any) => String(x.symbol || '').toUpperCase()).filter(s => s && this.stocks.get(s)?.tradable !== false);
    if (active?.most_actives?.length) this.movers.mostActive = clean(active.most_actives);
    if (movers?.gainers?.length) this.movers.gainers = clean(movers.gainers);
    if (movers?.losers?.length) this.movers.losers = clean(movers.losers);
    // Fold live price / change into our rows.
    for (const m of [...(movers?.gainers || []), ...(movers?.losers || [])]) {
      const row = this.stocks.get(String(m.symbol).toUpperCase());
      if (row) { row.price = num(m.price) ?? row.price; row.changePct = num(m.percent_change) ?? row.changePct; }
    }
    if (active || movers) { this.movers.at = new Date().toISOString(); this.movers.live = true; }
  }

  private rebuildMoversFromSnapshot() {
    const liquid = [...this.stocks.values()].filter(s => s.tradable && !s.isEtf && (s.price ?? 0) >= 2 && (s.volume ?? 0) > 0);
    this.movers.mostActive = [...liquid].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 100).map(s => s.symbol);
    const withChange = liquid.filter(s => s.changePct !== null && (s.volume ?? 0) >= 500_000);
    this.movers.gainers = [...withChange].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, 50).map(s => s.symbol);
    this.movers.losers = [...withChange].sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, 50).map(s => s.symbol);
  }

  get(symbol: string): UniverseSymbol | undefined {
    return this.stocks.get(symbol.toUpperCase());
  }

  private cryptoRows(): UniverseSymbol[] {
    const prices = this.cryptoPrices();
    return this.cryptoSymbols.map(sym => ({
      symbol: sym, name: sym, sector: 'Crypto', industry: null, marketCap: null,
      price: prices[sym] ?? null, changePct: null, volume: null, market: 'crypto' as const,
      tradable: true, fractionable: true, isEtf: false,
    }));
  }

  private capBucket(mc: number | null): string | null {
    if (!mc) return null;
    if (mc >= 200e9) return 'cap_mega';
    if (mc >= 10e9) return 'cap_large';
    if (mc >= 2e9) return 'cap_mid';
    if (mc >= 300e6) return 'cap_small';
    return 'cap_micro';
  }

  categories(extra: { portfolio?: string[]; watchlist?: string[] } = {}): UniverseCategory[] {
    const all = [...this.stocks.values()];
    const cats: UniverseCategory[] = [];
    if (extra.portfolio?.length) cats.push({ id: 'portfolio', label: 'In my portfolio', group: 'portfolio', count: extra.portfolio.length });
    cats.push({ id: 'most_active', label: 'Most active today', group: 'dynamic', count: this.movers.mostActive.length });
    cats.push({ id: 'top_gainers', label: 'Top gainers', group: 'dynamic', count: this.movers.gainers.length });
    cats.push({ id: 'top_losers', label: 'Top losers', group: 'dynamic', count: this.movers.losers.length });
    if (extra.watchlist?.length) cats.push({ id: 'agent_watchlist', label: 'Recently analysed by agents', group: 'dynamic', count: extra.watchlist.length });

    const sectorCounts = new Map<string, number>();
    for (const s of all) if (s.sector && !s.isEtf) sectorCounts.set(s.sector, (sectorCounts.get(s.sector) || 0) + 1);
    [...sectorCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([sector, count]) =>
      cats.push({ id: `sector_${slug(sector)}`, label: sector, group: 'sector', count }));

    const caps: Array<[string, string]> = [['cap_mega', 'Mega cap (>$200B)'], ['cap_large', 'Large cap ($10B–$200B)'], ['cap_mid', 'Mid cap ($2B–$10B)'], ['cap_small', 'Small cap ($300M–$2B)'], ['cap_micro', 'Micro cap (<$300M)']];
    for (const [id, label] of caps) {
      const count = all.filter(s => !s.isEtf && this.capBucket(s.marketCap) === id).length;
      if (count) cats.push({ id, label, group: 'cap', count });
    }
    const etfCount = all.filter(s => s.isEtf).length;
    if (etfCount) cats.push({ id: 'etf', label: 'ETFs', group: 'etf', count: etfCount });
    if (this.cryptoSymbols.length) cats.push({ id: 'crypto', label: 'Crypto', group: 'crypto', count: this.cryptoSymbols.length });
    return cats;
  }

  symbols(opts: { category?: string; search?: string; limit?: number; offset?: number; tradableOnly?: boolean; portfolio?: string[]; watchlist?: string[] }): { symbols: UniverseSymbol[]; total: number } {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const cat = opts.category || '';
    const bySymbols = (list: string[]) => list.map(s => this.stocks.get(s) || this.cryptoRows().find(c => c.symbol === s) || {
      symbol: s, name: s, sector: null, industry: null, marketCap: null, price: null, changePct: null, volume: null,
      market: 'stocks' as const, tradable: true, fractionable: false, isEtf: false,
    });

    let list: UniverseSymbol[];
    if (cat === 'most_active') list = bySymbols(this.movers.mostActive);
    else if (cat === 'top_gainers') list = bySymbols(this.movers.gainers);
    else if (cat === 'top_losers') list = bySymbols(this.movers.losers);
    else if (cat === 'portfolio') list = bySymbols(opts.portfolio || []);
    else if (cat === 'agent_watchlist') list = bySymbols(opts.watchlist || []);
    else if (cat === 'crypto') list = this.cryptoRows();
    else if (cat === 'etf') list = [...this.stocks.values()].filter(s => s.isEtf).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    else if (cat.startsWith('cap_')) list = [...this.stocks.values()].filter(s => !s.isEtf && this.capBucket(s.marketCap) === cat).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    else if (cat.startsWith('sector_')) list = [...this.stocks.values()].filter(s => !s.isEtf && s.sector && `sector_${slug(s.sector)}` === cat).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    else list = [...[...this.stocks.values()].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)), ...this.cryptoRows()];

    if (opts.tradableOnly) list = list.filter(s => s.tradable);
    const q = (opts.search || '').trim().toUpperCase();
    if (q) {
      // Exact ticker first, then ticker prefix, then name match.
      const pool = cat ? list : [...this.stocks.values(), ...this.cryptoRows()];
      const exact = pool.filter(s => s.symbol === q);
      const prefix = pool.filter(s => s.symbol !== q && s.symbol.startsWith(q));
      const name = pool.filter(s => !s.symbol.startsWith(q) && s.name.toUpperCase().includes(q));
      list = [...exact, ...prefix.sort((a, b) => a.symbol.length - b.symbol.length), ...name.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))];
    }
    return { symbols: list.slice(offset, offset + limit), total: list.length };
  }

  /**
   * Liquid, tradable, moving stocks for the intraday scanner — no fixed list.
   * Ranked by (live most-actives ∪ gainers ∪ losers), then by snapshot volume.
   */
  intradayCandidates(count: number, opts: { minPrice?: number; maxPrice?: number; minVolume?: number; exclude?: Set<string> } = {}): string[] {
    const minPrice = opts.minPrice ?? 5;
    const maxPrice = opts.maxPrice ?? 1000;
    const minVolume = opts.minVolume ?? 1_000_000;
    const seen = new Set<string>();
    const out: string[] = [];
    const ok = (sym: string) => {
      const r = this.stocks.get(sym);
      if (!r || !r.tradable || r.isEtf) return false;
      if (r.price !== null && (r.price < minPrice || r.price > maxPrice)) return false;
      // Live (Alpaca real-time) most-actives override the stale snapshot volume.
      if (r.volume !== null && r.volume < minVolume && !(this.movers.live && this.movers.mostActive.includes(sym))) return false;
      return !opts.exclude?.has(sym);
    };
    const ranked = [...this.movers.mostActive, ...this.movers.gainers, ...this.movers.losers,
      ...[...this.stocks.values()].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).map(s => s.symbol)];
    for (const sym of ranked) {
      if (out.length >= count) break;
      if (seen.has(sym)) continue;
      seen.add(sym);
      if (ok(sym)) out.push(sym);
    }
    return out;
  }

  /** Long-term / swing candidates: tradable large & mid caps across ALL sectors (sector-balanced). */
  swingCandidates(count: number, exclude: Set<string> = new Set()): string[] {
    const bySector = new Map<string, UniverseSymbol[]>();
    for (const s of this.stocks.values()) {
      if (!s.tradable || s.isEtf || !s.sector || (s.marketCap ?? 0) < 2e9 || (s.price ?? 0) < 5 || exclude.has(s.symbol)) continue;
      const arr = bySector.get(s.sector) || [];
      arr.push(s);
      bySector.set(s.sector, arr);
    }
    // Within each sector prefer today's strongest relative movers with volume.
    for (const arr of bySector.values()) arr.sort((a, b) => ((b.changePct ?? 0) * Math.log10((b.volume ?? 1) + 1)) - ((a.changePct ?? 0) * Math.log10((a.volume ?? 1) + 1)));
    const out: string[] = [];
    let round = 0;
    while (out.length < count) {
      let added = false;
      for (const arr of bySector.values()) {
        if (arr[round]) { out.push(arr[round].symbol); added = true; if (out.length >= count) break; }
      }
      if (!added) break;
      round++;
    }
    return out;
  }
}

export const universe = new UniverseService();
