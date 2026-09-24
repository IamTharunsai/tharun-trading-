export interface BrokerClock { timestamp: string; is_open: boolean; next_close: string }

export function stockEntryWindow(clock: BrokerClock, nowMs = Date.now()): boolean {
  const timestamp = Date.parse(clock.timestamp);
  const closes = Date.parse(clock.next_close);
  if (!clock.is_open || !Number.isFinite(timestamp) || !Number.isFinite(closes)) return false;
  if (Math.abs(nowMs - timestamp) > 60_000 || closes - timestamp <= 15 * 60_000) return false;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp));
  const minutes = Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value);
  return minutes >= 9 * 60 + 45 && minutes < 15 * 60 + 45;
}
