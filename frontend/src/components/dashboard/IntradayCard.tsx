import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Zap, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSystemStatus } from '../../hooks/useSystemStatus';
import { runIntradayScan } from '../../services/api';

const n = (v: any): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Intraday fast-lane summary, straight from GET /api/system/status. */
export default function IntradayCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useSystemStatus();
  const [scanning, setScanning] = useState(false);
  const intra = data?.intraday;

  const scanNow = async () => {
    setScanning(true);
    try {
      const r: any = await runIntradayScan();
      toast.success(r?.message || 'Intraday scan requested');
      qc.invalidateQueries({ queryKey: ['system-status'] });
    } catch (e: any) {
      toast.error('Intraday scan failed: ' + (e?.response?.data?.error || e?.message || 'unknown error'));
    } finally {
      setScanning(false);
    }
  };

  const trades = n(intra?.tradesToday);
  const max = n(intra?.maxPerDay);
  const pnl = n(intra?.realizedPnlToday);
  const scan = intra?.lastScan || null;
  const scanAt = scan?.at ? new Date(scan.at) : null;
  const entered: string[] = Array.isArray(scan?.entered) ? scan!.entered : [];

  return (
    <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm" data-testid="intraday-card">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-indigo-600" />
          <h2 className="font-semibold text-slate-900 text-sm">Intraday fast lane</h2>
          {intra && (
            <span data-testid="intraday-enabled" className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded border ${intra.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              {intra.enabled ? 'ENABLED' : 'DISABLED'}
            </span>
          )}
        </div>
        <button
          data-testid="intraday-scan"
          onClick={scanNow}
          disabled={scanning || !intra?.enabled}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-mono text-[11px] font-bold text-slate-700 disabled:opacity-40"
        >
          <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} /> SCAN NOW
        </button>
      </div>

      {isLoading ? (
        <div className="font-mono text-xs text-slate-400">Loading…</div>
      ) : isError || !intra ? (
        <div className="font-mono text-xs text-slate-400">Intraday status unavailable.</div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 font-mono">
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Trades today</div>
              <div className="text-lg font-bold text-slate-900 tabular-nums" data-testid="intraday-trades">{trades ?? '—'}{max !== null ? <span className="text-slate-400 text-sm"> / {max}</span> : null}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Realized P&L today</div>
              <div className={`text-lg font-bold tabular-nums ${pnl === null ? 'text-slate-400' : pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`} data-testid="intraday-pnl">
                {pnl === null ? '—' : `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Notional</div>
              <div className="text-lg font-bold text-slate-900 tabular-nums">{n(intra.notionalUsd) === null ? '—' : `$${n(intra.notionalUsd)!.toFixed(0)}`}</div>
            </div>
          </div>
          <div className="pt-3 border-t border-slate-100 font-mono text-xs" data-testid="intraday-last-scan">
            {scan ? (
              <>
                <div className="flex items-center justify-between text-slate-500">
                  <span>Last scan</span>
                  <span>{scanAt && Number.isFinite(scanAt.getTime()) ? scanAt.toLocaleTimeString('en-US') : '—'}</span>
                </div>
                <div className="mt-1 text-slate-800">
                  {n(scan.candidates) ?? '—'} candidates → {n(scan.passed) ?? '—'} setups{n(scan.scored) !== null ? ` (${scan.scored} scored)` : ''} → {entered.length} entered
                </div>
                {entered.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {entered.map(sym => <span key={sym} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold">{sym}</span>)}
                  </div>
                )}
                {scan.note && <div className="mt-1 text-[11px] text-slate-500">{scan.note}</div>}
              </>
            ) : (
              <span className="text-slate-400">No intraday scan has run yet.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
