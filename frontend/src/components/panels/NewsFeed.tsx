/**
 * INTEGRATION: OpenTerminal + FinceptTerminal → APEX
 * News Feed & Sentiment Panel — real-time news with AI sentiment scoring
 *
 * OpenTerminal ref: https://github.com/ErTasselli/OpenTerminal
 * FinceptTerminal ref: https://github.com/Fincept-Corporation/FinceptTerminal
 * APEX file location: frontend/src/components/panels/NewsFeed.tsx
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';

interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number;   // -1 to +1
  tickers: string[];
  category: string;
  impactLevel: 'breaking' | 'high' | 'medium' | 'low';
  aiAnnotation?: string;
}

const SENTIMENT_CONFIG = {
  bullish: { color: '#22c55e', label: '▲ Bullish', bg: 'rgba(34,197,94,0.08)' },
  bearish: { color: '#ef4444', label: '▼ Bearish', bg: 'rgba(239,68,68,0.08)' },
  neutral: { color: '#94a3b8', label: '● Neutral', bg: 'rgba(148,163,184,0.05)' },
};

const IMPACT_CONFIG = {
  breaking: { color: '#f97316', border: '#f97316', label: '⚡ BREAKING' },
  high:     { color: '#ef4444', border: '#ef444440', label: '🔴 HIGH' },
  medium:   { color: '#f59e0b', border: '#f59e0b40', label: '🟡 MEDIUM' },
  low:      { color: '#64748b', border: '#64748b30', label: '⚪ LOW' },
};

// Simulated live news feed — in production wire to /api/market/news
const MOCK_NEWS: NewsItem[] = [
  {
    id: '1',
    headline: 'Fed Signals Slower Rate-Cut Pace as Inflation Proves Sticky',
    summary: 'Federal Reserve officials indicated a more cautious approach to cutting interest rates after September CPI data came in above expectations, with core inflation remaining elevated at 3.3% YoY.',
    source: 'Bloomberg',
    url: '#',
    publishedAt: new Date(Date.now() - 12 * 60000).toISOString(),
    sentiment: 'bearish',
    sentimentScore: -0.62,
    tickers: ['TLT', 'SPY', 'QQQ', 'XLF'],
    category: 'monetary-policy',
    impactLevel: 'breaking',
    aiAnnotation: 'Hawkish surprise — bond yields spiking, rate-sensitive sectors under pressure. Watch XLF, XLRE, TLT.',
  },
  {
    id: '2',
    headline: 'NVIDIA Reports Record Data Center Revenue, AI Demand Surges',
    summary: 'NVIDIA Q3 revenue hit $35.1B, beating estimates by 8%. Data center segment grew 112% YoY driven by Blackwell GPU orders. CEO Jensen Huang says supply constraints will ease in Q1 2025.',
    source: 'Reuters',
    url: '#',
    publishedAt: new Date(Date.now() - 28 * 60000).toISOString(),
    sentiment: 'bullish',
    sentimentScore: 0.84,
    tickers: ['NVDA', 'AMD', 'SMCI', 'QQQ'],
    category: 'earnings',
    impactLevel: 'high',
    aiAnnotation: 'Semiconductor sector catalyst. NVDA likely gaps up 5-8%. AMD, SMCI positive sympathy plays.',
  },
  {
    id: '3',
    headline: 'China PMI Beats Expectations at 50.1, Stimulus Takes Hold',
    summary: 'China Manufacturing PMI expanded for the first time in 6 months in September, signaling the government\'s $1.4T stimulus package is beginning to show results in industrial activity.',
    source: 'WSJ',
    url: '#',
    publishedAt: new Date(Date.now() - 45 * 60000).toISOString(),
    sentiment: 'bullish',
    sentimentScore: 0.51,
    tickers: ['FXI', 'KWEB', 'BHP', 'FCX', 'CLF'],
    category: 'macro',
    impactLevel: 'high',
    aiAnnotation: 'EM and commodity stocks benefit. Watch copper (FCX) and materials (XLB) for follow-through.',
  },
  {
    id: '4',
    headline: 'Tesla Cybertruck Recall Expands to 27,000 Units Over Safety Defect',
    summary: 'NHTSA announced an expanded recall of Tesla Cybertruck vehicles due to a potential accelerator pedal issue. Tesla shares fell 2.3% in pre-market trading.',
    source: 'CNBC',
    url: '#',
    publishedAt: new Date(Date.now() - 67 * 60000).toISOString(),
    sentiment: 'bearish',
    sentimentScore: -0.38,
    tickers: ['TSLA'],
    category: 'company-news',
    impactLevel: 'medium',
    aiAnnotation: 'Company-specific negative. Limited sector contagion. Watch TSLA support at $245.',
  },
  {
    id: '5',
    headline: 'Oil Drops 3% as OPEC+ Confirms Supply Increase for December',
    summary: 'WTI crude fell below $70/bbl after OPEC+ confirmed it will proceed with planned supply increases of 180,000 bpd in December despite recent price weakness.',
    source: 'FT',
    url: '#',
    publishedAt: new Date(Date.now() - 89 * 60000).toISOString(),
    sentiment: 'bearish',
    sentimentScore: -0.45,
    tickers: ['XOM', 'CVX', 'OXY', 'XLE', 'USO'],
    category: 'commodities',
    impactLevel: 'high',
    aiAnnotation: 'Energy sector headwind. Integrated oils (XOM, CVX) less affected than E&Ps. Airlines benefit from lower jet fuel costs.',
  },
  {
    id: '6',
    headline: 'Bitcoin Climbs Above $62,000 as ETF Inflows Hit 3-Month High',
    summary: 'Spot Bitcoin ETFs saw $420M in net inflows on Thursday, the highest daily total since July. BlackRock\'s IBIT led with $218M. BTC approached key resistance at $63,000.',
    source: 'CoinDesk',
    url: '#',
    publishedAt: new Date(Date.now() - 110 * 60000).toISOString(),
    sentiment: 'bullish',
    sentimentScore: 0.71,
    tickers: ['BTC-USD', 'IBIT', 'MSTR', 'COIN'],
    category: 'crypto',
    impactLevel: 'medium',
    aiAnnotation: 'Crypto risk-on. MSTR, COIN likely positive sympathy. ETF inflow trend accelerating — bullish signal.',
  },
  {
    id: '7',
    headline: 'JPMorgan Upgrades S&P 500 Year-End Target to 5,800',
    summary: 'JPMorgan\'s equity research team raised their 2026 S&P 500 year-end target from 5,500 to 5,800, citing better-than-expected earnings growth and continued AI spending tailwinds.',
    source: 'Barron\'s',
    url: '#',
    publishedAt: new Date(Date.now() - 145 * 60000).toISOString(),
    sentiment: 'bullish',
    sentimentScore: 0.55,
    tickers: ['SPY', 'VOO', 'IVV'],
    category: 'analysis',
    impactLevel: 'medium',
    aiAnnotation: 'Broad market positive sentiment. Institutional upgrades of this size can be self-fulfilling near-term.',
  },
  {
    id: '8',
    headline: 'US Jobless Claims Rise to 231K, Slightly Above Estimate of 228K',
    summary: 'Initial unemployment benefit claims for the week ending Oct 1 came in at 231,000, slightly above the consensus estimate of 228,000 but still near historically low levels.',
    source: 'Labor Dept.',
    url: '#',
    publishedAt: new Date(Date.now() - 180 * 60000).toISOString(),
    sentiment: 'neutral',
    sentimentScore: -0.08,
    tickers: ['SPY', 'IWM'],
    category: 'employment',
    impactLevel: 'low',
    aiAnnotation: 'In-line with trend, minimal market impact. Labor market remains resilient despite slight uptick.',
  },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const CATEGORIES = ['all', 'earnings', 'macro', 'monetary-policy', 'commodities', 'crypto', 'company-news', 'analysis', 'employment'];

export const NewsFeed: React.FC = () => {
  const [news,     setNews]     = useState<NewsItem[]>(MOCK_NEWS);
  const [loading,  setLoading]  = useState(false);
  const [filter,   setFilter]   = useState<'all' | 'bullish' | 'bearish' | 'neutral'>('all');
  const [category, setCategory] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tick,     setTick]     = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refresh timestamps every 30s
  useEffect(() => {
    timerRef.current = setInterval(() => setTick(t => t + 1), 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const loadLive = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('apex_token');
      const res = await fetch('/api/market/news?limit=30', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.news) && data.news.length > 0) {
          // Map API news to our format
          const mapped: NewsItem[] = data.news.map((n: any) => ({
            id: n.id || String(Math.random()),
            headline: n.headline || n.title,
            summary: n.summary || n.description || '',
            source: n.source || 'APEX',
            url: n.url || '#',
            publishedAt: n.publishedAt || n.createdAt || new Date().toISOString(),
            sentiment: n.sentiment || 'neutral',
            sentimentScore: n.sentimentScore || 0,
            tickers: n.tickers || n.symbols || [],
            category: n.category || 'general',
            impactLevel: n.impactLevel || 'medium',
            aiAnnotation: n.aiAnnotation,
          }));
          setNews(mapped);
        }
      }
    } catch {
      // Keep mock data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLive(); }, [loadLive]);

  const filtered = news.filter(n => {
    const sentOk = filter === 'all' || n.sentiment === filter;
    const catOk  = category === 'all' || n.category === category;
    return sentOk && catOk;
  });

  // Aggregate sentiment for the feed
  const bullishCount = news.filter(n => n.sentiment === 'bullish').length;
  const bearishCount = news.filter(n => n.sentiment === 'bearish').length;
  const overallBias  = bullishCount > bearishCount ? 'bullish' : bearishCount > bullishCount ? 'bearish' : 'neutral';
  const avgScore     = news.reduce((s, n) => s + n.sentimentScore, 0) / news.length;

  return (
    <div style={{
      background: 'var(--panel-bg, #0f0f0f)',
      border: '1px solid var(--border, #1e2a3a)',
      borderRadius: 12,
      padding: 20,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
      color: 'var(--text, #e2e8f0)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>📰</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: 0.5 }}>News & Sentiment</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim, #64748b)' }}>Live Feed · AI Sentiment Scoring</div>
          </div>
        </div>
        <button onClick={loadLive} disabled={loading} style={{
          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
          background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
          border: '1px solid rgba(59,130,246,0.3)',
          opacity: loading ? 0.5 : 1,
        }}>
          {loading ? '⟳' : '↻'} Refresh
        </button>
      </div>

      {/* Sentiment summary bar */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--border, #1e2a3a)',
        borderRadius: 8, padding: '10px 14px',
        display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', gap: 14 }}>
          <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 13 }}>▲ {bullishCount}</span>
          <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 13 }}>▼ {bearishCount}</span>
          <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: 13 }}>● {news.length - bullishCount - bearishCount}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim, #64748b)', marginLeft: 'auto' }}>
          Avg score: <b style={{ color: avgScore > 0.1 ? '#22c55e' : avgScore < -0.1 ? '#ef4444' : '#94a3b8' }}>
            {avgScore >= 0 ? '+' : ''}{(avgScore * 100).toFixed(0)}
          </b>
        </div>
        <div style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
          background: SENTIMENT_CONFIG[overallBias].bg, color: SENTIMENT_CONFIG[overallBias].color,
        }}>
          {SENTIMENT_CONFIG[overallBias].label}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['all', 'bullish', 'bearish', 'neutral'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '3px 9px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer',
            background: filter === f ? (f === 'bullish' ? '#22c55e' : f === 'bearish' ? '#ef4444' : f === 'neutral' ? '#64748b' : '#3b82f6') : 'transparent',
            color: filter === f ? '#fff' : 'var(--text-dim, #64748b)',
            border: '1px solid var(--border, #1e2a3a)',
            textTransform: 'capitalize',
          }}>{f}</button>
        ))}
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{
            background: 'var(--surface, #141a24)', color: 'var(--text-dim, #64748b)',
            border: '1px solid var(--border, #1e2a3a)', borderRadius: 4,
            padding: '3px 6px', fontSize: 10, cursor: 'pointer',
          }}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c === 'all' ? 'All Topics' : c.replace(/-/g, ' ')}</option>)}
        </select>
      </div>

      {/* News list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-dim, #64748b)', fontSize: 13 }}>
            No news matching current filters.
          </div>
        ) : filtered.map(item => {
          const sent = SENTIMENT_CONFIG[item.sentiment];
          const imp  = IMPACT_CONFIG[item.impactLevel];
          const isOpen = expanded === item.id;

          return (
            <div
              key={item.id}
              onClick={() => setExpanded(isOpen ? null : item.id)}
              style={{
                background: isOpen ? sent.bg : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isOpen ? (item.sentiment === 'bullish' ? '#22c55e40' : item.sentiment === 'bearish' ? '#ef444440' : '#64748b30') : 'var(--border, #1e2a3a)'}`,
                borderLeft: `3px solid ${sent.color}`,
                borderRadius: 8, padding: '10px 14px',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {/* Top row */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                {item.impactLevel === 'breaking' && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 3,
                    background: '#f97316', color: '#fff', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>⚡ BREAKING</span>
                )}
                <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.4, flex: 1 }}>
                  {item.headline}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-dim, #64748b)', whiteSpace: 'nowrap' }}>
                    {timeAgo(item.publishedAt)}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: sent.color }}>
                    {item.sentimentScore >= 0 ? '+' : ''}{(item.sentimentScore * 100).toFixed(0)}
                  </span>
                </div>
              </div>

              {/* Meta row */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: 'var(--text-dim, #64748b)' }}>{item.source}</span>
                {item.tickers.slice(0, 4).map(t => (
                  <span key={t} style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                    background: 'rgba(59,130,246,0.12)', color: '#3b82f6',
                  }}>{t}</span>
                ))}
                <span style={{ fontSize: 9, fontWeight: 600, color: sent.color, marginLeft: 'auto' }}>
                  {sent.label}
                </span>
              </div>

              {/* Expanded */}
              {isOpen && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, margin: '0 0 10px 0' }}>
                    {item.summary}
                  </p>
                  {item.aiAnnotation && (
                    <div style={{
                      background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
                      borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#a78bfa', lineHeight: 1.5,
                    }}>
                      <span style={{ fontWeight: 700, marginRight: 6 }}>🤖 APEX Analysis:</span>
                      {item.aiAnnotation}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ fontSize: 10, color: 'var(--text-dim, #64748b)', borderTop: '1px solid var(--border, #1e2a3a)', paddingTop: 8 }}>
        OpenTerminal · FinceptTerminal · Sentiment scored by APEX AI · {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
};

export default NewsFeed;
