import { useStore } from '../../store';
import { Briefcase } from 'lucide-react';

interface Position { asset: string; quantity: number; entryPrice: number; currentPrice: number; unrealizedPnl: number; unrealizedPnlPct: number; stopLossPrice: number; takeProfitPrice: number; }

export default function ActivePositions({ positions }: { positions: Position[] }) {
  const prices = useStore(s => s.prices);

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Briefcase size={16} className="text-apex-accent" />
        <span className="font-sans font-semibold text-apex-text">Active Positions</span>
        <span className="ml-auto font-mono text-xs text-apex-muted">{positions.length} open</span>
      </div>

      {positions.length === 0 ? (
        <div className="text-center py-8 font-mono text-xs text-apex-muted">No open positions</div>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const livePrice = prices[pos.asset]?.price || pos.currentPrice;
            const livePnl = (livePrice - pos.entryPrice) * pos.quantity;
            const livePnlPct = ((livePrice - pos.entryPrice) / pos.entryPrice) * 100;
            const isPos = livePnl >= 0;

            return (
              <div key={pos.asset} className="p-3 rounded-lg bg-apex-surface border border-apex-border">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-sans font-bold text-apex-text">{pos.asset}</span>
                    <span className="font-mono text-xs text-apex-muted ml-2">{pos.quantity.toFixed(4)}</span>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono font-bold text-sm ${isPos ? 'text-apex-green' : 'text-apex-red'}`}>
                      {isPos ? '+' : ''}${livePnl.toFixed(2)}
                    </div>
                    <div className={`font-mono text-xs ${isPos ? 'text-apex-green' : 'text-apex-red'}`}>
                      {isPos ? '+' : ''}{livePnlPct.toFixed(2)}%
                    </div>
                  </div>
                </div>
                {/* Progress bar: stop-loss to take-profit */}
                <div className="mt-2">
                  <div className="flex justify-between font-mono text-[10px] text-apex-muted mb-0.5">
                    <span>🛑 ${pos.stopLossPrice.toFixed(2)}</span>
                    <span className="text-apex-text">${livePrice.toFixed(2)}</span>
                    <span>🎯 ${pos.takeProfitPrice.toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 bg-apex-border rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, Math.max(0, ((livePrice - pos.stopLossPrice) / (pos.takeProfitPrice - pos.stopLossPrice)) * 100))}%`,
                        background: isPos ? '#00FF88' : '#FF3B5C'
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
