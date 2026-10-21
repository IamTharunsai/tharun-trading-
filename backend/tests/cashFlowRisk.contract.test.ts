jest.mock('axios', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import axios from 'axios';
import { AlpacaBroker } from '../src/services/alpacaBroker';
test('history explicitly requests all cashflows and continuous fixed completed bins', async () => {
  const get = jest.fn().mockResolvedValue({ data: { timeframe: '5Min', timestamp: [], equity: [], cashflow: {} } });
  (axios.create as jest.Mock).mockReturnValue({ get });
  const broker = new AlpacaBroker('dummy', 'dummy', true);
  await broker.getPortfolioHistoryVerified('2026-10-08T00:00:00Z', '2026-10-16T12:00:00Z');
  expect(get).toHaveBeenCalledWith('/v2/account/portfolio/history', { params: { start: '2026-10-08T00:00:00Z', end: '2026-10-16T12:00:00Z',
    timeframe: '5Min', intraday_reporting: 'continuous', pnl_reset: 'no_reset', cashflow_types: 'ALL' } });
});
test('activity paging preserves creation interval and final stable ID; failures and bounds reject coverage', async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ id: `activity-${i}`, activity_type: 'FILL' }));
  const get = jest.fn().mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: [{ id: 'withdrawal', activity_type: 'CSW', date: '2026-10-01', net_amount: '-10000' }] });
  (axios.create as jest.Mock).mockReturnValue({ get });
  const broker = new AlpacaBroker('dummy', 'dummy', true);
  const activities = await broker.listActivitiesVerified('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z', 100);
  expect(activities).toHaveLength(101);
  expect(get.mock.calls[1][1].params).toMatchObject({ after: '2026-10-14T00:00:00.000Z', until: '2026-10-15T00:00:00.000Z', page_token: 'activity-99', direction: 'asc', page_size: 100 });
  get.mockReset().mockResolvedValue({ data: first });
  await expect(broker.listActivitiesVerified('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z', 1)).rejects.toThrow('BROKER_ACTIVITY_SCAN_BOUND_EXCEEDED');
  get.mockReset().mockRejectedValue(new Error('unavailable'));
  await expect(broker.listActivitiesVerified('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z')).rejects.toThrow('unavailable');
});
