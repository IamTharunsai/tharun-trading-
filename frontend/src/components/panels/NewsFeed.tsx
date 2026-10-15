import { useState } from 'react';
import { MarketPanel, finite, numeric, safeLink, usePanelData } from './MarketPanel';
interface News { id: string; headline: string; source?: string; url?: string; summary?: string; publishedAt?: string; sentimentLabel?: string; sentimentScore?: number | null; assetsMentioned?: string[] }
const parse = (value: unknown): News[] => { if (!Array.isArray(value) || value.some(row => !row || typeof row.headline !== 'string' || typeof row.id !== 'string')) throw new Error('Invalid news response'); return value; };
export function NewsFeed() {
  const result = usePanelData('/market/news?limit=30', parse);
  const [filter, setFilter] = useState('all'); const [symbol, setSymbol] = useState('');
  const rows = (result.data ?? []).filter(row => (filter === 'all' || row.sentimentLabel?.toLowerCase() === filter) && (!symbol.trim() || (Array.isArray(row.assetsMentioned) && row.assetsMentioned.some(s => s.toUpperCase().includes(symbol.trim().toUpperCase())))));
  return <MarketPanel title="News and recorded sentiment" description="Ingested articles and stored model assessments. A sentiment score is not a measured probability or independent verification of the article." result={result} observedAt={null}>
    <div className="flex flex-wrap gap-3 text-sm mb-4"><label>Sentiment<select className="block min-h-11 border rounded-lg px-2" value={filter} onChange={e => setFilter(e.target.value)}>{['all','bullish','bearish','neutral'].map(v => <option key={v} value={v}>{v}</option>)}</select></label><label>Mentioned symbol<input className="block min-h-11 border rounded-lg px-2 max-w-full" value={symbol} onChange={e => setSymbol(e.target.value)} /></label></div>
    {result.data && rows.length === 0 && <p className="text-sm text-slate-600">No received articles match these filters.</p>}
    <ul className="divide-y divide-slate-200 max-h-96 overflow-y-auto">{rows.map(row => {
      const url = safeLink(row.url);
      const time = row.publishedAt && Number.isFinite(Date.parse(row.publishedAt)) ? new Date(row.publishedAt).toLocaleString() : 'Publication time unavailable';
      return <li className="py-4" key={row.id}><h4 className="font-medium leading-snug">{url ? <a className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2" href={url} target="_blank" rel="noopener noreferrer">{row.headline}</a> : row.headline}</h4><p className="mt-2 text-xs text-slate-600">{row.source ?? 'Source unavailable'} · {time}</p><p className="mt-2 text-sm">Recorded sentiment: {row.sentimentLabel ?? 'Unavailable'} · Score: {finite(row.sentimentScore) === null ? 'Unavailable' : numeric(row.sentimentScore, 3)}</p>{row.summary && <details className="mt-2 text-sm"><summary className="cursor-pointer min-h-11 flex items-center">Read stored summary</summary><p className="leading-relaxed max-w-prose">{row.summary}</p></details>}{Array.isArray(row.assetsMentioned) && row.assetsMentioned.length > 0 && <p className="text-xs text-slate-600 mt-2">Mentions: {row.assetsMentioned.join(', ')}</p>}</li>;
    })}</ul>
  </MarketPanel>;
}
export default NewsFeed;