/**
 * INTEGRATION: OpenTerminal → APEX
 * ⌘K Command Palette — global search, quick navigation, agent actions
 *
 * OpenTerminal ref: https://github.com/ErTasselli/OpenTerminal
 * Feature: keyboard-driven command palette for symbols, pages, agent actions
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, TrendingUp, Bot, BarChart2, Activity, Layers,
  Radio, BookOpen, Globe2, Zap, ArrowRight, Command, Hash } from 'lucide-react';

interface PaletteItem {
  id: string;
  type: 'page' | 'symbol' | 'action' | 'agent';
  label: string;
  description?: string;
  icon: React.FC<any>;
  action: () => void;
  keywords?: string[];
}

const POPULAR_SYMBOLS = [
  'SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META',
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD',
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const go = useCallback((path: string) => {
    navigate(path);
    onClose();
    setQuery('');
  }, [navigate, onClose]);

  const STATIC_ITEMS: PaletteItem[] = [
    { id: 'dashboard', type: 'page', label: 'Overview Cockpit', description: 'Main dashboard', icon: BarChart2, action: () => go('/'), keywords: ['home', 'overview', 'dashboard'] },
    { id: 'charts', type: 'page', label: 'Live Charts Lab', description: 'Real-time candlestick charts', icon: TrendingUp, action: () => go('/charts'), keywords: ['chart', 'candle', 'price'] },
    { id: 'options', type: 'page', label: 'Options Chain', description: 'Strike ladder, IV skew, max pain', icon: Layers, action: () => go('/options'), keywords: ['options', 'puts', 'calls', 'iv', 'delta'] },
    { id: 'tearsheet', type: 'page', label: 'Performance Tearsheet', description: 'Sharpe, drawdown, monthly heatmap', icon: Activity, action: () => go('/tearsheet'), keywords: ['sharpe', 'sortino', 'drawdown', 'performance', 'quantstats'] },
    { id: 'analytics', type: 'page', label: 'BQuant Analytics', description: 'P&L analysis and statistics', icon: BarChart2, action: () => go('/analytics'), keywords: ['pnl', 'analytics', 'stats'] },
    { id: 'agents', type: 'page', label: 'Agent Council', description: '25-agent autonomous trading', icon: Bot, action: () => go('/agents'), keywords: ['agent', 'ai', 'autonomous'] },
    { id: 'debate', type: 'page', label: 'Live Debate Room', description: 'Bull vs Bear AI agents', icon: Bot, action: () => go('/agents/debate-room'), keywords: ['debate', 'bull', 'bear'] },
    { id: 'macro', type: 'page', label: 'Macro Dashboard', description: 'FinceptTerminal macro overview', icon: Globe2, action: () => go('/macro'), keywords: ['macro', 'economy', 'gdp', 'cpi', 'fed'] },
    { id: 'crypto', type: 'page', label: 'Crypto Strategy Lab', description: 'freqtrade backtesting & signals', icon: Zap, action: () => go('/crypto-strategy'), keywords: ['crypto', 'freqtrade', 'backtest', 'strategy'] },
    { id: 'forecaster', type: 'page', label: 'Price Forecaster', description: 'Kronos ML time-series predictions', icon: TrendingUp, action: () => go('/forecaster'), keywords: ['forecast', 'predict', 'kronos', 'ml'] },
    { id: 'multiagent', type: 'page', label: 'Multi-Agent Research', description: 'TradingAgents fundamental + sentiment', icon: Bot, action: () => go('/multi-agent'), keywords: ['tradingagents', 'fundamental', 'sentiment', 'research'] },
    { id: 'altdata', type: 'page', label: 'Alternative Data Radar', description: 'Satellite, web traffic, social signals', icon: Radio, action: () => go('/alternative-data'), keywords: ['alt data', 'satellite', 'reddit', 'twitter'] },
    { id: 'polymarket', type: 'page', label: 'Polymarket Alpha', description: 'Prediction markets trading', icon: Zap, action: () => go('/polymarket'), keywords: ['polymarket', 'prediction', 'market'] },
    { id: 'journal', type: 'page', label: 'Trade Journal', description: 'Log and review your trades', icon: BookOpen, action: () => go('/journal'), keywords: ['journal', 'log', 'review'] },
    { id: 'stocks', type: 'page', label: 'Stock Universe', description: 'Screen and discover stocks', icon: Globe2, action: () => go('/stocks'), keywords: ['screener', 'stocks', 'screen'] },
    { id: 'portfolio', type: 'page', label: 'Portfolio & Risk', description: 'Positions and risk metrics', icon: BarChart2, action: () => go('/portfolio'), keywords: ['portfolio', 'positions', 'risk', 'var'] },
    // Agent actions
    { id: 'chat', type: 'agent', label: 'Chat with AI', description: 'Instant Bloomberg chat', icon: Bot, action: () => go('/agents/chat'), keywords: ['chat', 'ask', 'question', 'ai', 'bloomberg'] },
    { id: 'monitor', type: 'agent', label: 'Agent Monitor', description: 'Live agent activity feed', icon: Bot, action: () => go('/agents/monitor'), keywords: ['monitor', 'activity', 'log'] },
  ];

  // Combine static items with symbol search
  const symbolItems: PaletteItem[] = POPULAR_SYMBOLS
    .filter(s => query.length === 0 || s.toLowerCase().includes(query.toLowerCase()))
    .map(sym => ({
      id: `sym-${sym}`,
      type: 'symbol' as const,
      label: sym,
      description: 'View chart',
      icon: Hash,
      action: () => { go(`/charts?symbol=${sym}`); },
      keywords: [sym.toLowerCase()],
    }));

  const filtered = query.trim() === ''
    ? [...STATIC_ITEMS.slice(0, 8), ...symbolItems.slice(0, 5)]
    : [
        ...STATIC_ITEMS.filter(item =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.description?.toLowerCase().includes(query.toLowerCase()) ||
          item.keywords?.some(k => k.includes(query.toLowerCase()))
        ),
        ...symbolItems.filter(s =>
          s.label.toLowerCase().startsWith(query.toLowerCase())
        ),
      ];

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIdx(0);
    }
  }, [open]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[selectedIdx]) { filtered[selectedIdx].action(); }
    if (e.key === 'Escape') { onClose(); setQuery(''); }
  }, [filtered, selectedIdx, onClose]);

  if (!open) return null;

  const typeColor: Record<string, string> = {
    page: 'bg-blue-100 text-blue-700',
    symbol: 'bg-emerald-100 text-emerald-700',
    action: 'bg-purple-100 text-purple-700',
    agent: 'bg-amber-100 text-amber-700',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      onClick={() => { onClose(); setQuery(''); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <Search size={16} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search pages, symbols, agents…"
            className="flex-1 text-sm text-slate-900 placeholder-slate-400 outline-none bg-transparent"
          />
          <span className="flex items-center gap-1 text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">ESC</span>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">No results for "{query}"</div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    idx === selectedIdx ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                    idx === selectedIdx ? 'bg-blue-100' : 'bg-slate-100'
                  }`}>
                    <Icon size={13} className={idx === selectedIdx ? 'text-blue-600' : 'text-slate-500'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{item.label}</div>
                    {item.description && (
                      <div className="text-xs text-slate-500 truncate">{item.description}</div>
                    )}
                  </div>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${typeColor[item.type]}`}>
                    {item.type}
                  </span>
                  {idx === selectedIdx && <ArrowRight size={12} className="text-blue-400 flex-shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-4 text-[10px] font-mono text-slate-400">
          <span className="flex items-center gap-1"><Command size={9} /> K to open</span>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>ESC close</span>
        </div>
      </div>
    </div>
  );
}
