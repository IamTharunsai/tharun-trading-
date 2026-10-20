// Execute only in offline CI. Fixture producer, parser, Axios interceptors,
// QueryClient and the rendered hook core are real; no HTTP adapter is used.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename);
const { TeamSessionRegistry } = require('../../backend/src/services/teamSessions.ts');
const { parseTeamSessionSnapshot, InvalidTeamSnapshotError } = require('../src/services/teamSessionSnapshot.ts');
const { projectTeamWorkspaceReadback, formatTeamReceiptTime, TEAM_READBACK_STALE_MS } = require('../src/utils/teamWorkspaceAdapter.ts');
const { teamWorkspaceQueryOptions, teamWorkspaceQueryKey } = require('../src/services/teamWorkspaceQuery.ts');
const { createSessionApi } = require('../src/services/sessionApi.ts');
const { createSessionQueryCache } = require('../src/services/sessionQueryCache.ts');
const { createStore } = require('zustand/vanilla');
const axios = require('axios');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { QueryClientProvider, QueryObserver, isCancelledError } = require('@tanstack/react-query');
// api.ts contains Vite import.meta and is the production composition root.
// Substitute only that import with a throwing client before loading the hook;
// test the same hook core with explicitly supplied real session-aware clients.
const originalLoad = Module._load;
Module._load = function(request, parent, ...rest) {
  if (request === '../services/api' && parent?.filename === path.resolve(__dirname, '../src/hooks/useTeamWorkspaceReadback.ts')) {
    return { __esModule: true, default: { get() { throw new Error('Unexpected default API use'); } } };
  }
  return originalLoad.call(this, request, parent, ...rest);
};
let useTeamWorkspaceReadbackForSession;
try { ({ useTeamWorkspaceReadbackForSession } = require('../src/hooks/useTeamWorkspaceReadback.ts')); }
finally { Module._load = originalLoad; }

const BASE_TIME = Date.parse('2026-10-16T14:03:00Z');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  let now = BASE_TIME;
  const registry = new TeamSessionRegistry(() => now);
  const contexts = new Map();
  function emit(id, event, payload = {}, options = {}) {
    const context = contexts.get(id) ?? { debateId: id, asset: options.asset ?? 'AAPL', market: options.market ?? 'stocks',
      purpose: options.purpose ?? 'ENTRY', marketSnapshotAt: BASE_TIME - 100 };
    contexts.set(id, context);
    const result = registry.observe(context, event, { debateId: id, ...payload }, false);
    now += 100;
    return result;
  }
  return { emit, raw: () => registry.snapshot(), parsed: () => parseTeamSessionSnapshot(registry.snapshot()), advance: ms => { now += ms; } };
}
function observedFixture() {
  const f = fixture(); f.emit('entry', 'debate:start'); f.emit('entry', 'debate:agent-speaking', { agentId: 1, round: 1 });
  f.emit('entry', 'debate:agent-voted', { agentId: 2, vote: 'BUY', confidence: 80, openingArgument: 'Source text with no verified quote $999' });
  return f;
}
const loaded = (snapshot, epoch = 1, receivedAt = BASE_TIME) => ({ snapshot, authEpoch: epoch, receivedAt });
const projection = (snapshot, options = {}) => projectTeamWorkspaceReadback({ tokenPresent: true, authEpoch: 1,
  data: loaded(snapshot), now: BASE_TIME + 1000, ...options });
const response = (config, data, status = 200) => ({ config, data, status, statusText: 'fixture', headers: {} });
const httpError = (config, status) => new axios.AxiosError('PRIVATE_SERVER_DETAIL', 'ERR_BAD_RESPONSE', config, {}, response(config, {}, status));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function sessionFixture() {
  const auth = createStore(set => ({ token: 'dummy-session-a', authEpoch: 1,
    logout: () => set(state => ({ token: null, authEpoch: state.authEpoch + 1 })) }));
  const api = createSessionApi(auth, 'https://fixture.invalid/api');
  const cache = createSessionQueryCache(auth);
  const options = () => teamWorkspaceQueryOptions(auth, api, { token: auth.getState().token, authEpoch: auth.getState().authEpoch });
  return { auth, api, cache, options, dispose: () => cache.dispose() };
}

test('actual empty producer snapshot has explicit process coverage without invented work or financial defaults', () => {
  const result = projection(fixture().parsed());
  assert.equal(result.meta.state, 'empty'); assert.equal(result.meta.executionLiveness, 'unknown');
  assert.equal(result.meta.coverage.retainedSessions, 0); assert.equal(result.meta.coverage.durable, false);
  assert.deepEqual(result.model.reviews, []); assert.equal(result.model.sampleState, false);
  assert.equal(result.model.observedFaultCount, null); assert.equal(result.model.modeLabel, 'Mode unverified');
  assert.match(result.model.accountLabel, /unverified/); assert.match(result.model.positionsLabel, /unverified/);
  assert.ok(result.meta.caveats.some(text => text.includes('disconnect')));
});

test('actual producer excludes private held-position reviews before frontend coverage exists', () => {
  const f = fixture(); f.emit('private', 'debate:start', {}, { purpose: 'POSITION_REVIEW' });
  assert.deepEqual(projection(f.parsed()).model.reviews, []);
});

test('analyzing is observed with unknown execution, vote is evidence, missing specialists remain absent', () => {
  const result = projection(observedFixture().parsed()); const review = result.model.reviews[0];
  assert.equal(review.specialists[1].state, 'observed'); assert.match(review.specialists[1].evidence, /execution is unknown/);
  assert.equal(review.specialists[2].state, 'voted'); assert.equal(review.specialists[3], undefined);
  assert.ok(Object.values(review.specialists).every(item => !['running', 'waiting'].includes(item.state)));
  assert.equal(review.priceLabel, undefined); assert.equal(review.forecastLabel, undefined); assert.equal(review.fundamentalsLabel, undefined);
  assert.equal(review.instrumentName, undefined); assert.equal(result.meta.sessions.entry.exchangeObservedAt, null);
  assert.equal(result.meta.sessions.entry.marketSnapshotAt, BASE_TIME - 100);
});

test('explicit same-symbol concurrent purpose/market sessions never join or inherit a stage', () => {
  const f = observedFixture(); f.emit('research', 'debate:start', {}, { purpose: 'RESEARCH', market: 'crypto' });
  f.emit('research', 'debate:round', { round: 3 });
  const result = projection(f.parsed());
  assert.equal(result.model.reviews.length, 2); assert.equal(result.model.reviews[0].id, 'research');
  assert.equal(result.model.reviews[0].marketLabel, 'Crypto'); assert.deepEqual(result.model.reviews[0].specialists, {});
  assert.equal(result.meta.sessions.research.purpose, 'RESEARCH'); assert.equal(result.meta.sessions.entry.status, 'incomplete');
  assert.match(result.model.reviews[1].stageLabel, /session start/);
});

test('receipt order follows sequence even when source/receipt clocks or input array order differ', () => {
  const f = fixture(); f.emit('entry', 'debate:start'); f.emit('entry', 'debate:agent-voted', { agentId: 1, vote: 'BUY', openingArgument: 'Earlier' });
  f.emit('entry', 'debate:final-vote', { agentId: 1, finalVote: 'HOLD', finalReason: 'Later sequence', confidence: 75 });
  const raw = f.raw(); const session = raw.sessions[0];
  session.entries[1].receivedAt = BASE_TIME + 10_000; session.entries[1].sourceEventAt = BASE_TIME - 50_000;
  session.agents[1].lastObservation.receivedAt = BASE_TIME - 1000;
  session.entries[2].receivedAt = BASE_TIME - 1000; session.entries.reverse();
  const result = projection(parseTeamSessionSnapshot(raw));
  assert.match(result.model.reviews[0].specialists[1].evidence, /HOLD.*Later sequence/);
  assert.match(result.model.reviews[0].specialists[1].history[0].text, /Later sequence/);
});

test('challenge/rebuttal are actual observations and never invented handoffs', () => {
  const f = fixture(); f.emit('entry', 'debate:start');
  f.emit('entry', 'debate:cross-examination', { challengerId: 10, targetId: 1, challenge: 'Question', rebuttal: 'Response' });
  const review = projection(f.parsed()).model.reviews[0];
  assert.equal(review.specialists[10].state, 'observed'); assert.equal(review.specialists[1].state, 'observed');
  assert.equal(review.specialists[10].evidence, 'Question'); assert.equal(review.handoffs, undefined);
});

test('separate coordinator and completed result do not become a fifteenth specialist or an order fill', () => {
  const f = observedFixture(); f.emit('entry', 'debate:master-thinking');
  f.emit('entry', 'debate:complete', { transcript: { id: 'entry', asset: 'AAPL', market: 'stocks', purpose: 'ENTRY', finalDecision: 'BUY',
    finalConfidence: 81, executionApproved: true, masterSynthesis: 'Observed synthesis', decisionId: 'actual-decision', timestamp: BASE_TIME,
    blockReason: null, tradeExecuted: true, credentials: 'PRIVATE_SECRET', portfolio: 'PRIVATE_ACCOUNT' } });
  const result = projection(f.parsed());
  assert.equal(result.meta.sessions.entry.status, 'complete'); assert.equal(result.meta.sessions.entry.result.decisionId, 'actual-decision');
  assert.equal(result.meta.sessions.entry.result.tradeExecution, 'not-observed'); assert.equal(result.meta.sessions.entry.coordinator.name, 'Master Coordinator');
  assert.equal(result.model.reviews[0].specialists[15], undefined); assert.match(result.model.reviews[0].decisionLabel, /execution not observed/);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_')); assert.ok(!JSON.stringify(result).includes('tradeExecuted'));
});

test('safe failures remain observed errors, not current provider health or inferred timeout failures', () => {
  const f = fixture(); f.emit('entry', 'debate:start');
  f.emit('entry', 'debate:agent-error', { agentId: 2, round: 3, errorCode: 'final_unavailable', error: 'PRIVATE_PROVIDER_DETAIL' });
  f.emit('entry', 'debate:error', { errorCode: 'session_failed', fatal: true, message: 'PRIVATE_PROVIDER_DETAIL' });
  const result = projection(f.parsed());
  assert.equal(result.meta.sessions.entry.status, 'failed'); assert.equal(result.model.reviews[0].specialists[2].state, 'error');
  assert.equal(result.model.reviews[0].issue.specialistId, 2); assert.equal(result.meta.observedFailureReceipts, 2);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_')); assert.equal(result.model.observedFaultCount, null);
});

test('content and timeline/session retention limits are surfaced as partial coverage', () => {
  const f = fixture(); f.emit('entry', 'debate:start');
  for (let i = 0; i < 110; i++) f.emit('entry', 'debate:agent-voted', { agentId: 1, vote: 'BUY', openingArgument: 'x'.repeat(3000) });
  let result = projection(f.parsed());
  assert.equal(result.meta.coverage.partial, true); assert.equal(result.meta.sessions.entry.contentTruncated, true);
  assert.equal(result.meta.sessions.entry.entriesTruncated, true); assert.equal(result.meta.sessions.entry.droppedEntryCount, 15);
  assert.ok(result.model.reviews[0].specialists[1].notes.some(text => text.includes('3000')));
  for (let i = 0; i < 33; i++) f.emit(`retained-${i}`, 'debate:start');
  result = projection(f.parsed()); assert.equal(result.meta.coverage.retainedSessions, 32); assert.equal(result.meta.coverage.counters.evictedSessions, 2);
  assert.ok(!result.model.reviews.some(review => review.id === 'entry'));
  f.advance(3_600_001); result = projection(f.parsed());
  assert.deepEqual(result.model.reviews, []); assert.equal(result.meta.coverage.counters.expiredSessions, 32);
});

test('restart and successive empty readbacks replace coverage without resurrecting old cached sessions', () => {
  const first = projection(observedFixture().parsed()); const next = projection(fixture().parsed());
  assert.notEqual(first.meta.coverage.processId, next.meta.coverage.processId); assert.deepEqual(next.model.reviews, []);
  assert.deepEqual(next.meta.sessions, {}); assert.equal(next.meta.state, 'empty');
});

test('age labels distinguish older transport/source observations without declaring work running or failed', () => {
  const f = observedFixture(); f.advance(40_000); const snapshot = f.parsed();
  const result = projection(snapshot, { now: BASE_TIME + TEAM_READBACK_STALE_MS + 1 });
  assert.equal(result.meta.state, 'stale'); assert.equal(result.meta.sessions.entry.olderObservation, true);
  assert.equal(result.meta.sessions.entry.status, 'incomplete'); assert.equal(result.meta.sessions.entry.executionLiveness, 'unknown');
  assert.equal(result.model.connectionState, 'unknown'); assert.equal(result.model.reviews[0].specialists[1].state, 'observed');
});

test('Eastern labels follow actual summer/winter and DST transition offsets', () => {
  assert.match(formatTeamReceiptTime(Date.parse('2026-07-01T16:00:00Z')), /12:00:00 PM EDT/);
  assert.match(formatTeamReceiptTime(Date.parse('2026-01-01T17:00:00Z')), /12:00:00 PM EST/);
  assert.match(formatTeamReceiptTime(Date.parse('2026-11-01T05:30:00Z')), /1:30:00 AM EDT/);
  assert.match(formatTeamReceiptTime(Date.parse('2026-11-01T06:30:00Z')), /1:30:00 AM EST/);
});

test('any request/validation error clears reviews but exposes safe previous-as-of metadata', () => {
  const data = loaded(observedFixture().parsed());
  for (const error of [new InvalidTeamSnapshotError(), { response: { status: 503 }, message: 'PRIVATE_DETAIL' }, { response: { status: 403 } }]) {
    const result = projectTeamWorkspaceReadback({ tokenPresent: true, authEpoch: 1, data, error, now: BASE_TIME + 1000 });
    assert.deepEqual(result.model.reviews, []); assert.deepEqual(result.meta.sessions, {}); assert.equal(result.meta.coverage, null);
    assert.equal(result.meta.stale, true); assert.equal(result.meta.previousReadback.processId, data.snapshot.process.id);
    assert.equal(result.meta.serverCapturedAt, null); assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  }
});

test('signed-out/new epoch projections cannot reveal old content or metadata', () => {
  const data = loaded(observedFixture().parsed());
  for (const input of [{ tokenPresent: false, authEpoch: 1 }, { tokenPresent: true, authEpoch: 2 }]) {
    const result = projectTeamWorkspaceReadback({ ...input, data, now: BASE_TIME });
    assert.deepEqual(result.model.reviews, []); assert.equal(result.meta.coverage, null); assert.equal(result.meta.previousReadback, undefined);
    assert.equal(result.meta.serverCapturedAt, null); assert.equal(result.meta.browserReceivedAt, null);
  }
});

test('parser and projections are allowlisted copies, not raw transport or mutable cache references', () => {
  const raw = observedFixture().raw(); raw.credentials = 'PRIVATE_SECRET'; raw.sessions[0].portfolio = 'PRIVATE_ACCOUNT';
  const parsed = parseTeamSessionSnapshot(raw); const result = projection(parsed);
  raw.sessions[0].agents[1].lastObservation.kind = 'error';
  result.model.reviews[0].specialists[1].evidence = 'MUTATED'; result.meta.coverage.counters.acceptedEvents = 0;
  assert.equal(parsed.sessions[0].agents[1].lastObservation.kind, 'analyzing'); assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  assert.ok(parsed.counters.acceptedEvents > 0);
});

const malformed = [
  ['schema version', raw => { raw.schemaVersion = 2; }],
  ['process identity', raw => { raw.process.id = 'hostname.example'; }],
  ['durability', raw => { raw.process.durable = true; }],
  ['execution liveness', raw => { raw.semantics.executionLiveness = 'running'; }],
  ['heartbeat', raw => { raw.semantics.heartbeat = true; }],
  ['scope exclusions', raw => { raw.semantics.excludes = []; }],
  ['huge session limit', raw => { raw.limits.maxSessions = 33; }],
  ['huge text limit', raw => { raw.limits.maxTextChars = 3000; }],
  ['session count', raw => { raw.sessions = Array.from({ length: 33 }, () => clone(raw.sessions[0])); }],
  ['entry count', raw => { raw.sessions[0].entries = Array.from({ length: 97 }, () => clone(raw.sessions[0].entries[0])); }],
  ['duplicate session', raw => { raw.sessions.push(clone(raw.sessions[0])); }],
  ['private purpose', raw => { raw.sessions[0].purpose = 'POSITION_REVIEW'; }],
  ['market guessing', raw => { raw.sessions[0].market = 'stock'; }],
  ['unverified exchange timestamp', raw => { raw.sessions[0].exchangeObservedAt = BASE_TIME; }],
  ['unknown agent', raw => { raw.roster.specialists[0].id = 99; }],
  ['role name mismatch', raw => { raw.roster.specialists[0].name = 'Administrator'; }],
  ['duplicate roster role', raw => { raw.roster.specialists[0] = clone(raw.roster.specialists[1]); }],
  ['sequence beyond coverage', raw => { raw.sessions[0].lastSequence = 9999; }],
  ['mixed process receipt', raw => { raw.sessions[0].entries[0].processId = 'another-process'; }],
  ['unscoped receipt event', raw => { raw.sessions[0].entries[0].event = 'agent:analyzing'; }],
  ['fake final start', raw => { raw.sessions[0].entries[1].round = 3; }],
  ['unbounded evidence', raw => { raw.sessions[0].entries[2].content = 'x'.repeat(2049); }],
  ['lying truncation', raw => { raw.sessions[0].entries[2].originalCharacters = 0; }],
  ['invalid vote', raw => { raw.sessions[0].entries[2].vote = 'ALL_IN'; }],
  ['invalid confidence', raw => { raw.sessions[0].entries[2].confidence = Infinity; }],
  ['invalid source time', raw => { raw.sessions[0].entries[1].sourceEventAt = 'yesterday'; }],
  ['mismatched last receipt', raw => { raw.sessions[0].agents[1].lastObservation.sequence = 1; }],
  ['last receipt name', raw => { raw.sessions[0].agents[1].name = 'Other role'; }],
  ['contradictory completion', raw => { raw.sessions[0].status = 'complete'; }],
  ['invalid error code', raw => { raw.sessions[0].entries[2].errorCode = 'PRIVATE_PROVIDER_DETAIL'; }],
];
for (const [name, mutate] of malformed) test(`rejects malformed ${name} as an entire response`, () => {
  const raw = observedFixture().raw(); mutate(raw);
  assert.throws(() => parseTeamSessionSnapshot(raw), InvalidTeamSnapshotError);
});

test('query captures real current authorization, signal and timeout without credentials in the key', async () => {
  const f = sessionFixture(); let config;
  f.api.defaults.adapter = request => { config = request; return Promise.resolve(response(request, observedFixture().raw())); };
  try {
    const options = f.options(), controller = new AbortController(); const data = await options.queryFn({ signal: controller.signal });
    assert.equal(config.url, '/agents/sessions'); assert.equal(config.method, 'get'); assert.equal(config.timeout, 5000);
    assert.equal(config.headers.get('Authorization'), 'Bearer dummy-session-a'); assert.equal(config.signal, controller.signal);
    assert.deepEqual(options.queryKey, ['team-workspace', 'server-sessions', 1]); assert.ok(!JSON.stringify(options.queryKey).includes('dummy'));
    assert.equal(options.refetchInterval, 10_000); assert.equal(options.refetchIntervalInBackground, false);
    assert.equal(options.refetchOnWindowFocus, true); assert.equal(options.placeholderData, undefined); assert.equal(options.structuralSharing, false);
    assert.equal(options.gcTime, 0); assert.equal(options.retry, false); assert.equal(data.authEpoch, 1);
  } finally { f.dispose(); }
});

test('old scheduled query and signed-out query cannot dispatch with new credentials', async () => {
  const f = sessionFixture(); let calls = 0;
  f.api.defaults.adapter = request => { calls++; return Promise.resolve(response(request, fixture().raw())); };
  try {
    const options = f.options(); f.auth.setState({ token: 'dummy-session-b', authEpoch: 2 });
    await assert.rejects(options.queryFn({ signal: new AbortController().signal }), error => axios.isCancel(error));
    f.auth.getState().logout(); const signedOut = f.options(); assert.equal(signedOut.enabled, false);
    await assert.rejects(signedOut.queryFn({ signal: new AbortController().signal }), error => axios.isCancel(error));
    assert.equal(calls, 0);
  } finally { f.dispose(); }
});

test('actual query cancellation aborts transport and ignored late completion cannot enter next auth epoch', async () => {
  const f = sessionFixture(); const pending = deferred(); let config;
  f.api.defaults.adapter = request => { config = request; return pending.promise; };
  try {
    const previous = f.cache.getSnapshot().client;
    const result = previous.fetchQuery(f.options()).then(data => ({ data }), error => ({ error }));
    assert.equal(config.signal.aborted, false);
    f.auth.setState({ token: 'dummy-session-a', authEpoch: 2 });
    assert.equal(config.signal.aborted, true);
    pending.resolve(response(config, observedFixture().raw()));
    assert.ok(isCancelledError((await result).error));
    assert.equal(f.cache.getSnapshot().client.getQueryData(teamWorkspaceQueryKey(2)), undefined);
    assert.equal(previous.getQueryData(teamWorkspaceQueryKey(1)), undefined);
  } finally { pending.resolve({}); f.dispose(); }
});

test('late old-session 401 cannot sign out new identity, but current 503 preserves sign-in', async () => {
  const f = sessionFixture(); const pending = deferred(); let config;
  f.api.defaults.adapter = request => { config = request; return pending.promise; };
  try {
    const result = f.options().queryFn({ signal: new AbortController().signal }).catch(error => error);
    f.auth.setState({ token: 'dummy-session-b', authEpoch: 2 }); pending.reject(httpError(config, 401));
    assert.ok(axios.isCancel(await result)); assert.equal(f.auth.getState().token, 'dummy-session-b');
    f.api.defaults.adapter = request => Promise.reject(httpError(request, 503));
    await assert.rejects(f.options().queryFn({ signal: new AbortController().signal }));
    assert.equal(f.auth.getState().token, 'dummy-session-b');
  } finally { f.dispose(); }
});

function renderHook(f, session = f.auth.getState()) {
  let hook;
  function Harness() { hook = useTeamWorkspaceReadbackForSession(session, f.auth, f.api); return React.createElement('div', null, hook.meta.state); }
  renderToString(React.createElement(QueryClientProvider, { client: f.cache.getSnapshot().client }, React.createElement(Harness)));
  return hook;
}

test('actual rendered hook clears cached review content on failed readback and accepts later empty coverage', async () => {
  const f = sessionFixture(); let raw = observedFixture().raw(), fail = false;
  f.api.defaults.adapter = config => fail ? Promise.reject(httpError(config, 503)) : Promise.resolve(response(config, raw));
  try {
    const client = f.cache.getSnapshot().client; await client.fetchQuery(f.options());
    assert.equal(renderHook(f).model.reviews.length, 1);
    fail = true; await assert.rejects(client.fetchQuery({ ...f.options(), staleTime: 0 }));
    let hook = renderHook(f); assert.deepEqual(hook.model.reviews, []); assert.equal(hook.meta.state, 'unavailable');
    assert.equal(hook.meta.stale, true); assert.ok(hook.meta.previousReadback); assert.equal(f.auth.getState().token, 'dummy-session-a');
    fail = false; raw = fixture().raw(); await client.fetchQuery({ ...f.options(), staleTime: 0 });
    hook = renderHook(f); assert.equal(hook.meta.state, 'empty'); assert.deepEqual(hook.model.reviews, []);
  } finally { f.dispose(); }
});

test('actual rendered hook cannot expose retired epoch data or refresh into a newer identity', async () => {
  const f = sessionFixture(); let calls = 0;
  f.api.defaults.adapter = config => { calls++; return Promise.resolve(response(config, observedFixture().raw())); };
  try {
    await f.cache.getSnapshot().client.fetchQuery(f.options()); const oldSession = { ...f.auth.getState() }; const oldHook = renderHook(f, oldSession);
    assert.equal(oldHook.model.reviews.length, 1); f.auth.setState({ token: 'dummy-session-b', authEpoch: 2 });
    await oldHook.refresh(); assert.equal(calls, 1);
    const next = renderHook(f); assert.deepEqual(next.model.reviews, []); assert.equal(next.meta.previousReadback, undefined);
    const retired = renderHook(f, oldSession); assert.deepEqual(retired.model.reviews, []);
  } finally { f.dispose(); }
});

test('actual hook distinguishes current forbidden/invalid readback and never exposes cached review content', async () => {
  const f = sessionFixture(); let mode = 'success';
  f.api.defaults.adapter = config => mode === 'forbidden' ? Promise.reject(httpError(config, 403))
    : Promise.resolve(response(config, mode === 'invalid' ? { schemaVersion: 2, credentials: 'PRIVATE_DETAIL' } : observedFixture().raw()));
  try {
    const client = f.cache.getSnapshot().client; await client.fetchQuery(f.options());
    mode = 'forbidden'; await assert.rejects(client.fetchQuery({ ...f.options(), staleTime: 0 }));
    let hook = renderHook(f); assert.equal(hook.meta.state, 'forbidden'); assert.deepEqual(hook.model.reviews, []);
    assert.equal(f.auth.getState().token, 'dummy-session-a');
    mode = 'invalid'; await assert.rejects(client.fetchQuery({ ...f.options(), staleTime: 0 }), InvalidTeamSnapshotError);
    hook = renderHook(f); assert.equal(hook.meta.state, 'invalid-response'); assert.deepEqual(hook.model.reviews, []);
    assert.ok(!JSON.stringify({ model: hook.model, meta: hook.meta, error: hook.error }).includes('PRIVATE_'));
  } finally { f.dispose(); }
});

test('a current unauthorized readback retires the auth client and cannot keep owner data visible', async () => {
  const f = sessionFixture();
  try {
    f.api.defaults.adapter = config => Promise.resolve(response(config, observedFixture().raw()));
    const previous = f.cache.getSnapshot().client, initial = await previous.fetchQuery(f.options());
    let unauthorizedRequests = 0;
    f.api.defaults.adapter = config => { unauthorizedRequests++; return Promise.reject(httpError(config, 401)); };
    // Retiring the client cancels with revert. Query can return its prior data
    // to the already-retired fetch caller; it must never enter the new client/UI.
    const outcome = await previous.fetchQuery({ ...f.options(), staleTime: 0 }).then(value => ({ value }), error => ({ error }));
    assert.equal(unauthorizedRequests, 1);
    if (outcome.error) assert.ok(isCancelledError(outcome.error) || outcome.error.response?.status === 401);
    else assert.deepEqual(outcome.value, initial);
    assert.equal(f.auth.getState().token, null); assert.notEqual(previous, f.cache.getSnapshot().client);
    assert.equal(previous.getQueryData(teamWorkspaceQueryKey(1)), undefined);
    assert.equal(f.cache.getSnapshot().client.getQueryCache().getAll().length, 0);
    const hook = renderHook(f); assert.equal(hook.meta.state, 'signed-out'); assert.deepEqual(hook.model.reviews, []);
    assert.equal(hook.meta.previousReadback, undefined);
  } finally { f.dispose(); }
});

test('a direct current-session request rejects actual401 and cannot return an authorized snapshot', async () => {
  const f = sessionFixture(); let config;
  f.api.defaults.adapter = request => { config = request; return Promise.reject(httpError(request, 401)); };
  try {
    const previous = f.cache.getSnapshot().client;
    await assert.rejects(f.options().queryFn({ signal: new AbortController().signal }), error => error.response?.status === 401);
    assert.equal(config.url, '/agents/sessions'); assert.equal(config.headers.get('Authorization'), 'Bearer dummy-session-a');
    assert.equal(f.auth.getState().token, null); assert.notEqual(f.cache.getSnapshot().client, previous);
    assert.deepEqual(renderHook(f).model.reviews, []);
  } finally { f.dispose(); }
});

test('actual observer replaces same-process/empty snapshots and removes unused private query data', async () => {
  const f = sessionFixture(); let raw = observedFixture().raw();
  f.api.defaults.adapter = config => Promise.resolve(response(config, raw));
  let stop = () => {};
  try {
    const client = f.cache.getSnapshot().client, observer = new QueryObserver(client, { ...f.options(), enabled: false });
    stop = observer.subscribe(() => {});
    let result = await observer.refetch(); assert.equal(result.data.snapshot.sessions.length, 1);
    raw = fixture().raw(); result = await observer.refetch(); assert.deepEqual(result.data.snapshot.sessions, []);
    stop(); observer.destroy();
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(client.getQueryData(f.options().queryKey), undefined);
  } finally { stop(); f.dispose(); }
});

test('a canceled older readback arriving last cannot replace a later observed sequence', async () => {
  const f = sessionFixture(), producer = observedFixture(), first = deferred(), second = deferred();
  let requests = 0, oldConfig, newConfig;
  f.api.defaults.adapter = config => {
    requests++;
    if (requests === 1) return Promise.resolve(response(config, producer.raw()));
    if (requests === 2) { oldConfig = config; return first.promise; }
    newConfig = config; return second.promise;
  };
  let stop = () => {};
  try {
    const client = f.cache.getSnapshot().client, observer = new QueryObserver(client, { ...f.options(), enabled: false });
    stop = observer.subscribe(() => {}); await observer.refetch();
    const older = producer.raw(), oldRead = observer.refetch();
    producer.emit('entry', 'debate:final-vote', { agentId: 2, finalVote: 'HOLD', confidence: 70, finalReason: 'Later actual sequence' });
    const newer = producer.raw(), newRead = observer.refetch();
    assert.equal(oldConfig.signal.aborted, true);
    second.resolve(response(newConfig, newer)); await newRead;
    first.resolve(response(oldConfig, older)); await oldRead;
    const current = client.getQueryData(f.options().queryKey);
    assert.equal(current.snapshot.sessions[0].lastSequence, newer.sessions[0].lastSequence);
    assert.match(projection(current.snapshot).model.reviews[0].specialists[2].evidence, /Later actual sequence/);
  } finally { first.resolve({}); second.resolve({}); stop(); f.dispose(); }
});
