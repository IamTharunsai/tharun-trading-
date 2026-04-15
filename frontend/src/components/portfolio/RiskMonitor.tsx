import { Shield, AlertTriangle, CheckCircle } from 'lucide-react';

export default function RiskMonitor({ portfolio }: { portfolio: any }) {
  if (!portfolio) return null;

  const dailyLossLimit = 5;
  const weeklyLimit = 10;
  const maxDrawdown = 20;
  const maxTradesPerDay = 50;

  const dailyUsed = Math.abs(Math.min(0, portfolio.pnlDayPct || 0));
  const drawdown = portfolio.drawdownFromPeak || 0;
  const tradesUsed = portfolio.tradesExecutedToday || 0;

  const RiskBar = ({ label, used, limit, unit = '%' }: { label: string; used: number; limit: number; unit?: string }) => {
    const pct = (used / limit) * 100;
    const color = pct >= 90 ? '#FF3B5C' : pct >= 70 ? '#FFD700' : '#00FF88';
    const status = pct >= 90 ? 'CRITICAL' : pct >= 70 ? 'WARNING' : 'OK';
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="text-apex-muted">{label}</span>
          <span style={{ color }} className="font-bold">{used.toFixed(1)}{unit} / {limit}{unit}</span>
        </div>
        <div className="h-1.5 bg-apex-border rounded-full overflow-hidden">
          <div style={{ width: `${Math.min(100, pct)}%`, background: color, height: '100%', borderRadius: '99px', transition: 'width 1s' }} />
        </div>
        <div className="flex justify-end">
          <span className="font-mono text-[10px]" style={{ color }}>{status}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Shield size={16} className="text-apex-accent" />
        <span className="font-sans font-semibold text-apex-text">Risk Monitor</span>
      </div>

      <div className="space-y-4">
        <RiskBar label="Daily Loss" used={dailyUsed} limit={dailyLossLimit} />
        <RiskBar label="Max Drawdown" used={drawdown} limit={maxDrawdown} />
        <RiskBar label="Trades Today" used={tradesUsed} limit={maxTradesPerDay} unit="" />
      </div>

      {/* Cash reserve */}
      <div className="mt-4 pt-4 border-t border-apex-border">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-apex-muted">Cash Reserve</span>
          <span className="font-mono text-xs font-bold text-apex-text">
            ${(portfolio.cashBalance || 0).toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="font-mono text-xs text-apex-muted">Invested</span>
          <span className="font-mono text-xs text-apex-text">${(portfolio.invested || 0).toFixed(2)}</span>
        </div>
      </div>

      {/* Guardrail status */}
      <div className="mt-4 pt-4 border-t border-apex-border">
        <div className="font-mono text-[10px] text-apex-muted uppercase tracking-widest mb-2">Guardrails</div>
        {[
          { label: 'Stop Loss Monitor', ok: true },
          { label: 'Risk Manager Agent', ok: true },
          { label: 'Daily Loss Limit', ok: dailyUsed < dailyLossLimit },
          { label: 'Drawdown Circuit', ok: drawdown < maxDrawdown },
        ].map(({ label, ok }) => (
          <div key={label} className="flex items-center gap-2 py-0.5">
            {ok ? <CheckCircle size={10} className="text-apex-green" /> : <AlertTriangle size={10} className="text-apex-red" />}
            <span className="font-mono text-xs text-apex-muted">{label}</span>
            <span className={`ml-auto font-mono text-[10px] ${ok ? 'text-apex-green' : 'text-apex-red'}`}>{ok ? 'ARMED' : 'BREACH'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
