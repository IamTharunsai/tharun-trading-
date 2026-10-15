import { MarketPanel, PanelTable, finite, money, percent, usePanelData } from '../components/panels/MarketPanel';
import SectorHeatmap from '../components/panels/SectorHeatmap';
import NewsFeed from '../components/panels/NewsFeed';
interface Row { symbol: string; name?: string | null; market?: string; price: number | null; change1d: number | null; observedAt?: string | null }
interface Data { data: Row[]; source?: string; observedAt?: string | null }
const parse = (value: unknown): Data => { const data = value as Data; if (!data || !Array.isArray(data.data) || data.data.some(row => !row || typeof row.symbol !== 'string')) throw new Error('Invalid observations'); return data; };
const indexProxies = [['SPY','S&P 500 ETF'], ['QQQ','Nasdaq-100 ETF'], ['DIA','Dow ETF'], ['IWM','Russell 2000 ETF']];
export default function MarketRecapPage() {
  const result = usePanelData('/market/screener', parse);
  const stocks = (result.data?.data ?? []).filter(row => row.market === 'stocks');
  const measured = stocks.filter((row): row is Row & { change1d: number } => finite(row.change1d) !== null);
  const positive = measured.filter(row => row.change1d > 0).sort((a,b) => b.change1d - a.change1d);
  const negative = measured.filter(row => row.change1d < 0).sort((a,b) => a.change1d - b.change1d);
  const flat = measured.filter(row => row.change1d === 0);
  const movers = (rows: Row[]) => <PanelTable headers={['Instrument', 'Price', 'Observed session change']}>
    {rows.map(row => <tr key={row.symbol}><td>{row.name ? `${row.name} · ${row.symbol}` : row.symbol}</td><td>{money(row.price)}</td><td>{percent(row.change1d)}</td></tr>)}
  </PanelTable>;
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold text-slate-900">Market recap</h1><p className="mt-2 text-sm text-slate-600 max-w-prose">A summary of received observations, not a forecast or a full-market census. Crypto rolling 24-hour returns are excluded from this equity session summary.</p></header>
    <MarketPanel title="Observed session summary" description="Derived only from the supplied equity observations. Missing measurements do not become flat returns or market-wide estimates." result={result} source={result.data?.source} observedAt={result.data?.observedAt}>
      {result.data && <p className="text-sm leading-relaxed">{measured.length ? `${positive.length} instruments advanced, ${negative.length} declined and ${flat.length} were unchanged among ${measured.length} measured equity returns. ${stocks.length - measured.length} additional equity observations lacked a valid session change.` : 'No verified equity session returns were supplied.'} New 52-week highs, new lows and an exchange-wide advance/decline line are unavailable.</p>}
    </MarketPanel>
    <MarketPanel title="Index ETF proxies" description="Tracked ETF observations only. An unavailable proxy has not been replaced with a guessed index return.">
      <PanelTable headers={['Proxy', 'Price', 'Session change', 'Observation']}>{indexProxies.map(([symbol,name]) => { const row = stocks.find(value => value.symbol === symbol); return <tr key={symbol}><td>{name} · {symbol}</td><td>{money(row?.price)}</td><td>{percent(row?.change1d)}</td><td>{row?.observedAt && Number.isFinite(Date.parse(row.observedAt)) ? new Date(row.observedAt).toLocaleString() : 'Unavailable'}</td></tr>; })}</PanelTable>
      <p className="mt-3 text-sm text-slate-600">Weekly and monthly returns require verified dated history and are not inferred from a session quote.</p>
    </MarketPanel>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6"><MarketPanel title="Tracked gainers" description="Largest positive session changes in the received equity subset.">{positive.length ? movers(positive.slice(0,5)) : <p className="text-sm text-slate-600">No verified positive equity returns in the received observations.</p>}</MarketPanel><MarketPanel title="Tracked decliners" description="Largest negative session changes in the received equity subset.">{negative.length ? movers(negative.slice(0,5)) : <p className="text-sm text-slate-600">No verified negative equity returns in the received observations.</p>}</MarketPanel></div>
    <SectorHeatmap />
    <NewsFeed />
  </div>;
}