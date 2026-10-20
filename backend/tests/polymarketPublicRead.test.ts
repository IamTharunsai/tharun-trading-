import { polymarketPublicRead } from '../src/services/polymarketPublicRead';

test('public gateway reads share spacing and429 cooldown without replay or fabricated data', async () => {
  jest.useFakeTimers();
  try {
    const starts: number[] = [];
    const read = () => polymarketPublicRead(async () => { starts.push(performance.now()); return { observed: true }; });
    const one = read(), two = read(), three = read();
    await jest.advanceTimersByTimeAsync(500);
    expect(await Promise.all([one, two, three])).toEqual([{ observed: true }, { observed: true }, { observed: true }]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(250);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(250);
    const operation = jest.fn(async () => { throw { status: 429, message: 'PRIVATE_PROVIDER_BODY' }; });
    const limited = polymarketPublicRead(operation).catch(error => error);
    await jest.advanceTimersByTimeAsync(250);
    expect(await limited).toMatchObject({ code: 'rate_limited', retryAfterMs: 15000 });
    expect(operation).toHaveBeenCalledTimes(1);
    const blocked = jest.fn(async () => 'must not dispatch');
    const queued = polymarketPublicRead(blocked).catch(error => error);
    await jest.advanceTimersByTimeAsync(5000);
    expect(await queued).toMatchObject({ code: 'queue_timeout' });
    expect(blocked).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(10000);
    expect(await read()).toEqual({ observed: true });
  } finally { jest.useRealTimers(); }
});
