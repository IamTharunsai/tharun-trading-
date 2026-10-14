import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

type Timestamp = number | string | Date | null;
interface QueryFreshness { dataUpdatedAt: number; isFetching: boolean; isError: boolean }
interface Props {
  /** Provider observation time, only when the response actually supplies it. */
  at?: Timestamp;
  /** React Query records this time only after a successful response. */
  query?: QueryFreshness;
  receivedAt?: Timestamp;
  isError?: boolean;
  isFetching?: boolean;
  staleAfterMs?: number;
  label?: string;
}

function timestamp(value: Timestamp | undefined, now: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) && result > 0 && result <= now ? result : null;
}

function age(at: number, now: number): string {
  const seconds = Math.floor((now - at) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function LastUpdated({ at, query, receivedAt, isError = false, isFetching = false, staleAfterMs, label = 'Data' }: Props) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Render may run immediately after a successful response, before the next clock tick.
  const clock = Math.max(now, Date.now());
  const observed = timestamp(at, clock);
  const received = timestamp(query?.dataUpdatedAt ?? receivedAt, clock);
  const failed = query?.isError ?? isError;
  const fetching = query?.isFetching ?? isFetching;
  const stale = received !== null && staleAfterMs !== undefined && clock - received > staleAfterMs;
  const state = failed ? 'error' : stale ? 'stale' : fetching ? 'refreshing' : received !== null || observed !== null ? 'known' : 'unknown';
  const receipt = received === null ? 'Receipt time unknown' : `Received ${age(received, clock)}`;
  const observation = observed === null ? 'Observation time unavailable' : `Observed ${age(observed, clock)}`;
  const status = failed ? received === null ? 'Request failed' : 'Refresh failed; cached response' : stale ? 'Response overdue' : fetching ? 'Refreshing' : '';
  const title = [
    `${label}: ${status || 'Request receipt and provider observation are separate'}`,
    received === null ? 'No successful receipt timestamp' : `Successful response: ${format(new Date(received), 'yyyy-MM-dd HH:mm:ss')}`,
    observed === null ? 'The provider observation time is not known' : `Provider observation: ${format(new Date(observed), 'yyyy-MM-dd HH:mm:ss')}`,
  ].join('\n');

  return (
    <span
      title={title}
      data-testid="data-freshness"
      data-state={state}
      aria-label={`${label}: ${[status, receipt, observation].filter(Boolean).join('. ')}`}
      style={{
        display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 5,
        fontFamily: 'JetBrains Mono', fontSize: 10, color: 'var(--apex-muted)',
      }}
    >
      <RefreshCw size={10} aria-hidden="true" />
      {label}: {[status, receipt, observation].filter(Boolean).join(' · ')}
    </span>
  );
}
