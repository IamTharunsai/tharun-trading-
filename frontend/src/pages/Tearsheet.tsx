/**
 * APEX Performance Tearsheet — QuantStats-style full analytics
 * Integrates: quantstats (Sharpe/Sortino/Calmar/drawdown), TradingAgents loss breakdown,
 * OpenTerminal monthly heatmap, Vibe-Trading agent attribution
 *
 * Route: /tearsheet
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTrades, getSnapshots } from '../services/api';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell, LineChart, Line, ReferenceLine
} from 'recharts';
import { format, subDays, startOfDay, parseISO, differenceInCalendarDays } from 'date-fns';
import LastUpdated from '../components/common/LastUpdated';
import {
  TrendingDown, TrendingUp, AlertTriangle, BarChart3,
  Target, Zap, Clock, Activity, ShieldAlert, Award
} from 'lucide-react';

// ─── Quant helpers ────────────────────────────────────────────────────────────
const mean = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
const std = (arr: number[]) => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
};
const annualise = (daily: number) => daily * Math.sqrt(252);

function computeMetrics(dailyReturns: number[], drawdownSeries: number[]) {
  if (!dailyReturns.length) return null;
  const m = mean(dailyReturns);
  const s = std(dailyReturns);
  const rfDaily = 0.05 / 252; // 5% risk-free
  const sharpe = s > 0 ? annualise((m - rfDaily) / s) : null;

  const downside = dailyReturns.filter(r => r < rfDaily);
  const downsideStd = std(downside.length ? downside : dailyReturns);
  const sortino = downsideStd > 0 ? annualise((m - rfDaily) / downsideStd) : null;

  const maxDD = drawdownSeries.length ? Math.min(...drawdownSeries) : 0;
  const cagr = dailyReturns.length > 5
    ? Math.pow(dailyReturns.reduce((p, r) => p * (1 + r), 1), 252 / dailyReturns.length) - 1
    : null;
  const calmar = maxDD < 0 && cagr !== null ? cagr / Math.abs(maxDD) : null;

  const winners = dailyReturns.filter(r => r > 0);
  const losers = dailyReturns.filter(r => r < 0);
  const grossWin = winners.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losers.reduce((s, v) => s + v, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;

  const kelly = sharpe !== null ? (m - rfDaily) / (s * s) : null;

  return { sharpe, sortino, calmar, maxDD, cagr, profitFactor, kelly, volatility: annualise(s), winDays: winners.length, lossDays: losers.length };
}

function buildDrawdownSeries(equityCurve: { date: string; value: number }[]) {
  if (!equityCurve.length) return [];
  let peak = equityCurve[0].value;
  return equityCurve.map(p => {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? (p.value - peak) / peak : 0;
    return { date: p.date, drawdown: dd * 100 };
  });
}

function buildRollingSharpe(dailyPnl: { date: string; pnl: number }[], window = 30) {
  return dailyPnl.map((_, i) => {
    if (i < window - 1) return { date: dailyPnl[i].date, sharpe: null };
    const slice = dailyPnl.slice(i - window + 1, i + 1).map(d => d.pnl);
    const m = mean(slice);
    const s = std(slice);
    return { date: dailyPnl[i].date, sharpe: s > 0 ? annualise(m / s) : null };
  });
}

// Monthly returns heatmap data
function buildMonthlyHeatmap(dailyPnl: { date: string; pnl: number }[]) {
  const byMonth: Record<string, { pnl: number; trades: number }> = {};
  dailyPnl.forEach(d => {
    const key = d.date.slice(0, 7); // YYYY-MM
    if (!byMonth[key]) byMonth[key] = { pnl: 0, trades: 0 };
    byMonth[key].pnl += d.pnl;
    byMonth[key].trades += 1;
  });
  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      label: format(parseISO(`${key}-01`), 'MMM yy'),
      pnl: Number(v.pnl.toFixed(2)),
      trades: v.trades,
    }));
}

// Loss reason heuristics
function classifyLoss(trade: any): string {
  const pnl = Number(trade.pnl ?? 0);
  if (pnl >= 0) return 'WIN';
  const symbol = String(trade.asset ?? trade.symbol ?? '').toUpperCase();
  const hour = new Date(trade.openedAt ?? trade.createdAt).getHours();
  if (hour < 9 || hour >= 16) return 'After-Hours Volatility';
  if (['BTC', 'ETH', 'SOL', 'DOGE'].some(c => symbol.includes(c))) return 'Crypto Volatility';
  if (symbol.includes('PM-') || trade.market === 'polymarket') return 'Prediction Market';
  const holdMinutes = trade.closedAt
    ? (new Date(trade.closedAt).getTime() - new Date(trade.openedAt ?? trade.createdAt).getTime()) / 60000
    : null;
  if (holdMinutes !== null && holdMinutes < 10) return 'Scalp Stopped Out';
  if (holdMinutes !== null && holdMinutes > 1440) return 'Overnight Risk';
  return 'Trend Reversal';
}

const MetricCard = ({ label, value, sub, tone = 'neutral', icon }: {
  label: string; value: string | null; sub?: string;
  tone?: 'good' | 'bad' | 'neutral' | 'warn'; icon?: React.ReactNode;
}) => {
  const valueColor = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900';
  return (
    <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-2 text-slate-500 text-[11px] font-mono uppercase tracking-wider">
        {icon}<span>{label}</span>
      </div>
      <div className={`text-2xl font-bold font-mono tabular-nums ${valueColor}`}>
        {value ?? '—'}
      </div>
      {sub && <div className="text-[10px] text-slate-400 font-mono">{sub}</div>}
    </div>
  );
};

export default function TearsheetPage() {
  const [range, setRange] = useState<'7D' | '30D' | '90D' | 'ALL'>('30D');

  const { data: closedData, isLoading } = useQuery({
    queryKey: ['trades-tearsheet'],
    queryFn: () => getTrades(1, 2000, { status: 'CLOSED' }),
    refetchInterval: 120000,
  });

  const { data: snapshots = [] } = useQuery({
    queryKey: ['snapshots-90'],
    queryFn: () => getSnapshots(90),
    refetchInterval: 300000,
  });

  const allTrades: any[] = useMemo(() => {
    const list = Array.isArray(closedData?.trades) ? closedData.trades
      : Array.isArray(closedData) ? closedData : [];
    return list.filter((t: any) => String(t.status ?? '').toUpperCase() === 'CLOSED');
  }, [closedData]);

  const dayCount = range === '7D' ? 7 : range === '30D' ? 30 : range === '90D' ? 90 : 3650;
  const cutoff = Date.now() - dayCount * 86400000;

  const scopedTrades = useMemo(() =>
    allTrades.filter(t => new Date(t.closedAt ?? t.updatedAt ?? t.openedAt).getTime() >= cutoff),
    [allTrades, cutoff]
  );

  // Daily P&L from trades
  const dailyPnl = useMemo(() => {
    const byDay = new Map<string, number>();
    scopedTrades.forEach(t => {
      if (!Number.isFinite(Number(t.pnl))) return;
      const d = format(new Date(t.closedAt ?? t.updatedAt), 'yyyy-MM-dd');
      byDay.set(d, (byDay.get(d) ?? 0) + Number(t.pnl));
    });
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => ({ date, pnl: Number(pnl.toFixed(2)) }));
  }, [scopedTrades]);

  // Equity curve from snapshots
  const equityCurve = useMemo(() => {
    const snaps = Array.isArray(snapshots) ? snapshots : [];
    return snaps
      .map((s: any) => {
        const d = s.timestamp ? new Date(s.timestamp) : null;
        const v = Number(s.value ?? s.totalValue ?? 0);
        if (!d || !Number.isFinite(d.getTime()) || v <= 0) return null;
        return { date: format(d, 'MM/dd'), value: v };
      })
      .filter(Boolean) as { date: string; value: number }[];
  }, [snapshots]);

  // Daily returns from equity curve
  const dailyReturns = useMemo(() => {
    if (equityCurve.length < 2) return dailyPnl.map(d => d.pnl / 10000); // fallback
    return equityCurve.slice(1).map((p, i) => {
      const prev = equityCurve[i].value;
      return prev > 0 ? (p.value - prev) / prev : 0;
    });
  }, [equityCurve, dailyPnl]);

  const drawdownSeries = useMemo(() => buildDrawdownSeries(equityCurve), [equityCurve]);
  const rollingSharpe = useMemo(() => buildRollingSharpe(dailyPnl), [dailyPnl]);
  const monthlyHeatmap = useMemo(() => buildMonthlyHeatmap(dailyPnl), [dailyPnl]);
  const metrics = useMemo(() => computeMetrics(dailyReturns, drawdownSeries.map(d => d.drawdown / 100)), [dailyReturns, drawdownSeries]);

  // Loss analysis
  const lossTrades = useMemo(() => scopedTrades.filter(t => Number(t.pnl ?? 0) < 0), [scopedTrades]);
  const winTrades = useMemo(() => scopedTrades.filter(t => Number(t.pnl ?? 0) > 0), [scopedTrades]);
  const totalPnl = scopedTrades.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const winRate = scopedTrades.length ? (winTrades.length / scopedTrades.length) * 100 : null;

  const lossByAsset = useMemo(() => {
    const byAsset: Record<string, { pnl: number; count: number }> = {};
    lossTrades.forEach(t => {
      const k = String(t.asset ?? t.symbol ?? 'Unknown').split('-')[0].toUpperCase();
      if (!byAsset[k]) byAsset[k] = { pnl: 0, count: 0 };
      byAsset[k].pnl += Number(t.pnl ?? 0);
      byAsset[k].count += 1;
    });
    return Object.entries(byAsset)
      .sort(([, a], [, b]) => a.pnl - b.pnl)
      .slice(0, 10)
      .map(([asset, v]) => ({ asset, pnl: Number(v.pnl.toFixed(2)), count: v.count }));
  }, [lossTrades]);

  const lossByReason = useMemo(() => {
    const byReason: Record<string, { pnl: number; count: number }> = {};
    lossTrades.forEach(t => {
      const r = classifyLoss(t);
      if (!byReason[r]) byReason[r] = { pnl: 0, count: 0 };
      byReason[r].pnl += Number(t.pnl ?? 0);
      byReason[r].count += 1;
    });
    return Object.entries(byReason)
      .sort(([, a], [, b]) => a.pnl - b.pnl)
      .map(([reason, v]) => ({ reason, pnl: Number(v.pnl.toFixed(2)), count: v.count }));
  }, [lossTrades]);

  const lossByHour = useMemo(() => {
    const byHour: Record<number, { pnl: number; count: number }> = {};
    lossTrades.forEach(t => {
      const h = new Date(t.openedAt ?? t.createdAt).getHours();
      if (!byHour[h]) byHour[h] = { pnl: 0, count: 0 };
      byHour[h].pnl += Number(t.pnl ?? 0);
      byHour[h].count += 1;
    });
    return Array.from({ length: 24 }, (_, h) => ({
      hour: `${h.toString().padStart(2, '0')}:00`,
      pnl: Number((byHour[h]?.pnl ?? 0).toFixed(2)),
      count: byHour[h]?.count ?? 0,
    })).filter(d => d.count > 0);
  }, [lossTrades]);

  const worstTrades = useMemo(() =>
    [...lossTrades]
      .sort((a, b) => Number(a.pnl) - Number(b.pnl))
      .slice(0, 10),
    [lossTrades]
  );

  const fmt2 = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);
  const fmtPct = (n: number | null) => n === null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  const fmtRatio = (n: number | null) => n === null ? '—' : n.toFixed(2);

  const sharpeTone = !metrics || metrics.sharpe === null ? 'neutral' : metrics.sharpe > 1 ? 'good' : metrics.sharpe > 0 ? 'warn' : 'bad';
  const sortTone = !metrics || metrics.sortino === null ? 'neutral' : metrics.sortino > 1.5 ? 'good' : metrics.sortino > 0 ? 'warn' : 'bad';
  const ddTone = !metrics || metrics.maxDD === null ? 'neutral' : metrics.maxDD > -0.1 ? 'good' : metrics.maxDD > -0.2 ? 'warn' : 'bad';

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-2xl text-slate-900 tracking-tight">
              📊 Performance Tearsheet
            </h1>
            <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-bold">
              QUANTSTATS ENGINE
            </span>
          </div>
          <p className="font-mono text-xs text-slate-500 mt-1">
            Sharpe · Sortino · Calmar · Drawdown · Loss Attribution · Monthly Heatmap
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['7D', '30D', '90D', 'ALL'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)} style={{
              fontSize: 11, padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600,
              background: range === r ? '#7c3aed' : '#f1f5f9', color: range === r ? '#fff' : '#64748b',
            }}>{r}</button>
          ))}
          <LastUpdated />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-slate-400 font-mono text-sm">Loading tearsheet data…</div>
      ) : (
        <>
          {/* QuantStats Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <MetricCard label="Sharpe Ratio" value={fmtRatio(metrics?.sharpe ?? null)} sub="Annualised, rf=5%" tone={sharpeTone} icon={<Award size={12} />} />
            <MetricCard label="Sortino Ratio" value={fmtRatio(metrics?.sortino ?? null)} sub="Downside-adjusted" tone={sortTone} icon={<Activity size={12} />} />
            <MetricCard label="Calmar Ratio" value={fmtRatio(metrics?.calmar ?? null)} sub="CAGR / Max DD" tone={metrics != null && metrics.calmar !== null && metrics.calmar > 1 ? 'good' : 'warn'} icon={<Target size={12} />} />
            <MetricCard label="Max Drawdown" value={metrics?.maxDD !== undefined ? `${(metrics.maxDD * 100).toFixed(1)}%` : '—'} sub="Peak to trough" tone={ddTone} icon={<TrendingDown size={12} />} />
            <MetricCard label="Volatility" value={metrics?.volatility !== undefined ? `${(metrics.volatility * 100).toFixed(1)}%` : '—'} sub="Annualised daily" tone="neutral" icon={<BarChart3 size={12} />} />
            <MetricCard label="Win Rate" value={winRate !== null ? `${winRate.toFixed(1)}%` : '—'} sub={`${winTrades.length}W / ${lossTrades.length}L`} tone={winRate !== null && winRate >= 50 ? 'good' : 'bad'} icon={<Zap size={12} />} />
            <MetricCard label="Profit Factor" value={fmtRatio(metrics?.profitFactor ?? null)} sub="Gross win / loss" tone={metrics != null && metrics.profitFactor !== null && metrics.profitFactor > 1 ? 'good' : 'bad'} icon={<TrendingUp size={12} />} />
            <MetricCard label="Total P&L" value={totalPnl !== 0 ? `${fmt2(totalPnl)}` : '—'} sub={`${scopedTrades.length} closed trades`} tone={totalPnl >= 0 ? 'good' : 'bad'} icon={<ShieldAlert size={12} />} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Equity Curve */}
            <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
              <h3 className="font-semibold text-sm text-slate-800 mb-3 flex items-center gap-2">
                <TrendingUp size={14} className="text-emerald-500" /> Equity Curve
              </h3>
              {equityCurve.length > 1 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={equityCurve}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={50} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'NAV']} />
                    <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} fill="url(#eqGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-slate-400 text-xs font-mono">Portfolio snapshot data needed for equity curve</div>
              )}
            </div>

            {/* Drawdown Chart */}
            <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
              <h3 className="font-semibold text-sm text-slate-800 mb-3 flex items-center gap-2">
                <TrendingDown size={14} className="text-red-500" /> Underwater Drawdown
              </h3>
              {drawdownSeries.length > 1 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={drawdownSeries}>
                    <defs>
                      <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} tickFormatter={v => `${v.toFixed(0)}%`} width={45} />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(2)}%`, 'Drawdown']} />
                    <Area type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={1.5} fill="url(#ddGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-slate-400 text-xs font-mono">Snapshot data needed for drawdown</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Monthly P&L Heatmap */}
            <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
              <h3 className="font-semibold text-sm text-slate-800 mb-3 flex items-center gap-2">
                <BarChart3 size={14} className="text-blue-500" /> Monthly Returns Heatmap
              </h3>
              {monthlyHeatmap.length ? (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={monthlyHeatmap} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} tickFormatter={v => `$${v}`} width={55} />
                    <ReferenceLine y={0} stroke="#94a3b8" />
                    <Tooltip formatter={(v: number) => [`${v >= 0 ? '+' : ''}$${v.toFixed(2)}`, 'Month P&L']} />
                    <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                      {monthlyHeatmap.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? '#059669' : '#dc2626'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-slate-400 text-xs font-mono">No closed trades in range</div>
              )}
            </div>

            {/* Rolling 30-day Sharpe */}
            <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
              <h3 className="font-semibold text-sm text-slate-800 mb-3 flex items-center gap-2">
                <Activity size={14} className="text-violet-500" /> Rolling 30-Day Sharpe
              </h3>
              {rollingSharpe.filter(d => d.sharpe !== null).length > 3 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={rollingSharpe.filter(d => d.sharpe !== null)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} width={35} />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                    <ReferenceLine y={1} stroke="#059669" strokeDasharray="4 2" label={{ value: 'SR=1', position: 'right', fontSize: 9 }} />
                    <Tooltip formatter={(v: number) => [v.toFixed(2), 'Sharpe']} />
                    <Line type="monotone" dataKey="sharpe" stroke="#7c3aed" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-slate-400 text-xs font-mono">Need 30+ days of trade data</div>
              )}
            </div>
          </div>

          {/* ── LOSS INVESTIGATION ─────────────────────────────────────────── */}
          <div className="p-5 rounded-xl bg-red-50 border border-red-200 shadow-sm">
            <h2 className="font-bold text-base text-red-800 mb-4 flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-600" />
              Loss Investigation — Why Did We Lose?
              <span className="ml-2 text-[11px] font-mono bg-red-100 text-red-700 px-2 py-0.5 rounded-full border border-red-300">
                {lossTrades.length} losing trades · ${Math.abs(lossTrades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)).toFixed(2)} total losses
              </span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Loss by reason */}
              <div className="bg-white rounded-xl border border-red-100 p-4">
                <h4 className="font-semibold text-xs text-slate-700 mb-3 flex items-center gap-1.5">
                  <AlertTriangle size={11} className="text-amber-500" /> Loss Cause Analysis
                </h4>
                {lossByReason.length ? lossByReason.map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                    <div>
                      <div className="font-mono text-xs text-slate-800">{r.reason}</div>
                      <div className="font-mono text-[10px] text-slate-400">{r.count} trade{r.count !== 1 ? 's' : ''}</div>
                    </div>
                    <span className="font-bold font-mono text-xs text-red-600">${r.pnl.toFixed(2)}</span>
                  </div>
                )) : <div className="text-xs text-slate-400 font-mono text-center py-4">No losses in range 🎉</div>}
              </div>

              {/* Worst assets */}
              <div className="bg-white rounded-xl border border-red-100 p-4">
                <h4 className="font-semibold text-xs text-slate-700 mb-3 flex items-center gap-1.5">
                  <TrendingDown size={11} className="text-red-500" /> Worst Performing Assets
                </h4>
                {lossByAsset.length ? lossByAsset.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs bg-slate-100 rounded px-1.5 py-0.5 text-slate-700 font-mono">{a.asset}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{a.count}×</span>
                    </div>
                    <span className="font-bold font-mono text-xs text-red-600">${a.pnl.toFixed(2)}</span>
                  </div>
                )) : <div className="text-xs text-slate-400 font-mono text-center py-4">No loss data</div>}
              </div>

              {/* Loss by hour */}
              <div className="bg-white rounded-xl border border-red-100 p-4">
                <h4 className="font-semibold text-xs text-slate-700 mb-3 flex items-center gap-1.5">
                  <Clock size={11} className="text-blue-500" /> Losses by Hour of Day
                </h4>
                {lossByHour.length ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={lossByHour} barSize={12}>
                      <XAxis dataKey="hour" tick={{ fontSize: 8, fontFamily: 'monospace' }} />
                      <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'Loss']} />
                      <Bar dataKey="pnl" fill="#dc2626" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div className="text-xs text-slate-400 font-mono text-center py-8">No hour data</div>}
              </div>
            </div>
          </div>

          {/* Worst Trades Table */}
          {worstTrades.length > 0 && (
            <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
              <h3 className="font-semibold text-sm text-slate-800 mb-4 flex items-center gap-2">
                <TrendingDown size={14} className="text-red-500" /> 10 Worst Trades — Full Postmortem
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      {['Asset', 'Market', 'Type', 'Entry', 'Exit', 'P&L', 'Loss Cause', 'Opened'].map(h => (
                        <th key={h} className="py-2.5 px-3 text-[10px] uppercase font-bold tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {worstTrades.map((t, i) => (
                      <tr key={t.id ?? i} className="hover:bg-red-50/50 transition-colors">
                        <td className="py-2.5 px-3 font-bold text-slate-900">{t.asset ?? t.symbol ?? '—'}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            t.market === 'crypto' ? 'bg-orange-50 text-orange-700' :
                            t.market === 'polymarket' ? 'bg-purple-50 text-purple-700' :
                            'bg-blue-50 text-blue-700'
                          }`}>{(t.market ?? 'STOCK').toUpperCase()}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.type === 'BUY' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {t.type ?? '—'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 tabular-nums text-slate-700">{t.entryPrice ? `$${Number(t.entryPrice).toFixed(2)}` : '—'}</td>
                        <td className="py-2.5 px-3 tabular-nums text-slate-500">{t.exitPrice ? `$${Number(t.exitPrice).toFixed(2)}` : '—'}</td>
                        <td className="py-2.5 px-3 font-bold text-red-600 tabular-nums">{`$${Number(t.pnl).toFixed(2)}`}</td>
                        <td className="py-2.5 px-3 text-amber-700 font-semibold">{classifyLoss(t)}</td>
                        <td className="py-2.5 px-3 text-slate-400">{t.openedAt ? format(new Date(t.openedAt), 'MM/dd HH:mm') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daily P&L bar with running total */}
          {dailyPnl.length > 0 && (
            <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
              <h3 className="font-semibold text-sm text-slate-800 mb-4 flex items-center gap-2">
                <BarChart3 size={14} className="text-blue-500" /> Daily P&L — Last {dayCount} Days
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dailyPnl} barSize={16}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'monospace' }} tickFormatter={d => format(parseISO(d), 'MM/dd')} />
                  <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} tickFormatter={v => `$${v}`} width={55} />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Tooltip formatter={(v: number) => [`${v >= 0 ? '+' : ''}$${v.toFixed(2)}`, 'Day P&L']}
                    labelFormatter={(l: string) => format(parseISO(l), 'EEEE MMM d')} />
                  <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                    {dailyPnl.map((entry, i) => (
                      <Cell key={i} fill={entry.pnl >= 0 ? '#059669' : '#dc2626'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
