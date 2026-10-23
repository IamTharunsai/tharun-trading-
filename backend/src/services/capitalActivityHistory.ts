import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';

export const ACTIVITY_HISTORY_START = Date.parse('2026-02-11T00:00:00Z');
export interface ActivityHistoryObservation {
  accountId: string; accountCreatedAt: string; since: string; until: string;
  events: Record<string, unknown>[]; digest: string; transportComplete: true;
}
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Finite Trading SSE, never a generated-client JSON read. Reject error/drop
 * comments and unfinished frames even when the HTTP status was 200.
 * https://docs.alpaca.markets/us/reference/subscribetoactivitiessse */
export async function parseActivityHistory(stream: AsyncIterable<Uint8Array | string>, identity: {
  accountId: string; accountCreatedAt: string; since: string; until: string;
}, signal: AbortSignal, maxBytes = 4 * 1024 * 1024, maxEvents = 10000): Promise<ActivityHistoryObservation> {
  const start = date(identity.since), end = date(identity.until), created = date(identity.accountCreatedAt);
  if (!identity.accountId || ![start, end, created].every(Number.isFinite) || created < ACTIVITY_HISTORY_START
    || start < ACTIVITY_HISTORY_START || start > created || end <= start || end > Date.now()) throw new Error('ACTIVITY_HISTORY_RANGE_UNAVAILABLE');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const events: Record<string, unknown>[] = [], ids = new Map<string, Record<string, unknown>>();
  let buffer = '', bytes = 0;
  const frame = (text: string) => {
    const data: string[] = []; let eventId: string | undefined;
    for (const line of text.split('\n')) {
      if (!line) continue;
      if (line.startsWith(':')) {
        if (!/^:\s*(?:heartbeat|keep[- ]alive)?\s*$/i.test(line)) throw new Error('ACTIVITY_HISTORY_COMMENT_UNVERIFIED');
        continue;
      }
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'data') data.push(value);
      else if (field === 'id') eventId = value;
      else if (field !== 'event') throw new Error('ACTIVITY_HISTORY_FRAME_UNVERIFIED');
    }
    if (!data.length) return;
    let event: unknown;
    try { event = JSON.parse(data.join('\n')); } catch { throw new Error('ACTIVITY_HISTORY_EVENT_INVALID'); }
    if (!object(event) || event.account_id !== identity.accountId || typeof event.event_id !== 'string'
      || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(event.event_id) || typeof event.ref_id !== 'string' || !event.ref_id
      || typeof event.activity_type !== 'string' || !event.activity_type || !Number.isFinite(date(event.at))
      || date(event.at) < start || date(event.at) > end || (eventId !== undefined && eventId !== event.event_id)) throw new Error('ACTIVITY_HISTORY_EVENT_INVALID');
    const previous = ids.get(event.event_id);
    if (previous && !isDeepStrictEqual(previous, event)) throw new Error('ACTIVITY_HISTORY_EVENT_CONFLICT');
    if (!previous) { ids.set(event.event_id, event); events.push(event); }
    if (events.length > maxEvents) throw new Error('ACTIVITY_HISTORY_BOUND_EXCEEDED');
  };
  for await (const chunk of stream) {
    signal.throwIfAborted();
    bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
    if (bytes > maxBytes) throw new Error('ACTIVITY_HISTORY_BOUND_EXCEEDED');
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    // Normalize CRLF only after the LF arrives, including split chunks.
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) { frame(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
  }
  buffer += decoder.decode(); signal.throwIfAborted();
  if (buffer.trim()) throw new Error('ACTIVITY_HISTORY_FRAME_TRUNCATED');
  // Node IncomingMessage.complete means the full HTTP message was received.
  if ((stream as { complete?: boolean }).complete !== true) throw new Error('ACTIVITY_HISTORY_HTTP_INCOMPLETE');
  return { ...identity, events, digest: createHash('sha256').update(JSON.stringify(events)).digest('hex'), transportComplete: true };
}

// Unified SSE names deliberately differ from legacy Activities REST (FILL).
// https://docs.alpaca.markets/us/docs/activity-sse#supported-activity-types
const resultSubtypes: Record<string, ReadonlySet<string>> = {
  CGD: new Set(['STCG', 'LTCG']), DIV: new Set(['CDIV', 'SDIV', 'SPD', 'ROC']),
  INT: new Set(['MGN', 'CDT', 'SWP', 'QII', 'FPSL', 'FI']),
  FEE: new Set(['', 'REG', 'TAF', 'ORF', 'OCC', 'NRV', 'NRC', 'LCT', 'COM', 'CAT', 'ADR', 'OCOM', 'BSWP']),
  DIVNRA: new Set(['']),
};
const decimal = (value: unknown) => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
function investmentResult(event: Record<string, unknown>): boolean {
  if (!object(event.details) || !decimal(event.net_amount)) return false;
  const subtype = event.activity_subtype === undefined ? '' : event.activity_subtype;
  if (event.activity_type === 'TRD') {
    return subtype === '' && ['fill', 'trade_correct', 'trade_bust'].includes(String(event.details.execution_type))
      && typeof event.details.order_id === 'string' && !!event.details.order_id
      && ['buy', 'sell'].includes(String(event.details.side))
      && typeof event.details.symbol === 'string' && !!event.details.symbol
      && decimal(event.qty) && decimal(event.price);
  }
  return typeof subtype === 'string' && resultSubtypes[String(event.activity_type)]?.has(subtype) === true;
}
const external = new Set(['CSD', 'CSW', 'ACATC']);

/** Negative capital evidence is conditional on a fresh, full-origin finite
 * observation, not merely no recent REST activities. No timestamp allocation
 * of nonzero capital is attempted; any potentially intersecting flow rejects. */
export function corroboratesNoCapital(observation: ActivityHistoryObservation, accountId: string, start: Date, end: Date): boolean {
  if (![date(observation.accountCreatedAt), date(observation.since), date(observation.until), start.getTime(), end.getTime()].every(Number.isFinite)
    || end <= start || observation.accountId !== accountId || observation.transportComplete !== true
    || date(observation.accountCreatedAt) < ACTIVITY_HISTORY_START || date(observation.since) > date(observation.accountCreatedAt)
    || date(observation.since) > start.getTime() || date(observation.until) < end.getTime()) return false;
  for (const event of observation.events) {
    if (event.account_id !== accountId || event.currency !== 'USD' || event.status !== 'executed') return false;
    const type = String(event.activity_type);
    if (investmentResult(event)) continue;
    if (!external.has(type)) return false;
    const at = date(event.at), executed = date(event.executed_at);
    const settled = typeof event.settle_date === 'string' && /^\d{4}-\d\d-\d\d$/.test(event.settle_date)
      ? Date.parse(event.settle_date + 'T00:00:00Z') : NaN;
    if (![at, executed, settled].every(Number.isFinite)) return false;
    // Preserve date-only timezone/settlement uncertainty conservatively.
    const from = Math.min(at, executed, settled - 86400000);
    const to = Math.max(at + 1, executed + 1, settled + 2 * 86400000);
    if (from < end.getTime() && to > start.getTime()) return false;
  }
  return true;
}
