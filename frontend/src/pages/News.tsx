// News Page
import { useQuery } from '@tanstack/react-query';
import { getNews } from '../services/api';
import { Newspaper, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

export default function NewsPage() {
  const { data: news = [] } = useQuery({ queryKey: ['news'], queryFn: getNews, refetchInterval: 60000 });

  const sentimentColor = (score: number) =>
    score > 0.2 ? 'text-apex-green bg-apex-green/10' :
    score < -0.2 ? 'text-apex-red bg-apex-red/10' :
    'text-apex-muted bg-apex-surface';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Newspaper size={20} className="text-apex-accent" />
        <h1 className="font-sans font-bold text-2xl text-apex-text">Market News</h1>
        <span className="font-mono text-xs text-apex-muted ml-2">Analyzed by Agent 2</span>
      </div>

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
    </div>
  );
}
