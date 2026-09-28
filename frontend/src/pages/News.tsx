import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getNews, getIpoCalendar } from '../services/api';
import api from '../services/api';
import { Newspaper, ExternalLink, Globe, Rocket, AlertTriangle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
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
  sectorsAffected: string[];
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

function parseArray(val: any): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return val.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function MarketNewsTab() {
  const { data: rawNews = [] } = useQuery({ queryKey: ['news'], queryFn: getNews, refetchInterval: 60000 });
  const news = Array.isArray(rawNews) ? rawNews : Array.isArray((rawNews as any)?.news) ? (rawNews as any).news : [];

  const sentimentBadge = (score: number) => {
    if (score > 0.2) {
      return <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">BULLISH (+{score.toFixed(2)})</span>;
    }
    if (score < -0.2) {
      return <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">BEARISH ({score.toFixed(2)})</span>;
    }
    return <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">NEUTRAL</span>;
  };

  return (
    <div className="space-y-3">
      {news.map((n: any) => {
        if (!n) return null;
        const assets = parseArray(n.assetsMentioned);
        return (
          <div key={n.id || Math.random()} className="p-4 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition-all shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  {assets.map((a: string) => (
                    <span key={a} className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                      {a}
                    </span>
                  ))}
                  {sentimentBadge(n.sentimentScore || 0)}
                  {n.source && (
                    <span className="font-mono text-[10px] text-slate-500 font-semibold">
                      {n.source}
                    </span>
                  )}
                  {n.publishedAt && (
                    <span className="font-mono text-[10px] text-slate-400">
                      · {format(new Date(n.publishedAt), 'MM/dd HH:mm')}
                    </span>
                  )}
                </div>
                <h3 className="font-sans font-bold text-sm text-slate-900 leading-snug">
                  {n.headline || n.title}
                </h3>
                {n.summary && (
                  <p className="font-sans text-xs text-slate-600 mt-1 leading-relaxed">
                    {n.summary}
                  </p>
                )}
              </div>
              {n.url && (
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-blue-600 transition-colors p-1"
                >
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
          </div>
        );
      })}
      {news.length === 0 && (
        <div className="p-12 text-center bg-white border border-slate-200 rounded-xl font-mono text-xs text-slate-400">
          No news articles analyzed yet
        </div>
      )}
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
        setNews(Array.isArray(newsResponse.data?.news) ? newsResponse.data.news : []);
        setEvents(Array.isArray(eventsResponse.data?.events) ? eventsResponse.data.events : []);
        setSentiment(sentimentResponse.data || null);
      } catch (err) {
        console.error('Failed to fetch data', err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const filteredNews = news.filter(n => {
    if (selectedCategory !== 'ALL' && n.category !== selectedCategory) return false;
    if (selectedSentiment !== 'ALL' && n.sentiment !== selectedSentiment) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {sentiment && (
        <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="font-mono text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">
                OVERALL MARKET SENTIMENT
              </div>
              <div className={`text-2xl font-bold flex items-center gap-2 ${
                sentiment.overallSentiment === 'BULLISH' ? 'text-emerald-700' :
                sentiment.overallSentiment === 'BEARISH' ? 'text-red-700' : 'text-slate-800'
              }`}>
                {sentiment.overallSentiment === 'BULLISH' ? <TrendingUp size={24} className="text-emerald-600" /> :
                 sentiment.overallSentiment === 'BEARISH' ? <TrendingDown size={24} className="text-red-600" /> :
                 <Minus size={24} className="text-slate-500" />}
                {sentiment.overallSentiment}
              </div>
            </div>

            <div>
              <div className="font-mono text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">
                NEWS SENTIMENT RATIO
              </div>
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-xl font-bold text-emerald-600 tabular-nums">{sentiment.positiveNews}</div>
                  <div className="font-mono text-[10px] text-slate-500 font-semibold">Positive</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-red-600 tabular-nums">{sentiment.negativeNews}</div>
                  <div className="font-mono text-[10px] text-slate-500 font-semibold">Negative</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-slate-700 tabular-nums">{sentiment.totalNews}</div>
                  <div className="font-mono text-[10px] text-slate-500 font-semibold">Total Articles</div>
                </div>
              </div>
            </div>

            <div>
              <div className="font-mono text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">
                CRITICAL GEOPOLITICAL ALERTS
              </div>
              <div className="text-2xl font-bold text-amber-600 tabular-nums flex items-center gap-2">
                <AlertTriangle size={20} className="text-amber-600" />
                {sentiment.criticalEvents} Active Events
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter Row */}
      <div className="flex gap-3 flex-wrap">
        <div>
          <label className="text-[10px] font-mono text-slate-500 font-bold block mb-1">CATEGORY</label>
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 bg-white text-slate-900 rounded-lg text-xs font-mono"
          >
            <option value="ALL">All Categories</option>
            <option value="CRYPTO">Crypto</option>
            <option value="STOCKS">Stocks</option>
            <option value="GEOPOLITICS">Geopolitics</option>
            <option value="MACROECONOMICS">Macroeconomics</option>
            <option value="EMERGENCY">Emergency</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-mono text-slate-500 font-bold block mb-1">SENTIMENT</label>
          <select
            value={selectedSentiment}
            onChange={e => setSelectedSentiment(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 bg-white text-slate-900 rounded-lg text-xs font-mono"
          >
            <option value="ALL">All Sentiments</option>
            <option value="POSITIVE">Positive</option>
            <option value="NEGATIVE">Negative</option>
            <option value="NEUTRAL">Neutral</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* News Feed */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="p-3.5 border-b border-slate-200 font-mono text-xs font-bold text-slate-700 bg-slate-50/50">
            📰 NEWS FEED ({filteredNews.length})
          </div>
          <div className="flex-1 max-h-[550px] overflow-y-auto divide-y divide-slate-100">
            {filteredNews.length === 0 ? (
              <div className="p-8 text-center text-slate-400 font-mono text-xs">No news matching filters</div>
            ) : (
              filteredNews.map(item => (
                <div key={item.id} className="p-3.5 hover:bg-slate-50/80 transition-colors">
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-bold text-xs text-slate-900 line-clamp-2">{item.title}</h4>
                    <span className="text-xs ml-2 font-mono">{item.sentiment === 'POSITIVE' ? '🟢' : item.sentiment === 'NEGATIVE' ? '🔴' : '⚪'}</span>
                  </div>
                  <div className="font-mono text-[10px] text-slate-500 mb-2">{item.source}</div>
                  <div className="flex gap-1.5 flex-wrap">
                    <span className="bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold">
                      {item.category}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                      item.impact === 'HIGH' ? 'bg-red-50 text-red-700 border border-red-200' :
                      item.impact === 'MEDIUM' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      {item.impact} IMPACT
                    </span>
                    {parseArray(item.sectorsAffected).map(sector => (
                      <span key={sector} className="bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold">
                        {sector}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Geopolitical Events */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="p-3.5 border-b border-slate-200 font-mono text-xs font-bold text-slate-700 bg-slate-50/50">
            🌍 GEOPOLITICAL EVENTS ({events.length})
          </div>
          <div className="flex-1 max-h-[550px] overflow-y-auto divide-y divide-slate-100">
            {events.length === 0 ? (
              <div className="p-8 text-center text-slate-400 font-mono text-xs">No active geopolitical events</div>
            ) : (
              events.map(event => (
                <div key={event.id} className="p-3.5 hover:bg-slate-50/80 transition-colors">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-xs text-slate-900">{event.region}</span>
                    <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded ${
                      event.severity === 'CRITICAL' ? 'bg-red-50 text-red-700 border border-red-200' :
                      event.severity === 'HIGH' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      {event.severity}
                    </span>
                  </div>
                  <p className="font-sans text-xs text-slate-700 leading-snug mb-2">{event.event}</p>
                  <div className="font-mono text-[10px] text-slate-500">
                    Affects: <span className="font-semibold text-slate-800">{parseArray(event.affectedAssets).join(', ') || 'Global'}</span>
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

function IpoCalendarTab() {
  const { data: rawIpos = [] } = useQuery({ queryKey: ['ipo-calendar'], queryFn: getIpoCalendar, staleTime: 60 * 60000 });
  const ipos = Array.isArray(rawIpos) ? rawIpos : Array.isArray((rawIpos as any)?.ipos) ? (rawIpos as any).ipos : [];

  return (
    <div className="space-y-3">
      {ipos.length === 0 && (
        <div className="p-12 text-center bg-white border border-slate-200 rounded-xl font-mono text-xs text-slate-400">
          No upcoming IPOs in the next 30 days
        </div>
      )}
      {ipos.map((ipo: any) => (
        <div key={`${ipo.symbol}-${ipo.date}`} className="p-4 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition-all shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {ipo.symbol}
                </span>
                <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {ipo.status?.toUpperCase()}
                </span>
                {ipo.exchange && <span className="font-mono text-[10px] text-slate-500 font-semibold">{ipo.exchange}</span>}
              </div>
              <h3 className="font-sans font-bold text-sm text-slate-900">{ipo.name}</h3>
              <div className="flex items-center gap-4 mt-2 font-mono text-[10px] text-slate-500">
                <span>Date: <strong className="text-slate-800">{ipo.date}</strong></span>
                {ipo.priceRange && <span>Price: <strong className="text-slate-800">${ipo.priceRange}</strong></span>}
                {ipo.numberOfShares && <span>Shares: <strong className="text-slate-800">{(ipo.numberOfShares / 1e6).toFixed(1)}M</strong></span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NewsPage() {
  const [tab, setTab] = useState<'news' | 'geo' | 'ipo'>('news');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 p-5 rounded-xl bg-white border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-700">
            <Newspaper size={20} />
          </div>
          <div>
            <h1 className="font-bold text-2xl text-slate-900 tracking-tight">Market Intelligence & News</h1>
            <p className="font-mono text-xs text-slate-500 mt-0.5">Continuous Multi-Asset Real-Time Sentiment & Geopolitical Feed</p>
          </div>
        </div>
        <LastUpdated />
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        {([
          { id: 'news' as const, label: 'Market News', icon: Newspaper },
          { id: 'geo' as const, label: 'Geopolitics & Sentiment', icon: Globe },
          { id: 'ipo' as const, label: 'Upcoming IPOs', icon: Rocket },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs font-bold transition-all ${
              tab === id
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'news' ? <MarketNewsTab /> : tab === 'geo' ? <GeopoliticsTab /> : <IpoCalendarTab />}
    </div>
  );
}
