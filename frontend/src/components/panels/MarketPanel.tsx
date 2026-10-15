import { ReactNode, useEffect, useState } from 'react';
import api from '../../services/api';
import { useStore } from '../../store';
import LastUpdated from '../common/LastUpdated';

export const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const numeric = (value: unknown, digits = 2) => finite(value)?.toLocaleString('en-US', { maximumFractionDigits: digits }) ?? 'Unavailable';
export const money = (value: unknown) => finite(value) === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Number(value) > 0 && Number(value) < 1 ? 8 : 2 }).format(Number(value));
export const percent = (value: unknown) => finite(value) === null ? 'Unavailable' : `${Number(value).toFixed(2)}%`;
export function safeLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

interface Result<T> { data: T | null; receivedAt: number | null; isFetching: boolean; error: string | null; refresh: () => void; refreshMs?: number }
/** No shared account cache, anonymous requests, invented rows or late responses after sign-out. */
export function usePanelData<T>(path: string, parse: (data: unknown) => T, refreshMs = 60000): Result<T> {
  const token = useStore(s => s.token);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ identity: string | null; path: string; data: T | null; receivedAt: number | null; isFetching: boolean; error: string | null }>({ identity: null, path: '', data: null, receivedAt: null, isFetching: false, error: null });
  useEffect(() => {
    if (!token) return;
    let disposed = false;
    let active: AbortController | null = null;
    const load = async () => {
      if (active) return;
      const controller = new AbortController(); active = controller;
      setState(previous => ({ identity: token, path, data: previous.identity === token && previous.path === path ? previous.data : null, receivedAt: previous.identity === token && previous.path === path ? previous.receivedAt : null, isFetching: true, error: null }));
      try {
        const response = await api.get(path, { signal: controller.signal });
        const data = parse(response.data);
        if (!disposed && !controller.signal.aborted && useStore.getState().token === token) setState({ identity: token, path, data, receivedAt: Date.now(), isFetching: false, error: null });
      } catch (error: any) {
        if (!disposed && !controller.signal.aborted && useStore.getState().token === token) {
          const code = error?.response?.status;
          const message = code === 501 ? 'This data feed is not connected.' : code === 503 ? 'The provider is unavailable. Try refreshing shortly.' : 'Could not verify this response. Try refreshing.';
          setState(previous => ({ ...previous, isFetching: false, error: message }));
        }
      } finally { if (active === controller) active = null; }
    };
    void load();
    const timer = setInterval(() => { void load(); }, refreshMs);
    return () => { disposed = true; clearInterval(timer); active?.abort(); };
  }, [token, path, parse, refreshMs, revision]);
  const visible = !!token && state.identity === token && state.path === path;
  return { data: visible ? state.data : null, receivedAt: visible ? state.receivedAt : null, isFetching: visible ? state.isFetching : !!token, error: visible ? state.error : token ? null : 'Sign in to view market data.', refresh: () => setRevision(value => value + 1), refreshMs };
}

export function MarketPanel({ title, description, result, observedAt, source, children }: { title: string; description: string; result?: Result<unknown>; observedAt?: string | null; source?: string | null; children: ReactNode }) {
  return <section className="rounded-xl bg-white p-5 text-slate-900 shadow-sm min-w-0" aria-label={title}>
    <div className="flex flex-wrap items-start justify-between gap-3 mb-3"><div><h3 className="text-base font-semibold">{title}</h3><p className="mt-1 text-sm text-slate-600 max-w-prose">{description}</p></div>
      {result && <button className="min-h-11 px-3 rounded-lg border border-slate-300 text-sm disabled:opacity-50" onClick={result.refresh} disabled={result.isFetching}>{result.isFetching ? 'Refreshing…' : 'Refresh'}</button>}
    </div>
    {result?.error && <p role="status" className="mb-3 text-sm text-red-800">{result.error}{result.data !== null ? ' Previously received data remains below.' : ''}</p>}
    {result?.isFetching && result.data === null && <p role="status" className="py-4 text-sm text-slate-600">Loading provider data…</p>}
    {children}
    {result && <div className="mt-4"><LastUpdated receivedAt={result.receivedAt} at={observedAt} isError={!!result.error} isFetching={result.isFetching} staleAfterMs={(result.refreshMs ?? 60000) * 2} label={title} /></div>}
    {source && <p className="mt-2 text-xs text-slate-600">Source: {source}</p>}
  </section>;
}

export function PanelTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm text-left tabular-nums"><thead><tr>{headers.map(label => <th key={label} scope="col" className="py-3 pr-4 font-medium text-slate-600 whitespace-nowrap">{label}</th>)}</tr></thead><tbody className="[&_td]:py-3 [&_td]:pr-4 [&_tr]:border-t [&_tr]:border-slate-100">{children}</tbody></table></div>;
}
