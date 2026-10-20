jest.mock('axios', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import axios from 'axios';
import { AlpacaBroker } from '../src/services/alpacaBroker';
const get = jest.fn();
let broker: AlpacaBroker;
beforeEach(() => {
  jest.clearAllMocks(); (axios.create as jest.Mock).mockReturnValue({ get });
  broker = new AlpacaBroker('fixture-not-a-credential', 'fixture-not-a-secret', true);
});
test('strict order evidence requests nested legs and never maps transport failure to missing', async () => {
  get.mockResolvedValueOnce({ data: { id: 'parent', legs: [{ id: 'leg' }] } });
  expect(await broker.getOrderVerified('parent')).toMatchObject({ id: 'parent', legs: [{ id: 'leg' }] });
  expect(get).toHaveBeenCalledWith('/v2/orders/parent', { params: { nested: true } });
  get.mockRejectedValueOnce({ response: { status: 503 } });
  await expect(broker.getOrderVerified('parent')).rejects.toMatchObject({ response: { status: 503 } });
  get.mockRejectedValueOnce({ response: { status: 404 } });
  expect(await broker.getOrderVerified('parent')).toBeNull();
});
test('order identity mismatch never becomes valid execution evidence', async () => {
  get.mockResolvedValue({ data: { id: 'other' } });
  await expect(broker.getOrderVerified('expected')).rejects.toThrow('IDENTITY');
});
test('activities page by broker ID and preserve late fees rather than only requesting trades', async () => {
  const page = Array.from({ length: 100 }, (_, index) => ({ id: `id-${index}`, activity_type: 'FILL' }));
  get.mockResolvedValueOnce({ data: page }).mockResolvedValueOnce({ data: [{ id: 'late-fee', activity_type: 'CFEE' }] });
  const rows = await broker.listActivitiesVerified('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z');
  expect(rows).toHaveLength(101);
  expect(get.mock.calls[1][1].params).toMatchObject({ page_token: 'id-99', page_size: 100, direction: 'asc' });
});
test('a bounded or repeated activity page is unavailable evidence rather than an empty successful scan', async () => {
  const page = Array.from({ length: 100 }, (_, index) => ({ id: `id-${index}`, activity_type: 'FILL' }));
  get.mockResolvedValue({ data: page });
  await expect(broker.listActivitiesVerified('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 1)).rejects.toThrow('BOUND_EXCEEDED');
  await expect(broker.listActivitiesVerified('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 2)).rejects.toThrow('ACTIVITY_PAGE');
});
