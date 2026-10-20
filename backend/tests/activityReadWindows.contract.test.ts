jest.mock('axios', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import axios from 'axios';
import { performance } from 'node:perf_hooks';
import { AlpacaBroker } from '../src/services/alpacaBroker';
import { operatingError } from '../src/trading/operatingDiagnostics';
const get = jest.fn();
const start = '2026-10-01T00:00:00Z'; const end = '2026-10-03T00:00:00Z';
let broker: AlpacaBroker;
beforeEach(() => {
  jest.resetAllMocks(); (axios.create as jest.Mock).mockReturnValue({ get });
  broker = new AlpacaBroker('fixture-not-a-credential', 'fixture-not-a-secret', true);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('exclusive creation-time boundaries overlap, dedupe equal evidence, and retain late-effective fees', async () => {
  // creation time is deliberately independent of effective date and ID prefix.
  const rows = [
    { created: Date.parse('2026-10-02T00:00:00Z'), value: { id: 'old-prefix::late', activity_type: 'CFEE', date: '2026-09-01', net_amount: '-1' } },
    { created: Date.parse('2026-10-01T23:59:59.500Z'), value: { id: 'overlap', activity_type: 'FILL' } },
  ];
  get.mockImplementation(async (path, { params }) => {
    expect(path).toBe('/v2/account/activities');
    expect(Date.parse(params.until) - Date.parse(params.after)).toBeLessThanOrEqual(86400000);
    return { data: rows.filter(row => row.created > Date.parse(params.after) && row.created < Date.parse(params.until)).map(row => ({ ...row.value })) };
  });
  expect(await broker.listActivitiesVerified(start, end)).toEqual([rows[1].value, rows[0].value]);
  expect(get).toHaveBeenCalledTimes(3);
  expect(get.mock.calls[1][1].params.after).toBe('2026-10-01T23:59:59.000Z');
  expect(get.mock.calls[2][1].params.until).toBe('2026-10-03T00:00:00.000Z');
});

test('paginates every window completely, resets cursor between windows, and keeps order_id on every page', async () => {
  let n = 0;
  get.mockImplementation(async (_path, { params }) => ({ data: params.page_token ? []
    : Array.from({ length: 100 }, () => ({ id: `fill-${++n}`, activity_type: 'FILL' })) }));
  expect(await broker.listActivitiesVerified(start, end, 6, 'order-fixture')).toHaveLength(300);
  expect(get).toHaveBeenCalledTimes(6);
  get.mock.calls.forEach(([, config], i) => {
    expect(config.params).toMatchObject({ order_id: 'order-fixture', page_size: 100, direction: 'asc' });
    expect(config.params.page_token).toBe(i % 2 ? `fill-${(i + 1) / 2 * 100}` : undefined);
  });
});

test('same ID with changed evidence across windows is unavailable, never last-write-wins', async () => {
  get.mockResolvedValueOnce({ data: [{ id: 'same', activity_type: 'FEE', net_amount: '-1' }] })
    .mockResolvedValueOnce({ data: [{ id: 'same', activity_type: 'FEE', net_amount: '-2' }] });
  await expect(broker.listActivitiesVerified(start, end)).rejects.toThrow('BROKER_ACTIVITY_CONFLICT');
});

test('object key order alone is equal evidence, and repeated cursor pages still fail', async () => {
  get.mockResolvedValueOnce({ data: [{ id: 'same', activity_type: 'FEE', net_amount: '-1' }] })
    .mockResolvedValue({ data: [{ net_amount: '-1', activity_type: 'FEE', id: 'same' }] });
  expect(await broker.listActivitiesVerified(start, end)).toHaveLength(1);
  const page = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, activity_type: 'FILL' }));
  get.mockReset().mockResolvedValue({ data: page });
  await expect(broker.listActivitiesVerified(start, end)).rejects.toThrow('INVALID_BROKER_ACTIVITY_PAGE');
});

test('total HTTP budget includes empty windows; thirty days need an explicit larger caller budget', async () => {
  get.mockResolvedValue({ data: [] });
  await expect(broker.listActivitiesVerified(start, '2026-10-31T00:00:00Z')).rejects.toThrow('BROKER_ACTIVITY_SCAN_BOUND_EXCEEDED');
  expect(get).toHaveBeenCalledTimes(20);
  get.mockClear();
  expect(await broker.listActivitiesVerified(start, '2026-10-31T00:00:00Z', 64)).toEqual([]);
  expect(get).toHaveBeenCalledTimes(31);
  get.mockClear();
  await expect(broker.listActivitiesVerified(start, '2026-12-01T00:00:00Z', 100)).rejects.toThrow('BROKER_ACTIVITY_WINDOW_BOUND_EXCEEDED');
  expect(get).not.toHaveBeenCalled();
});

test('later-window timeout rejects all earlier rows and preserves the safe timeout classification', async () => {
  const error = Object.assign(new Error('private-provider-text'), { code: 'ECONNABORTED' });
  get.mockResolvedValueOnce({ data: [{ id: 'partial', activity_type: 'CFEE' }] }).mockRejectedValueOnce(error);
  await expect(broker.listActivitiesVerified(start, end)).rejects.toBe(error);
  expect(operatingError(error)).toBe('TRANSPORT_TIMEOUT_OR_CANCEL');
  expect(get).toHaveBeenCalledTimes(2);
});

test('reduces the per-request timeout to the remaining total deadline and rejects a late response', async () => {
  const clock = jest.spyOn(performance, 'now').mockReturnValue(0);
  get.mockImplementationOnce(async () => { clock.mockReturnValue(24000); return { data: [] }; })
    .mockImplementationOnce(async () => { clock.mockReturnValue(25000); return { data: [{ id: 'late', activity_type: 'FILL' }] }; });
  await expect(broker.listActivitiesVerified(start, end)).rejects.toThrow('BROKER_ACTIVITY_DEADLINE_EXCEEDED');
  expect(get.mock.calls[0][1].timeout).toBe(10000);
  expect(get.mock.calls[1][1].timeout).toBe(1000);
  expect(get).toHaveBeenCalledTimes(2);
});

test('total deadline aborts a pending transport and releases its timer', async () => {
  jest.useFakeTimers();
  get.mockImplementation((_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })), { once: true });
  }));
  const result = expect(broker.listActivitiesVerified(start, end)).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  await jest.advanceTimersByTimeAsync(25000); await result;
  expect(get).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

test.each([['invalid', end, 20], [end, start, 20], [start, end, 0], [start, end, 101], [start, end, 1.5]])(
  'invalid interval or request budget rejects before transport: %s %s %s', async (after, until, budget) => {
    await expect(broker.listActivitiesVerified(after as string, until as string, budget as number)).rejects.toThrow('INVALID_BROKER_ACTIVITY_RANGE');
    expect(get).not.toHaveBeenCalled();
  });

test('oversized pages cannot evade the response/page budget', async () => {
  get.mockResolvedValue({ data: Array.from({ length: 101 }, (_, i) => ({ id: `id-${i}`, activity_type: 'FILL' })) });
  await expect(broker.listActivitiesVerified(start, end)).rejects.toThrow('INVALID_BROKER_ACTIVITIES');
});
