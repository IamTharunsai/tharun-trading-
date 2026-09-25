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
  const valueColorClass = trend === 'up'
    ? 'text-emerald-400'
    : trend === 'down'
    ? 'text-red-400'
    : accent
    ? 'text-amber-400'
    : 'text-white';

  return (
    <div className={`p-4 rounded-xl backdrop-blur-md transition-all ${
      accent
        ? 'bg-[#121B2E]/90 border border-amber-500/40 shadow-lg shadow-amber-500/5'
        : 'bg-[#101728]/70 border border-white/[0.08] hover:border-white/[0.16]'
    }`}>
      <div className="flex items-start justify-between mb-2">
        <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider">
          {label}
        </span>
        {icon && <span className="text-amber-400/80">{icon}</span>}
      </div>
      <div className={`text-2xl font-bold leading-tight tabular-nums ${mono ? 'font-mono' : 'font-sans'} ${valueColorClass}`}>
        {value}
      </div>
      {sub && (
        <div className="font-mono text-xs text-slate-400 mt-1.5 flex items-center gap-1.5">
          {sub}
        </div>
      )}
    </div>
  );
}
