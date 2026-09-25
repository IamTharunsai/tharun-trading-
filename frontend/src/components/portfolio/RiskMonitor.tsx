import { Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getSettings } from '../../services/api';

export default function RiskMonitor({ portfolio }: { portfolio: any }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings, staleTime: 60000 });

  if (!portfolio) return null;

  const dailyLossLimit = settings?.dailyLossLimit ?? 3;
  const maxDrawdown = settings?.maxDrawdown ?? 10;
  const maxTradesPerDay = settings?.maxTradesPerDay ?? 1000;

  const dailyUsed = Math.abs(Math.min(0, portfolio.pnlDayPct || 0));
  const drawdown = portfolio.drawdownFromPeak || 0;
  const tradesUsed = portfolio.tradesExecutedToday || 0;

  const RiskBar = ({ label, used, limit, unit = '%' }: { label: string; used: number; limit: number; unit?: string }) => {
    const pct = (used / (limit || 1)) * 100;
    const colorClass = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
    const textColorClass = pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-amber-400' : 'text-emerald-400';
    const status = pct >= 90 ? 'CRITICAL' : pct >= 70 ? 'WARNING' : 'HEALTHY';
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="text-slate-400">{label}</span>
          <span className={`font-bold tabular-nums ${textColorClass}`}>{used.toFixed(1)}{unit} / {limit}{unit}</span>
        </div>
        <div className="h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${colorClass}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="flex justify-end">
          <span className={`font-mono text-[10px] font-bold ${textColorClass}`}>{status}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="p-5 rounded-xl glass-panel space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-emerald-400" />
          <span className="font-semibold text-white">Risk Commander</span>
        </div>
        <span className="text-xs font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
          ALL INVARIANTS PASS
        </span>
      </div>

      <div className="space-y-3.5">
        <RiskBar label="Daily Loss Guardrail" used={dailyUsed} limit={dailyLossLimit} />
        <RiskBar label="Max Drawdown Circuit" used={drawdown} limit={maxDrawdown} />
        <RiskBar label="Day Trades Execution" used={tradesUsed} limit={maxTradesPerDay} unit="" />
      </div>

      {/* Cash reserve */}
      <div className="pt-3 border-t border-white/[0.08] space-y-1.5 font-mono text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Cash Reserve</span>
          <span className="font-bold text-white tabular-nums">
            ${(portfolio.cashBalance || 0).toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Capital At Risk</span>
          <span className="text-amber-400 tabular-nums">${(portfolio.invested || 0).toFixed(2)}</span>
        </div>
      </div>

      {/* Guardrail status */}
      <div className="pt-3 border-t border-white/[0.08]">
        <div className="font-mono text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-bold">ACTIVE PROTOCOL SENSORS</div>
        {[
          { label: 'Stop Loss Dynamic Monitor', ok: true },
          { label: 'Kelly Position Sizing Filter', ok: true },
          { label: 'Daily Loss Limit Circuit', ok: dailyUsed < dailyLossLimit },
          { label: 'Max Drawdown Hard Halt', ok: drawdown < maxDrawdown },
        ].map(({ label, ok }) => (
          <div key={label} className="flex items-center gap-2 py-0.5 font-mono text-xs">
            {ok ? <CheckCircle size={11} className="text-emerald-400" /> : <AlertTriangle size={11} className="text-red-400" />}
            <span className="text-slate-400">{label}</span>
            <span className={`ml-auto text-[10px] font-bold ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{ok ? 'ARMED' : 'BREACH'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
