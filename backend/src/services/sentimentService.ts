// ── SENTIMENT FEED (X + news) ─────────────────────────────────────────────────
// Produces one honest number per asset: a -1..+1 sentiment score, plus how
// much evidence it rests on (mention count, volume z-score vs. our own
// history, per-source counts, freshness). It is a FILTER and a SIZER for the
// technical committee, never a trade trigger on its own.
//
// Sources (each is optional and fails soft):
//   • Alpaca News API     — stocks + crypto (uses the Alpaca data keys you already have)
//   • Finnhub company-news — stocks (FINNHUB_API_KEY); crypto category news filtered by name
//   • CryptoPanic          — crypto (CRYPTOPANIC_API_KEY, paid plan)
//   • alternative.me Fear & Greed — crypto market mood (free, no key)
//   • GDELT DOC 2.0        — free global news; fallback for assets, primary for Polymarket questions
//   • X API v2 recent search — ONLY when X_BEARER_TOKEN is set (graceful no-op otherwise),
//                              capped by X_MAX_REQUESTS_PER_DAY because X bills per read.
// Scoring: kronos-service FinBERT (/api/sentiment) when KRONOS_SERVICE_URL is
// set and reachable, else a small finance lexicon in this file.
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { redis } from '../utils/redis';

export type SentimentSource = 'alpaca' | 'finnhub' | 'cryptopanic' | 'gdelt' | 'x';
export type SentimentMarket = 'stocks' | 'crypto' | 'forex' | 'prediction';

export interface SentimentItem {
  source: SentimentSource;
  text: string;
  url?: string;
  publishedAt: Date;
  engagement?: number;          // X: likes + 2×reposts + replies
  authorFollowers?: number;     // X only
  authorCreatedAt?: Date;       // X only
}

export interface SentimentResult {
  asset: string;
  market: SentimentMarket;
  score: number;                // -1 (bearish) .. +1 (bullish)
  confidence: number;           // 0..1, grows with evidence
  mentionCount: number;         // items kept after filtering
  filteredOut: number;          // duplicates / promo / bot-like removed
  volumeZScore: number;         // mentionCount vs. trailing 7-day snapshot history (0 when <5 samples)
  baselineSamples: number;
  sourceCounts: Partial<Record<SentimentSource, number>>;
  freshnessMinutes: number | null; // age of the newest kept item
  fearGreed?: { value: number; classification: string } | null;
  scorer: 'finbert' | 'kronos-keyword' | 'lexicon' | 'none';
  headlines: string[];          // top recent items, for logs / LLM prompts
  computedAt: string;
}

export interface SentimentConfig {
  vetoThreshold: number;
  minMentions: number;
  maxAgeMinutes: number;
  spikeZ: number;
}

export function readSentimentConfig(): SentimentConfig {
  const n = (name: string, d: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return {
    vetoThreshold: n('SENTIMENT_VETO_THRESHOLD', 0.3),
    minMentions: n('SENTIMENT_MIN_MENTIONS', 5),
    maxAgeMinutes: n('SENTIMENT_MAX_AGE_MIN', 360),
    spikeZ: n('SENTIMENT_SPIKE_Z', 2),
  };
}

/** SENTIMENT_ENABLED=true|false. Unset → on in paper mode, off in live (opt in explicitly). */
export function isSentimentEnabled(): boolean {
  const raw = String(process.env.SENTIMENT_ENABLED ?? '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAlpacaMode } = require('../trading/liveGate');
    return getAlpacaMode() === 'paper';
  } catch {
    return false;
  }
}

// ── Gate: how sentiment may influence a technical decision ────────────────────

export interface SentimentGateResult {
  veto: boolean;
  multiplier: number;  // 0.5 .. 1.25 position-size multiplier
  meaningful: boolean; // enough fresh evidence to act on
  reason: string;
}

/**
 * Never creates a trade. Given the committee's BUY/SELL:
 *   • veto BUY when score < -threshold, veto SELL when score > +threshold
 *     (only with ≥ SENTIMENT_MIN_MENTIONS fresh items)
 *   • otherwise scale size 0.5×–1.25× by how much sentiment agrees
 *   • thin/stale evidence → no effect (1.0×)
 */
export function evaluateSentimentGate(
  direction: 'BUY' | 'SELL' | 'HOLD',
  s: SentimentResult | null | undefined,
  cfg: SentimentConfig = readSentimentConfig(),
): SentimentGateResult {
  if (direction === 'HOLD') return { veto: false, multiplier: 1, meaningful: false, reason: 'HOLD — sentiment not applied' };
  if (!s) return { veto: false, multiplier: 1, meaningful: false, reason: 'no sentiment data' };
  const fresh = s.freshnessMinutes !== null && s.freshnessMinutes <= cfg.maxAgeMinutes;
  const meaningful = s.mentionCount >= cfg.minMentions && fresh;
  if (!meaningful) {
    return { veto: false, multiplier: 1, meaningful: false, reason: `thin/stale evidence (${s.mentionCount} items, newest ${s.freshnessMinutes ?? '–'} min) — no effect` };
  }
  const score = Math.max(-1, Math.min(1, s.score));
  if (direction === 'BUY' && score < -cfg.vetoThreshold) {
    return { veto: true, multiplier: 0, meaningful, reason: `VETO BUY: sentiment ${score.toFixed(2)} < -${cfg.vetoThreshold} on ${s.mentionCount} items` };
  }
  if (direction === 'SELL' && score > cfg.vetoThreshold) {
    return { veto: true, multiplier: 0, meaningful, reason: `VETO SELL: sentiment ${score.toFixed(2)} > +${cfg.vetoThreshold} on ${s.mentionCount} items` };
  }
  const aligned = direction === 'BUY' ? score : -score; // + agrees, - disagrees
  const multiplier = aligned >= 0
    ? Math.min(1.25, 1 + aligned * 0.5)
    : Math.max(0.5, 1 + aligned * 1.5);
  return { veto: false, multiplier: +multiplier.toFixed(3), meaningful, reason: `sentiment ${score.toFixed(2)} on ${s.mentionCount} items → size ×${multiplier.toFixed(2)}` };
}

// ── Text hygiene: duplicates, promo spam, bot-like accounts ───────────────────

const PROMO_RE = /(giveaway|airdrop|free\s+(crypto|money|signals?|tokens?)|join\s+(my|our)\b|t\.me\/|telegram|discord\.gg|whatsapp|\bdm\s+(me|for)\b|\b\d{3,}x\b|guaranteed|presale|pre-sale|referral|promo\s*code|sign\s?up\s+bonus|link\s+in\s+bio|vip\s+(group|signals?)|copy\s+my\s+trades|next\s+100x|pump\s+(it|incoming)|moon\s*soon)/i;

export function normalizeText(t: string): string {
  return String(t || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9$#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPromo(text: string): boolean {
  return PROMO_RE.test(text);
}

export function isBotLike(item: SentimentItem, now = Date.now()): boolean {
  if (item.source !== 'x') return false;
  const t = item.text || '';
  if (normalizeText(t).length < 15) return true;
  if ((t.match(/\$[A-Za-z]{1,6}\b/g) || []).length > 4) return true;   // cashtag stuffing
  if ((t.match(/#\w+/g) || []).length > 6) return true;                 // hashtag stuffing
  if (item.authorFollowers !== undefined && item.authorFollowers < 25) return true;
  if (item.authorCreatedAt && now - item.authorCreatedAt.getTime() < 30 * 86_400_000) return true;
  return false;
}

export function filterItems(items: SentimentItem[], now = Date.now()): { kept: SentimentItem[]; removed: number } {
  const seen = new Set<string>();
  const kept: SentimentItem[] = [];
  for (const it of items) {
    if (!it?.text || !(it.publishedAt instanceof Date) || isNaN(it.publishedAt.getTime())) continue;
    const key = normalizeText(it.text).slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isPromo(it.text) || isBotLike(it, now)) continue;
    kept.push(it);
  }
  return { kept, removed: items.length - kept.length };
}

// ── Lexicon fallback scorer ──────────────────────────────────────────────────

const POS = ['beat', 'beats', 'surge', 'surges', 'soar', 'soars', 'rally', 'rallies', 'gain', 'gains', 'jump', 'jumps', 'record', 'upgrade', 'upgraded', 'outperform', 'bullish', 'growth', 'profit', 'profits', 'strong', 'raises', 'raised', 'approval', 'approved', 'buyback', 'breakout', 'exceeds', 'tops', 'rebound', 'optimistic', 'partnership', 'inflows', 'adoption', 'etf approval'];
const NEG = ['miss', 'misses', 'missed', 'plunge', 'plunges', 'drop', 'drops', 'fall', 'falls', 'slump', 'crash', 'downgrade', 'downgraded', 'underperform', 'bearish', 'loss', 'losses', 'weak', 'cuts', 'lawsuit', 'probe', 'investigation', 'fraud', 'hack', 'hacked', 'exploit', 'bankruptcy', 'recall', 'layoffs', 'outflows', 'ban', 'banned', 'delist', 'warning', 'sell-off', 'selloff', 'liquidations', 'default'];
const NEGATORS = new Set(['not', 'no', 'never', "isn't", "wasn't", "don't", "doesn't", 'without']);

export function lexiconScore(text: string): number {
  const tokens = String(text || '').toLowerCase().replace(/[^a-z0-9'\-\s]/g, ' ').split(/\s+/).filter(Boolean);
  let pos = 0, neg = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const isPos = POS.includes(tok), isNeg = NEG.includes(tok);
    if (!isPos && !isNeg) continue;
    const negated = NEGATORS.has(tokens[i - 1]) || NEGATORS.has(tokens[i - 2]);
    if ((isPos && !negated) || (isNeg && negated)) pos++; else neg++;
  }
  if (pos + neg === 0) return 0;
  return (pos - neg) / (pos + neg + 1);
}

async function scoreTexts(texts: string[]): Promise<{ scores: number[]; scorer: SentimentResult['scorer'] }> {
  if (texts.length === 0) return { scores: [], scorer: 'none' };
  const base = process.env.KRONOS_SERVICE_URL;
  if (base) {
    try {
      const out: number[] = [];
      let model = '';
      for (let i = 0; i < texts.length; i += 100) {
        const batch = texts.slice(i, i + 100).map(t => t.slice(0, 500));
        const r = await axios.post(`${base.replace(/\/$/, '')}/api/sentiment`, { texts: batch }, { timeout: 20_000 });
        const results = r?.data?.results;
        if (!Array.isArray(results) || results.length !== batch.length) throw new Error('bad FinBERT response');
        model = String(r.data.model || '');
        for (const x of results) out.push(Math.max(-1, Math.min(1, (Number(x.positive) || 0) - (Number(x.negative) || 0))));
      }
      return { scores: out, scorer: model.includes('keyword') ? 'kronos-keyword' : 'finbert' };
    } catch (err: any) {
      logger.debug(`[SENTIMENT] FinBERT unavailable (${err?.message}) — using lexicon`);
    }
  }
  return { scores: texts.map(lexiconScore), scorer: 'lexicon' };
}

// ── Source fetchers ──────────────────────────────────────────────────────────

const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binance coin', ADA: 'cardano', AVAX: 'avalanche',
  LINK: 'chainlink', DOT: 'polkadot', UNI: 'uniswap', MATIC: 'polygon', XRP: 'xrp', DOGE: 'dogecoin',
  SHIB: 'shiba inu', LTC: 'litecoin', BCH: 'bitcoin cash', ATOM: 'cosmos', FIL: 'filecoin', NEAR: 'near protocol',
  APT: 'aptos', ARB: 'arbitrum', OP: 'optimism', INJ: 'injective', SUI: 'sui', PEPE: 'pepe',
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function alpacaDataKeys(): { key?: string; secret?: string } {
  const key = process.env.ALPACA_PAPER_API_KEY || process.env.ALPACA_API_KEY || process.env.ALPACA_LIVE_API_KEY;
  const secret = process.env.ALPACA_PAPER_SECRET_KEY || process.env.ALPACA_SECRET_KEY || process.env.ALPACA_LIVE_SECRET_KEY;
  return { key, secret };
}

export async function fetchAlpacaNews(asset: string, market: SentimentMarket, since: Date): Promise<SentimentItem[]> {
  const { key, secret } = alpacaDataKeys();
  if (!key || !secret) return [];
  const symbol = market === 'crypto' ? `${asset}USD` : asset;
  const r = await axios.get('https://data.alpaca.markets/v1beta1/news', {
    params: { symbols: symbol, start: since.toISOString(), limit: 50, sort: 'desc' },
    headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
    timeout: 10_000,
  });
  return (r?.data?.news || []).map((n: any) => ({
    source: 'alpaca' as const,
    text: [n.headline, n.summary].filter(Boolean).join('. '),
    url: n.url,
    publishedAt: new Date(n.created_at || n.updated_at),
  }));
}

export async function fetchFinnhubNews(asset: string, market: SentimentMarket, since: Date): Promise<SentimentItem[]> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) return [];
  if (market === 'crypto') {
    const name = CRYPTO_NAMES[asset] || asset.toLowerCase();
    const r = await axios.get('https://finnhub.io/api/v1/news', { params: { category: 'crypto', token }, timeout: 10_000 });
    const re = new RegExp(`\\b(${asset}|${name})\\b`, 'i');
    return (Array.isArray(r?.data) ? r.data : [])
      .filter((n: any) => re.test(`${n.headline} ${n.summary}`))
      .map((n: any) => ({ source: 'finnhub' as const, text: [n.headline, n.summary].filter(Boolean).join('. '), url: n.url, publishedAt: new Date((n.datetime || 0) * 1000) }))
      .filter((it: SentimentItem) => it.publishedAt >= since);
  }
  const r = await axios.get('https://finnhub.io/api/v1/company-news', {
    params: { symbol: asset, from: ymd(since), to: ymd(new Date()), token },
    timeout: 10_000,
  });
  return (Array.isArray(r?.data) ? r.data : [])
    .map((n: any) => ({ source: 'finnhub' as const, text: [n.headline, n.summary].filter(Boolean).join('. '), url: n.url, publishedAt: new Date((n.datetime || 0) * 1000) }))
    .filter((it: SentimentItem) => it.publishedAt >= since)
    .slice(0, 50);
}

export async function fetchCryptoPanic(asset: string, market: SentimentMarket, since: Date): Promise<SentimentItem[]> {
  const token = process.env.CRYPTOPANIC_API_KEY;
  if (!token || market !== 'crypto') return [];
  const plan = process.env.CRYPTOPANIC_API_PLAN || 'developer';
  const r = await axios.get(`https://cryptopanic.com/api/${plan}/v2/posts/`, {
    params: { auth_token: token, currencies: asset, kind: 'news', public: 'true' },
    timeout: 10_000,
  });
  return (r?.data?.results || [])
    .map((p: any) => ({ source: 'cryptopanic' as const, text: [p.title, p.description].filter(Boolean).join('. '), url: p.url, publishedAt: new Date(p.published_at || p.created_at) }))
    .filter((it: SentimentItem) => it.publishedAt >= since);
}

let fngCache: { at: number; value: SentimentResult['fearGreed'] } | null = null;
export async function fetchFearGreed(): Promise<SentimentResult['fearGreed']> {
  if (fngCache && Date.now() - fngCache.at < 3_600_000) return fngCache.value;
  const r = await axios.get('https://api.alternative.me/fng/', { params: { limit: 1 }, timeout: 8_000 });
  const d = r?.data?.data?.[0];
  const value = d ? { value: Number(d.value), classification: String(d.value_classification || '') } : null;
  if (value && !Number.isFinite(value.value)) return null;
  fngCache = { at: Date.now(), value };
  return value;
}

// GDELT asks for ≤1 request / 5 s. Serialise calls with a minimum gap.
let gdeltNextSlot = 0;
async function gdeltThrottle() {
  const gap = Number(process.env.SENTIMENT_GDELT_MIN_INTERVAL_MS ?? 5000);
  const now = Date.now();
  const wait = Math.max(0, gdeltNextSlot - now);
  gdeltNextSlot = Math.max(now, gdeltNextSlot) + gap;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

function parseGdeltDate(s: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s || ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(NaN);
}

export async function fetchGdelt(query: string, hours: number): Promise<SentimentItem[]> {
  if (!query.trim()) return [];
  await gdeltThrottle();
  const r = await axios.get('https://api.gdeltproject.org/api/v2/doc/doc', {
    params: { query: `${query} sourcelang:english`, mode: 'artlist', format: 'json', maxrecords: 50, timespan: `${Math.max(1, Math.round(hours))}h`, sort: 'datedesc' },
    timeout: 12_000,
  });
  const articles = typeof r?.data === 'object' ? r.data?.articles : null;
  return (Array.isArray(articles) ? articles : []).map((a: any) => ({
    source: 'gdelt' as const, text: String(a.title || ''), url: a.url, publishedAt: parseGdeltDate(a.seendate),
  }));
}

let xDay = '';
let xCalls = 0;
function xBudgetOk(): boolean {
  const day = ymd(new Date());
  if (day !== xDay) { xDay = day; xCalls = 0; }
  const max = Number(process.env.X_MAX_REQUESTS_PER_DAY || 50);
  if (xCalls >= max) return false;
  xCalls++;
  return true;
}

export function buildXQuery(asset: string, market: SentimentMarket): string {
  if (market === 'crypto') {
    const name = CRYPTO_NAMES[asset] || asset.toLowerCase();
    const tag = name.replace(/\s+/g, '');
    return `($${asset} OR #${tag} OR "${name}") lang:en -is:retweet -is:reply`;
  }
  return `($${asset} OR "${asset} stock") lang:en -is:retweet -is:reply`;
}

/** X API v2 recent search. No-op unless X_BEARER_TOKEN is set. */
export async function fetchXPosts(query: string, since: Date): Promise<SentimentItem[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return [];
  if (!xBudgetOk()) {
    logger.debug('[SENTIMENT] X_MAX_REQUESTS_PER_DAY reached — skipping X');
    return [];
  }
  const minStart = new Date(Date.now() - 6.9 * 86_400_000); // recent search = last 7 days
  const r = await axios.get('https://api.x.com/2/tweets/search/recent', {
    params: {
      query,
      max_results: Math.min(100, Math.max(10, Number(process.env.X_SEARCH_MAX_RESULTS || 50))),
      start_time: (since > minStart ? since : minStart).toISOString(),
      'tweet.fields': 'created_at,public_metrics,author_id,lang',
      expansions: 'author_id',
      'user.fields': 'created_at,public_metrics',
    },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10_000,
  });
  const users = new Map<string, any>((r?.data?.includes?.users || []).map((u: any) => [u.id, u]));
  return (r?.data?.data || []).map((t: any) => {
    const m = t.public_metrics || {};
    const u = users.get(t.author_id);
    return {
      source: 'x' as const,
      text: String(t.text || ''),
      url: `https://x.com/i/web/status/${t.id}`,
      publishedAt: new Date(t.created_at),
      engagement: (m.like_count || 0) + 2 * (m.retweet_count || 0) + (m.reply_count || 0) + (m.quote_count || 0),
      authorFollowers: u?.public_metrics?.followers_count,
      authorCreatedAt: u?.created_at ? new Date(u.created_at) : undefined,
    };
  });
}

// ── Aggregation ──────────────────────────────────────────────────────────────

const SOURCE_WEIGHT: Record<SentimentSource, number> = { alpaca: 1.0, finnhub: 1.0, cryptopanic: 0.8, gdelt: 0.6, x: 0.5 };

export function aggregate(items: SentimentItem[], scores: number[], now = Date.now()): number {
  const halfLife = Math.max(0.5, Number(process.env.SENTIMENT_HALF_LIFE_HOURS || 12));
  let num = 0, den = 0;
  items.forEach((it, i) => {
    const ageH = Math.max(0, (now - it.publishedAt.getTime()) / 3_600_000);
    const recency = Math.pow(0.5, ageH / halfLife);
    const eng = it.source === 'x' ? Math.min(2, 1 + Math.log10(1 + (it.engagement || 0)) / 2) : 1;
    const w = SOURCE_WEIGHT[it.source] * recency * eng;
    num += w * (scores[i] || 0);
    den += w;
  });
  return den > 0 ? num / den : 0;
}

async function volumeZScore(asset: string, current: number): Promise<{ z: number; samples: number }> {
  try {
    const rows = await (prisma as any).sentimentSnapshot.findMany({
      where: { asset, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      select: { mentionCount: true },
      take: 500,
      orderBy: { createdAt: 'desc' },
    });
    const xs = (rows || []).map((r: any) => Number(r.mentionCount) || 0);
    if (xs.length < 5) return { z: 0, samples: xs.length };
    const mean = xs.reduce((a: number, b: number) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / xs.length);
    return { z: sd > 0 ? (current - mean) / sd : 0, samples: xs.length };
  } catch {
    return { z: 0, samples: 0 };
  }
}

async function settle<T>(label: string, p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch (err: any) {
    logger.debug(`[SENTIMENT] ${label} failed: ${err?.response?.status || ''} ${err?.message}`);
    return [];
  }
}

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const { exp, val } = JSON.parse(raw);
    return Date.now() < exp ? val as T : null;
  } catch { return null; }
}

async function cacheSet(key: string, val: unknown, ttlSec: number) {
  try { await redis.set(key, JSON.stringify({ exp: Date.now() + ttlSec * 1000, val })); } catch { /* cache is best-effort */ }
}

export interface GetSentimentOptions {
  market?: SentimentMarket;
  includeX?: boolean;   // X costs money per read; the pre-debate gate passes false
  persist?: boolean;    // write a SentimentSnapshot row (default true)
}

export async function getSentiment(assetIn: string, opts: GetSentimentOptions = {}): Promise<SentimentResult> {
  const asset = String(assetIn || '').toUpperCase();
  const market: SentimentMarket = opts.market || 'stocks';
  const includeX = opts.includeX !== false;
  const ttl = Number(process.env.SENTIMENT_CACHE_TTL_SEC || 900);
  const cacheKey = `sentiment:v1:${market}:${asset}:${includeX ? 'x' : 'nx'}`;
  const cached = await cacheGet<SentimentResult>(cacheKey);
  if (cached) return cached;

  const lookbackH = Math.max(1, Number(process.env.SENTIMENT_LOOKBACK_HOURS || 24));
  const since = new Date(Date.now() - lookbackH * 3_600_000);

  const [alpaca, finnhub, cpanic, xPosts, fearGreed] = await Promise.all([
    settle('alpaca', fetchAlpacaNews(asset, market, since)),
    settle('finnhub', fetchFinnhubNews(asset, market, since)),
    settle('cryptopanic', fetchCryptoPanic(asset, market, since)),
    includeX ? settle('x', fetchXPosts(buildXQuery(asset, market), since)) : Promise.resolve([] as SentimentItem[]),
    market === 'crypto' ? fetchFearGreed().catch(() => null) : Promise.resolve(null),
  ]);
  let raw: SentimentItem[] = [...alpaca, ...finnhub, ...cpanic, ...xPosts];
  // GDELT only as a fallback when the dedicated news APIs returned nothing.
  if (alpaca.length + finnhub.length + cpanic.length === 0) {
    const q = market === 'crypto' ? `"${CRYPTO_NAMES[asset] || asset}"` : `"${asset}" (stock OR shares)`;
    raw = raw.concat(await settle('gdelt', fetchGdelt(q, lookbackH)));
  }
  raw = raw.filter(it => it.publishedAt >= since);

  const { kept, removed } = filterItems(raw);
  kept.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  const { scores, scorer } = await scoreTexts(kept.map(k => k.text));
  const textScore = aggregate(kept, scores);
  const fg = fearGreed && Number.isFinite(fearGreed.value) ? (fearGreed.value - 50) / 50 : null;
  const score = kept.length
    ? (fg !== null ? 0.85 * textScore + 0.15 * fg : textScore)
    : (fg !== null ? 0.15 * fg : 0);

  const sourceCounts: Partial<Record<SentimentSource, number>> = {};
  for (const k of kept) sourceCounts[k.source] = (sourceCounts[k.source] || 0) + 1;
  const { z, samples } = await volumeZScore(asset, kept.length);

  const result: SentimentResult = {
    asset,
    market,
    score: +Math.max(-1, Math.min(1, score)).toFixed(4),
    confidence: +Math.min(1, kept.length / 20).toFixed(3),
    mentionCount: kept.length,
    filteredOut: removed,
    volumeZScore: +z.toFixed(3),
    baselineSamples: samples,
    sourceCounts,
    freshnessMinutes: kept.length ? Math.round((Date.now() - kept[0].publishedAt.getTime()) / 60_000) : null,
    fearGreed: fearGreed ?? null,
    scorer: kept.length ? scorer : 'none',
    headlines: kept.slice(0, 5).map(k => k.text.slice(0, 200)),
    computedAt: new Date().toISOString(),
  };

  await cacheSet(cacheKey, result, ttl);
  if (opts.persist !== false) {
    // History for the volume z-score and for later evaluation/backtests.
    try {
      await (prisma as any).sentimentSnapshot.create({
        data: {
          asset, market, score: result.score, confidence: result.confidence, mentionCount: result.mentionCount,
          volumeZScore: result.volumeZScore, sourceCounts: result.sourceCounts as any,
          newestItemAt: kept[0]?.publishedAt ?? null, fearGreed: fearGreed?.value ?? null,
          scorer: result.scorer, headlines: result.headlines as any,
        },
      });
    } catch (err: any) {
      logger.debug(`[SENTIMENT] snapshot write failed: ${err?.message}`);
    }
  }
  logger.info(`[SENTIMENT] ${asset}: ${result.score.toFixed(2)} on ${result.mentionCount} items (${Object.entries(sourceCounts).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'}), z=${result.volumeZScore}, scorer=${result.scorer}`);
  return result;
}

// ── Headlines for free-text questions (Polymarket) ────────────────────────────

const STOP = new Set('will the a an of in on by to be is are for and or at with from as before after than this that what who which when where does do did has have it its into over under between during end'.split(' '));

export function keywordsForQuestion(q: string, max = 6): string[] {
  return String(q || '')
    .replace(/[^A-Za-z0-9\s$%.-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter(w => w.length > 2 && !STOP.has(w.toLowerCase()) && !/^\d{1,2}$/.test(w))
    .slice(0, max);
}

/** Recent, filtered headlines (and X posts if configured) for a free-text question. */
export interface QuerySentiment {
  /** -1..+1 tone of the kept items. Tone is NOT the same as "YES is more likely". */
  score: number;
  mentions: number;
  /** Hours since the newest kept item (null when nothing was found). */
  freshestHours: number | null;
  headlines: string[];
  scorer: SentimentResult['scorer'];
}

const EMPTY_QUERY_SENTIMENT: QuerySentiment = { score: 0, mentions: 0, freshestHours: null, headlines: [], scorer: 'none' };

/**
 * News (GDELT, 72h) + optional X posts for a free-text question (Polymarket),
 * filtered, scored and cached (SENTIMENT_HEADLINE_CACHE_TTL_SEC, default 1800).
 */
export async function getQuerySentiment(query: string, limit = 8): Promise<QuerySentiment> {
  if (!isSentimentEnabled()) return EMPTY_QUERY_SENTIMENT;
  const words = keywordsForQuestion(query);
  if (words.length < 2) return EMPTY_QUERY_SENTIMENT;
  const key = `headlines:v2:${crypto.createHash('sha1').update(words.join(' ').toLowerCase()).digest('hex')}`;
  const cached = await cacheGet<QuerySentiment>(key);
  if (cached) return { ...cached, headlines: cached.headlines.slice(0, limit) };
  const since = new Date(Date.now() - 72 * 3_600_000);
  const gdeltQ = words.length > 3 ? `(${words.slice(0, 4).join(' ')})` : words.join(' ');
  const [news, posts] = await Promise.all([
    settle('gdelt', fetchGdelt(gdeltQ, 72)),
    process.env.SENTIMENT_X_FOR_POLYMARKET === 'true'
      ? settle('x', fetchXPosts(`${words.slice(0, 4).join(' ')} lang:en -is:retweet -is:reply`, since))
      : Promise.resolve([] as SentimentItem[]),
  ]);
  const { kept } = filterItems([...news, ...posts]);
  kept.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  let score = 0;
  let scorer: SentimentResult['scorer'] = 'none';
  if (kept.length) {
    const scored = await scoreTexts(kept.map(k => k.text));
    score = Math.max(-1, Math.min(1, aggregate(kept, scored.scores)));
    scorer = scored.scorer;
  }
  const out: QuerySentiment = {
    score,
    mentions: kept.length,
    freshestHours: kept.length ? Math.max(0, (Date.now() - kept[0].publishedAt.getTime()) / 3_600_000) : null,
    headlines: kept.slice(0, Math.max(limit, 8)).map(k => `[${k.source}] ${k.text.slice(0, 200)}`),
    scorer,
  };
  await cacheSet(key, out, Number(process.env.SENTIMENT_HEADLINE_CACHE_TTL_SEC || 1800));
  return { ...out, headlines: out.headlines.slice(0, limit) };
}

export async function getHeadlinesForQuery(query: string, limit = 5): Promise<string[]> {
  return (await getQuerySentiment(query, limit)).headlines;
}
