import { useState } from 'react';
import { MarketPanel, PanelTable, finite, money, numeric, percent, usePanelData } from './MarketPanel';
interface Asset { id?: string; symbol: string; name: string; price: number | null; change24h: number | null; marketCap: number | null; volume24h: number | null; observedAt?: string | null; source?: string }
interface Overview { totalMarketCap: number | null; totalVolume24h: number | null; btcDominance: number | null; ethDominance: number | null; fearGreedIndex: number | null; fearGreedLabel: string | null; source?: string; observedAt?: string | null; globalObservedAt?: string | null; fearGreedObservedAt?: string | null }
const parseAssets = (value: unknown): Asset[] => { if (!Array.isArray(value) || value.some(row => !row || typeof row.symbol !== 'string' || typeof row.name !== 'string')) throw new Error('Invalid crypto observations'); return value; };
const parseOverview = (value: unknown): Overview => { if (!value || typeof value !== 'object' || Array.isArray(value) || !('totalMarketCap' in value)) throw new Error('Invalid crypto overview'); return value as Overview; };
export function CryptoBoard({ onAssetClick }: { onAssetClick?: (symbol: string) => void }) {
  const assets = usePanelData('/market/crypto/top20', parseAssets);
  const overview = usePanelData('/market/crypto/overview', parseOverview);
  const [sortBy, setSortBy] = useState<'marketCap' | 'change24h' | 'volume24h'>('marketCap');
  const rows = [...(assets.data ?? [])].sort((a, b) => (finite(b[sortBy]) ?? -Infinity) - (finite(a[sortBy]) ?? -Infinity));
  const o = overview.data;
  return <MarketPanel title="Crypto markets" description="Provider observations in USD. Unavailable amounts remain unknown." result={assets} source={assets.data?.[0]?.source ?? 'CoinGecko'} observedAt={null}>
    {overview.error && <p role="status" className="text-sm text-red-800">Overview: {overview.error}</p>}
    {o && <dl className="grid grid-cols-2 gap-3 text-sm mb-4">{[['Market capitalization', money(o.totalMarketCap)], ['24h volume', money(o.totalVolume24h)], ['BTC dominance', percent(o.btcDominance)], ['ETH dominance', percent(o.ethDominance)], ['Fear / greed index', finite(o.fearGreedIndex) === null ? 'Unavailable' : `${numeric(o.fearGreedIndex, 0)} / 100 · ${o.fearGreedLabel ?? 'Label unavailable'}`]].map(([label,value]) => <div key={label}><dt className="text-slate-600">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl>}
    <p className="text-xs text-slate-600 mb-3">Global market observation: {o?.globalObservedAt ?? 'Unavailable'} · Fear / greed observation: {o?.fearGreedObservedAt ?? 'Unavailable'}</p><label className="text-sm">Sort by <select className="min-h-11 border rounded-lg px-2 ml-2" value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)}><option value="marketCap">Market cap</option><option value="change24h">24h change</option><option value="volume24h">24h volume</option></select></label>
    <PanelTable headers={['Asset', 'Price', '24h change', 'Market cap', 'Observed']}>
      {rows.map(row => <tr key={row.id ?? row.symbol}><td>{onAssetClick ? <button className="min-h-11 underline" onClick={() => onAssetClick(row.symbol)}>{row.name} · {row.symbol}</button> : `${row.name} · ${row.symbol}`}</td><td>{money(row.price)}</td><td>{percent(row.change24h)}</td><td>{money(row.marketCap)}</td><td>{row.observedAt && Number.isFinite(Date.parse(row.observedAt)) ? new Date(row.observedAt).toLocaleString() : 'Unavailable'}</td></tr>)}
    </PanelTable>
    {assets.data?.length === 0 && <p className="text-sm text-slate-600">No verified assets were returned.</p>}
  </MarketPanel>;
}
export default CryptoBoard;