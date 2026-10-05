/**
 * INTEGRATION: FinceptTerminal → APEX
 * Macro Dashboard — economic indicators, global markets, sector heatmap
 *
 * FinceptTerminal ref: https://github.com/Fincept-Corporation/FinceptTerminal
 * APEX file: frontend/src/pages/MacroDashboard.tsx
 *
 * Shows:
 * - Key macro indicators: CPI, GDP, unemployment, Fed rate, M2 money supply
 * - Global index performance (US, Europe, Asia)
 * - Treasury yields (live from YieldCurve panel)
 * - Economic calendar events
 * - Sector ETF performance heatmap
 * - Dollar Index (DXY), Gold, Oil
 * - VIX fear & greed
 */

import { useState, useEffect } from 'react';
import { YieldCurve } from '../components/panels/YieldCurve';
import { EconomicCalendar } from '../components/panels/EconomicCalendar';
import { SectorHeatmap } from '../components/panels/SectorHeatmap';
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle } from 'lucide-react';

interface MacroIndicator {
  label: string;
  value: string;
  change: string;
  direction: 'up' | 'down' | 'flat';
  signal: 'bullish' | 'bearish' | 'neutral';
  description: string;
}

interface GlobalIndex {
  name: string;
  symbol: string;
  value: number;
  change: number;
  pct: number;
  region: string;
}

interface Commodity {
  name: string;
  value: number;
  change: number;
  pct: number;
  unit: string;
}

function generateMacroData() {
  const indicators: MacroIndicator[] = [
    { label: 'CPI YoY', value: '3.2%', change: '-0.1%', direction: 'down', signal: 'bullish', description: 'Inflation cooling toward Fed target' },
    { label: 'Core PCE', value: '2.8%', change: '+0.1%', direction: 'up', signal: 'bearish', description: "Fed's preferred inflation gauge" },
    { label: 'Fed Funds Rate', value: '5.25-5.50%', change: '0%', direction: 'flat', signal: 'neutral', description: 'Held steady, cuts expected H1 2027' },
    { label: 'GDP Growth QoQ', value: '+2.8%', change: '+0.3%', direction: 'up', signal: 'bullish', description: 'US economy remains resilient' },
    { label: 'Unemployment', value: '4.1%', change: '+0.1%', direction: 'up', signal: 'neutral', description: 'Labor market softening slightly' },
    { label: 'ISM Manufacturing', value: '47.2', change: '-1.4', direction: 'down', signal: 'bearish', description: 'Contraction territory (<50)' },
    { label: 'ISM Services', value: '54.9', change: '+2.1', direction: 'up', signal: 'bullish', description: 'Services sector expanding' },
    { label: '10Y-2Y Spread', value: '-15bps', change: '+5bps', direction: 'up', signal: 'neutral', description: 'Yield curve slightly inverted' },
    { label: 'M2 Money Supply', value: '$21.1T', change: '+0.4%', direction: 'up', signal: 'neutral', description: 'Money supply recovering from decline' },
    { label: 'Consumer Sentiment', value: '68.9', change: '-2.3', direction: 'down', signal: 'bearish', description: 'University of Michigan survey' },
    { label: 'Retail Sales MoM', value: '+0.3%', change: '-0.1%', direction: 'down', signal: 'neutral', description: 'Consumer spending holding up' },
    { label: 'Housing Starts', value: '1.35M', change: '-3.2%', direction: 'down', signal: 'bearish', description: 'High mortgage rates weighing' },
  ];

  const globalIndices: GlobalIndex[] = [
    { name: 'S&P 500', symbol: 'SPX', value: 5748, change: 23.4, pct: 0.41, region: 'US' },
    { name: 'NASDAQ 100', symbol: 'NDX', value: 20142, change: 87.2, pct: 0.44, region: 'US' },
    { name: 'Dow Jones', symbol: 'DJIA', value: 42850, change: -45.3, pct: -0.11, region: 'US' },
    { name: 'Russell 2000', symbol: 'RUT', value: 2198, change: -12.7, pct: -0.58, region: 'US' },
    { name: 'FTSE 100', symbol: 'UKX', value: 8245, change: 38.1, pct: 0.46, region: 'Europe' },
    { name: 'DAX', symbol: 'DAX', value: 19380, change: -92.3, pct: -0.47, region: 'Europe' },
    { name: 'CAC 40', symbol: 'CAC', value: 7580, change: 21.4, pct: 0.28, region: 'Europe' },
    { name: 'Nikkei 225', symbol: 'NKY', value: 38420, change: 234.5, pct: 0.61, region: 'Asia' },
    { name: 'Hang Seng', symbol: 'HSI', value: 21850, change: 312.8, pct: 1.45, region: 'Asia' },
    { name: 'Shanghai Comp', symbol: 'SHCOMP', value: 3485, change: -23.6, pct: -0.67, region: 'Asia' },
    { name: 'Nifty 50', symbol: 'NIFTY', value: 25120, change: 89.4, pct: 0.36, region: 'Asia' },
    { name: 'ASX 200', symbol: 'AS51', value: 8180, change: 42.1, pct: 0.52, region: 'Asia' },
  ];

  const commodities: Commodity[] = [
    { name: 'Gold', value: 2648, change: 12.4, pct: 0.47, unit: '$/oz' },
    { name: 'Silver', value: 31.24, change: 0.38, pct: 1.23, unit: '$/oz' },
    { name: 'WTI Crude', value: 72.45, change: -1.23, pct: -1.67, unit: '$/bbl' },
    { name: 'Brent Crude', value: 75.82, change: -0.98, pct: -1.28, unit: '$/bbl' },
    { name: 'Natural Gas', value: 2.84, change: 0.12, pct: 4.41, unit: '$/MMBtu' },
    { name: 'Copper', value: 4.42, change: 0.05, pct: 1.14, unit: '$/lb' },
    { name: 'DXY (Dollar)', value: 102.34, change: -0.28, pct: -0.27, unit: 'index' },
    { name: 'VIX', value: 18.42, change: 1.34, pct: 7.84, unit: 'index' },
    { name: 'Bitcoin', value: 62840, change: 1240, pct: 2.01, unit: 'USD' },
    { name: 'Ethereum', value: 2485, change: 67, pct: 2.77, unit: 'USD' },
  ];

  return { indicators, globalIndices, commodities };
}

function PctBadge({ pct }: { pct: number }) {
  const pos = pct >= 0;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-mono font-semibold ${pos ? 'text-emerald-600' : 'text-red-600'}`}>
      {pos ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {pos ? '+' : ''}{pct.toFixed(2)}%
    </span>
  );
}

function SignalBadge({ signal }: { signal: 'bullish' | 'bearish' | 'neutral' }) {
  return (
    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
      signal === 'bullish' ? 'bg-emerald-100 text-emerald-700' :
      signal === 'bearish' ? 'bg-red-100 text-red-700' :
      'bg-slate-100 text-slate-500'
    }`}>{signal.toUpperCase()}</span>
  );
}

const REGIONS = ['ALL', 'US', 'Europe', 'Asia'];

export default function MacroDashboard() {
  const [data] = useState(() => generateMacroData());
  const [region, setRegion] = useState('ALL');
  const [activeTab, setActiveTab] = useState<'macro' | 'global' | 'yield' | 'calendar' | 'sectors'>('macro');
  const [lastUpdate] = useState(new Date().toLocaleTimeString());

  const filteredIndices = region === 'ALL'
    ? data.globalIndices
    : data.globalIndices.filter(i => i.region === region);

  const advancers = data.globalIndices.filter(i => i.pct > 0).length;
  const decliners = data.globalIndices.filter(i => i.pct < 0).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Macro Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Global economic indicators · FinceptTerminal integration
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live · {lastUpdate}
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-emerald-600 font-bold">{advancers}▲</span>
            <span className="text-slate-400">/</span>
            <span className="text-red-600 font-bold">{decliners}▼</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {([
          ['macro', 'Key Indicators'],
          ['global', 'Global Indices'],
          ['yield', 'Yield Curve'],
          ['calendar', 'Econ Calendar'],
          ['sectors', 'Sector Map'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >{label}</button>
        ))}
      </div>

      {/* --- Key Indicators --- */}
      {activeTab === 'macro' && (
        <div>
          {/* Commodities strip */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            {data.commodities.map(c => (
              <div key={c.name} className="flex-shrink-0 bg-white border border-slate-200 rounded-lg px-3 py-2 min-w-[110px]">
                <div className="text-[10px] text-slate-500 font-mono">{c.name}</div>
                <div className="text-sm font-bold text-slate-900 font-mono">
                  {c.name === 'Bitcoin' ? `$${(c.value / 1000).toFixed(1)}k` :
                   c.name === 'Ethereum' ? `$${c.value.toFixed(0)}` :
                   c.value.toFixed(2)}
                </div>
                <PctBadge pct={c.pct} />
              </div>
            ))}
          </div>

          {/* Indicators grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.indicators.map(ind => (
              <div key={ind.label} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wide">{ind.label}</div>
                    <div className="text-2xl font-bold text-slate-900 font-mono mt-0.5">{ind.value}</div>
                  </div>
                  <SignalBadge signal={ind.signal} />
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono font-semibold flex items-center gap-1 ${
                    ind.direction === 'up' ? 'text-emerald-600' : ind.direction === 'down' ? 'text-red-600' : 'text-slate-500'
                  }`}>
                    {ind.direction === 'up' ? <TrendingUp size={10} /> : ind.direction === 'down' ? <TrendingDown size={10} /> : <Minus size={10} />}
                    {ind.change}
                  </span>
                  <span className="text-[10px] text-slate-400 text-right max-w-[60%] leading-tight">{ind.description}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Fed watch */}
          <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-mono font-bold text-slate-500 uppercase tracking-wide mb-3">Fed Rate Cut Probability (CME FedWatch)</div>
            <div className="flex gap-4 flex-wrap">
              {[
                { meeting: 'Nov 2026', cut25: 32, cut50: 8, hold: 60 },
                { meeting: 'Dec 2026', cut25: 45, cut50: 15, hold: 40 },
                { meeting: 'Jan 2027', cut25: 55, cut50: 22, hold: 23 },
                { meeting: 'Mar 2027', cut25: 62, cut50: 28, hold: 10 },
              ].map(m => (
                <div key={m.meeting} className="flex-1 min-w-[140px]">
                  <div className="text-[10px] text-slate-500 font-mono mb-1">{m.meeting}</div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${m.hold}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-slate-600 w-8">Hold {m.hold}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${m.cut25}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-slate-600 w-8">-25bp {m.cut25}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${m.cut50}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-slate-600 w-8">-50bp {m.cut50}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --- Global Indices --- */}
      {activeTab === 'global' && (
        <div>
          <div className="flex gap-1 mb-4">
            {REGIONS.map(r => (
              <button key={r} onClick={() => setRegion(r)}
                className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                  region === r ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >{r}</button>
            ))}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-[11px] font-mono text-slate-500">INDEX</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-mono text-slate-500">REGION</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-mono text-slate-500">VALUE</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-mono text-slate-500">CHANGE</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-mono text-slate-500">% CHG</th>
                </tr>
              </thead>
              <tbody>
                {filteredIndices.map((idx, i) => (
                  <tr key={idx.symbol} className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-900">{idx.name}</div>
                      <div className="text-[10px] font-mono text-slate-400">{idx.symbol}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{idx.region}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900">
                      {idx.value.toLocaleString()}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono font-semibold ${idx.change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {idx.change >= 0 ? '+' : ''}{idx.change.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <PctBadge pct={idx.pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- Yield Curve --- */}
      {activeTab === 'yield' && (
        <div className="bg-[#0a0b0f] rounded-xl p-4" style={{ minHeight: 300 }}>
          <YieldCurve />
        </div>
      )}

      {/* --- Econ Calendar --- */}
      {activeTab === 'calendar' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 min-h-[400px]">
          <EconomicCalendar />
        </div>
      )}

      {/* --- Sectors --- */}
      {activeTab === 'sectors' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 min-h-[400px]">
          <SectorHeatmap />
        </div>
      )}
    </div>
  );
}
