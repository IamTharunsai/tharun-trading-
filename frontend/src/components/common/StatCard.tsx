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
  const valueColor = trend === 'up' ? '#2D8A4A' : trend === 'down' ? '#DC2626' : '#2C1810';

  return (
    <div style={{
      background: '#FFFFFF',
      border: accent ? '1.5px solid #FF8C42' : '1px solid #E8D5C4',
      borderRadius: 12,
      padding: '16px 18px',
      boxShadow: accent ? '0 0 18px rgba(255,140,66,0.12)' : '0 1px 4px rgba(139,111,71,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: '#8B6F47', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {label}
        </span>
        {icon && <span style={{ color: '#FF8C42' }}>{icon}</span>}
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
        <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: '#8B6F47', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
