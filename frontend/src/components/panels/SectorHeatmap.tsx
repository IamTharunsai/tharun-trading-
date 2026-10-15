import { MarketPanel, PanelTable, money, percent, usePanelData } from './MarketPanel';
interface Sector { name: string; ticker: string; price: number | null; changePercent: number | null; observedAt: string | null }
interface Data { sectors: Sector[]; source?: string; observedAt?: string | null }
const parse = (value: unknown): Data => { const data = value as Data; if (!data || !Array.isArray(data.sectors) || data.sectors.some(row => !row || typeof row.name !== 'string' || typeof row.ticker !== 'string')) throw new Error('Invalid sector response'); return data; };
export function SectorHeatmap({ onSectorClick }: { onSectorClick?: (sector: string) => void }) {
  const result = usePanelData('/market/sectors', parse);
  return <MarketPanel title="Sector ETF proxies" description="ETF price changes are sector proxies. Sector capitalization and constituents are not supplied." result={result} source={result.data?.source} observedAt={result.data?.observedAt}>
    {result.data && <PanelTable headers={['Sector / ETF', 'Price', 'Session change', 'Observation']}>
      {result.data.sectors.map(row => <tr key={row.ticker}><td>{onSectorClick ? <button className="min-h-11 underline underline-offset-4" onClick={() => onSectorClick(row.name)}>{row.name} · {row.ticker}</button> : `${row.name} · ${row.ticker}`}</td><td>{money(row.price)}</td><td>{percent(row.changePercent)}</td><td>{row.observedAt && Number.isFinite(Date.parse(row.observedAt)) ? new Date(row.observedAt).toLocaleString() : 'Unavailable'}</td></tr>)}
    </PanelTable>}
    {result.data?.sectors.length === 0 && <p className="text-sm text-slate-600">No verified ETF observations were returned.</p>}
  </MarketPanel>;
}
export default SectorHeatmap;