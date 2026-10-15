import { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { MarketPanel, PanelTable, finite, percent, usePanelData } from './MarketPanel';
interface Point { maturity: string; months: number; rate: number | null; observedAt?: string | null }
interface Data { current: Point[]; oneMonthAgo: Point[]; oneYearAgo: Point[]; spread2Y10Y: number | null; source?: string; observedAt?: string | null }
const parse = (value: unknown): Data => { const data = value as Data; if (!data || !Array.isArray(data.current) || !Array.isArray(data.oneMonthAgo) || !Array.isArray(data.oneYearAgo) || data.current.some(p => !p || typeof p.maturity !== 'string' || finite(p.months) === null)) throw new Error('Invalid yield observations'); return data; };
export function YieldCurve() {
  const result = usePanelData('/market/treasury/yields', parse, 600000);
  const [history, setHistory] = useState(false);
  const data = result.data;
  const rows = data?.current.map(p => ({ ...p, rate: finite(p.rate), month: finite(data.oneMonthAgo.find(v => v.maturity === p.maturity)?.rate), year: finite(data.oneYearAgo.find(v => v.maturity === p.maturity)?.rate) })) ?? [];
  return <MarketPanel title="US Treasury yields" description="FRED observations by maturity. Dates may differ across series; missing tenors remain gaps. No recession probability model is supplied." result={result} source={data?.source} observedAt={data?.observedAt}>
    {data && <>
      <p className="text-sm mb-3">10Y minus 2Y spread: {finite(data.spread2Y10Y) === null ? 'Unavailable' : `${(data.spread2Y10Y! * 100).toFixed(1)} basis points`}</p>
      <label className="flex items-center gap-2 min-h-11 text-sm"><input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} />Show supplied historical observations</label>
      {history && !data.oneMonthAgo.length && !data.oneYearAgo.length && <p className="text-sm text-slate-600">Historical curves have not been supplied.</p>}
      {rows.some(p => finite(p.rate) !== null) && <div className="h-48" aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows}><XAxis dataKey="maturity" /><YAxis unit="%" /><Tooltip /><Line dataKey="rate" name="Latest observed" stroke="#1d4ed8" connectNulls={false} isAnimationActive={false} />{history && <Line dataKey="month" name="One month ago" stroke="#92400e" strokeDasharray="5 4" connectNulls={false} isAnimationActive={false} />}{history && <Line dataKey="year" name="One year ago" stroke="#047857" strokeDasharray="2 4" connectNulls={false} isAnimationActive={false} />}</LineChart></ResponsiveContainer></div>}
      <PanelTable headers={['Maturity', 'Yield', 'Observation', ...(history ? ['1M ago', '1Y ago'] : [])]}>{rows.map(row => <tr key={row.maturity}><td>{row.maturity}</td><td>{percent(row.rate)}</td><td>{row.observedAt ?? 'Unavailable'}</td>{history && <td>{percent(row.month)}</td>}{history && <td>{percent(row.year)}</td>}</tr>)}</PanelTable>
    </>}
  </MarketPanel>;
}
export default YieldCurve;