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
  const valueColor = trend === 'up' ? '#12805F' : trend === 'down' ? '#B0263B' : '#14171F';

  return (
    <div style={{
      background: '#FFFFFF',
      border: accent ? '1.5px solid #C9A24B' : '1px solid #DCDFE6',
      borderRadius: 12,
      padding: '16px 18px',
      boxShadow: accent ? '0 0 18px rgba(201,162,75,0.12)' : '0 1px 4px rgba(91,100,114,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: '#5B6472', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {label}
        </span>
        {icon && <span style={{ color: '#C9A24B' }}>{icon}</span>}
      </div>
      <div style={{
        fontFamily: mono ? 'Space Mono, monospace' : 'Syne, sans-serif',
        fontSize: 22,
        fontWeight: 700,
        color: valueColor,
        lineHeight: 1.2,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: '#5B6472', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
