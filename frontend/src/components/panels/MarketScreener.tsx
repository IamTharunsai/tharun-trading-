import { useMemo, useState } from 'react';
import { MarketPanel, PanelTable, finite, money, numeric, percent, usePanelData } from './MarketPanel';
interface Row { symbol: string; market?: string; name?: string; sector: string | null; price: number | null; change1d: number | null; change5d: number | null; change20d: number | null; volume: number | null; volumeUnit?: string; volumeRatio: number | null; marketCap: number | null; rsi14: number | null; signal: string | null; observedAt?: string | null }
interface Data { data: Row[]; source?: string; observedAt?: string | null }
const parse = (value: unknown): Data => { const data = value as Data; if (!data || !Array.isArray(data.data) || data.data.some(row => !row || typeof row.symbol !== 'string')) throw new Error('Invalid screener response'); return data; };
type Sort = 'symbol' | 'price' | 'change1d' | 'change5d' | 'change20d' | 'volumeRatio' | 'marketCap' | 'rsi14';
export function MarketScreener() {
  const result = usePanelData('/market/screener', parse);
  const [search, setSearch] = useState(''); const [sector, setSector] = useState('All');
  const [rsi, setRsi] = useState('all'); const [volume, setVolume] = useState(0); const [signal, setSignal] = useState('all');
  const [sort, setSort] = useState<Sort>('change1d'); const [ascending, setAscending] = useState(false);
  const sectors = [...new Set((result.data?.data ?? []).map(row => row.sector).filter((value): value is string => typeof value === 'string'))].sort();
  const rows = useMemo(() => (result.data?.data ?? []).filter(row => {
    if (!`${row.symbol} ${row.name ?? ''}`.toUpperCase().includes(search.trim().toUpperCase())) return false;
    if (sector !== 'All' && row.sector !== sector) return false;
    const value = finite(row.rsi14);
    if (rsi !== 'all' && (value === null || (rsi === 'oversold' ? value >= 35 : rsi === 'overbought' ? value <= 70 : value < 35 || value > 70))) return false;
    if (volume && (finite(row.volumeRatio) === null || row.volumeRatio! < volume)) return false;
    return signal === 'all' || row.signal === signal;
  }).sort((a,b) => {
    if (sort === 'symbol') return a.symbol.localeCompare(b.symbol) * (ascending ? 1 : -1);
    const av = finite(a[sort]); const bv = finite(b[sort]);
    return av === null ? bv === null ? 0 : 1 : bv === null ? -1 : (av - bv) * (ascending ? 1 : -1);
  }), [result.data, search, sector, rsi, volume, signal, sort, ascending]);
  const columns: [Sort,string][] = [['symbol','Asset'],['price','Price'],['change1d','Session / 24h change'],['change5d','5d'],['change20d','20d'],['volumeRatio','Volume ratio'],['rsi14','RSI'],['marketCap','Market cap']];
  return <MarketPanel title="Market screener" description="Observed tracked stocks and crypto, not the entire market. Stock session returns and crypto rolling 24h returns use different windows. Missing measurements are not trading signals." result={result} source={result.data?.source} observedAt={result.data?.observedAt}>
    <div className="flex flex-wrap gap-3 text-sm mb-3">
      <label>Search<input className="block min-h-11 border rounded-lg px-2 max-w-full" value={search} onChange={e => setSearch(e.target.value)} placeholder="Symbol or name" /></label>
      <label>Sector<select className="block min-h-11 border rounded-lg px-2" value={sector} onChange={e => setSector(e.target.value)}><option>All</option>{sectors.map(s => <option key={s}>{s}</option>)}</select></label>
      <label>RSI<select className="block min-h-11 border rounded-lg px-2" value={rsi} onChange={e => setRsi(e.target.value)}><option value="all">All observations</option><option value="oversold">Below 35</option><option value="neutral">35–70</option><option value="overbought">Above 70</option></select></label>
      <label>Volume ratio<select className="block min-h-11 border rounded-lg px-2" value={volume} onChange={e => setVolume(Number(e.target.value))}><option value={0}>All observations</option>{[1.5,2,3].map(v => <option key={v} value={v}>At least {v}×</option>)}</select></label>
      <label>Recorded signal<select className="block min-h-11 border rounded-lg px-2" value={signal} onChange={e => setSignal(e.target.value)}>{['all','BUY','SELL','HOLD'].map(v => <option key={v} value={v}>{v === 'all' ? 'All observations' : v}</option>)}</select></label>
    </div>
    <p className="text-sm text-slate-600 mb-2">{rows.length} matching observations. Filters exclude rows missing the selected measurement. RSI, volume ratios and committee signals may be unavailable.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm tabular-nums text-left"><thead><tr>{columns.map(([key,label]) => <th key={key} scope="col" aria-sort={sort === key ? ascending ? 'ascending' : 'descending' : 'none'}><button className="min-h-11 pr-4 whitespace-nowrap underline underline-offset-4" onClick={() => { if (sort === key) setAscending(v => !v); else {setSort(key);setAscending(false);} }}>{label}{sort === key ? ascending ? ' ↑' : ' ↓' : ''}</button></th>)}<th scope="col">Observed</th></tr></thead><tbody className="[&_td]:py-3 [&_td]:pr-4 [&_tr]:border-t [&_tr]:border-slate-100">{rows.map(row => <tr key={`${row.market}:${row.symbol}`}><td>{row.symbol}<span className="block text-xs text-slate-600">{row.market ?? 'Market unknown'}</span></td><td>{money(row.price)}</td><td>{percent(row.change1d)}</td><td>{percent(row.change5d)}</td><td>{percent(row.change20d)}</td><td>{finite(row.volumeRatio) === null ? 'Unavailable' : `${numeric(row.volumeRatio)}×`}</td><td>{numeric(row.rsi14)}</td><td>{money(row.marketCap)}</td><td>{row.observedAt && Number.isFinite(Date.parse(row.observedAt)) ? new Date(row.observedAt).toLocaleString() : 'Unavailable'}</td></tr>)}</tbody></table></div>
  </MarketPanel>;
}
export default MarketScreener;