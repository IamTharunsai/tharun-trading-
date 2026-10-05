import { useState } from 'react';
import { Search, TrendingUp, TrendingDown, BarChart2, DollarSign, Activity, Globe, Info } from 'lucide-react';

const SYMBOLS = [
  { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
  { ticker: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology' },
  { ticker: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology' },
  { ticker: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'GOOGL', name: 'Alphabet Inc.', sector: 'Communication Services' },
  { ticker: 'META', name: 'Meta Platforms Inc.', sector: 'Communication Services' },
  { ticker: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financials' },
  { ticker: 'GS', name: 'Goldman Sachs Group', sector: 'Financials' },
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', sector: 'ETF' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', sector: 'ETF' },
  { ticker: 'BTC-USD', name: 'Bitcoin USD', sector: 'Crypto' },
  { ticker: 'ETH-USD', name: 'Ethereum USD', sector: 'Crypto' },
];

const MOCK_DATA: Record<string, any> = {
  'AAPL': {
    price: 227.48, change: 2.13, changePct: 0.94, volume: '52.3M', avgVolume: '58.7M',
    marketCap: '$3.42T', pe: 32.1, eps: 7.09, beta: 1.21, dividend: '0.99 (0.44%)',
    week52High: 237.23, week52Low: 164.08, sharesOut: '15.04B', float: '15.01B',
    institutionalOwn: '61.2%', shortFloat: '0.67%', targetPrice: 245.00,
    analystRating: 'Buy', buyCount: 32, holdCount: 8, sellCount: 2,
    revenue: '$391.04B', revenueGrowth: '+4.87%', netIncome: '$93.74B', grossMargin: '46.2%',
    operatingMargin: '31.5%', roe: '160.5%', debtEquity: '1.45', currentRatio: '0.95',
    description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide. The company also offers various related services.',
    relatedNews: [
      { headline: 'Apple Vision Pro sales miss analyst expectations', time: '2h ago', sentiment: 'bearish' },
      { headline: 'iPhone 17 Pro pre-orders surpass iPhone 16 records', time: '5h ago', sentiment: 'bullish' },
      { headline: 'Apple services revenue hits all-time high at $24.2B', time: '1d ago', sentiment: 'bullish' },
    ],
  },
  'MSFT': {
    price: 441.75, change: -1.24, changePct: -0.28, volume: '18.4M', avgVolume: '21.2M',
    marketCap: '$3.28T', pe: 37.8, eps: 11.69, beta: 0.89, dividend: '3.32 (0.75%)',
    week52High: 468.35, week52Low: 362.90, sharesOut: '7.43B', float: '7.41B',
    institutionalOwn: '71.3%', shortFloat: '0.52%', targetPrice: 510.00,
    analystRating: 'Strong Buy', buyCount: 45, holdCount: 5, sellCount: 1,
    revenue: '$245.12B', revenueGrowth: '+16.04%', netIncome: '$88.14B', grossMargin: '69.8%',
    operatingMargin: '44.6%', roe: '38.5%', debtEquity: '0.22', currentRatio: '1.34',
    description: 'Microsoft Corporation develops and supports software, services, devices, and solutions worldwide. It operates through Productivity and Business Processes, Intelligent Cloud, and Personal Computing segments.',
    relatedNews: [
      { headline: 'Microsoft Azure growth accelerates to 33% in Q2', time: '3h ago', sentiment: 'bullish' },
      { headline: 'Copilot+ PC adoption exceeds 5 million units', time: '8h ago', sentiment: 'bullish' },
      { headline: 'DOJ scrutinizes Microsoft-OpenAI partnership structure', time: '2d ago', sentiment: 'bearish' },
    ],
  },
  'NVDA': {
    price: 134.89, change: 4.72, changePct: 3.63, volume: '198.7M', avgVolume: '234.5M',
    marketCap: '$3.30T', pe: 55.4, eps: 2.44, beta: 1.69, dividend: '0.04 (0.03%)',
    week52High: 153.13, week52Low: 76.08, sharesOut: '24.46B', float: '24.43B',
    institutionalOwn: '65.8%', shortFloat: '1.12%', targetPrice: 175.00,
    analystRating: 'Strong Buy', buyCount: 51, holdCount: 4, sellCount: 0,
    revenue: '$130.50B', revenueGrowth: '+122.4%', netIncome: '$72.88B', grossMargin: '76.6%',
    operatingMargin: '54.1%', roe: '123.8%', debtEquity: '0.41', currentRatio: '4.17',
    description: 'NVIDIA Corporation provides graphics, networking, and compute infrastructure solutions. The company designs, develops, and markets graphics processors, chipsets, and related software.',
    relatedNews: [
      { headline: 'NVIDIA Blackwell GB200 NVL72 demand exceeds supply through 2026', time: '1h ago', sentiment: 'bullish' },
      { headline: 'China export restrictions may cut NVIDIA revenue by $15B', time: '4h ago', sentiment: 'bearish' },
      { headline: 'NVIDIA announces CUDA 13 with 40% speed improvements', time: '1d ago', sentiment: 'bullish' },
    ],
  },
};

const DEFAULT = MOCK_DATA['AAPL'];

function getQuoteData(ticker: string) {
  if (MOCK_DATA[ticker]) return MOCK_DATA[ticker];
  // Generate plausible random data for unknown tickers
  const price = 50 + Math.random() * 400;
  const change = (Math.random() - 0.45) * 8;
  return {
    price, change, changePct: (change / price) * 100,
    volume: `${(Math.random() * 80 + 5).toFixed(1)}M`,
    avgVolume: `${(Math.random() * 100 + 10).toFixed(1)}M`,
    marketCap: `$${(price * (Math.random() * 10 + 1)).toFixed(0)}B`,
    pe: (Math.random() * 40 + 10).toFixed(1),
    eps: (Math.random() * 8 + 1).toFixed(2),
    beta: (Math.random() * 1.5 + 0.3).toFixed(2),
    dividend: 'N/A',
    week52High: price * (1 + Math.random() * 0.4),
    week52Low: price * (1 - Math.random() * 0.35),
    sharesOut: `${(Math.random() * 5 + 0.5).toFixed(2)}B`,
    float: `${(Math.random() * 5 + 0.5).toFixed(2)}B`,
    institutionalOwn: `${(Math.random() * 40 + 30).toFixed(1)}%`,
    shortFloat: `${(Math.random() * 5 + 0.5).toFixed(2)}%`,
    targetPrice: price * (1 + Math.random() * 0.25),
    analystRating: 'Buy', buyCount: 20, holdCount: 8, sellCount: 2,
    revenue: 'N/A', revenueGrowth: 'N/A', netIncome: 'N/A',
    grossMargin: `${(Math.random() * 40 + 20).toFixed(1)}%`,
    operatingMargin: `${(Math.random() * 25 + 5).toFixed(1)}%`,
    roe: `${(Math.random() * 30 + 5).toFixed(1)}%`,
    debtEquity: (Math.random() * 2).toFixed(2),
    currentRatio: (Math.random() * 2 + 0.5).toFixed(2),
    description: `${ticker} is a publicly traded company listed on major US exchanges.`,
    relatedNews: [],
  };
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Week52Bar({ low, high, current }: { low: number; high: number; current: number }) {
  const pct = ((current - low) / (high - low)) * 100;
  return (
    <div>
      <div style={{ position: 'relative', height: 6, background: 'var(--border)', borderRadius: 3, margin: '6px 0' }}>
        <div style={{ position: 'absolute', left: `${pct}%`, top: -3, width: 12, height: 12, background: 'var(--accent)', borderRadius: '50%', transform: 'translateX(-50%)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
        <span>52W Low: ${low.toFixed(2)}</span>
        <span>52W High: ${high.toFixed(2)}</span>
      </div>
    </div>
  );
}

export default function QuotePanelPage() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(SYMBOLS[0]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'fundamentals' | 'analyst' | 'news'>('overview');

  const data = getQuoteData(selected.ticker);
  const isUp = data.change >= 0;

  const filtered = SYMBOLS.filter(s =>
    s.ticker.toLowerCase().includes(query.toLowerCase()) ||
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  const totalAnalysts = data.buyCount + data.holdCount + data.sellCount;
  const buyPct = (data.buyCount / totalAnalysts) * 100;
  const holdPct = (data.holdCount / totalAnalysts) * 100;
  const sellPct = (data.sellCount / totalAnalysts) * 100;

  const tabs = ['overview', 'fundamentals', 'analyst', 'news'] as const;

  return (
    <div style={{ padding: '24px', color: 'var(--text)', fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto' }}>
      <style>{`
        :root { --text:#0f172a; --muted:#64748b; --card:#ffffff; --border:#e2e8f0; --accent:#3b82f6; --bg:#f8fafc; --green:#16a34a; --red:#dc2626; }
        @media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--text:#f1f5f9;--muted:#94a3b8;--card:#1e293b;--border:#334155;--accent:#60a5fa;--bg:#0f172a;--green:#4ade80;--red:#f87171;}}
        :root[data-theme="dark"]{--text:#f1f5f9;--muted:#94a3b8;--card:#1e293b;--border:#334155;--accent:#60a5fa;--bg:#0f172a;--green:#4ade80;--red:#f87171;}
        body{background:var(--bg);}
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Quote Panel</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>OpenTerminal-style stock fundamentals &amp; analyst data</p>
        </div>

        {/* Symbol Search */}
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
            <Search size={15} color="var(--muted)" />
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Search symbol or company..."
              style={{ border: 'none', background: 'transparent', color: 'var(--text)', outline: 'none', fontSize: 14, width: 220 }}
            />
          </div>
          {showDropdown && (
            <div style={{ position: 'absolute', top: '110%', left: 0, right: 0, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 50, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
              onMouseLeave={() => setTimeout(() => setShowDropdown(false), 150)}>
              {filtered.map(s => (
                <div key={s.ticker} onClick={() => { setSelected(s); setQuery(''); setShowDropdown(false); }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{s.ticker}</span>
                    <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--muted)' }}>{s.name}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--border)', padding: '2px 6px', borderRadius: 4 }}>{s.sector}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Price Hero */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 20, display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>{selected.name} · {selected.sector}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
            <span style={{ fontSize: 42, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>${data.price.toFixed(2)}</span>
            <span style={{ fontSize: 20, fontWeight: 600, color: isUp ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {isUp ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
              {isUp ? '+' : ''}{data.change.toFixed(2)} ({isUp ? '+' : ''}{data.changePct.toFixed(2)}%)
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>As of market close · {new Date().toLocaleDateString()}</div>
          <div style={{ marginTop: 16 }}>
            <Week52Bar low={data.week52Low} high={data.week52High} current={data.price} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, flex: 2, minWidth: 300 }}>
          <MetricCard label="Market Cap" value={data.marketCap} />
          <MetricCard label="P/E Ratio" value={String(data.pe)} sub="Trailing 12M" />
          <MetricCard label="EPS (TTM)" value={`$${data.eps}`} />
          <MetricCard label="Beta" value={String(data.beta)} sub="5Y monthly" />
          <MetricCard label="Volume" value={data.volume} sub={`Avg: ${data.avgVolume}`} />
          <MetricCard label="Dividend" value={data.dividend} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: '10px 20px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontWeight: activeTab === t ? 600 : 400, fontSize: 14,
            color: activeTab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: activeTab === t ? '2px solid var(--accent)' : '2px solid transparent',
            textTransform: 'capitalize', transition: 'color 0.15s'
          }}>{t}</button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Info size={16} color="var(--accent)" />
                <span style={{ fontWeight: 600 }}>About {selected.ticker}</span>
              </div>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>{data.description}</p>
            </div>

            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Globe size={16} color="var(--accent)" />
                Share Statistics
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  ['Shares Outstanding', data.sharesOut],
                  ['Float', data.float],
                  ['Institutional Ownership', data.institutionalOwn],
                  ['Short % of Float', data.shortFloat],
                ].map(([label, val]) => (
                  <div key={label} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={16} color="var(--accent)" />
                Analyst Price Target
              </div>
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Consensus Target</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--green)', margin: '4px 0' }}>${data.targetPrice.toFixed(2)}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Upside: {((data.targetPrice - data.price) / data.price * 100).toFixed(1)}%
                </div>
              </div>
              <div style={{ marginTop: 12, background: 'rgba(59,130,246,0.1)', borderRadius: 6, padding: '8px 12px', textAlign: 'center' }}>
                <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 15 }}>{data.analystRating}</span>
              </div>
            </div>

            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 14 }}>Analyst Breakdown</div>
              <div style={{ fontSize: 13, color: 'var(--green)', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>Buy / Strong Buy</span><span>{data.buyCount}</span>
              </div>
              <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, marginBottom: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${buyPct}%`, background: 'var(--green)', borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>Hold</span><span>{data.holdCount}</span>
              </div>
              <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, marginBottom: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${holdPct}%`, background: '#f59e0b', borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--red)', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>Sell / Strong Sell</span><span>{data.sellCount}</span>
              </div>
              <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${sellPct}%`, background: 'var(--red)', borderRadius: 4 }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Fundamentals */}
      {activeTab === 'fundamentals' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <DollarSign size={16} color="var(--accent)" />
              Income Statement
            </div>
            {[
              ['Revenue (TTM)', data.revenue],
              ['Revenue Growth (YoY)', data.revenueGrowth],
              ['Net Income (TTM)', data.netIncome],
              ['Gross Margin', data.grossMargin],
              ['Operating Margin', data.operatingMargin],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
                <span style={{ color: 'var(--muted)' }}>{k}</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart2 size={16} color="var(--accent)" />
              Balance Sheet & Ratios
            </div>
            {[
              ['Return on Equity', data.roe],
              ['Debt / Equity', data.debtEquity],
              ['Current Ratio', data.currentRatio],
              ['P/E Ratio', String(data.pe)],
              ['EPS (TTM)', `$${data.eps}`],
              ['Beta (5Y)', String(data.beta)],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
                <span style={{ color: 'var(--muted)' }}>{k}</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Analyst */}
      {activeTab === 'analyst' && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 20 }}>Analyst Ratings — {selected.ticker}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
            <div style={{ textAlign: 'center', padding: 20, background: 'rgba(22,163,74,0.08)', borderRadius: 8, border: '1px solid rgba(22,163,74,0.2)' }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--green)' }}>{data.buyCount}</div>
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>Buy / Strong Buy</div>
            </div>
            <div style={{ textAlign: 'center', padding: 20, background: 'rgba(245,158,11,0.08)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)' }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: '#f59e0b' }}>{data.holdCount}</div>
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>Hold / Neutral</div>
            </div>
            <div style={{ textAlign: 'center', padding: 20, background: 'rgba(220,38,38,0.08)', borderRadius: 8, border: '1px solid rgba(220,38,38,0.2)' }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--red)' }}>{data.sellCount}</div>
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>Sell / Strong Sell</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'var(--bg)', borderRadius: 8 }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Consensus Rating</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{data.analystRating}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>12-Month Price Target</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>${data.targetPrice.toFixed(2)}</div>
              <div style={{ fontSize: 13, color: data.targetPrice > data.price ? 'var(--green)' : 'var(--red)' }}>
                {data.targetPrice > data.price ? '▲' : '▼'} {Math.abs((data.targetPrice - data.price) / data.price * 100).toFixed(1)}% from current
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: News */}
      {activeTab === 'news' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(data.relatedNews.length > 0 ? data.relatedNews : [
            { headline: `No recent news found for ${selected.ticker}`, time: 'N/A', sentiment: 'neutral' },
          ]).map((n: any, i: number) => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>{n.headline}</p>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>{n.time}</div>
              </div>
              <span style={{
                padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                background: n.sentiment === 'bullish' ? 'rgba(22,163,74,0.12)' : n.sentiment === 'bearish' ? 'rgba(220,38,38,0.12)' : 'var(--border)',
                color: n.sentiment === 'bullish' ? 'var(--green)' : n.sentiment === 'bearish' ? 'var(--red)' : 'var(--muted)',
              }}>{n.sentiment}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
