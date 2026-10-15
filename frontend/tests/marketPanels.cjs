const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === '../../services/api' && parent?.filename.endsWith('/panels/MarketPanel.tsx')) return { __esModule: true, default: { get: () => { throw new Error('Unexpected network request in server render'); } } };
  return originalLoad.call(this, name, parent, main);
};
for (const extension of ['.tsx', '.ts']) Module._extensions[extension] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
};
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const panel = require('../src/components/panels/MarketPanel.tsx');
const { belongsToCurrentSession } = require('../src/utils/sessionResponse.ts');
let responses = {};
const response = (data, error = null) => ({ data, error, receivedAt: null, isFetching: false, refresh() {} });
panel.usePanelData = path => responses[path.split('?')[0]] ?? response(null, 'This data feed is not connected.');
const render = (name, props = {}) => renderToStaticMarkup(React.createElement(require(`../src/components/panels/${name}.tsx`).default, props));

test('a late unauthorized response cannot invalidate a different sign-in', () => {
  assert.equal(belongsToCurrentSession('Bearer earlier-session', 'current-session'), false);
  assert.equal(belongsToCurrentSession(undefined, 'current-session'), false);
  assert.equal(belongsToCurrentSession('Bearer current-session', null), false);
  assert.equal(belongsToCurrentSession('Bearer current-session', 'current-session'), true);
});

test('missing financial measurements remain unavailable while real zero and sub-dollar prices survive', () => {
  for (const value of [null, undefined, NaN, Infinity, '', '0']) {
    assert.equal(panel.money(value), 'Unavailable');
    assert.equal(panel.percent(value), 'Unavailable');
  }
  assert.equal(panel.money(0), '$0.00');
  assert.equal(panel.percent(0), '0.00%');
  assert.equal(panel.money(0.00000381), '$0.00000381');
});

test('every unavailable panel keeps its identity and does not manufacture market values', () => {
  responses = {};
  for (const name of ['SectorHeatmap','CryptoBoard','YieldCurve','MarketScreener','NewsFeed','OptionsChain','EconomicCalendar']) {
    const html = render(name);
    assert.match(html, /This data feed is not connected/);
    assert.doesNotMatch(html, /\$578|\$62,000|40176|DEMO|Fed Signals|NVIDIA Reports Record|42%|54\.2%/);
  }
  const book = render('OrderBook');
  assert.match(book, /No exchange depth feed is connected/);
  assert.doesNotMatch(book, /573\.87|61,250|Bid-Heavy/);
});

test('crypto renders provider observations rather than a synthetic board', () => {
  responses = {
    '/market/crypto/top20': response([{ symbol: 'BTC', name: 'Bitcoin', price: 82012.28, change24h: -1.43, marketCap: null, volume24h: 0, observedAt: null, source: 'CoinGecko' }]),
    '/market/crypto/overview': response({ totalMarketCap: null, totalVolume24h: 0, btcDominance: null, ethDominance: null, fearGreedIndex: 0, fearGreedLabel: 'Extreme Fear' }),
  };
  const html = render('CryptoBoard');
  assert.match(html, /82,012\.28/);
  assert.match(html, /-1\.43%/);
  assert.match(html, /0 \/ 100/);
  assert.match(html, /Extreme Fear/);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /54\.2%|18\.1%|Greed<|98\.0B/);
});

test('sector proxies do not imply sector capitalization or invent observation times', () => {
  responses = { '/market/sectors': response({ sectors: [{ name: 'Technology', ticker: 'XLK', price: 100, changePercent: 0, observedAt: null }], source: 'Alpaca IEX' }) };
  const html = render('SectorHeatmap');
  assert.match(html, /ETF price changes are sector proxies/);
  assert.match(html, /Technology · XLK/);
  assert.match(html, /0\.00%/);
  assert.match(html, /Observation time unavailable/);
  assert.doesNotMatch(html, /4,800|DEMO/);
});

test('Treasury table retains absent tenor values and does not infer recession probability', () => {
  responses = { '/market/treasury/yields': response({ current: [{ maturity: '2Y', months: 24, rate: 4.1, observedAt: '2026-10-13' }, { maturity: '10Y', months: 120, rate: null, observedAt: null }], oneMonthAgo: [], oneYearAgo: [], spread2Y10Y: null, source: 'FRED' }) };
  const html = render('YieldCurve');
  assert.match(html, /4\.10%/);
  assert.match(html, /10Y/);
  assert.match(html, /Unavailable/);
  assert.match(html, /No recession probability model is supplied/);
  assert.doesNotMatch(html, /42%|4\.85%/);
});

test('news uses the real array contract and rejects executable links without invented sentiment', () => {
  responses = { '/market/news': response([{ id: 'stored', headline: 'Verified fixture headline', source: 'Fixture source', url: 'javascript:alert(1)', publishedAt: null, sentimentLabel: null, sentimentScore: null, assetsMentioned: [] }]) };
  const html = render('NewsFeed');
  assert.match(html, /Verified fixture headline/);
  assert.match(html, /Publication time unavailable/);
  assert.match(html, /Recorded sentiment: Unavailable/);
  assert.doesNotMatch(html, /href=|javascript:|just now|Fed Signals/);
  assert.equal(panel.safeLink('https://example.com/story'), 'https://example.com/story');
  assert.equal(panel.safeLink('data:text/html,hello'), undefined);
});

test('screener preserves an actual flat return and does not synthesize technical indicators', () => {
  responses = { '/market/screener': response({ data: [{ symbol: 'REAL', market: 'stocks', price: 100, change1d: 0, change5d: null, change20d: null, volumeRatio: null, rsi14: null, marketCap: null, observedAt: null, signal: null }] }) };
  const html = render('MarketScreener');
  assert.match(html, /REAL/);
  assert.match(html, /0\.00%/);
  assert.match(html, /\$100\.00/);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /NVDA|136\.50|1\.37/);
});

test('recap counts only verified equity changes and safely renders nullable prices and absent proxies', () => {
  responses = { '/market/screener': response({ data: [
    { symbol: 'GAIN', market: 'stocks', price: null, change1d: 2 },
    { symbol: 'LOSS', market: 'stocks', price: 20, change1d: -1 },
    { symbol: 'FLAT', market: 'stocks', price: 0, change1d: 0 },
    { symbol: 'MISSING', market: 'stocks', price: null, change1d: null },
    { symbol: 'BTC', market: 'crypto', price: 100, change1d: 99 },
  ] }), '/market/news': response([]), '/market/sectors': response({ sectors: [] }) };
  const Page = require('../src/pages/MarketRecap.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.match(html, /1 instruments advanced, 1 declined and 1 were unchanged among 3 measured equity returns/);
  assert.match(html, /1 additional equity observations lacked a valid session change/);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /99\.00%|52%|500 stocks|NaN|Infinity/);
});
