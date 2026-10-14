// Actual source contracts using installed TypeScript + React, with no browser,
// provider credentials, external requests or fabricated component stand-ins.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    module._compile(output, filename);
  };
}
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const LastUpdated = require('../src/components/common/LastUpdated.tsx').default;
const { chartSelection } = require('../src/utils/chartSelection.ts');
const { reduceDebateEvent: reduce, debateTally } = require('../src/utils/debateSessions.ts');
const { csvCell, csvRow } = require('../src/utils/csv.ts');
const { useStore } = require('../src/store/index.ts');
const now = Date.parse('2026-10-14T12:00:00Z');
const render = props => {
  const original = Date.now;
  Date.now = () => now;
  try { return renderToStaticMarkup(React.createElement(LastUpdated, props)); }
  finally { Date.now = original; }
};

test('unknown, invalid and future timestamps never become fresh evidence', () => {
  for (const value of [undefined, 'not a date', 0, NaN, new Date(NaN), now + 60000]) {
    const html = render({ at: value, receivedAt: value });
    assert.match(html, /Receipt time unknown/);
    assert.match(html, /Observation time unavailable/);
    assert.match(html, /data-state="unknown"/);
    assert.doesNotMatch(html, /just now/);
  }
});
test('a new receipt does not replace an old observation', () => {
  const html = render({ at: now - 3600000, receivedAt: now });
  assert.match(html, /Received just now/);
  assert.match(html, /Observed 1h ago/);
});
test('failed and overdue refreshes retain their last successful receipt', () => {
  const failed = render({ query: { dataUpdatedAt: now - 60000, isError: true, isFetching: false } });
  assert.match(failed, /Refresh failed; cached response/);
  assert.match(failed, /Received 1m ago/);
  assert.match(failed, /data-state="error"/);
  const stale = render({ receivedAt: now - 180000, isFetching: true, staleAfterMs: 120000 });
  assert.match(stale, /Response overdue/);
  assert.match(stale, /data-state="stale"/);
});
test('chart links keep valid dynamic symbols and reject malformed scope', () => {
  for (const symbol of ['NEWCO.WS.A', 'BRK/B', '^GSPC', '.DJI', '@ES', 'ES=F', 'NEWCOIN/USDT']) {
    const result = chartSelection(new URLSearchParams({ symbol }));
    assert.equal(result.symbol, symbol);
    assert.equal(result.error, null);
  }
  assert.equal(chartSelection(new URLSearchParams()), null);
  assert.equal(chartSelection(new URLSearchParams({ symbol: 'BRK/B', market: 'stocks' })).market, 'stocks');
  assert.equal(chartSelection(new URLSearchParams({ symbol: 'NEWCOIN/USDT' })).market, 'crypto');
  for (const symbol of ['', '<script>', '../secret', 'BTC?other=value', '.']) {
    assert.ok(chartSelection(new URLSearchParams({ symbol })).error);
  }
  assert.ok(chartSelection(new URLSearchParams({ symbol: 'ABC', market: 'unsupported' })).error);
});
test('interleaved debates keep each asset, votes and final evidence isolated', () => {
  let state = reduce({}, 'debate:start', { debateId: 'stock', asset: 'ABC' }, now);
  state = reduce(state, 'debate:start', { debateId: 'crypto', asset: 'XYZ/USD' }, now + 1);
  state = reduce(state, 'debate:final-vote', { debateId: 'stock', agentId: 1, finalVote: 'SELL', confidence: 65, finalReason: 'Weak revenue' }, now + 2);
  state = reduce(state, 'debate:final-vote', { debateId: 'crypto', agentId: 1, finalVote: 'BUY', confidence: 70, finalReason: 'Supply evidence' }, now + 3);
  assert.equal(state.stock.agents[1].vote, 'SELL');
  assert.equal(state.crypto.agents[1].vote, 'BUY');
  state = reduce(state, 'debate:complete', { debateId: 'stock', transcript: { asset: 'ABC', finalDecision: 'SELL', executionApproved: true, round3: [{ agentId: 1, finalVote: 'SELL', confidence: 65, reason: 'Weak revenue' }] } }, now + 4);
  assert.equal(state.crypto.status, 'running');
  assert.equal(debateTally(state.stock).sell, 1);
  assert.equal(debateTally(state.stock).buy, 0);
  assert.equal(state.stock.result.approved, true);
  assert.equal(state.stock.result.tradeExecuted, undefined);
});
test('missed starts restore a complete transcript and keep provider errors out of HOLD counts', () => {
  const state = reduce({}, 'debate:complete', { debateId: 'late', transcript: {
    asset: 'LATE', purpose: 'RESEARCH', finalDecision: 'HOLD', executionApproved: false,
    round1: [{ agentName: 'Technician', argument: 'Opening evidence', vote: 'BUY' }],
    round2: [{ challenger: 'Risk', target: 'Technician', challenge: 'Missing liquidity', rebuttal: 'Acknowledged' }],
    round3: [{ agentId: 1, agentName: 'Technician', finalVote: 'HOLD', confidence: 0, reason: 'Error' }, { agentId: 2, agentName: 'Risk', finalVote: 'HOLD', confidence: 80, reason: 'Insufficient liquidity' }],
  } }, now);
  assert.equal(state.late.entries.length, 5);
  assert.deepEqual(debateTally(state.late), { buy: 0, sell: 0, hold: 1, errors: 1 });
  assert.equal(state.late.result.purpose, 'RESEARCH');
  assert.equal(reduce(state, 'debate:agent-speaking', { debateId: 'late', agentId: 1 }, now + 1), state);
});
test('the real Round 1 provider-fallback payload is an error rather than a HOLD opinion', () => {
  const state = reduce({}, 'debate:agent-voted', {
    debateId: 'opening', agentId: 1, agentName: 'Technician', vote: 'HOLD',
    confidence: 0, openingArgument: 'Analysis unavailable',
  }, now);
  assert.equal(state.opening.agents[1].error, true);
  assert.deepEqual(debateTally(state.opening), { buy: 0, sell: 0, hold: 0, errors: 1 });
});
test('unidentified events cannot contaminate sessions and the event cache is bounded', () => {
  const initial = {};
  assert.equal(reduce(initial, 'debate:final-vote', { asset: 'ABC', agentId: 1 }, now), initial);
  let state = initial;
  for (let i = 0; i < 40; i++) state = reduce(state, 'debate:start', { debateId: `id${i}`, asset: `S${i}` }, now + i);
  assert.equal(Object.keys(state).length, 32);
});
test('CSV exports distinguish real losses from untrusted formulas and preserve missing values', () => {
  assert.equal(csvCell(-12.5), '"-12.5"');
  for (const value of ['=HYPERLINK("https://example.invalid")', ' +1', '@SUM(1,2)', '\t=1', '-12.5']) {
    assert.ok(csvCell(value).startsWith('"\''));
  }
  assert.equal(csvCell('ABC"DEF'), '"ABC""DEF"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(0), '"0"');
  assert.equal(csvRow(['ABC', null, 0]), '"ABC","","0"\r\n');
});
test('signed-out events cannot repopulate the real session store', () => {
  const previousStorage = global.localStorage;
  global.localStorage = { setItem() {}, removeItem() {} };
  try {
    useStore.getState().setAuth('offline-fixture-token', { id: 'fixture' });
    useStore.getState().receiveDebateEvent('debate:start', { debateId: 'signed-in', asset: 'ABC' });
    assert.equal(Object.keys(useStore.getState().debateSessions).length, 1);
    useStore.getState().logout();
    useStore.getState().receiveDebateEvent('debate:start', { debateId: 'signed-out', asset: 'XYZ' });
    assert.equal(Object.keys(useStore.getState().debateSessions).length, 0);
    useStore.getState().setAuth('another-offline-fixture', { id: 'second' });
    assert.equal(Object.keys(useStore.getState().debateSessions).length, 0);
  } finally {
    useStore.setState({ token: null, user: null, debateSessions: {}, agentCouncil: {}, currentAnalysis: null });
    global.localStorage = previousStorage;
  }
});
