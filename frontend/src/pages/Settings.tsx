import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, getLiveAccounts, connectAlpaca, connectPolymarket, disconnectAccount } from '../services/api';
import {
  Settings, Shield, Zap, AlertTriangle, Wallet, CheckCircle2,
  XCircle, RefreshCw, Key, Globe, DollarSign, Activity, Unlink, ExternalLink
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const { data: liveAccounts, isLoading: loadingAccounts } = useQuery({
    queryKey: ['live-accounts'],
    queryFn: getLiveAccounts,
    refetchInterval: 10000,
  });

  // Alpaca Form State
  const [alpacaKey, setAlpacaKey] = useState('');
  const [alpacaSecret, setAlpacaSecret] = useState('');
  const [alpacaPaper, setAlpacaPaper] = useState(true);

  // Polymarket Form State
  const [polyAddress, setPolyAddress] = useState('');
  const [polyPrivateKey, setPolyPrivateKey] = useState('');

  // Alpaca Connect Mutation
  const alpacaMutation = useMutation({
    mutationFn: () => connectAlpaca({ apiKey: alpacaKey, secretKey: alpacaSecret, paperMode: alpacaPaper }),
    onSuccess: (data) => {
      toast.success(`✅ Alpaca Connected! Account: ${data?.account?.accountNumber || 'Active'}`);
      queryClient.invalidateQueries({ queryKey: ['live-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      setAlpacaKey('');
      setAlpacaSecret('');
    },
    onError: (err: any) => {
      toast.error(`Alpaca Connection Error: ${err.response?.data?.error || err.message}`);
    }
  });

  // Polymarket Connect Mutation
  const polyMutation = useMutation({
    mutationFn: () => connectPolymarket({ address: polyAddress, privateKey: polyPrivateKey }),
    onSuccess: (data) => {
      toast.success(`✅ Polymarket Connected! USDC: $${(data?.account?.usdcBalance || 0).toFixed(2)}`);
      queryClient.invalidateQueries({ queryKey: ['live-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      setPolyAddress('');
      setPolyPrivateKey('');
    },
    onError: (err: any) => {
      toast.error(`Polymarket Connection Error: ${err.response?.data?.error || err.message}`);
    }
  });

  // Disconnect Mutation
  const disconnectMutation = useMutation({
    mutationFn: (type: 'alpaca' | 'polymarket') => disconnectAccount(type),
    onSuccess: (_, type) => {
      toast.success(`${type.toUpperCase()} disconnected`);
      queryClient.invalidateQueries({ queryKey: ['live-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    }
  });

  const Section = ({ title, icon, badge, children }: any) => (
    <div className="card glass-panel bg-[#0F172A]/80 border border-slate-700/60 rounded-xl p-5 shadow-xl">
      <div className="flex items-center justify-between mb-4 border-b border-slate-700/50 pb-3">
        <div className="flex items-center gap-2.5">
          {icon}
          <h2 className="font-sans font-bold text-base text-white">{title}</h2>
        </div>
        {badge}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );

  const SettingRow = ({ label, value, desc }: { label: string; value: any; desc?: string }) => (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-800/80 last:border-0">
      <div>
        <div className="font-sans text-xs font-semibold text-slate-200">{label}</div>
        {desc && <div className="font-mono text-[10px] text-slate-400 mt-0.5">{desc}</div>}
      </div>
      <span className="font-mono text-xs font-bold text-emerald-400">{value}</span>
    </div>
  );

  const alpaca = liveAccounts?.alpaca;
  const poly = liveAccounts?.polymarket;

  return (
    <div className="space-y-8 max-w-7xl mx-auto text-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <Settings size={22} className="text-emerald-400" />
            </div>
            <div>
              <h1 className="font-display font-bold text-2xl text-white tracking-tight">Terminal Settings & Real Accounts</h1>
              <p className="font-mono text-xs text-slate-400 mt-0.5">
                Connect your real Alpaca Brokerage & Polymarket Web3 Accounts for 100% Live Execution
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 font-mono text-xs">
            <span className="text-slate-400">Total Live Equity:</span>
            <span className="text-emerald-400 font-bold">${((liveAccounts?.combinedLiveEquity || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['live-accounts'] })}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
            title="Refresh Live Data"
          >
            <RefreshCw size={14} className={loadingAccounts ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── LIVE ACCOUNT CONNECTION HUB ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* 1. ALPACA LIVE BROKER */}
        <Section
          title="Alpaca Brokerage Account"
          icon={<Globe size={18} className="text-amber-400" />}
          badge={
            alpaca?.connected ? (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 size={10} /> CONNECTED ({alpaca.paperMode ? 'PAPER' : 'LIVE'})
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-slate-700 text-slate-300">
                <XCircle size={10} /> NOT CONNECTED
              </span>
            )
          }
        >
          {alpaca?.connected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <div className="font-mono text-[10px] text-slate-400">PORTFOLIO VALUE</div>
                  <div className="font-mono text-base font-bold text-white mt-1">
                    ${alpaca.portfolioValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <div className="font-mono text-[10px] text-slate-400">CASH AVAILABLE</div>
                  <div className="font-mono text-base font-bold text-emerald-400 mt-1">
                    ${alpaca.cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <div className="font-mono text-[10px] text-slate-400">BUYING POWER</div>
                  <div className="font-mono text-base font-bold text-amber-400 mt-1">
                    ${alpaca.buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <div className="font-mono text-[10px] text-slate-400">OPEN POSITIONS</div>
                  <div className="font-mono text-base font-bold text-cyan-400 mt-1">
                    {alpaca.positionsCount}
                  </div>
                </div>
              </div>

              {alpaca.positions && alpaca.positions.length > 0 && (
                <div className="space-y-2 mt-3">
                  <div className="font-mono text-xs text-slate-400 font-semibold">Live Alpaca Holdings:</div>
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {alpaca.positions.map((pos: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800 font-mono text-xs">
                        <span className="font-bold text-white">{pos.symbol} ({pos.qty} shs)</span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-300">${pos.currentPrice}</span>
                          <span className={pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)} ({pos.unrealizedPnlPct.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between">
                <span className="font-mono text-[11px] text-slate-400">Account #{alpaca.accountNumber}</span>
                <button
                  onClick={() => disconnectMutation.mutate('alpaca')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono text-xs transition-colors"
                >
                  <Unlink size={12} /> Disconnect Account
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-sans text-xs text-slate-300">
                Enter your Alpaca API credentials to pull real-time portfolio balance, trade US equities live, and track real filled positions.
              </p>
              
              <div className="space-y-2.5">
                <div>
                  <label className="block font-mono text-[10px] text-slate-400 uppercase tracking-wider mb-1">
                    Alpaca API Key ID
                  </label>
                  <div className="relative">
                    <Key size={13} className="absolute left-3 top-3 text-slate-500" />
                    <input
                      type="text"
                      value={alpacaKey}
                      onChange={(e) => setAlpacaKey(e.target.value)}
                      placeholder="PKXXXXXXXXXXXXXXXXXX"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 pl-9 pr-3 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-slate-400 uppercase tracking-wider mb-1">
                    Alpaca Secret Key
                  </label>
                  <div className="relative">
                    <Key size={13} className="absolute left-3 top-3 text-slate-500" />
                    <input
                      type="password"
                      value={alpacaSecret}
                      onChange={(e) => setAlpacaSecret(e.target.value)}
                      placeholder="••••••••••••••••••••••••••••••••"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 pl-9 pr-3 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="paperToggle"
                      checked={alpacaPaper}
                      onChange={(e) => setAlpacaPaper(e.target.checked)}
                      className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                    />
                    <label htmlFor="paperToggle" className="font-mono text-xs text-slate-300 cursor-pointer">
                      Paper Trading Mode (Recommended for testing)
                    </label>
                  </div>
                  <a
                    href="https://app.alpaca.markets/paper/dashboard/overview"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-mono text-[10px] text-emerald-400 hover:underline"
                  >
                    Get Alpaca Keys <ExternalLink size={10} />
                  </a>
                </div>

                <button
                  onClick={() => alpacaMutation.mutate()}
                  disabled={!alpacaKey || !alpacaSecret || alpacaMutation.isPending}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-mono text-xs font-bold transition-colors shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2"
                >
                  {alpacaMutation.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                  Connect & Sync Alpaca Live
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* 2. POLYMARKET WEB3 WALLET */}
        <Section
          title="Polymarket Account & Polygon Wallet"
          icon={<Wallet size={18} className="text-cyan-400" />}
          badge={
            poly?.connected ? (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                <CheckCircle2 size={10} /> CONNECTED (POLYGON)
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-slate-700 text-slate-300">
                <XCircle size={10} /> NOT CONNECTED
              </span>
            )
          }
        >
          {poly?.connected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <div className="font-mono text-[10px] text-slate-400">TOTAL POLY VALUE</div>
                  <div className="font-mono text-base font-bold text-white mt-1">
                    ${poly.portfolioValue.toFixed(2)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <div className="font-mono text-[10px] text-slate-400">USDC BALANCE</div>
                  <div className="font-mono text-base font-bold text-emerald-400 mt-1">
                    ${poly.usdcBalance.toFixed(2)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <div className="font-mono text-[10px] text-slate-400">POL GAS</div>
                  <div className="font-mono text-base font-bold text-cyan-400 mt-1">
                    {poly.polBalance.toFixed(3)} POL
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <div className="font-mono text-[10px] text-slate-400">POSITIONS</div>
                  <div className="font-mono text-base font-bold text-purple-400 mt-1">
                    {poly.positionsCount}
                  </div>
                </div>
              </div>

              {poly.positions && poly.positions.length > 0 && (
                <div className="space-y-2 mt-3">
                  <div className="font-mono text-xs text-slate-400 font-semibold">Active Polymarket Positions:</div>
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {poly.positions.map((pos: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800 font-mono text-xs">
                        <span className="font-bold text-white truncate max-w-[200px]" title={pos.title}>{pos.title}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-300">{pos.outcome} @ ${(pos.currentPrice || pos.avgPrice).toFixed(2)}</span>
                          <span className={pos.cashPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {pos.cashPnl >= 0 ? '+' : ''}${pos.cashPnl.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between">
                <span className="font-mono text-[11px] text-slate-400 truncate max-w-[280px]" title={poly.address}>
                  Wallet: {poly.address}
                </span>
                <button
                  onClick={() => disconnectMutation.mutate('polymarket')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono text-xs transition-colors"
                >
                  <Unlink size={12} /> Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-sans text-xs text-slate-300">
                Connect your Polygon wallet address to query your real USDC balance on Polygon and monitor all your live Polymarket positions in real-time.
              </p>

              <div className="space-y-2.5">
                <div>
                  <label className="block font-mono text-[10px] text-slate-400 uppercase tracking-wider mb-1">
                    Polygon Wallet Address (0x...)
                  </label>
                  <div className="relative">
                    <Globe size={13} className="absolute left-3 top-3 text-slate-500" />
                    <input
                      type="text"
                      value={polyAddress}
                      onChange={(e) => setPolyAddress(e.target.value)}
                      placeholder="0x71C...392"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 pl-9 pr-3 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-slate-400 uppercase tracking-wider mb-1">
                    Private Key (Optional — for automated on-chain order placement)
                  </label>
                  <div className="relative">
                    <Key size={13} className="absolute left-3 top-3 text-slate-500" />
                    <input
                      type="password"
                      value={polyPrivateKey}
                      onChange={(e) => setPolyPrivateKey(e.target.value)}
                      placeholder="Leave empty for read-only live portfolio monitoring"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 pl-9 pr-3 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <button
                  onClick={() => polyMutation.mutate()}
                  disabled={!polyAddress || polyMutation.isPending}
                  className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-mono text-xs font-bold transition-colors shadow-lg shadow-cyan-900/30 flex items-center justify-center gap-2"
                >
                  {polyMutation.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Wallet size={13} />}
                  Connect & Query Polymarket
                </button>
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* ── AUTONOMOUS ENGINE & RISK PARAMETERS ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Autonomous Engine Rules" icon={<Zap size={16} className="text-emerald-400" />}>
          <SettingRow label="Execution Mode" value={settings?.tradingMode?.toUpperCase() || 'PAPER'} desc="Real orders routed when live keys are connected" />
          <SettingRow label="Min Council Votes to Execute" value={`${settings?.minVotesToExecute || 7}/10`} desc="Minimum consensus threshold" />
          <SettingRow label="Min Agent Confidence" value={`${settings?.minAgentConfidence || 65}%`} desc="Average confidence gate" />
          <SettingRow label="Stop-Loss Method" value={settings?.stopLossMethod || 'ATR-based (dynamic)'} desc="Calculated from asset volatility" />
          <SettingRow label="Take-Profit Ratio" value={settings?.takeProfitMethod || '2.5x stop distance'} desc="Minimum 2:1 risk/reward" />
        </Section>

        <Section title="Risk Guardrails & Circuit Breakers" icon={<Shield size={16} className="text-rose-400" />}>
          <SettingRow label="Max Risk Per Trade" value={`${settings?.maxRiskPerTrade || 1}%`} desc="% of portfolio risked per signal" />
          <SettingRow label="Max Position Size" value={`${settings?.maxPositionSize || 10}%`} desc="Maximum capital in any single asset" />
          <SettingRow label="Daily Loss Limit" value={`${settings?.dailyLossLimit || 5}%`} desc="Halts trading when reached" />
          <SettingRow label="Weekly Drawdown Limit" value={`${settings?.weeklyDrawdownLimit || 10}%`} desc="Pauses trading for regime review" />
          <SettingRow label="Max All-Time Drawdown" value={`${settings?.maxDrawdown || 20}%`} desc="Emergency stop + kill switch" />
          <SettingRow label="Cash Reserve Protection" value={`${settings?.cashReserve || 30}%`} desc="Always kept liquid" />
        </Section>
      </div>
    </div>
  );
}
