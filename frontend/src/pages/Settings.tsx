import { useQuery } from '@tanstack/react-query';
import { getSettings } from '../services/api';
import { Settings, Shield, Zap, AlertTriangle } from 'lucide-react';

export default function SettingsPage() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const Section = ({ title, icon, children }: any) => (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="font-sans font-semibold text-apex-text">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );

  const SettingRow = ({ label, value, desc }: { label: string; value: any; desc?: string }) => (
    <div className="flex items-center justify-between py-2 border-b border-apex-border/40 last:border-0">
      <div>
        <div className="font-sans text-sm text-apex-text">{label}</div>
        {desc && <div className="font-mono text-[10px] text-apex-muted mt-0.5">{desc}</div>}
      </div>
      <span className="font-mono text-sm font-bold text-apex-accent">{value}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings size={20} className="text-apex-accent" />
        <h1 className="font-sans font-bold text-2xl text-apex-text">Settings</h1>
      </div>

      <div className="p-4 rounded-lg bg-apex-yellow/10 border border-apex-yellow/30 flex items-center gap-3">
        <AlertTriangle size={16} className="text-apex-yellow flex-shrink-0" />
        <p className="font-mono text-xs text-apex-yellow">Settings are configured via the .env file on the server. Restart the backend to apply changes.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Trading Mode" icon={<Zap size={16} className="text-apex-accent" />}>
          <SettingRow label="Mode" value={settings?.tradingMode?.toUpperCase() || 'PAPER'} desc="paper = no real money. live = real execution." />
          <SettingRow label="Min Agent Votes to Execute" value={`${settings?.minVotesToExecute || 7}/10`} desc="Minimum council votes required" />
          <SettingRow label="Min Agent Confidence" value={`${settings?.minAgentConfidence || 65}%`} desc="Average confidence threshold" />
        </Section>

        <Section title="Risk Per Trade" icon={<Shield size={16} className="text-apex-accent" />}>
          <SettingRow label="Max Risk Per Trade" value={`${settings?.maxRiskPerTrade || 1}%`} desc="% of portfolio risked per trade" />
          <SettingRow label="Max Position Size" value={`${settings?.maxPositionSize || 10}%`} desc="Max % of portfolio in one asset" />
          <SettingRow label="Stop Loss — Crypto" value={`${settings?.stopLossCrypto || 3}%`} desc="Auto stop-loss for crypto" />
          <SettingRow label="Stop Loss — Stocks" value={`${settings?.stopLossStocks || 2}%`} desc="Auto stop-loss for stocks" />
          <SettingRow label="Take Profit" value={`${settings?.takeProfitPct || 6}%`} desc="Auto take-profit level" />
        </Section>

        <Section title="Portfolio Guardrails" icon={<Shield size={16} className="text-apex-red" />}>
          <SettingRow label="Daily Loss Limit" value={`${settings?.dailyLossLimit || 5}%`} desc="Halts trading when hit" />
          <SettingRow label="Weekly Drawdown Limit" value={`${settings?.weeklyDrawdownLimit || 10}%`} desc="Pauses trading when hit" />
          <SettingRow label="Max Drawdown (all-time)" value={`${settings?.maxDrawdown || 20}%`} desc="Emergency stop + kill switch" />
          <SettingRow label="Cash Reserve" value={`${settings?.cashReserve || 30}%`} desc="Always kept in cash" />
          <SettingRow label="Max Trades Per Day" value={settings?.maxTradesPerDay || 50} desc="Daily execution cap" />
        </Section>

        <Section title="System" icon={<Settings size={16} className="text-apex-muted" />}>
          <SettingRow label="Backend" value="Node.js + TypeScript" />
          <SettingRow label="AI Engine" value="Claude Sonnet (10 agents)" />
          <SettingRow label="Data Feed" value="Binance WS + Polygon.io" />
          <SettingRow label="Database" value="PostgreSQL + Prisma" />
          <SettingRow label="Cache" value="Redis" />
          <SettingRow label="Auth" value="JWT + TOTP 2FA" />
        </Section>
      </div>
    </div>
  );
}
