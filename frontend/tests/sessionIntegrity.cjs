// Real Axios/Zustand/session controllers with in-memory adapters; no HTTP listener
// or default network adapter is used. Execute only inside the offline CI sandbox.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename);
};
const axios = require('axios');
const { useStore } = require('../src/store/index.ts');
const { createSessionApi } = require('../src/services/sessionApi.ts');
const { logoutSession, logoutNoticeApplies, LOGOUT_DEADLINE_MS } = require('../src/services/sessionLogout.ts');
const { createSessionQueryCache } = require('../src/services/sessionQueryCache.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = (config, data = {}, status = 200) => ({ config, data, status, statusText: 'fixture', headers: {} });
const errorResponse = (config, status) => new axios.AxiosError('Fixture unavailable', 'ERR_BAD_RESPONSE', config, {}, response(config, {}, status));
async function fixture(run) {
  const previous = useStore.getState(); const previousStorage = global.localStorage;
  let storedToken;
  global.localStorage = { setItem(_key, value) { storedToken = value; }, removeItem() { storedToken = undefined; } };
  try { useStore.getState().setAuth('dummy-session-a', { id: 'fixture-a' }); await run(() => storedToken); }
  finally { useStore.setState(previous, true); global.localStorage = previousStorage; }
}

test('captures the request token synchronously and rejects a late successful private response', () => fixture(async () => {
  const api = createSessionApi(useStore, 'https://fixture.invalid/api'); const pending = deferred(); let captured;
  api.defaults.adapter = config => { captured = config; return pending.promise; };
  const result = api.get('/portfolio').then(value => ({ value }), error => ({ error }));
  assert.equal(captured.headers.get('Authorization'), 'Bearer dummy-session-a');
  useStore.getState().setAuth('dummy-session-b', { id: 'fixture-b' });
  pending.resolve(response(captured, { marker: 'PRIVATE_A' }));
  const outcome = await result; assert.ok(axios.isCancel(outcome.error)); assert.equal(outcome.value, undefined);
  assert.equal(useStore.getState().token, 'dummy-session-b');
}));
test('late 401 cannot log out a newer token or a fresh session using the same token', () => fixture(async () => {
  for (const replacement of ['dummy-session-b', 'dummy-session-a']) {
    useStore.getState().setAuth('dummy-session-a', { id: 'fixture-a' });
    const api = createSessionApi(useStore, 'https://fixture.invalid/api'); const pending = deferred(); let captured;
    api.defaults.adapter = config => { captured = config; return pending.promise; };
    const result = api.get('/portfolio').catch(error => error);
    useStore.getState().logout(); useStore.getState().setAuth(replacement, { id: 'fixture-next' });
    pending.reject(errorResponse(captured, 401));
    assert.ok(axios.isCancel(await result)); assert.equal(useStore.getState().token, replacement);
  }
}));
test('current 401 clears local auth but temporary 503 preserves it for retry', () => fixture(async () => {
  const api = createSessionApi(useStore, 'https://fixture.invalid/api');
  api.defaults.adapter = config => Promise.reject(errorResponse(config, 503));
  await assert.rejects(api.get('/portfolio')); assert.equal(useStore.getState().token, 'dummy-session-a');
  api.defaults.adapter = config => Promise.reject(errorResponse(config, 401));
  await assert.rejects(api.get('/portfolio')); assert.equal(useStore.getState().token, null);
}));
test('same-token reauthentication rotates the real query cache and rejects earlier work', () => fixture(async () => {
  const cache = createSessionQueryCache(useStore);
  try {
    const previous = cache.getSnapshot().client; previous.setQueryData(['portfolio'], { marker: 'PRIVATE_A' });
    const api = createSessionApi(useStore, 'https://fixture.invalid/api'); const pending = deferred(); let captured;
    api.defaults.adapter = config => { captured = config; return pending.promise; };
    const result = api.get('/portfolio').catch(error => error);
    useStore.getState().setAuth('dummy-session-a', { id: 'fixture-a' });
    assert.notEqual(cache.getSnapshot().client, previous); assert.equal(cache.getSnapshot().client.getQueryData(['portfolio']), undefined);
    pending.resolve(response(captured, { marker: 'PRIVATE_A' })); assert.ok(axios.isCancel(await result));
  } finally { cache.dispose(); }
}));
test('logout clears real local state and cache immediately, then revokes only the captured token', () => fixture(async stored => {
  const cache = createSessionQueryCache(useStore); const client = axios.create(); const pending = deferred(); let captured;
  client.defaults.adapter = config => { captured = config; return pending.promise; };
  try {
    useStore.getState().setPortfolio({ marker: 'PRIVATE_A' }); const previous = cache.getSnapshot().client;
    previous.setQueryData(['portfolio'], { marker: 'PRIVATE_A' });
    const result = logoutSession(useStore, client);
    assert.equal(useStore.getState().token, null); assert.equal(useStore.getState().portfolio, null); assert.equal(stored(), undefined);
    assert.notEqual(cache.getSnapshot().client, previous); assert.equal(previous.getQueryData(['portfolio']), undefined);
    assert.equal(captured.headers.get('Authorization'), 'Bearer dummy-session-a'); assert.equal(captured.url, '/auth/logout');
    assert.equal(captured.timeout, LOGOUT_DEADLINE_MS); assert.equal(captured.signal.aborted, false);
    useStore.getState().setAuth('dummy-session-b', { id: 'fixture-b' });
    pending.resolve(response(captured, { success: true, revocationConfirmed: true }));
    const outcome = await result; assert.equal(outcome.revocation, 'confirmed'); assert.equal(logoutNoticeApplies(useStore, outcome), false);
    assert.equal(useStore.getState().token, 'dummy-session-b');
    assert.equal(captured.headers.get('Authorization'), 'Bearer dummy-session-a');
  } finally { pending.resolve(response(captured)); cache.dispose(); }
}));
test('old logout 401 cannot clear fresh same-token or new-token sessions and never retries', () => fixture(async () => {
  for (const replacement of ['dummy-session-a', 'dummy-session-b']) {
    useStore.getState().setAuth('dummy-session-a', { id: 'fixture-a' });
    const client = axios.create(); const pending = deferred(); let captured; let calls = 0;
    client.defaults.adapter = config => { captured = config; calls++; return pending.promise; };
    const result = logoutSession(useStore, client);
    useStore.getState().setAuth(replacement, { id: 'fixture-next' });
    pending.reject(errorResponse(captured, 401)); const outcome = await result;
    assert.equal(outcome.revocation, 'unconfirmed'); assert.equal(logoutNoticeApplies(useStore, outcome), false);
    assert.equal(useStore.getState().token, replacement); assert.equal(calls, 1);
  }
}));
test('logout reports unconfirmed on unavailable/malformed success instead of claiming server revocation', () => fixture(async () => {
  for (const data of [{ success: true }, { success: true, revocationConfirmed: false }, {}]) {
    useStore.getState().setAuth('dummy-session-a', { id: 'fixture-a' });
    const client = axios.create({ adapter: config => Promise.resolve(response(config, data)) });
    const outcome = await logoutSession(useStore, client);
    assert.equal(outcome.revocation, 'unconfirmed'); assert.equal(logoutNoticeApplies(useStore, outcome), true);
  }
  useStore.getState().setAuth('dummy-session-a', { id: 'fixture-a' });
  const client = axios.create({ adapter: config => Promise.reject(errorResponse(config, 503)) });
  assert.equal((await logoutSession(useStore, client)).revocation, 'unconfirmed');
  assert.equal(useStore.getState().token, null);
}));
test('logout deadline aborts transport and an ignored abort/late success cannot change the result', () => fixture(async () => {
  const client = axios.create(); const pending = deferred(); let captured; let fire; let timeout; let cleared;
  client.defaults.adapter = config => { captured = config; return pending.promise; };
  const originalSet = global.setTimeout; const originalClear = global.clearTimeout;
  global.setTimeout = (callback, ms) => { fire = callback; timeout = ms; return 17; };
  global.clearTimeout = handle => { cleared = handle; };
  try {
    const result = logoutSession(useStore, client); assert.equal(timeout, LOGOUT_DEADLINE_MS);
    fire(); const outcome = await result;
    assert.equal(captured.signal.aborted, true); assert.equal(outcome.revocation, 'unconfirmed'); assert.equal(cleared, 17);
    pending.resolve(response(captured, { success: true, revocationConfirmed: true })); await pending.promise; await Promise.resolve();
    assert.equal(outcome.revocation, 'unconfirmed'); assert.equal(useStore.getState().token, null);
  } finally { global.setTimeout = originalSet; global.clearTimeout = originalClear; pending.resolve(response(captured)); }
}));
test('an already signed-out session sends no revocation request and storage failures still clear memory', () => fixture(async () => {
  global.localStorage.removeItem = () => { throw new Error('Fixture storage unavailable'); };
  useStore.getState().logout(); assert.equal(useStore.getState().token, null);
  let calls = 0; const client = axios.create({ adapter: () => { calls++; throw new Error('Must not send'); } });
  assert.equal((await logoutSession(useStore, client)).revocation, 'not-needed'); assert.equal(calls, 0);
}));
