/**
 * INTEGRATION: OpenTerminal → APEX
 * Full Market Screener — stocks, ETFs, crypto
 * Inspired by OpenTerminal's multi-column sortable screener with TradingView scanner data
 */
import { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Search, Filter, RefreshCw, ArrowUpDown } from 'lucide-react';

type Asset = {
  ticker: string; name: string; sector: string; type: 'stock' | 'etf' | 'crypto';
  price: number; change: number; changePct: number; volume: number; avgVolume: number;
  marketCap: number; pe: number | null; eps: number | null; week52High: number; week52Low: number;
  rsi: number; macd: number; beta: number | null; dividendYield: number | null;
  earningsDate: string | null; shortFloat: number | null; institutionalOwn: number | null;
};

function gen(ticker: string, name: string, sector: string, type: Asset['type'],
  price: number, chg: number, vol: number, mcap: number, pe: number | null, beta: number | null): Asset {
  const rsi = 30 + Math.random() * 50;
  return {
    ticker, name, sector, type, price,
    change: chg, changePct: (chg / price) * 100,
    volume: vol, avgVolume: vol * (0.8 + Math.random() * 0.6),
    marketCap: mcap, pe, eps: pe ? +(price / pe).toFixed(2) : null,
    week52High: price * (1 + Math.random() * 0.45),
    week52Low: price * (1 - Math.random() * 0.35),
    rsi: +rsi.toFixed(1), macd: +(Math.random() * 4 - 2).toFixed(2),
    beta, dividendYield: type === 'stock' && Math.random() > 0.5 ? +(Math.random() * 3).toFixed(2) : null,
    earningsDate: type === 'stock' ? ['Oct 24', 'Nov 1', 'Oct 31', 'Nov 7', 'Jan 15'][Math.floor(Math.random() * 5)] : null,
    shortFloat: type === 'stock' ? +(Math.random() * 8).toFixed(2) : null,
    institutionalOwn: type === 'stock' ? +(40 + Math.random() * 40).toFixed(1) : null,
  };
}

const ALL_ASSETS: Asset[] = [
  gen('AAPL','Apple Inc.','Technology','stock',227.48,2.13,52e6,3.42e12,32.1,1.21),
  gen('MSFT','Microsoft Corp.','Technology','stock',441.75,-1.24,18e6,3.28e12,37.8,0.89),
  gen('NVDA','NVIDIA Corp.','Technology','stock',134.89,4.72,198e6,3.30e12,55.4,1.69),
  gen('AMZN','Amazon.com Inc.','Consumer Disc.','stock',207.63,1.08,32e6,2.22e12,44.2,1.15),
  gen('GOOGL','Alphabet Inc.','Comm. Services','stock',183.21,-0.45,22e6,2.28e12,22.8,1.04),
  gen('META','Meta Platforms','Comm. Services','stock',594.89,8.12,17e6,1.50e12,29.3,1.28),
  gen('TSLA','Tesla Inc.','Consumer Disc.','stock',248.71,6.33,95e6,0.79e12,71.2,2.31),
  gen('JPM','JPMorgan Chase','Financials','stock',224.18,0.89,11e6,0.65e12,12.4,1.14),
  gen('GS','Goldman Sachs','Financials','stock',537.22,3.41,4e6,0.17e12,14.8,1.38),
  gen('JNJ','Johnson & Johnson','Healthcare','stock',157.45,-0.33,9e6,0.38e12,28.5,0.52),
  gen('UNH','UnitedHealth Group','Healthcare','stock',542.13,2.17,4e6,0.51e12,23.1,0.55),
  gen('XOM','Exxon Mobil','Energy','stock',118.33,1.22,18e6,0.47e12,14.2,0.84),
  gen('CVX','Chevron Corp.','Energy','stock',155.44,0.78,12e6,0.29e12,12.8,0.98),
  gen('HD','Home Depot','Consumer Staples','stock',408.22,-1.55,5e6,0.41e12,25.6,1.02),
  gen('PG','Procter & Gamble','Consumer Staples','stock',173.88,0.44,9e6,0.41e12,26.2,0.48),
  gen('V','Visa Inc.','Financials','stock',290.44,1.33,8e6,0.59e12,32.4,0.92),
  gen('MA','Mastercard Inc.','Financials','stock',501.22,2.88,5e6,0.46e12,38.1,1.07),
  gen('BRK.B','Berkshire Hathaway','Financials','stock',447.12,1.02,5e6,0.98e12,null,0.88),
  gen('SPY','SPDR S&P 500 ETF','ETF','etf',571.88,1.24,74e6,5.27e11,null,1.00),
  gen('QQQ','Invesco QQQ Trust','ETF','etf',490.22,2.11,42e6,1.74e11,null,1.08),
  gen('IWM','iShares Russell 2000','ETF','etf',224.33,0.88,34e6,0.58e11,null,1.23),
  gen('GLD','SPDR Gold Shares','ETF','etf',238.11,0.44,12e6,0.57e11,null,null),
  gen('BTC-USD','Bitcoin','Crypto','crypto',67420,1850,42e9,1.33e12,null,null),
  gen('ETH-USD','Ethereum','Crypto','crypto',2641,-32,18e9,0.32e12,null,null),
  gen('SOL-USD','Solana','Crypto','crypto',174.22,8.33,6e9,0.08e12,null,null),
  gen('BNB-USD','BNB','Crypto','crypto',612.44,12.1,4e9,0.09e12,null,null),
  gen('AVAX-USD','Avalanche','Crypto','crypto',38.88,1.22,2e9,0.016e12,null,null),
  gen('LINK-USD','Chainlink','Crypto','crypto',14.77,0.44,1.2e9,0.009e12,null,null),
];

type SortKey = keyof Asset;

function fmt(n: number, prefix = '') {
  if (n >= 1e12) return prefix + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return prefix + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return prefix + (n / 1e6).toFixed(1) + 'M';
  return prefix + n.toFixed(0);
}

const SECTORS = ['All Sectors', 'Technology', 'Financials', 'Healthcare', 'Consumer Disc.', 'Consumer Staples', 'Energy', 'Comm. Services', 'ETF', 'Crypto'];
const RSI_FILTERS = ['All RSI', 'Oversold (<30)', 'Neutral (30-70)', 'Overbought (>70)'];
const SIGNAL_FILTERS = ['All Signals', 'Bullish (RSI<40 + MACD+)', 'Bearish (RSI>65 + MACD-)', 'Near 52W High', 'Near 52W Low'];

export default function ScreenerPage() {
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('All Sectors');
  const [typeFilter, setTypeFilter] = useState<'all'|'stock'|'etf'|'crypto'>('all');
  const [rsiFilter, setRsiFilter] = useState('All RSI');
  const [signalFilter, setSignalFilter] = useState('All Signals');
  const [sortKey, setSortKey] = useState<SortKey>('marketCap');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [cols, setCols] = useState(['price','changePct','volume','marketCap','pe','rsi','macd','week52High','beta']);

  const filtered = useMemo(() => {
    let data = [...ALL_ASSETS];
    if (query) data = data.filter(a => a.ticker.toLowerCase().includes(query.toLowerCase()) || a.name.toLowerCase().includes(query.toLowerCase()));
    if (typeFilter !== 'all') data = data.filter(a => a.type === typeFilter);
    if (sector !== 'All Sectors') data = data.filter(a => a.sector === sector || (sector === 'ETF' && a.type === 'etf') || (sector === 'Crypto' && a.type === 'crypto'));
    if (rsiFilter === 'Oversold (<30)') data = data.filter(a => a.rsi < 30);
    else if (rsiFilter === 'Neutral (30-70)') data = data.filter(a => a.rsi >= 30 && a.rsi <= 70);
    else if (rsiFilter === 'Overbought (>70)') data = data.filter(a => a.rsi > 70);
    if (signalFilter === 'Bullish (RSI<40 + MACD+)') data = data.filter(a => a.rsi < 40 && a.macd > 0);
    else if (signalFilter === 'Bearish (RSI>65 + MACD-)') data = data.filter(a => a.rsi > 65 && a.macd < 0);
    else if (signalFilter === 'Near 52W High') data = data.filter(a => a.price / a.week52High > 0.95);
    else if (signalFilter === 'Near 52W Low') data = data.filter(a => a.price / a.week52Low < 1.08);
    data.sort((a, b) => {
      const av = a[sortKey] as number ?? 0;
      const bv = b[sortKey] as number ?? 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return data;
  }, [query, sector, typeFilter, rsiFilter, signalFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const COL_DEF: Record<string, { label: string; render: (a: Asset) => React.ReactNode; align?: string }> = {
    price: { label: 'Price', render: a => `$${a.price.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}`, align: 'right' },
    changePct: { label: 'Change %', render: a => (
      <span style={{color: a.changePct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight:600}}>
        {a.changePct >= 0 ? '+' : ''}{a.changePct.toFixed(2)}%
      </span>
    ), align: 'right' },
    volume: { label: 'Volume', render: a => fmt(a.volume), align: 'right' },
    marketCap: { label: 'Mkt Cap', render: a => fmt(a.marketCap, '$'), align: 'right' },
    pe: { label: 'P/E', render: a => a.pe ? a.pe.toFixed(1) : '—', align: 'right' },
    rsi: { label: 'RSI', render: a => (
      <span style={{color: a.rsi < 30 ? 'var(--green)' : a.rsi > 70 ? 'var(--red)' : 'var(--text)', fontWeight: (a.rsi < 30 || a.rsi > 70) ? 700 : 400}}>
        {a.rsi}
      </span>
    ), align: 'right' },
    macd: { label: 'MACD', render: a => (
      <span style={{color: a.macd > 0 ? 'var(--green)' : 'var(--red)'}}>
        {a.macd > 0 ? '+' : ''}{a.macd.toFixed(2)}
      </span>
    ), align: 'right' },
    week52High: { label: '52W High', render: a => `$${a.week52High.toFixed(2)}`, align: 'right' },
    week52Low: { label: '52W Low', render: a => `$${a.week52Low.toFixed(2)}`, align: 'right' },
    beta: { label: 'Beta', render: a => a.beta ? a.beta.toFixed(2) : '—', align: 'right' },
    dividendYield: { label: 'Div Yield', render: a => a.dividendYield ? `${a.dividendYield.toFixed(2)}%` : '—', align: 'right' },
    shortFloat: { label: 'Short %', render: a => a.shortFloat ? `${a.shortFloat.toFixed(2)}%` : '—', align: 'right' },
    earningsDate: { label: 'Earnings', render: a => a.earningsDate ?? '—', align: 'center' },
  };

  const bullish = filtered.filter(a => a.rsi < 40 && a.macd > 0).length;
  const bearish = filtered.filter(a => a.rsi > 65 && a.macd < 0).length;

  return (
    <div style={{padding:'24px', color:'var(--text)', fontFamily:'system-ui,sans-serif', maxWidth:1400, margin:'0 auto'}}>
      <style>{`
        :root{--text:#0f172a;--muted:#64748b;--card:#ffffff;--border:#e2e8f0;--accent:#3b82f6;--bg:#f8fafc;--green:#16a34a;--red:#dc2626;}
        @media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--text:#f1f5f9;--muted:#94a3b8;--card:#1e293b;--border:#334155;--accent:#60a5fa;--bg:#0f172a;--green:#4ade80;--red:#f87171;}}
        :root[data-theme="dark"]{--text:#f1f5f9;--muted:#94a3b8;--card:#1e293b;--border:#334155;--accent:#60a5fa;--bg:#0f172a;--green:#4ade80;--red:#f87171;}
        body{background:var(--bg);}
        .scr-table th{cursor:pointer;user-select:none;white-space:nowrap;}
        .scr-table th:hover{color:var(--accent);}
        .scr-row:hover{background:rgba(59,130,246,0.06);}
        select{background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px;cursor:pointer;}
      `}</style>

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{margin:0,fontSize:22,fontWeight:700}}>Market Screener</h1>
          <p style={{margin:'4px 0 0',color:'var(--muted)',fontSize:13}}>OpenTerminal-style screener — {filtered.length} results · {bullish} bullish signals · {bearish} bearish signals</p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:8,background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,padding:'7px 12px'}}>
            <Search size={14} color="var(--muted)" />
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search ticker or name..." style={{border:'none',background:'transparent',color:'var(--text)',outline:'none',fontSize:13,width:180}} />
          </div>
          <button style={{display:'flex',alignItems:'center',gap:6,background:'var(--accent)',color:'#fff',border:'none',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontSize:13,fontWeight:600}}>
            <RefreshCw size={13}/> Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        <Filter size={14} color="var(--muted)" />
        <div style={{display:'flex',gap:4}}>
          {(['all','stock','etf','crypto'] as const).map(t => (
            <button key={t} onClick={()=>setTypeFilter(t)} style={{padding:'5px 12px',border:'1px solid var(--border)',borderRadius:6,background:typeFilter===t?'var(--accent)':'var(--card)',color:typeFilter===t?'#fff':'var(--text)',cursor:'pointer',fontSize:12,fontWeight:typeFilter===t?600:400,textTransform:'capitalize'}}>
              {t === 'all' ? 'All' : t.toUpperCase()}
            </button>
          ))}
        </div>
        <select value={sector} onChange={e=>setSector(e.target.value)}>{SECTORS.map(s=><option key={s}>{s}</option>)}</select>
        <select value={rsiFilter} onChange={e=>setRsiFilter(e.target.value)}>{RSI_FILTERS.map(s=><option key={s}>{s}</option>)}</select>
        <select value={signalFilter} onChange={e=>setSignalFilter(e.target.value)}>{SIGNAL_FILTERS.map(s=><option key={s}>{s}</option>)}</select>
      </div>

      {/* Column toggles */}
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        <span style={{fontSize:11,color:'var(--muted)',alignSelf:'center'}}>Columns:</span>
        {Object.keys(COL_DEF).map(k => (
          <button key={k} onClick={()=>setCols(c=>c.includes(k)?c.filter(x=>x!==k):[...c,k])}
            style={{padding:'3px 8px',border:'1px solid var(--border)',borderRadius:4,background:cols.includes(k)?'rgba(59,130,246,0.12)':'var(--card)',color:cols.includes(k)?'var(--accent)':'var(--muted)',cursor:'pointer',fontSize:11}}>
            {COL_DEF[k].label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table className="scr-table" style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'var(--bg)',borderBottom:'2px solid var(--border)'}}>
                <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--muted)'}}>Ticker</th>
                <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--muted)'}}>Name</th>
                <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--muted)'}}>Sector</th>
                {cols.map(c => (
                  <th key={c} onClick={()=>toggleSort(c as SortKey)} style={{padding:'10px 14px',textAlign:COL_DEF[c]?.align as any||'right',fontWeight:600,color:sortKey===c?'var(--accent)':'var(--muted)'}}>
                    <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
                      {COL_DEF[c]?.label} <ArrowUpDown size={11}/>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.ticker} className="scr-row" style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{padding:'9px 14px',fontWeight:700,color:'var(--accent)',fontVariantNumeric:'tabular-nums'}}>{a.ticker}</td>
                  <td style={{padding:'9px 14px',color:'var(--muted)',whiteSpace:'nowrap',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis'}}>{a.name}</td>
                  <td style={{padding:'9px 14px'}}>
                    <span style={{fontSize:11,background:'var(--border)',padding:'2px 6px',borderRadius:4,whiteSpace:'nowrap'}}>{a.sector}</span>
                  </td>
                  {cols.map(c => (
                    <td key={c} style={{padding:'9px 14px',textAlign:COL_DEF[c]?.align as any||'right',fontVariantNumeric:'tabular-nums'}}>
                      {COL_DEF[c]?.render(a)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filtered.length === 0 && (
        <div style={{textAlign:'center',padding:48,color:'var(--muted)'}}>No assets match your filters.</div>
      )}
    </div>
  );
}
