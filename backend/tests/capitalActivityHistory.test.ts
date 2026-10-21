import { parseActivityHistory, corroboratesNoCapital } from '../src/services/capitalActivityHistory';
const identity = { accountId: 'fixture', accountCreatedAt: '2026-03-01T00:00:01Z',
  since: '2026-03-01T00:00:00Z', until: '2026-10-16T12:00:30Z' };
const event = { account_id: 'fixture', event_id: '01K7M5S8Q00000000000000000', ref_id: 'fixture-ref',
  activity_type: 'TRD', qty: '1', price: '50', net_amount: '-50', details: { execution_type: 'fill', order_id: 'fixture-order', side: 'buy', symbol: 'MSFT' }, at: '2026-10-16T11:00:00Z', currency: 'USD', status: 'executed' };
function stream(text: string, complete = true) {
  return Object.assign((async function* () { for (let i = 0; i < text.length; i += 7) yield Buffer.from(text.slice(i, i + 7)); })(), { complete });
}
const parse = (text: string, complete = true) => parseActivityHistory(stream(text, complete), identity, new AbortController().signal);
test('finite complete chunked CRLF observation retains account evidence and permits only corroborated no-capital interval', async () => {
  const result = await parse(`: heartbeat\r\n\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
  expect(result.events).toEqual([event]); expect(result.transportComplete).toBe(true);
  expect(corroboratesNoCapital(result, 'fixture', new Date('2026-10-06'), new Date('2026-10-16'))).toBe(true);
  expect(corroboratesNoCapital(result, 'other', new Date('2026-10-06'), new Date('2026-10-16'))).toBe(false);
});
test.each([': internal server error\n\n', ': you are reading too slowly, dropped 10000 messages\n\n',
  'data: {"broken":\n\n', `data: ${JSON.stringify(event)}`])('rejects error, drop, malformed or unfinished frame (%#)', async text => {
  await expect(parse(text)).rejects.toThrow(/^ACTIVITY_HISTORY_/);
});
test('normal event framing is insufficient without complete HTTP transport', async () => {
  await expect(parse(`data: ${JSON.stringify(event)}\n\n`, false)).rejects.toThrow('ACTIVITY_HISTORY_HTTP_INCOMPLETE');
});
test('wrong-account events, duplicate conflicts, stale range and byte bounds reject', async () => {
  await expect(parse(`data: ${JSON.stringify({ ...event, account_id: 'other' })}\n\n`)).rejects.toThrow('ACTIVITY_HISTORY_EVENT_INVALID');
  await expect(parse(`data: ${JSON.stringify(event)}\n\ndata: ${JSON.stringify({ ...event, status: 'canceled' })}\n\n`)).rejects.toThrow('ACTIVITY_HISTORY_EVENT_CONFLICT');
  await expect(parseActivityHistory(stream(''), { ...identity, accountCreatedAt: '2026-01-01T00:00:00Z' }, new AbortController().signal)).rejects.toThrow('ACTIVITY_HISTORY_RANGE_UNAVAILABLE');
  await expect(parseActivityHistory(stream('12345'), identity, new AbortController().signal, 4)).rejects.toThrow('ACTIVITY_HISTORY_BOUND_EXCEEDED');
});
test('aborted read never establishes coverage', async () => {
  const controller = new AbortController(); controller.abort(new Error('fixture canceled'));
  await expect(parseActivityHistory(stream(''), identity, controller.signal)).rejects.toThrow('fixture canceled');
});
test('external, unknown, unsettled and date-boundary-ambiguous effects cannot establish zero', async () => {
  const base = await parse('');
  const from = new Date('2026-10-06'), end = new Date('2026-10-16');
  for (const activity of [ { ...event, activity_type: 'UNRECOGNIZED' }, { ...event, status: 'pending' },
    { ...event, activity_type: 'CSD', executed_at: '2026-10-16T11:00:00Z', settle_date: '2026-10-16' },
    { ...event, activity_type: 'CSW', at: '2026-10-05T00:00:00Z', executed_at: '2026-10-05T01:00:00Z', settle_date: '2026-10-05' } ]) {
    expect(corroboratesNoCapital({ ...base, events: [activity] }, 'fixture', from, end)).toBe(false);
  }
});

test.each(['fill', 'trade_correct', 'trade_bust'])('unified TRD %s is an investment result, never legacy FILL', async execution_type => {
  const base = await parse('');
  const accepts = (activity: Record<string, unknown>) => corroboratesNoCapital({ ...base, events: [activity] }, 'fixture', new Date('2026-10-06'), new Date('2026-10-16'));
  expect(accepts({ ...event, details: { ...event.details, execution_type } })).toBe(true);
  expect(accepts({ ...event, activity_type: 'FILL' })).toBe(false);
  expect(accepts({ ...event, details: { ...event.details, execution_type: 'accepted' } })).toBe(false);
  expect(accepts({ ...event, details: null })).toBe(false);
  expect(accepts({ ...event, activity_type: 'DIV', activity_subtype: 'UNKNOWN' })).toBe(false);
});
