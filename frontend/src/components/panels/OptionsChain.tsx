import { useEffect, useState } from 'react';
import { MarketPanel, PanelTable, finite, money, numeric, percent, usePanelData } from './MarketPanel';
interface Strike { strike: number; callBid?: number | null; callAsk?: number | null; callIV?: number | null; callOI?: number | null; callVolume?: number | null; putBid?: number | null; putAsk?: number | null; putIV?: number | null; putOI?: number | null; putVolume?: number | null; unusualCallActivity?: boolean; unusualPutActivity?: boolean }
interface Data { symbol: string; spotPrice?: number | null; expiry?: string; putCallRatio?: number | null; strikes: Strike[]; observedAt?: string | null; source?: string }
const parse = (value: unknown): Data => { const data = value as Data; if (!data || typeof data.symbol !== 'string' || !Array.isArray(data.strikes) || data.strikes.some(row => finite(row?.strike) === null)) throw new Error('Invalid options response'); return data; };
export function OptionsChain({ symbol: initialSymbol = 'SPY' }: { symbol?: string }) {
  const [symbol, setSymbol] = useState(initialSymbol); const [days, setDays] = useState(30); const [unusual, setUnusual] = useState(false);
  useEffect(() => setSymbol(initialSymbol), [initialSymbol]);
  const query = `/market/options?symbol=${encodeURIComponent(symbol.trim())}&expiry=${days}d`;
  const result = usePanelData(query, parse, 600000);
  const data = result.data?.symbol === symbol.trim() ? result.data : null;
  const rows = (data?.strikes ?? []).filter(row => !unusual || row.unusualCallActivity === true || row.unusualPutActivity === true);
  return <MarketPanel title="Options chain" description="A connected options provider is required for quotes, open interest and volatility. No generated prices or implied trading edge are used." result={result} source={data?.source} observedAt={data?.observedAt}>
    <div className="flex flex-wrap gap-3 text-sm"><label>Symbol<input className="block min-h-11 border rounded-lg px-2 max-w-full" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} /></label><label>Requested window<select className="block min-h-11 border rounded-lg px-2" value={days} onChange={e => setDays(Number(e.target.value))}>{[7,14,30,45,60].map(d => <option key={d} value={d}>{d} days</option>)}</select></label><label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={unusual} onChange={e => setUnusual(e.target.checked)} />Provider-marked unusual activity only</label></div>
    {data && <><p className="text-sm my-3">Spot {money(data.spotPrice)} · Actual expiry {data.expiry ?? 'Unavailable'} · Put/call open-interest ratio {numeric(data.putCallRatio)}</p><PanelTable headers={['Call volume','Call OI','Call IV','Call bid','Call ask','Strike','Put bid','Put ask','Put IV','Put OI','Put volume']}>{rows.map(row => <tr key={row.strike}><td>{numeric(row.callVolume,0)}</td><td>{numeric(row.callOI,0)}</td><td>{percent(row.callIV)}</td><td>{money(row.callBid)}</td><td>{money(row.callAsk)}</td><td className="font-semibold">{numeric(row.strike)}</td><td>{money(row.putBid)}</td><td>{money(row.putAsk)}</td><td>{percent(row.putIV)}</td><td>{numeric(row.putOI,0)}</td><td>{numeric(row.putVolume,0)}</td></tr>)}</PanelTable>{rows.length === 0 && <p className="text-sm mt-3">No returned contracts match the selected filter.</p>}</>}
  </MarketPanel>;
}
export default OptionsChain;