jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn() } }));
import { SchedulerRuntime } from '../src/jobs/schedulerRuntime';

describe('current-process scheduler evidence', () => {
  let time: number;
  let log: jest.Mock;
  let runtime: SchedulerRuntime;
  beforeEach(() => { time = Date.parse('2026-10-17T12:00:00Z'); log = jest.fn(); runtime = new SchedulerRuntime(() => time, log); });

  test('HTTP process construction never means scheduler online; first heartbeat is required', () => {
    expect(runtime.snapshot()).toMatchObject({ status: 'offline', lifecycle: 'not_started', observer: { status: 'not_observed' } });
    runtime.begin(); runtime.ready();
    expect(runtime.snapshot().status).toBe('starting');
    runtime.heartbeat(); expect(runtime.snapshot().status).toBe('online');
    time += 30_001;
    expect(runtime.snapshot()).toMatchObject({ status: 'degraded', observer: { status: 'stale' } });
    runtime.heartbeat(); expect(runtime.snapshot().status).toBe('online');
    runtime.stop(); expect(runtime.snapshot().status).toBe('offline');
  });

  test('registration failure remains offline even if a partial registration ticks', () => {
    runtime.begin(); runtime.register('partial', '* * * * *', 'SYSTEM_DEFAULT', () => {});
    runtime.fail('INIT_FAILED'); runtime.heartbeat();
    expect(runtime.snapshot()).toMatchObject({ status: 'offline', lifecycle: 'failed', initializationFailure: 'INIT_FAILED' });
    expect(runtime.begin()).toBe(false);
  });

  test('awaits actual completion, returns value, records duration and safe correlated fields', async () => {
    let release!: (value: number) => void;
    const callback = runtime.register('fixture', '* * * * *', 'America/New_York', () => new Promise<number>(resolve => { release = resolve; }));
    const pending = callback();
    expect(runtime.snapshot().jobs[0]).toMatchObject({ active: 1, returned: 0, lastFinishedAt: null });
    time += 1234; release(42); await expect(pending).resolves.toBe(42);
    const job = runtime.snapshot().jobs[0];
    expect(job).toMatchObject({ active: 0, returned: 1, failed: 0, lastDurationMs: 1234, lastOutcome: 'callback_returned', lastReason: null });
    expect(log.mock.calls[0][1]).toMatchObject({ runId: job.lastRunId, entryPoint: 'scheduler', bootId: runtime.bootId });
    expect(log.mock.calls[1][1]).toMatchObject({ runId: job.lastRunId, outcome: 'callback_returned' });
  });

  test('caught dependency failure survives async fanout and takes precedence over skip', async () => {
    runtime.begin(); runtime.ready(); runtime.heartbeat();
    const callback = runtime.register('batch', '* * * * *', 'SYSTEM_DEFAULT', async () => {
      await Promise.all([Promise.resolve().then(() => runtime.skip('PRE_DEBATE_GATE')),
        Promise.reject(new Error('TOKEN=secret; URL?key=private')).catch(() => runtime.failure())]);
      return 'continued';
    });
    await expect(callback()).resolves.toBe('continued');
    expect(runtime.snapshot()).toMatchObject({ status: 'degraded', jobHealth: { failedJobs: ['batch'] } });
    expect(runtime.snapshot().jobs[0]).toMatchObject({ failed: 1, returned: 0, lastOutcome: 'caught_failure', lastReason: 'CAUGHT_DEPENDENCY_FAILURE' });
    expect(JSON.stringify([runtime.snapshot(), log.mock.calls])).not.toMatch(/TOKEN|secret|private/);
  });

  test('throw preserves original object and is not converted to a fulfilled callback', async () => {
    const secretError = new Error('sensitive provider response');
    const callback = runtime.register('throwing', '* * * * *', 'SYSTEM_DEFAULT', () => { throw secretError; });
    await expect(callback()).rejects.toBe(secretError);
    expect(runtime.snapshot().jobs[0]).toMatchObject({ failed: 1, active: 0, lastOutcome: 'threw', lastReason: 'CALLBACK_THROWN' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive');
  });

  test('overlapping callbacks remain independent; observations never suppress financial work', async () => {
    const releases: Array<() => void> = [];
    const callback = runtime.register('overlap', '* * * * *', 'SYSTEM_DEFAULT', async () => {
      const index = releases.length;
      await new Promise<void>(resolve => releases.push(resolve));
      if (index === 1) runtime.failure('NO_MARKET_SNAPSHOT');
      else runtime.skip('PRE_DEBATE_GATE');
    });
    const first = callback(); const second = callback();
    expect(runtime.snapshot().jobs[0]).toMatchObject({ active: 2, overlaps: 1, started: 2 });
    releases[1](); await second;
    expect(runtime.snapshot().jobs[0]).toMatchObject({ active: 1, failed: 1 });
    releases[0](); await first;
    expect(runtime.snapshot().jobs[0]).toMatchObject({ active: 0, started: 2, failed: 1, skipped: 1, lastOutcome: 'skipped' });
  });

  test('long callback remains active even with a recent observer; never infers a timeout or fill', async () => {
    let release!: () => void;
    runtime.begin(); runtime.ready();
    const pending = runtime.register('slow', '* * * * *', 'SYSTEM_DEFAULT', () => new Promise<void>(resolve => { release = resolve; }))();
    time += 3_600_000; runtime.heartbeat();
    expect(runtime.snapshot()).toMatchObject({ observer: { status: 'recent' }, jobHealth: { activeCallbacks: 1 } });
    expect(runtime.snapshot().jobs[0]).toMatchObject({ active: 1, lastOutcome: null, lastFinishedAt: null });
    release(); await pending;
  });

  test('bounded registrations, snapshot copies and fresh boot cannot manufacture history', () => {
    for (let i = 0; i < 32; i++) runtime.register(`job_${i}`, '* * * * *', 'SYSTEM_DEFAULT', () => {});
    expect(() => runtime.register('overflow', '* * * * *', 'SYSTEM_DEFAULT', () => {})).toThrow();
    expect(() => runtime.register('job_0', '* * * * *', 'SYSTEM_DEFAULT', () => {})).toThrow();
    runtime.snapshot().jobs[0].started = 99;
    expect(runtime.snapshot().jobs[0].started).toBe(0);
    const restarted = new SchedulerRuntime(() => time, log);
    expect(restarted.bootId).not.toBe(runtime.bootId);
    expect(restarted.snapshot()).toMatchObject({ evidenceScope: 'CURRENT_PROCESS', jobs: [], lifecycle: 'not_started' });
  });

  test('unrelated/manual failure marking and broken logging do not change job semantics', async () => {
    runtime.failure(); runtime.skip('KILL_SWITCH_ACTIVE'); log.mockImplementation(() => { throw new Error('sink down'); });
    const callback = runtime.register('isolated', '* * * * *', 'SYSTEM_DEFAULT', () => 7);
    await expect(callback()).resolves.toBe(7);
    expect(runtime.snapshot().jobs[0].lastOutcome).toBe('callback_returned');
  });
});
