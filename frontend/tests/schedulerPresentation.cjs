const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { schedulerPresentation: present } = require('../src/utils/schedulerPresentation.ts');
const now = Date.parse('2026-10-17T05:00:00Z');
const base = { evidenceScope: 'CURRENT_PROCESS', status: 'online', lifecycle: 'registered', observedAt: new Date(now).toISOString(),
  observer: { status: 'recent', lastTickAt: new Date(now - 5000).toISOString(), ageMs: 5000, staleAfterMs: 30000 },
  jobHealth: { failedJobs: [], neverObservedJobs: [], activeCallbacks: 0 } };
test('legacy online flag and missing evidence cannot claim operational trading', () => {
  assert.equal(present(undefined, now).tone, 'unknown');
  assert.equal(present({ ...base, evidenceScope: 'HISTORY' }, now).tone, 'unknown');
});
test('only recent observed heartbeat and complete registration earn heartbeat label', () => {
  const result = present(base, now);
  assert.equal(result.label, 'SCHEDULER HEARTBEAT OBSERVED');
  assert.match(result.detail, /does not establish provider health/);
  assert.doesNotMatch(result.label, /TRADING|RUNNING|READY/);
});
test('cached responses, future clocks and stale heartbeats never show green', () => {
  for (const observedAt of ['invalid', new Date(now + 1).toISOString(), new Date(now - 60001).toISOString()]) {
    assert.equal(present({ ...base, observedAt }, now).tone, 'unknown');
  }
  assert.equal(present({ ...base, observer: { ...base.observer, lastTickAt: new Date(now - 30001).toISOString() } }, now).tone, 'unknown');
  assert.equal(present({ ...base, observer: { ...base.observer, lastTickAt: null } }, now).tone, 'unknown');
  for (const staleAfterMs of [NaN, 0, -1, Infinity, 999999]) {
    assert.equal(present({ ...base, observer: { ...base.observer, staleAfterMs } }, now).tone, 'unknown');
  }
});
test('startup, degraded and initialization failure retain distinct recoverable meaning', () => {
  assert.equal(present({ ...base, status: 'starting', observer: { ...base.observer, status: 'not_observed' } }, now).label, 'SCHEDULER STARTING');
  assert.equal(present({ ...base, status: 'degraded' }, now).label, 'SCHEDULER NEEDS ATTENTION');
  assert.equal(present({ ...base, lifecycle: 'failed' }, now).label, 'SCHEDULER OFFLINE');
  assert.equal(present({ ...base, jobHealth: { ...base.jobHealth, failedJobs: ['broker-sync'] } }, now).label, 'SCHEDULER NEEDS ATTENTION');
});
