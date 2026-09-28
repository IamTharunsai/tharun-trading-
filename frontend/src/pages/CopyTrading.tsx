import { Users, ShieldAlert, AlertTriangle, ArrowLeft, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import LastUpdated from '../components/common/LastUpdated';

export default function CopyTradingPage() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-2xl glass-panel bg-[#0B101D]/80 border border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <Users size={20} className="text-amber-400" />
            <h1 className="font-sans font-bold text-2xl text-white">Social & Copy Trading Engine</h1>
          </div>
          <p className="font-mono text-xs text-slate-400 mt-1">
            Institutional multi-account allocation & signal following
          </p>
        </div>
        <LastUpdated />
      </div>

      {/* Feature Unavailable / Compliance Notice */}
      <div className="p-8 sm:p-12 rounded-2xl glass-panel bg-[#0B101D]/90 border border-amber-500/30 text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 mx-auto">
          <ShieldAlert size={32} />
        </div>

        <div className="space-y-2 max-w-xl mx-auto">
          <div className="inline-block px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 font-mono text-xs font-bold uppercase tracking-wider mb-2">
            MODULE DISCONNECTED · AUDIT IN PROGRESS
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Copy Trading Is Temporarily Unavailable
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed font-sans">
            In compliance with our strict non-negotiable data integrity and fiduciary auditing standards, copy trading has been placed on standby.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left font-mono text-xs">
          <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-1.5">
            <span className="text-slate-400">DATA INTEGRITY:</span>
            <div className="text-white font-bold">Zero Synthetic Traders</div>
            <p className="text-[11px] text-slate-500">Fabricated profiles, simulated AUM, and backfilled win-rates have been purged.</p>
          </div>

          <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-1.5">
            <span className="text-slate-400">VERIFICATION:</span>
            <div className="text-amber-300 font-bold">Broker API Required</div>
            <p className="text-[11px] text-slate-500">Requires verified multi-broker master sub-account authorization (IBKR / Alpaca).</p>
          </div>

          <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-1.5">
            <span className="text-slate-400">STATUS:</span>
            <div className="text-rose-400 font-bold">Execution Blocked</div>
            <p className="text-[11px] text-slate-500">No client orders can be mirrored until authentic provider verification completes.</p>
          </div>
        </div>

        <div className="pt-4 flex items-center justify-center gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-mono font-bold text-xs transition"
          >
            <ArrowLeft size={14} />
            <span>RETURN TO TRADING COCKPIT</span>
          </Link>
          <Link
            to="/trades"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-mono text-xs transition"
          >
            <span>VIEW VERIFIED TRADES</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
