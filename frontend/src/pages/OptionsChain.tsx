/**
 * Options Chain Page — wraps the OptionsChain panel for full-page view
 * Route: /options
 */
import { useState } from 'react';
import { OptionsChain } from '../components/panels/OptionsChain';
import { YieldCurve } from '../components/panels/YieldCurve';

const SYMBOLS = ['AAPL', 'AMZN', 'TSLA', 'SPY', 'QQQ', 'NVDA', 'MSFT', 'BTC-USD', 'ETH-USD'];

export default function OptionsChainPage() {
  const [symbol, setSymbol] = useState('SPY');
  const [activeTab, setActiveTab] = useState<'options' | 'yield'>('options');

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Options & Derivatives</h1>
          <p className="text-sm text-slate-500 mt-0.5">Options chain, IV skew, max pain, unusual flow · Yield curve & inversion</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 font-medium"
          >
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {([['options', 'Options Chain'], ['yield', 'Yield Curve']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-[#0a0b0f] rounded-xl p-4 min-h-[600px]">
        {activeTab === 'options' && <OptionsChain symbol={symbol} />}
        {activeTab === 'yield' && <YieldCurve />}
      </div>
    </div>
  );
}
