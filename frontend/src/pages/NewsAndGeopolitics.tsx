import { useState, useEffect } from 'react';
import axios from 'axios';
import { useStore } from '../store';

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

export default function NewsAndGeopoliticsPage() {
  const token = useStore(s => s.token);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [events, setEvents] = useState<GeopoliticalEvent[]>([]);
  const [sentiment, setSentiment] = useState<MarketSentiment | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedSentiment, setSelectedSentiment] = useState<string>('ALL');

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch news
        const newsResponse = await axios.get('/api/monitor/news', {
          params: { minutes: 120 },
          headers: { Authorization: `Bearer ${token}` }
        });
        setNews(newsResponse.data.news   || []);

        // Fetch geopolitical events
        const eventsResponse = await axios.get('/api/monitor/geopolitics', {
          params: { hours: 24 },
          headers: { Authorization: `Bearer ${token}` }
        });
        setEvents(eventsResponse.data.events || []);

        // Fetch sentiment
        const sentimentResponse = await axios.get('/api/monitor/sentiment', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSentiment(sentimentResponse.data);
      } catch (err) {
        console.error('Failed to fetch data', err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, [token]);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'GEOPOLITICS': return '#FF8C42';
      case 'CRYPTO': return '#2D8A4A';
      case 'STOCKS': return '#FFD700';
      case 'MACROECONOMICS': return '#2D8A4A';
      case 'EMERGENCY': return '#DC2626';
      default: return '#666';
    }
  };

  const getSentimentEmoji = (sentiment: string) => {
    switch (sentiment) {
      case 'POSITIVE': return '📈';
      case 'NEGATIVE': return '📉';
      case 'NEUTRAL': return '➡️';
      default: return '❓';
    }
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'POSITIVE': return '#2D8A4A';
      case 'NEGATIVE': return '#DC2626';
      case 'NEUTRAL': return '#666';
      default: return '#666';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return '#DC2626';
      case 'HIGH': return '#FF8C42';
      case 'MEDIUM': return '#FFD700';
      case 'LOW': return '#2D8A4A';
      default: return '#666';
    }
  };

  const filteredNews = news.filter(n => {
    if (selectedCategory !== 'ALL' && n.category !== selectedCategory) return false;
    if (selectedSentiment !== 'ALL' && n.sentiment !== selectedSentiment) return false;
    return true;
  });

  return (
    <div style={{ padding: '20px', background: 'var(--apex-bg)', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ fontFamily: 'Syne', fontSize: 28, fontWeight: 800, color: 'var(--apex-text)', marginBottom: 8 }}>
          📰 News & Geopolitics
        </h1>
        <p style={{ fontFamily: 'Space Mono', fontSize: 12, color: 'var(--apex-muted)' }}>
          Real-time news feed, geopolitical events, and market sentiment that influence agent decisions
        </p>
      </div>

      {/* Market Sentiment Card */}
      {sentiment && (
        <div style={{
          background: 'var(--apex-surface)',
          border: `2px solid ${sentiment.overallSentiment === 'BULLISH' ? '#2D8A4A' : sentiment.overallSentiment === 'BEARISH' ? '#DC2626' : '#666'}`,
          borderRadius: 12,
          padding: 20,
          marginBottom: 30
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {/* Sentiment */}
            <div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: 'var(--apex-muted)', marginBottom: 8 }}>
                OVERALL SENTIMENT
              </div>
              <div style={{
                fontSize: 28,
                fontFamily: 'Syne',
                fontWeight: 800,
                color: getSentimentColor(sentiment.overallSentiment)
              }}>
                {sentiment.overallSentiment === 'BULLISH' ? '🟢' : sentiment.overallSentiment === 'BEARISH' ? '🔴' : '⚪'}
                {' ' + sentiment.overallSentiment}
              </div>
            </div>

            {/* Positive/Negative */}
            <div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: 'var(--apex-muted)', marginBottom: 8 }}>
                NEWS BREAKDOWN
              </div>
              <div style={{ display: 'flex', gap: 20 }}>
                <div>
                  <div style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 800, color: '#2D8A4A' }}>
                    {sentiment.positiveNews}
                  </div>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)' }}>Positive</div>
                </div>
                <div>
                  <div style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 800, color: '#DC2626' }}>
                    {sentiment.negativeNews}
                  </div>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)' }}>Negative</div>
                </div>
              </div>
            </div>

            {/* Critical Events */}
            <div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: 'var(--apex-muted)', marginBottom: 8 }}>
                ⚠️ CRITICAL ALERTS
              </div>
              <div style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 800, color: '#FF8C42' }}>
                {sentiment.criticalEvents}
              </div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)' }}>Active events</div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* Category Filter */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--apex-muted)', display: 'block', marginBottom: 6 }}>
            CATEGORY
          </label>
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--apex-border)',
              background: 'var(--apex-surface)',
              color: 'var(--apex-text)',
              borderRadius: 6,
              fontFamily: 'Space Mono',
              cursor: 'pointer'
            }}
          >
            <option value="ALL">All Categories</option>
            <option value="CRYPTO">Crypto</option>
            <option value="STOCKS">Stocks</option>
            <option value="GEOPOLITICS">Geopolitics</option>
            <option value="MACROECONOMICS">Macro</option>
            <option value="EMERGENCY">Emergency</option>
          </select>
        </div>

        {/* Sentiment Filter */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--apex-muted)', display: 'block', marginBottom: 6 }}>
            SENTIMENT
          </label>
          <select
            value={selectedSentiment}
            onChange={e => setSelectedSentiment(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--apex-border)',
              background: 'var(--apex-surface)',
              color: 'var(--apex-text)',
              borderRadius: 6,
              fontFamily: 'Space Mono',
              cursor: 'pointer'
            }}
          >
            <option value="ALL">All Sentiments</option>
            <option value="POSITIVE">Positive</option>
            <option value="NEGATIVE">Negative</option>
            <option value="NEUTRAL">Neutral</option>
          </select>
        </div>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* News Feed */}
        <div style={{
          background: 'var(--apex-surface)',
          border: '1px solid var(--apex-border)',
          borderRadius: 12,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ padding: '16px', borderBottom: '1px solid var(--apex-border)', fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-muted)' }}>
            📰 NEWS FEED ({filteredNews.length})
          </div>

          <div style={{ flex: 1, maxHeight: '600px', overflowY: 'auto' }}>
            {filteredNews.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--apex-muted)' }}>
                No news matching filters
              </div>
            ) : (
              filteredNews.map(item => (
                <div
                  key={item.id}
                  style={{
                    padding: 12,
                    borderBottom: '1px solid var(--apex-border)',
                    background: item.sentiment === 'POSITIVE' ? 'rgba(45, 138, 74, 0.05)' : item.sentiment === 'NEGATIVE' ? 'rgba(220, 38, 38, 0.05)' : 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'Syne', fontSize: 12, fontWeight: 700, color: 'var(--apex-text)', lineHeight: 1.4 }} title={item.title}>
                        {item.title.slice(0, 60)}...
                      </div>
                      <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)', marginTop: 4 }}>
                        {item.source}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 14,
                      marginLeft: 8,
                      flexShrink: 0
                    }}>
                      {getSentimentEmoji(item.sentiment)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    <span style={{
                      background: getCategoryColor(item.category),
                      color: 'white',
                      padding: '2px 6px',
                      borderRadius: 3,
                      fontFamily: 'Space Mono',
                      fontSize: 8,
                      fontWeight: 700
                    }}>
                      {item.category}
                    </span>
                    <span style={{
                      background: item.impact === 'HIGH' ? 'rgba(220, 38, 38, 0.2)' : item.impact === 'MEDIUM' ? 'rgba(255, 140, 66, 0.2)' : 'rgba(45, 138, 74, 0.2)',
                      color: item.impact === 'HIGH' ? '#DC2626' : item.impact === 'MEDIUM' ? '#FF8C42' : '#2D8A4A',
                      padding: '2px 6px',
                      borderRadius: 3,
                      fontFamily: 'Space Mono',
                      fontSize: 8,
                      fontWeight: 700
                    }}>
                      {item.impact} IMPACT
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Geopolitical Events */}
        <div style={{
          background: 'var(--apex-surface)',
          border: '1px solid var(--apex-border)',
          borderRadius: 12,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ padding: '16px', borderBottom: '1px solid var(--apex-border)', fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-muted)' }}>
            🌍 GEOPOLITICAL EVENTS ({events.length})
          </div>

          <div style={{ flex: 1, maxHeight: '600px', overflowY: 'auto' }}>
            {events.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--apex-muted)' }}>
                No active geopolitical events
              </div>
            ) : (
              events.map(event => (
                <div
                  key={event.id}
                  style={{
                    padding: 12,
                    borderBottom: '1px solid var(--apex-border)',
                    borderLeft: `4px solid ${getSeverityColor(event.severity)}`
                  }}
                >
                  <div style={{ fontFamily: 'Syne', fontSize: 12, fontWeight: 700, color: 'var(--apex-text)', marginBottom: 6 }}>
                    {event.region}
                  </div>
                  <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: 'var(--apex-text)', lineHeight: 1.4, marginBottom: 8 }}>
                    {event.event}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{
                      background: getSeverityColor(event.severity),
                      color: 'white',
                      padding: '3px 8px',
                      borderRadius: 3,
                      fontFamily: 'Space Mono',
                      fontSize: 9,
                      fontWeight: 700
                    }}>
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
