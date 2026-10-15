// Installed QueryClient + real production controller; no browser, credentials,
// remote requests or mock replacement for the cache being tested.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};
const { QueryClient, QueryObserver, isCancelledError } = require('@tanstack/react-query');
const { createStore } = require('zustand/vanilla');
const { createSessionQueryCache } = require('../src/services/sessionQueryCache.ts');
const fixture = token => {
  const auth = createStore(() => ({ token }));
  return { auth, cache: createSessionQueryCache(auth) };
};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('token changes synchronously replace clients with non-secret epochs and stable snapshots', () => {
  const { auth, cache } = fixture(null);
  const observed = [];
  const unsubscribe = cache.subscribe(() => observed.push(cache.getSnapshot()));
  try {
    const signedOut = cache.getSnapshot();
    assert.ok(signedOut.client instanceof QueryClient);
    assert.equal(cache.getSnapshot(), signedOut);
    assert.deepEqual(Object.keys(signedOut).sort(), ['client', 'epoch']);
    auth.setState({ token: 'dummy-session-a' });
    const first = cache.getSnapshot();
    assert.notEqual(first.client, signedOut.client);
    assert.equal(first.epoch, 1);
    assert.equal(observed[0], first);
    auth.setState({ token: 'dummy-session-a' });
    assert.equal(cache.getSnapshot(), first);
    assert.equal(observed.length, 1);
    auth.setState({ token: null });
    const loggedOut = cache.getSnapshot();
    auth.setState({ token: 'dummy-session-a' });
    const signedInAgain = cache.getSnapshot();
    assert.notEqual(signedInAgain.client, first.client);
    assert.notEqual(signedInAgain.client, loggedOut.client);
    assert.equal(signedInAgain.epoch, 3);
    assert.deepEqual(signedInAgain.client.getDefaultOptions().queries, {
      retry: 2, staleTime: 5000, refetchInterval: 30000,
    });
  } finally { unsubscribe(); cache.dispose(); }
});

test('retiring a session clears both actual query data and mutation result caches', async () => {
  const { auth, cache } = fixture('dummy-session-a');
  try {
    const previous = cache.getSnapshot().client;
    previous.setQueryData(['portfolio'], { owner: 'fixture-a', balance: 123 });
    const mutation = previous.getMutationCache().build(previous, {
      mutationKey: ['private-fixture'], mutationFn: async () => ({ owner: 'fixture-a' }),
    });
    await mutation.execute({});
    assert.equal(previous.getMutationCache().getAll().length, 1);
    auth.setState({ token: 'dummy-session-b' });
    assert.equal(previous.getQueryCache().getAll().length, 0);
    assert.equal(previous.getMutationCache().getAll().length, 0);
    assert.equal(cache.getSnapshot().client.getQueryData(['portfolio']), undefined);
    assert.equal(cache.getSnapshot().client.getMutationCache().getAll().length, 0);
  } finally { cache.dispose(); }
});

test('a provider response ignoring cancellation cannot overwrite the next session cache', async () => {
  const { auth, cache } = fixture('dummy-session-a');
  const response = deferred();
  try {
    const previous = cache.getSnapshot().client;
    let started = false;
    const result = previous.fetchQuery({
      queryKey: ['portfolio'], retry: false,
      queryFn: () => { started = true; return response.promise; },
    }).then(value => ({ value }), error => ({ error }));
    assert.equal(started, true);
    auth.setState({ token: 'dummy-session-b' });
    const current = cache.getSnapshot().client;
    current.setQueryData(['portfolio'], { owner: 'fixture-b', balance: 456 });
    response.resolve({ owner: 'fixture-a', balance: 123 });
    const outcome = await result;
    await response.promise;
    assert.ok(isCancelledError(outcome.error));
    assert.deepEqual(current.getQueryData(['portfolio']), { owner: 'fixture-b', balance: 456 });
    assert.equal(previous.getQueryData(['portfolio']), undefined);
  } finally { response.resolve({}); cache.dispose(); }
});

test('cancellation aborts a consumed signal and discarded requests cannot repopulate logout', async () => {
  const { auth, cache } = fixture('dummy-session-a');
  const response = deferred();
  let signal;
  try {
    const previous = cache.getSnapshot().client;
    const result = previous.fetchQuery({
      queryKey: ['positions'], retry: false,
      queryFn: context => { signal = context.signal; return response.promise; },
    }).then(value => ({ value }), error => ({ error }));
    assert.equal(signal.aborted, false);
    auth.setState({ token: null });
    assert.equal(signal.aborted, true);
    response.resolve([{ owner: 'fixture-a' }]);
    assert.ok(isCancelledError((await result).error));
    assert.equal(cache.getSnapshot().client.getQueryData(['positions']), undefined);
  } finally { response.resolve([]); cache.dispose(); }
});

test('the next session observer cannot fall back to prior private data when its request fails', async () => {
  const { auth, cache } = fixture('dummy-session-a');
  let stopObserver = () => {};
  try {
    cache.getSnapshot().client.setQueryData(['portfolio'], { owner: 'fixture-a' });
    auth.setState({ token: 'dummy-session-b' });
    const current = cache.getSnapshot().client;
    const observer = new QueryObserver(current, {
      queryKey: ['portfolio'], enabled: false, retry: false,
      queryFn: async () => { throw new Error('Fixture service unavailable'); },
    });
    const observedData = [];
    stopObserver = observer.subscribe(result => observedData.push(result.data));
    assert.equal(observer.getCurrentResult().data, undefined);
    const result = await observer.refetch();
    assert.equal(result.status, 'error');
    assert.equal(result.data, undefined);
    assert.ok(observedData.every(data => data === undefined));
    assert.equal(current.getQueryData(['portfolio']), undefined);
  } finally { stopObserver(); cache.dispose(); }
});

test('production auth-store actions switch the cache before returning and disposal removes the binding', () => {
  const { useStore } = require('../src/store/index.ts');
  const previousState = useStore.getState();
  const previousStorage = global.localStorage;
  global.localStorage = { setItem() {}, removeItem() {} };
  const cache = createSessionQueryCache(useStore);
  try {
    useStore.getState().setAuth('dummy-store-session-a', { id: 'fixture-a' });
    const first = cache.getSnapshot();
    first.client.setQueryData(['private-fixture'], { owner: 'fixture-a' });
    useStore.getState().logout();
    const signedOut = cache.getSnapshot();
    assert.notEqual(signedOut.client, first.client);
    assert.equal(first.client.getQueryData(['private-fixture']), undefined);
    useStore.getState().setAuth('dummy-store-session-b', { id: 'fixture-b' });
    assert.notEqual(cache.getSnapshot().client, signedOut.client);
    assert.equal(cache.getSnapshot().client.getQueryData(['private-fixture']), undefined);
    cache.dispose();
    const disposed = cache.getSnapshot();
    useStore.getState().logout();
    assert.equal(cache.getSnapshot(), disposed);
  } finally {
    cache.dispose();
    useStore.setState(previousState, true);
    global.localStorage = previousStorage;
  }
});
