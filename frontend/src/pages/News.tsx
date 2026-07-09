import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getNews } from '../services/api';
import api from '../services/api';
import { Newspaper, ExternalLink, Globe } from 'lucide-react';
import { format } from 'date-fns';
import LastUpdated from '../components/common/LastUpdated';

interface NewsItem {
  id: string;
  title: string;
  source: string;
  timestamp: number;
  category: 'GEOPOLITICS' | 'CRYPTO' | 'STOCKS' | 'MACROECONOMICS' | 'EMERGENCY';
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  tags: string[];
  summary: string;
}

interface GeopoliticalEvent {
  id: string;
  region: string;
  event: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  affectedAssets: string[];
  timestamp: number;
  source: string;
}

interface MarketSentiment {
  overallSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  positiveNews: number;
  negativeNews: number;
  totalNews: number;
  sentimentRatio: string;
  criticalEvents: number;
}

function MarketNewsTab() {
  const { data: news = [] } = useQuery({ queryKey: ['news'], queryFn: getNews, refetchInterval: 60000 });

  const sentimentColor = (score: number) =>
    score > 0.2 ? 'text-apex-green bg-apex-green/10' :
    score < -0.2 ? 'text-apex-red bg-apex-red/10' :
    'text-apex-muted bg-apex-surface';

  return (
    <div className="space-y-3">
      {news.map((n: any) => (
        <div key={n.id} className="card hover:border-apex-border/80 transition-colors">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                {n.assetsMentioned?.map((a: string) => (
                  <span key={a} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-apex-accent/10 text-apex-accent">{a}</span>
                ))}
                <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${sentimentColor(n.sentimentScore || 0)}`}>
                  {n.sentimentLabel || 'NEUTRAL'} {n.sentimentScore ? `(${n.sentimentScore.toFixed(2)})` : ''}
                </span>
              </div>
              <h3 className="font-sans font-semibold text-sm text-apex-text">{n.headline}</h3>
              {n.summary && <p className="font-sans text-xs text-apex-muted mt-1 leading-relaxed">{n.summary}</p>}
              <div className="flex items-center gap-3 mt-2">
                <span className="font-mono text-[10px] text-apex-muted">{n.source}</span>
                <span className="font-mono text-[10px] text-apex-muted">{n.publishedAt ? format(new Date(n.publishedAt), 'MM/dd HH:mm') : ''}</span>
              </div>
            </div>
            {n.url && (
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-apex-muted hover:text-apex-accent transition-colors flex-shrink-0">
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
      ))}
      {news.length === 0 && <div className="card text-center py-12 font-mono text-xs text-apex-muted">No news articles analyzed yet</div>}
    </div>
  );
}

function GeopoliticsTab() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [events, setEvents] = useState<GeopoliticalEvent[]>([]);
  const [sentiment, setSentiment] = useState<MarketSentiment | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedSentiment, setSelectedSentiment] = useState<string>('ALL');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [newsResponse, eventsResponse, sentimentResponse] = await Promise.all([
          api.get('/monitor/news', { params: { minutes: 120 } }),
          api.get('/monitor/geopolitics', { params: { hours: 24 } }),
          api.get('/monitor/sentiment'),
        ]);
        setNews(newsResponse.data.news || []);
        setEvents(eventsResponse.data.events || []);
        setSentiment(sentimentResponse.data);
      } catch (err) {
        console.error('Failed to fetch data', err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'GEOPOLITICS': return '#C9A24B';
      case 'CRYPTO': return '#12805F';
      case 'STOCKS': return '#C9A24B';
      case 'MACROECONOMICS': return '#12805F';
      case 'EMERGENCY': return '#B0263B';
      default: return '#5B6472';
    }
  };

  const getSentimentEmoji = (s: string) =>
    s === 'POSITIVE' ? '📈' : s === 'NEGATIVE' ? '📉' : s === 'NEUTRAL' ? '➡️' : '❓';

  const getSentimentColor = (s: string) =>
    s === 'POSITIVE' ? '#12805F' : s === 'NEGATIVE' ? '#B0263B' : '#5B6472';

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return '#B0263B';
      case 'HIGH': return '#C9A24B';
      case 'MEDIUM': return '#C9A24B';
      case 'LOW': return '#12805F';
      default: return '#5B6472';
    }
  };

  const filteredNews = news.filter(n => {
    if (selectedCategory !== 'ALL' && n.category !== selectedCategory) return false;
    if (selectedSentiment !== 'ALL' && n.sentiment !== selectedSentiment) return false;
    return true;
  });

  return (
    <div>
      {sentiment && (
        <div style={{
          background: 'var(--apex-surface)',
          border: `2px solid ${getSentimentColor(sentiment.overallSentiment === 'BULLISH' ? 'POSITIVE' : sentiment.overallSentiment === 'BEARISH' ? 'NEGATIVE' : 'NEUTRAL')}`,
          borderRadius: 12,
          padding: 20,
          marginBottom: 20
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            <div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: 'var(--apex-muted)', marginBottom: 8 }}>OVERALL SENTIMENT</div>
              <div style={{ fontSize: 28, fontFamily: 'Manrope', fontWeight: 800, color: getSentimentColor(sentiment.overallSentiment === 'BULLISH' ? 'POSITIVE' : sentiment.overallSentiment === 'BEARISH' ? 'NEGATIVE' : 'NEUTRAL') }}>
                {sentiment.overallSentiment === 'BULLISH' ? '🟢' : sentiment.overallSentiment === 'BEARISH' ? '🔴' : '⚪'}
                {' ' + sentiment.overallSentiment}
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: 'var(--apex-muted)', marginBottom: 8 }}>NEWS BREAKDOWN</div>
              <div style={{ display: 'flex', gap: 20 }}>
                <div>
                  <div style={{ fontFamily: 'Manrope', fontSize: 20, fontWeight: 800, color: '#12805F' }}>{sentiment.positiveNews}</div>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)' }}>Positive</div>
                </div>
                <div>
                  <div style={{ fontFamily: 'Manrope', fontSize: 20, fontWeight: 800, color: '#B0263B' }}>{sentiment.negativeNews}</div>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)' }}>Negative</div>
                </div>
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: 'var(--apex-muted)', marginBottom: 8 }}>⚠️ CRITICAL ALERTS</div>
              <div style={{ fontFamily: 'Manrope', fontSize: 24, fontWeight: 800, color: '#C9A24B' }}>{sentiment.criticalEvents}</div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)' }}>Active events</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--apex-muted)', display: 'block', marginBottom: 6 }}>CATEGORY</label>
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--apex-border)', background: 'var(--apex-surface)', color: 'var(--apex-text)', borderRadius: 6, fontFamily: 'Space Mono', cursor: 'pointer' }}
          >
            <option value="ALL">All Categories</option>
            <option value="CRYPTO">Crypto</option>
            <option value="STOCKS">Stocks</option>
            <option value="GEOPOLITICS">Geopolitics</option>
            <option value="MACROECONOMICS">Macro</option>
            <option value="EMERGENCY">Emergency</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--apex-muted)', display: 'block', marginBottom: 6 }}>SENTIMENT</label>
          <select
            value={selectedSentiment}
            onChange={e => setSelectedSentiment(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--apex-border)', background: 'var(--apex-surface)', color: 'var(--apex-text)', borderRadius: 6, fontFamily: 'Space Mono', cursor: 'pointer' }}
          >
            <option value="ALL">All Sentiments</option>
            <option value="POSITIVE">Positive</option>
            <option value="NEGATIVE">Negative</option>
            <option value="NEUTRAL">Neutral</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{ background: 'var(--apex-surface)', border: '1px solid var(--apex-border)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid var(--apex-border)', fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-muted)' }}>
            📰 NEWS FEED ({filteredNews.length})
          </div>
          <div style={{ flex: 1, maxHeight: '600px', overflowY: 'auto' }}>
            {filteredNews.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--apex-muted)' }}>No news matching filters</div>
            ) : (
              filteredNews.map(item => (
                <div key={item.id} style={{
                  padding: 12,
                  borderBottom: '1px solid var(--apex-border)',
                  background: item.sentiment === 'POSITIVE' ? 'rgba(18,128,95, 0.05)' : item.sentiment === 'NEGATIVE' ? 'rgba(176,38,59, 0.05)' : 'transparent'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'Manrope', fontSize: 12, fontWeight: 700, color: 'var(--apex-text)', lineHeight: 1.4 }} title={item.title}>
                        {item.title.slice(0, 60)}...
                      </div>
                      <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)', marginTop: 4 }}>{item.source}</div>
                    </div>
                    <span style={{ fontSize: 14, marginLeft: 8, flexShrink: 0 }}>{getSentimentEmoji(item.sentiment)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    <span style={{ background: getCategoryColor(item.category), color: 'white', padding: '2px 6px', borderRadius: 3, fontFamily: 'Space Mono', fontSize: 8, fontWeight: 700 }}>
                      {item.category}
                    </span>
                    <span style={{
                      background: item.impact === 'HIGH' ? 'rgba(176,38,59, 0.2)' : item.impact === 'MEDIUM' ? 'rgba(201,162,75, 0.2)' : 'rgba(18,128,95, 0.2)',
                      color: item.impact === 'HIGH' ? '#B0263B' : item.impact === 'MEDIUM' ? '#C9A24B' : '#12805F',
                      padding: '2px 6px', borderRadius: 3, fontFamily: 'Space Mono', fontSize: 8, fontWeight: 700
                    }}>
                      {item.impact} IMPACT
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ background: 'var(--apex-surface)', border: '1px solid var(--apex-border)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid var(--apex-border)', fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-muted)' }}>
            🌍 GEOPOLITICAL EVENTS ({events.length})
          </div>
          <div style={{ flex: 1, maxHeight: '600px', overflowY: 'auto' }}>
            {events.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--apex-muted)' }}>No active geopolitical events</div>
            ) : (
              events.map(event => (
                <div key={event.id} style={{
                  padding: 12,
                  borderBottom: '1px solid var(--apex-border)',
                  borderTop: `1px solid ${getSeverityColor(event.severity)}`,
                  background: `${getSeverityColor(event.severity)}0D`,
                }}>
                  <div style={{ fontFamily: 'Manrope', fontSize: 12, fontWeight: 700, color: 'var(--apex-text)', marginBottom: 6 }}>{event.region}</div>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: 'var(--apex-text)', lineHeight: 1.4, marginBottom: 8 }}>{event.event}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ background: getSeverityColor(event.severity), color: 'white', padding: '3px 8px', borderRadius: 3, fontFamily: 'Space Mono', fontSize: 9, fontWeight: 700 }}>
                      {event.severity}
                    </span>
                    <span style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)' }}>
                      Affects: {event.affectedAssets.join(', ')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewsPage() {
  const [tab, setTab] = useState<'news' | 'geo'>('news');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Newspaper size={20} className="text-apex-accent" />
          <h1 className="font-sans font-bold text-2xl text-apex-text">Market News</h1>
          <span className="font-mono text-xs text-apex-muted ml-2">Analyzed by Agent 2</span>
        </div>
        <LastUpdated />
      </div>

      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--apex-border)' }}>
        {([
          { id: 'news' as const, label: 'Market News', icon: Newspaper },
          { id: 'geo' as const, label: 'Geopolitics & Sentiment', icon: Globe },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 16px',
              fontFamily: 'Manrope', fontSize: 13, fontWeight: tab === id ? 700 : 500,
              color: tab === id ? 'var(--apex-accent)' : 'var(--apex-muted)',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === id ? '2px solid var(--apex-accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'news' ? <MarketNewsTab /> : <GeopoliticsTab />}
    </div>
  );
}
