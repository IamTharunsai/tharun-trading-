import { useStore } from '../../store';
import { Briefcase } from 'lucide-react';

interface Position { asset: string; quantity: number; entryPrice: number; currentPrice: number; unrealizedPnl: number; unrealizedPnlPct: number; stopLossPrice: number; takeProfitPrice: number; }

export default function ActivePositions({ positions }: { positions?: Position[] }) {
  const prices = useStore(s => s.prices);
  const posList = Array.isArray(positions) ? positions : Array.isArray((positions as any)?.positions) ? (positions as any).positions : [];

  return (
    <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Briefcase size={16} className="text-emerald-600" />
        <span className="font-semibold text-slate-900 text-sm">Active Institutional Positions</span>
        <span className="ml-auto font-mono text-xs text-slate-500 font-semibold">{posList.length} open</span>
      </div>

      {posList.length === 0 ? (
        <div className="text-center py-8 font-mono text-xs text-slate-400">No active positions open</div>
      ) : (
        <div className="space-y-2.5">
          {posList.map((pos: any) => {
            const livePrice = prices[pos.asset]?.price || pos.currentPrice;
            const livePnl = (livePrice - pos.entryPrice) * pos.quantity;
            const livePnlPct = ((livePrice - pos.entryPrice) / (pos.entryPrice || 1)) * 100;
            const isPos = livePnl >= 0;

            return (
              <div key={pos.asset} className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900 text-sm">{pos.asset}</span>
                    <span className="font-mono text-xs text-slate-500 ml-2">Qty: {pos.quantity.toFixed(4)}</span>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono font-bold text-sm tabular-nums ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>
                      {isPos ? '+' : ''}${livePnl.toFixed(2)}
                    </div>
                    <div className={`font-mono text-xs font-semibold tabular-nums ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>
                      {isPos ? '+' : ''}{livePnlPct.toFixed(2)}%
                    </div>
                  </div>
                </div>
                {/* Progress bar: stop-loss to take-profit */}
                <div className="mt-2.5">
                  <div className="flex justify-between font-mono text-[10px] text-slate-500 mb-1">
                    <span>🛑 ${(pos.stopLossPrice || 0).toFixed(2)}</span>
                    <span className="text-slate-900 font-bold">${livePrice.toFixed(2)}</span>
                    <span>🎯 ${(pos.takeProfitPrice || 0).toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.max(0, ((livePrice - (pos.stopLossPrice || 0)) / ((pos.takeProfitPrice || 1) - (pos.stopLossPrice || 0))) * 100))}%`,
                        background: isPos ? '#059669' : '#DC2626'
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
