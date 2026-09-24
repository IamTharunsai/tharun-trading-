import { stockEntryWindow } from '../src/trading/marketSession';

const check = (timestamp: string, next_close: string, is_open = true) => stockEntryWindow({ timestamp, next_close, is_open }, Date.parse(timestamp));
it('rejects an exchange holiday even during normal weekday hours', () => {
  expect(check('2026-12-25T15:00:00Z', '2026-12-28T21:00:00Z', false)).toBe(false);
});
it('respects the last 15 minutes before an early close', () => {
  expect(check('2026-11-27T17:44:00Z', '2026-11-27T18:00:00Z')).toBe(true);
  expect(check('2026-11-27T17:45:00Z', '2026-11-27T18:00:00Z')).toBe(false);
});
it('waits until 09:45 ET and adapts to daylight saving time', () => {
  expect(check('2026-09-23T13:44:00Z', '2026-09-23T20:00:00Z')).toBe(false);
  expect(check('2026-09-23T13:45:00Z', '2026-09-23T20:00:00Z')).toBe(true);
  expect(check('2026-12-23T14:45:00Z', '2026-12-23T21:00:00Z')).toBe(true);
});
it('fails closed on stale and malformed clocks', () => {
  expect(stockEntryWindow({ timestamp: '2026-09-23T14:00:00Z', next_close: '2026-09-23T20:00:00Z', is_open: true }, Date.parse('2026-09-23T14:02:00Z'))).toBe(false);
  expect(stockEntryWindow({ timestamp: 'bad', next_close: 'bad', is_open: true })).toBe(false);
});
