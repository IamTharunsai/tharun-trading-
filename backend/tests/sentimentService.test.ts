const snapshotCreate = jest.fn().mockResolvedValue({});
const snapshotFindMany = jest.fn().mockResolvedValue([]);
jest.mock('../src/utils/prisma', () => ({ prisma: { sentimentSnapshot: { create: (...a: any[]) => snapshotCreate(...a), findMany: (...a: any[]) => snapshotFindMany(...a) } } }));
jest.mock('axios');
import axios from 'axios';
import {
  getSentiment, evaluateSentimentGate, filterItems, lexiconScore, isPromo, isBotLike,
  getHeadlinesForQuery, keywordsForQuestion, buildXQuery, isSentimentEnabled, SentimentResult,
} from '../src/services/sentimentService';

const get = (axios as any).get as jest.Mock;
const post = (axios as any).post as jest.Mock;
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const ENV = ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY', 'ALPACA_PAPER_API_KEY', 'ALPACA_PAPER_SECRET_KEY', 'ALPACA_LIVE_API_KEY', 'ALPACA_LIVE_SECRET_KEY', 'FINNHUB_API_KEY', 'CRYPTOPANIC_API_KEY', 'X_BEARER_TOKEN', 'KRONOS_SERVICE_URL', 'SENTIMENT_ENABLED', 'TRADING_MODE', 'LIVE_TRADING_CONFIRMED'];
let n = 0;
beforeEach(() => {
  jest.clearAllMocks();
  ENV.forEach(k => delete process.env[k]);
  process.env.SENTIMENT_GDELT_MIN_INTERVAL_MS = '0';
  process.env.SENTIMENT_CACHE_TTL_SEC = '1';
  get.mockReset(); post.mockReset();
  snapshotFindMany.mockResolvedValue([]);
});
const uniq = () => `T${++n}X`; // fresh asset per test → no cache hits

function routeGet(routes: Record<string, any>) {
  get.mockImplementation((url: string) => {
    for (const [frag, val] of Object.entries(routes)) {
      if (url.includes(frag)) return typeof val === 'function' ? val() : Promise.resolve({ data: val });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

describe('text hygiene', () => {
  it('drops duplicates, promo spam and bot-like X accounts', () => {
    const now = Date.now();
    const d = new Date(now - 60_000);
    const { kept, removed } = filterItems([
      { source: 'alpaca', text: 'Apple beats earnings estimates', publishedAt: d },
      { source: 'finnhub', text: 'Apple beats earnings estimates!!', publishedAt: d },               // duplicate
      { source: 'x', text: 'Join my VIP signals group, next 100x gem $AAPL', publishedAt: d, authorFollowers: 5000 }, // promo
      { source: 'x', text: 'Thinking about trimming my AAPL position after the run', publishedAt: d, authorFollowers: 3 },  // tiny account
      { source: 'x', text: 'Fresh account shilling AAPL calls right now', publishedAt: d, authorFollowers: 900, authorCreatedAt: new Date(now - 3 * 86_400_000) },
      { source: 'x', text: '$AAPL $MSFT $NVDA $TSLA $AMZN $META all going up', publishedAt: d, authorFollowers: 900 }, // cashtag stuffing
      { source: 'x', text: 'AAPL guidance looked solid to me, holding', publishedAt: d, authorFollowers: 900, authorCreatedAt: new Date(now - 400 * 86_400_000) },
    ], now);
    expect(kept.map(k => k.text)).toEqual(['Apple beats earnings estimates', 'AAPL guidance looked solid to me, holding']);
    expect(removed).toBe(5);
    expect(isPromo('Airdrop live, claim now')).toBe(true);
    expect(isBotLike({ source: 'alpaca', text: 'x', publishedAt: new Date() })).toBe(false);
  });

  it('lexicon handles polarity and simple negation', () => {
    expect(lexiconScore('Shares surge after record quarter')).toBeGreaterThan(0);
    expect(lexiconScore('Company misses estimates, stock plunges')).toBeLessThan(0);
    expect(lexiconScore('not bullish on this at all')).toBeLessThan(0);
    expect(lexiconScore('The meeting is on Tuesday')).toBe(0);
  });
});

describe('getSentiment', () => {
  it('combines Alpaca + Finnhub news, scores with the lexicon when FinBERT is not configured, persists a snapshot', async () => {
    process.env.ALPACA_API_KEY = 'PKTESTKEY1234'; process.env.ALPACA_SECRET_KEY = 'secret1234567';
    process.env.FINNHUB_API_KEY = 'fh-key';
    routeGet({
      'data.alpaca.markets': { news: [
        { headline: 'Acme beats estimates and raises guidance', created_at: iso(30) },
        { headline: 'Acme shares surge to record high', created_at: iso(90) },
      ] },
      'finnhub.io/api/v1/company-news': [{ headline: 'Analysts upgrade Acme on strong growth', datetime: Math.floor(Date.now() / 1000) - 3600 }],
    });
    const asset = uniq();
    const s = await getSentiment(asset, { market: 'stocks', includeX: true });
    expect(s.mentionCount).toBe(3);
    expect(s.sourceCounts).toEqual({ alpaca: 2, finnhub: 1 });
    expect(s.score).toBeGreaterThan(0.3);
    expect(s.scorer).toBe('lexicon');
    expect(s.freshnessMinutes).toBeLessThanOrEqual(31);
    expect(s.volumeZScore).toBe(0); // < 5 baseline samples
    expect(get.mock.calls.some(c => String(c[0]).includes('api.x.com'))).toBe(false); // no token → no X call
    expect(get.mock.calls.some(c => String(c[0]).includes('gdelt'))).toBe(false);     // news found → no GDELT fallback
    expect(snapshotCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ asset, mentionCount: 3 }) }));
  });

  it('uses kronos FinBERT when KRONOS_SERVICE_URL is set', async () => {
    process.env.ALPACA_API_KEY = 'PKTESTKEY1234'; process.env.ALPACA_SECRET_KEY = 'secret1234567';
    process.env.KRONOS_SERVICE_URL = 'http://kronos.local/';
    routeGet({ 'data.alpaca.markets': { news: [{ headline: 'Neutral sounding headline', created_at: iso(10) }] } });
    post.mockResolvedValue({ data: { model: 'ProsusAI/finbert', results: [{ positive: 0.1, negative: 0.8, neutral: 0.1 }] } });
    const s = await getSentiment(uniq(), { market: 'stocks' });
    expect(post).toHaveBeenCalledWith('http://kronos.local/api/sentiment', { texts: ['Neutral sounding headline'] }, expect.anything());
    expect(s.scorer).toBe('finbert');
    expect(s.score).toBeCloseTo(-0.7, 2);
  });

  it('reads X only when X_BEARER_TOKEN is set, and filters bot/promo posts', async () => {
    process.env.X_BEARER_TOKEN = 'test-bearer';
    routeGet({
      'api.x.com/2/tweets/search/recent': {
        data: [
          { id: '1', text: 'Earnings were strong, guidance raised, bullish here', created_at: iso(5), author_id: 'u1', public_metrics: { like_count: 50, retweet_count: 10 } },
          { id: '2', text: 'FREE signals in my telegram, 1000x guaranteed', created_at: iso(5), author_id: 'u1', public_metrics: {} },
          { id: '3', text: 'Bought more today, looks bullish into earnings', created_at: iso(8), author_id: 'u2', public_metrics: {} },
        ],
        includes: { users: [
          { id: 'u1', created_at: '2015-01-01T00:00:00Z', public_metrics: { followers_count: 5000 } },
          { id: 'u2', created_at: '2015-01-01T00:00:00Z', public_metrics: { followers_count: 2 } },
        ] },
      },
      'gdeltproject.org': { articles: [] },
    });
    const s = await getSentiment(uniq(), { market: 'stocks', includeX: true });
    const xCall = get.mock.calls.find(c => String(c[0]).includes('api.x.com'))!;
    expect(xCall[1].headers.Authorization).toBe('Bearer test-bearer');
    expect(s.sourceCounts).toEqual({ x: 1 });
    expect(s.filteredOut).toBe(2);
    expect(s.score).toBeGreaterThan(0);
  });

  it('includeX:false never calls X even with a token (pre-debate gate path)', async () => {
    process.env.X_BEARER_TOKEN = 'test-bearer';
    routeGet({ 'gdeltproject.org': { articles: [] } });
    await getSentiment(uniq(), { market: 'stocks', includeX: false });
    expect(get.mock.calls.some(c => String(c[0]).includes('api.x.com'))).toBe(false);
  });

  it('crypto: blends Fear & Greed, uses CryptoPanic when keyed, GDELT only as fallback', async () => {
    process.env.CRYPTOPANIC_API_KEY = 'cp-key';
    routeGet({
      'cryptopanic.com': { results: [{ title: 'Bitcoin ETF inflows hit record', published_at: iso(20) }] },
      'alternative.me': { data: [{ value: '80', value_classification: 'Extreme Greed' }] },
    });
    const s = await getSentiment('BTC', { market: 'crypto', includeX: false, persist: false });
    expect(s.sourceCounts).toEqual({ cryptopanic: 1 });
    expect(s.fearGreed).toEqual({ value: 80, classification: 'Extreme Greed' });
    expect(s.score).toBeGreaterThan(0);
    expect(get.mock.calls.some(c => String(c[0]).includes('gdelt'))).toBe(false);
    expect(snapshotCreate).not.toHaveBeenCalled();
  });

  it('falls back to GDELT and survives every source failing', async () => {
    process.env.FINNHUB_API_KEY = 'fh-key';
    routeGet({
      'finnhub.io': () => Promise.reject(new Error('429')),
      'gdeltproject.org': { articles: [{ title: 'Regulators open probe into Acme accounting', seendate: new Date(Date.now() - 600_000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') }] },
    });
    const s = await getSentiment(uniq(), { market: 'stocks' });
    expect(s.sourceCounts).toEqual({ gdelt: 1 });
    expect(s.score).toBeLessThan(0);

    routeGet({ 'gdeltproject.org': () => Promise.reject(new Error('down')) });
    const empty = await getSentiment(uniq(), { market: 'stocks' });
    expect(empty).toEqual(expect.objectContaining({ mentionCount: 0, score: 0, scorer: 'none', freshnessMinutes: null }));
  });

  it('computes a mention-volume z-score from snapshot history', async () => {
    process.env.ALPACA_API_KEY = 'PKTESTKEY1234'; process.env.ALPACA_SECRET_KEY = 'secret1234567';
    snapshotFindMany.mockResolvedValue([1, 2, 1, 2, 1, 2].map(m => ({ mentionCount: m })));
    routeGet({ 'data.alpaca.markets': { news: Array.from({ length: 6 }, (_, i) => ({ headline: `Headline number ${i} about growth`, created_at: iso(5 + i) })) } });
    const s = await getSentiment(uniq(), { market: 'stocks' });
    expect(s.baselineSamples).toBe(6);
    expect(s.volumeZScore).toBeCloseTo(9, 0); // (6 - 1.5) / 0.5
  });
});

describe('evaluateSentimentGate', () => {
  const s = (over: Partial<SentimentResult>): SentimentResult => ({
    asset: 'A', market: 'stocks', score: 0, confidence: 0.5, mentionCount: 10, filteredOut: 0, volumeZScore: 0, baselineSamples: 0,
    sourceCounts: {}, freshnessMinutes: 30, scorer: 'lexicon', headlines: [], computedAt: '', ...over,
  });
  it('vetoes BUY below -0.3 and SELL above +0.3 with meaningful volume', () => {
    expect(evaluateSentimentGate('BUY', s({ score: -0.5 })).veto).toBe(true);
    expect(evaluateSentimentGate('SELL', s({ score: 0.5 })).veto).toBe(true);
    expect(evaluateSentimentGate('BUY', s({ score: 0.5 })).veto).toBe(false);
  });
  it('does nothing on thin or stale evidence', () => {
    expect(evaluateSentimentGate('BUY', s({ score: -0.9, mentionCount: 2 }))).toEqual(expect.objectContaining({ veto: false, multiplier: 1, meaningful: false }));
    expect(evaluateSentimentGate('BUY', s({ score: -0.9, freshnessMinutes: 10_000 })).veto).toBe(false);
    expect(evaluateSentimentGate('BUY', null).multiplier).toBe(1);
  });
  it('sizes between 0.5x and 1.25x and never acts on HOLD', () => {
    expect(evaluateSentimentGate('BUY', s({ score: 1 })).multiplier).toBe(1.25);
    expect(evaluateSentimentGate('BUY', s({ score: -0.3 })).multiplier).toBeCloseTo(0.55, 2);
    expect(evaluateSentimentGate('SELL', s({ score: -0.4 })).multiplier).toBe(1.2);
    const all = [-0.3, -0.2, 0, 0.2, 0.6, 1].map(x => evaluateSentimentGate('BUY', s({ score: x })).multiplier);
    all.forEach(m => { expect(m).toBeGreaterThanOrEqual(0.5); expect(m).toBeLessThanOrEqual(1.25); });
    expect(evaluateSentimentGate('HOLD', s({ score: -1 }))).toEqual(expect.objectContaining({ veto: false, multiplier: 1 }));
  });
});

describe('Polymarket headlines + config', () => {
  it('extracts keywords and returns filtered headlines from GDELT', async () => {
    process.env.SENTIMENT_ENABLED = 'true';
    expect(keywordsForQuestion('Will the Fed cut rates in December 2026?')).toEqual(['Fed', 'cut', 'rates', 'December', '2026']);
    routeGet({ 'gdeltproject.org': { articles: [
      { title: 'Fed officials signal December rate cut', seendate: '20261007T120000Z' },
      { title: 'Join our telegram for free signals', seendate: '20261007T110000Z' },
    ] } });
    const h = await getHeadlinesForQuery(`Will the Fed cut rates in December ${uniq()}?`, 5);
    expect(h).toEqual(['[gdelt] Fed officials signal December rate cut']);
  });

  it('SENTIMENT_ENABLED: explicit flag wins; unset → on in paper, off in live', () => {
    expect(isSentimentEnabled()).toBe(true);
    process.env.SENTIMENT_ENABLED = 'false';
    expect(isSentimentEnabled()).toBe(false);
    delete process.env.SENTIMENT_ENABLED;
    Object.assign(process.env, { TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: 'I_ACCEPT_REAL_MONEY_RISK', ALPACA_LIVE_API_KEY: 'AKLIVEKEY123456', ALPACA_LIVE_SECRET_KEY: 'livesecret123456' });
    expect(isSentimentEnabled()).toBe(false);
  });

  it('builds X queries with cashtags and excludes reposts/replies', () => {
    expect(buildXQuery('AAPL', 'stocks')).toBe('($AAPL OR "AAPL stock") lang:en -is:retweet -is:reply');
    expect(buildXQuery('BTC', 'crypto')).toBe('($BTC OR #bitcoin OR "bitcoin") lang:en -is:retweet -is:reply');
  });
});
