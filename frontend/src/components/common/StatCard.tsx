import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  accent?: boolean;
  mono?: boolean;
  /** 'bhishma' = war-room dark variant; default 'apex' keeps the legacy
      light card so unmigrated pages using StatCard are unchanged. */
  variant?: 'apex' | 'bhishma';
  testId?: string;
}

export default function StatCard({ label, value, sub, icon, trend, accent, mono, testId, variant = 'apex' }: StatCardProps) {
  const bh = variant === 'bhishma';
  const valueColorClass = trend === 'up'
    ? (bh ? 'text-bh-up' : 'text-emerald-600')
    : trend === 'down'
    ? (bh ? 'text-bh-down' : 'text-red-600')
    : accent
    ? (bh ? 'text-bh-gold-bright' : 'text-blue-700')
    : (bh ? 'text-bh-bone-100' : 'text-slate-900');

  return (
    <div data-testid={testId} className={bh
      ? `bh-panel bh-reveal bh-gold-hover p-4 ${accent ? 'border-bh-gold/40' : ''}`
      : `p-4 rounded-xl transition-all bg-white border shadow-sm ${
          accent
            ? 'border-blue-300 ring-1 ring-blue-100'
            : 'border-slate-200/90 hover:border-slate-300'
        }`}>
      <div className="flex items-start justify-between mb-2">
        <span className={`font-mono text-[10px] uppercase tracking-wider font-semibold ${bh ? 'text-bh-bone-500' : 'text-slate-500'}`}>
          {label}
        </span>
        {icon && <span className={bh ? 'text-bh-gold' : 'text-blue-600'}>{icon}</span>}
      </div>
      <div data-testid={testId ? `${testId}-value` : undefined} className={`text-2xl font-bold leading-tight tabular-nums ${mono ? 'font-mono' : 'font-sans'} ${valueColorClass}`}>
        {value}
      </div>
      {sub && (
        <div className={`font-mono text-xs mt-1.5 flex items-center gap-1.5 ${bh ? 'text-bh-bone-500' : 'text-slate-500'}`}>
          {sub}
        </div>
      )}
    </div>
  );
}
