import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPortfolio } from '../../services/api';
import LastUpdated from '../common/LastUpdated';

const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const dollars = (value: unknown) => { const number = finite(value); return number === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(number); };
const percent = (value: unknown) => { const number = finite(value); return number === null ? 'Unavailable' : `${number.toFixed(2)}%`; };
const tabs = ['overview', 'var', 'greeks', 'alerts'] as const;
type Tab = typeof tabs[number];
const labels: Record<Tab, string> = { overview: 'Overview', var: 'Loss estimates', greeks: 'Options exposure', alerts: 'Data quality' };

export const RiskMetrics = () => {
  const query = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 30000, retry: false });
  const [tab, setTab] = useState<Tab>('overview');
  const data = query.data;
  const complete = data?.riskDataComplete === true;
  const rows = tab === 'overview' ? [
    ['Account equity', dollars(data?.totalEquity)],
    ['Cash balance', dollars(data?.cashBalance)],
    ['Buying power', dollars(data?.buyingPower)],
    ['Invested collateral', dollars(data?.investedCollateral)],
    ['Collateral / equity', percent(data?.exposurePct)],
    ['Day P&L', complete ? dollars(data?.dailyPnl) : 'Unavailable: incomplete risk data'],
    ['Day return', complete ? percent(data?.dailyPnlPct) : 'Unavailable: incomplete risk data'],
    ['Current loss from recorded peak', percent(data?.maxDrawdownPct)],
    ['Sharpe / Sortino', 'Unavailable: verified return series required'],
  ] : tab === 'var' ? [
    ['95% value at risk', 'Not calculated by this service'],
    ['99% value at risk', 'Not calculated by this service'],
    ['Expected shortfall', 'Not calculated by this service'],
  ] : tab === 'greeks' ? [
    ['Portfolio delta', 'Not calculated by this service'],
    ['Portfolio gamma', 'Not calculated by this service'],
    ['Portfolio vega', 'Not calculated by this service'],
    ['Portfolio theta', 'Not calculated by this service'],
    ['Market beta / correlation', 'Not calculated by this service'],
  ] : [
    ['Risk evidence complete', data ? complete ? 'Yes, reported by backend' : 'No — do not infer risk readiness' : 'Unknown'],
    ['Backend stale flag', data ? data.isStale === true ? 'Stale' : data.isStale === false ? 'Not marked stale' : 'Unknown' : 'Unknown'],
    ['Broker mode', typeof data?.brokerMode === 'string' ? data.brokerMode : 'Unknown'],
    ['Data source', typeof data?.dataSource === 'string' ? data.dataSource : 'Unknown'],
    ['Price observation time', 'Not supplied by this response'],
  ];
  return <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Portfolio risk evidence">
    <div className="flex justify-between items-start flex-wrap gap-3">
      <div><h2 className="text-lg font-semibold text-slate-900">Portfolio risk evidence</h2><p className="text-sm text-slate-600 mt-1">Reported account values; unsupported models remain unavailable.</p></div>
      <button className="min-h-11 px-3 rounded-lg border border-slate-300 text-sm disabled:opacity-50" onClick={() => query.refetch()} disabled={query.isFetching}>{query.isFetching ? 'Refreshing…' : 'Refresh risk data'}</button>
    </div>
    <div className="flex flex-wrap gap-2 my-4" role="group" aria-label="Risk detail view">
      {tabs.map(value => <button key={value} aria-pressed={tab === value} className={`min-h-11 px-3 rounded-lg text-sm ${tab === value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setTab(value)}>{labels[value]}</button>)}
    </div>
    {query.isLoading && <p role="status" className="text-sm text-slate-600">Loading account evidence…</p>}
    {query.isError && <p role="alert" className="text-sm text-red-700 mb-3">Risk data could not be refreshed.{data ? ' Cached values below may be outdated.' : ' No financial values are available.'} Use Refresh to retry.</p>}
    {(!query.isLoading || data) && <dl className="space-y-3">{rows.map(([label, value]) => <div className="flex justify-between items-start gap-4 text-sm" key={label}><dt className="text-slate-600">{label}</dt><dd className="text-slate-900 text-right font-medium break-words">{value}</dd></div>)}</dl>}
    <p className="text-sm text-slate-600 mt-4">Current loss from a stored peak is not the historical maximum drawdown. No cash-flow-adjusted return series or risk-alert service is supplied here.</p>
    <div className="mt-3"><LastUpdated query={query} label="Account response" staleAfterMs={60000} /></div>
  </section>;
};
export default RiskMetrics;
