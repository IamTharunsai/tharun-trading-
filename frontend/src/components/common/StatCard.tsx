import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  accent?: boolean;
  mono?: boolean;
}

export default function StatCard({ label, value, sub, icon, trend, accent, mono }: StatCardProps) {
  const trendColor = trend === 'up' ? 'text-apex-green' : trend === 'down' ? 'text-apex-red' : 'text-apex-text';

  return (
    <div className={`card ${accent ? 'card-glow' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-mono text-apex-muted uppercase tracking-widest">{label}</span>
        {icon && <span className="text-apex-muted">{icon}</span>}
      </div>
      <div className={`text-2xl font-bold ${mono ? 'font-mono' : 'font-sans'} ${trendColor}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-apex-muted mt-1">{sub}</div>}
    </div>
  );
}
