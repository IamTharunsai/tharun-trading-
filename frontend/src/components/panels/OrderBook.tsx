import { useState } from 'react';
import { MarketPanel } from './MarketPanel';
export function OrderBook() {
  const [symbol, setSymbol] = useState('');
  const [view, setView] = useState('book');
  return <MarketPanel title="Order book" description="Level 2 quotes, market depth and the transaction tape require a connected exchange feed.">
    <label className="text-sm">Instrument<input className="block min-h-11 border rounded-lg px-2 mt-1 max-w-full" placeholder="Symbol or pair" value={symbol} onChange={e => setSymbol(e.target.value)} /></label>
    <div className="flex gap-2 my-3" role="group" aria-label="Order book view">{[['book','Level 2 book'],['depth','Depth'],['tape','Tape']].map(([value,label]) => <button key={value} aria-pressed={view === value} className={`min-h-11 px-3 rounded-lg border text-sm ${view === value ? 'bg-slate-100 border-slate-500' : 'border-slate-300'}`} onClick={() => setView(value)}>{label}</button>)}</div>
    <p role="status" className="text-sm text-slate-700">{view === 'book' ? 'Level 2 order book' : view === 'depth' ? 'Market depth' : 'Transaction tape'}{symbol.trim() ? ` for ${symbol.trim()}` : ''} is unavailable. No exchange depth feed is connected to this panel.</p>
    <p className="mt-3 text-sm text-slate-600">A last-trade price cannot establish bid/ask sizes, queue counts or executed transactions. No simulated activity is displayed.</p>
  </MarketPanel>;
}
export default OrderBook;