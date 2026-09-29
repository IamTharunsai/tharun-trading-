import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  accent?: boolean;
  mono?: boolean;
  testId?: string;
}

export default function StatCard({ label, value, sub, icon, trend, accent, mono, testId }: StatCardProps) {
  const valueColorClass = trend === 'up'
    ? 'text-emerald-600'
    : trend === 'down'
    ? 'text-red-600'
    : accent
    ? 'text-blue-700'
    : 'text-slate-900';

  return (
    <div data-testid={testId} className={`p-4 rounded-xl transition-all bg-white border shadow-sm ${
      accent
        ? 'border-blue-300 ring-1 ring-blue-100'
        : 'border-slate-200/90 hover:border-slate-300'
    }`}>
      <div className="flex items-start justify-between mb-2">
        <span className="font-mono text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
          {label}
        </span>
        {icon && <span className="text-blue-600">{icon}</span>}
      </div>
      <div data-testid={testId ? `${testId}-value` : undefined} className={`text-2xl font-bold leading-tight tabular-nums ${mono ? 'font-mono' : 'font-sans'} ${valueColorClass}`}>
        {value}
      </div>
      {sub && (
        <div className="font-mono text-xs text-slate-500 mt-1.5 flex items-center gap-1.5">
          {sub}
        </div>
      )}
    </div>
  );
}
