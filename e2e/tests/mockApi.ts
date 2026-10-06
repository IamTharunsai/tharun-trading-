// Deterministic API mock for E2E tests. Every /api/* request is answered here,
// so the suite never reaches a real broker. Tests can override any route via
// `overrides` and inspect every call via the returned `calls` array.
import { Page, Route } from '@playwright/test';

export type Handler = (route: Route, url: URL, body: any) => any;

const now = new Date().toISOString();

export const fixtures = {
  me: { id: 'u1', email: 'owner@example.com', role: 'OWNER' },
  portfolio: { totalValue: 101180.2, cashBalance: 79810.34, invested: 21369.86, pnlDay: 120.5, pnlDayPct: 0.12, pnlTotal: 1180.2, positions: [], tradesExecutedToday: 3, drawdownFromPeak: 0.4 },
  positions: [
    { id: 'p1', asset: 'AMZN', market: 'stocks', side: 'BUY', quantity: 40.47, entryPrice: 246.63, currentPrice: 246.94, stopLossPrice: 234.3, takeProfitPrice: 271.29, unrealizedPnl: 12.55, unrealizedPnlPct: 0.13, status: 'OPEN', protectionStatus: 'BROKER_SYNCED', openedAt: now },
  ],
  trades: {
    trades: [
      { id: 't1', asset: 'SOFI', market: 'stocks', type: 'BUY', entryPrice: 20.1, exitPrice: 20.6, quantity: 12, pnl: 6, pnlPct: 2.4, status: 'CLOSED', openedAt: now, closedAt: now, metadata: { lane: 'INTRADAY', setup: 'VWAP_RECLAIM', score: 72 } },
      { id: 't2', asset: 'GRRR', market: 'stocks', type: 'SELL', entryPrice: 11.89, quantity: 281, status: 'REJECTED', exitReason: 'Broker rejected: Request failed with status code 422', openedAt: now },
      { id: 't3', asset: 'AMZN', market: 'stocks', type: 'BUY', entryPrice: 246.63, quantity: 40.47, status: 'OPEN', reconciliationStatus: 'IMPORTED_FROM_BROKER', openedAt: now },
      { id: 't4', asset: 'NKE', market: 'stocks', type: 'BUY', entryPrice: 70, exitPrice: 69, quantity: 3, pnl: -3, pnlPct: -1.4, status: 'CLOSED', openedAt: now, closedAt: now },
    ],
    total: 4, page: 1, pages: 1,
  },
  tradeStats: { totalTrades: 2, winRate: '50.0', totalPnl: '3.00', avgWin: '6.00', avgLoss: '-3.00', profitFactor: '2.00', payoffRatio: '2.00' },
  categories: {
    categories: [
      { id: 'portfolio', label: 'In my portfolio', group: 'portfolio', count: 1 },
      { id: 'most_active', label: 'Most active today', group: 'dynamic', count: 3 },
      { id: 'top_gainers', label: 'Top gainers', group: 'dynamic', count: 2 },
      { id: 'sector_energy', label: 'Energy', group: 'sector', count: 2 },
      { id: 'crypto', label: 'Crypto', group: 'crypto', count: 2 },
    ],
    source: 'NASDAQ_SCREENER+ALPACA', syncedAt: now, stocks: 11877, moversAt: now,
  },
  symbolsByCategory: {
    portfolio: [{ symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Discretionary', price: 246.94, changePct: 0.1, market: 'stocks', tradable: true }],
    most_active: [
      { symbol: 'SOFI', name: 'SoFi Technologies', sector: 'Financials', price: 20.6, changePct: 3.1, market: 'stocks', tradable: true },
      { symbol: 'NOK', name: 'Nokia', sector: 'Communication Services', price: 4.5, changePct: -1.2, market: 'stocks', tradable: true },
      { symbol: 'RIG', name: 'Transocean', sector: 'Energy', price: 3.9, changePct: 2.2, market: 'stocks', tradable: true },
    ],
    top_gainers: [{ symbol: 'KOD', name: 'Kodiak Sciences', sector: 'Healthcare', price: 12, changePct: 18, market: 'stocks', tradable: true }],
    sector_energy: [
      { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', price: 162.52, changePct: 1.2, market: 'stocks', tradable: true },
      { symbol: 'CVX', name: 'Chevron', sector: 'Energy', price: 206.37, changePct: 0.9, market: 'stocks', tradable: true },
    ],
    crypto: [
      { symbol: 'BTC', name: 'BTC', sector: 'Crypto', price: 84000, changePct: null, market: 'crypto', tradable: true },
      { symbol: 'ETH', name: 'ETH', sector: 'Crypto', price: 2734, changePct: null, market: 'crypto', tradable: true },
    ],
  } as Record<string, any[]>,
  status: {
    scheduler: 'online', killSwitch: false, tradingMode: 'paper',
    polymarket: { mode: 'paper', usConnected: true },
    llm: { fast: { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b', healthy: true }, smart: { provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b', healthy: true }, spendTodayUsd: 0, callsToday: 212, budgetUsd: 15 },
    alpaca: { connected: true, mode: 'paper' },
    brokerSync: { imported: [], updated: ['AMZN'], closed: [] },
    universe: { source: 'NASDAQ_SCREENER+ALPACA', syncedAt: now, stocks: 11877, moversAt: now },
    intraday: { enabled: true, tradesToday: 12, maxPerDay: 150, realizedPnlToday: 18.4, notionalUsd: 250, lastScan: { at: now, candidates: 30, scored: 5, passed: 5, entered: ['SOFI'] } },
    dataProviders: { sec: { configured: true }, nasdaq: { configured: true, healthy: true }, alpaca: { configured: true, healthy: true }, finnhub: { configured: true }, polygon: { configured: true }, alphaVantage: { configured: true }, fred: { configured: true }, newsapi: { configured: true }, polymarket: { configured: true }, polymarketUs: { configured: true }, yahoo: { configured: true }, nvidia: { configured: true }, anthropic: { configured: true } },
    serverTime: now,
  },
  decisions: {
    decisions: [
      { id: 'd1', asset: 'SOFI', finalVote: 'BUY', totalVotes: 3, goVotes: 3, noGoVotes: 0, avgConfidence: 72, executed: true, timestamp: now, agentVotes: [{ agent: 'Technician', vote: 'BUY', reason: 'clean trend' }] },
      { id: 'd2', asset: 'HBR', finalVote: 'HOLD', totalVotes: 14, goVotes: 0, noGoVotes: 14, avgConfidence: 0, executed: false, timestamp: now, agentVotes: Array.from({ length: 14 }, (_, i) => ({ agentId: i + 1, vote: 'HOLD', confidence: 0, reasoning: 'Error' })) },
    ],
    total: 2,
  },
  liveAccounts: { alpaca: { connected: true, paperMode: true, accountNumber: 'PA-TEST', cash: 79810.34, portfolioValue: 101180.2, buyingPower: 379076.96, positions: [] }, polymarket: { connected: false }, combinedLiveEquity: 101180.2, combinedLiveCash: 79810.34 },
  news: [
    { id: 'n1', title: 'Duplicate headline', url: 'https://example.com/a', source: 'CNBC', publishedAt: now, sentiment: 'NEUTRAL' },
    { id: 'n2', title: 'Duplicate headline', url: 'https://example.com/a', source: 'CNBC', publishedAt: now, sentiment: 'NEUTRAL' },
    { id: 'n3', title: 'Different story', url: 'https://example.com/b', source: 'Reuters', publishedAt: now, sentiment: 'BULLISH' },
  ],
};

export interface MockHandle { calls: Array<{ method: string; path: string; body: any }> }

export async function mockApi(page: Page, overrides: Record<string, Handler | any> = {}): Promise<MockHandle> {
  const calls: MockHandle['calls'] = [];
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/api/, '');
    let body: any = null;
    try { body = req.postDataJSON(); } catch { body = req.postData(); }
    calls.push({ method: req.method(), path: path + url.search, body });
    const key = `${req.method()} ${path}`;
    const o = overrides[key] ?? overrides[path];
    if (o !== undefined) {
      if (typeof o === 'function') return o(route, url, body);
      return route.fulfill({ json: o });
    }
    return route.fulfill({ json: defaultResponse(req.method(), path, url) });
  });
  // Socket.IO: fail fast and quietly.
  await page.route(/socket\.io/, route => route.abort());
  return { calls };
}

function defaultResponse(method: string, path: string, url: URL): any {
  if (method !== 'GET') return { success: true, message: 'ok' };
  if (path === '/auth/me') return fixtures.me;
  if (path === '/portfolio') return fixtures.portfolio;
  if (path === '/portfolio/positions') return fixtures.positions;
  if (path.startsWith('/portfolio/snapshots')) return [];
  if (path === '/portfolio/live-accounts') return fixtures.liveAccounts;
  if (path === '/portfolio/breakdown') return { totalEquity: 101180.2, cash: 79810.34, positions: fixtures.positions };
  if (path === '/trades') return fixtures.trades;
  if (path === '/trades/stats') return fixtures.tradeStats;
  if (path === '/agents/decisions') return fixtures.decisions;
  if (path === '/market/universe/categories') return fixtures.categories;
  if (path === '/market/universe/symbols') {
    const cat = url.searchParams.get('category') || '';
    const q = (url.searchParams.get('search') || '').toUpperCase();
    let list = fixtures.symbolsByCategory[cat] || Object.values(fixtures.symbolsByCategory).flat();
    if (q) list = Object.values(fixtures.symbolsByCategory).flat().filter((s: any) => s.symbol.includes(q) || s.name.toUpperCase().includes(q));
    return { symbols: list, total: list.length };
  }
  if (path === '/system/status') return fixtures.status;
  if (path === '/market/news') return fixtures.news;
  if (path === '/market/prices') return { BTC: 84000, ETH: 2734 };
  if (path === '/kill-switch/status') return { active: false };
  if (path === '/settings') return { tradingMode: 'paper', minAgentConfidence: '65', minVotesToExecute: '5' };
  if (path === '/market/polymarket-us/account') return { success: true, account: { balance: 0, buyingPower: 0, positions: [] } };
  if (path === '/journal') return [];
  if (path === '/market/predictions') return [];
  if (path.startsWith('/copy-trading/')) return path.endsWith('strategies') ? [] : [];
  if (path.startsWith('/monitor/')) return path.endsWith('status') ? { uptimeMinutes: 10 } : [];
  return {};
}

/** Log in by seeding a token (no real credentials anywhere in tests). */
export async function seedAuth(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem('apex_token', 'e2e-test-token'); } catch { /* noop */ } });
}

/** Collect uncaught page errors so a crashing page fails the test. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e?.message || e)));
  return errors;
}
