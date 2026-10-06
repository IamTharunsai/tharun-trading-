import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getStocksUniverse, getStockDetail, getStockCandles,
  getAllStocksFiltered, getCrossIndustryRipple, triggerDebate
} from '../services/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { isCryptoSymbol } from '../constants/assets';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Scatter
} from 'recharts';
import {
  Search, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp,
  X, BarChart2, Activity, Globe, Zap, Layers, ArrowUpRight, ShieldCheck, Sparkles
} from 'lucide-react';
import { APEX_COLORS } from '../constants/colors';
import LastUpdated from '../components/common/LastUpdated';

const C = APEX_COLORS;

const US_GICS_SECTORS = [
  'All Sectors',
  'Technology',
  'Healthcare',
  'Energy',
  'Utilities',
  'Financial Services',
  'Industrials',
  'Consumer Cyclical',
  'Consumer Defensive',
  'Basic Materials',
  'Real Estate',
  'Communication Services'
];

type SortKey = 'name' | 'lastVote' | 'debateCount' | 'tradeCount' | 'totalPnl' | 'winRate';
type FilterKey = 'all' | 'traded' | 'open' | 'buy' | 'sell';

// ── VOTE BADGE ────────────────────────────────────────────────────────────────
function VoteBadge({ vote }: { vote: string }) {
  const v = vote?.toUpperCase();
  const color = v?.includes('BUY') ? C.green : v?.includes('SELL') ? C.red : C.yellow;
  return (
    <span style={{
      fontFamily: 'Space Mono', fontSize: 10, fontWeight: 700,
      padding: '2px 7px', borderRadius: 4,
      background: `${color}18`, border: `1px solid ${color}40`, color,
    }}>{v || '—'}</span>
  );
}

// ── CHART WITH ENTRY/EXIT DOTS ────────────────────────────────────────────────
function StockChart({ symbol, market, trades }: { symbol: string; market: string; trades: any[] }) {
  const { data, isLoading } = useQuery({
    queryKey: ['candles', symbol, market],
    queryFn: () => getStockCandles(symbol, market),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return (
    <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Space Mono', fontSize: 11, color: C.muted }}>
      Loading chart…
    </div>
  );

  const candles = data?.candles || [];
  if (candles.length < 3) return (
    <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Space Mono', fontSize: 11, color: C.muted }}>
      Not enough price data yet — agents will populate this on next analysis
    </div>
  );

  // Build price line
  const chartData = candles.map((c: any, i: number) => ({
    i,
    time: format(new Date(c.timestamp), 'MM/dd'),
    price: parseFloat(c.close.toFixed(2)),
  }));

  // Map trades to chart indices (find closest candle by timestamp)
  const entryDots: any[] = [];
  const exitDots: any[] = [];
  trades.forEach(t => {
    const openTs = new Date(t.openedAt).getTime();
    let closestOpen = 0;
    candles.forEach((c: any, i: number) => {
      if (Math.abs(c.timestamp - openTs) < Math.abs(candles[closestOpen].timestamp - openTs)) closestOpen = i;
    });
    entryDots.push({ i: closestOpen, price: t.entryPrice, label: `BUY $${t.entryPrice?.toFixed(2)}` });

    if (t.exitPrice && t.closedAt) {
      const closeTs = new Date(t.closedAt).getTime();
      let closestClose = 0;
      candles.forEach((c: any, i: number) => {
        if (Math.abs(c.timestamp - closeTs) < Math.abs(candles[closestClose].timestamp - closeTs)) closestClose = i;
      });
      const isWin = (t.pnl || 0) >= 0;
      exitDots.push({ i: closestClose, price: t.exitPrice, pnl: t.pnl, isWin, label: `${isWin ? '+' : ''}$${t.pnl?.toFixed(2)}` });
    }
  });

  // Embed dots into chartData
  const enriched = chartData.map((d: any) => {
    const entry = entryDots.find(e => e.i === d.i);
    const exit = exitDots.find(e => e.i === d.i);
    return { ...d, entryDot: entry ? d.price : null, exitDot: exit ? d.price : null, exitWin: exit?.isWin };
  });

  const prices = chartData.map((d: any) => d.price);
  const minP = Math.min(...prices) * 0.995;
  const maxP = Math.max(...prices) * 1.005;
  const isUp = prices[prices.length - 1] >= prices[0];

  const CustomDot = (props: any) => {
    const { cx, cy, payload, dataKey } = props;
    if (payload[dataKey] === null) return null;
    const isEntry = dataKey === 'entryDot';
    const color = isEntry ? C.green : (payload.exitWin ? C.green : C.red);
    return <circle cx={cx} cy={cy} r={6} fill={color} stroke="#fff" strokeWidth={2} />;
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontFamily: 'Space Mono', fontSize: 11 }}>
        <div style={{ color: C.muted }}>{d.time}</div>
        <div style={{ color: C.text, fontWeight: 700 }}>${d.price}</div>
        {d.entryDot && <div style={{ color: C.green }}>▲ ENTRY ${d.entryDot}</div>}
        {d.exitDot && <div style={{ color: d.exitWin ? C.green : C.red }}>● EXIT ${d.exitDot}</div>}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={enriched} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad_${symbol}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={isUp ? C.green : C.red} stopOpacity={0.15} />
            <stop offset="95%" stopColor={isUp ? C.green : C.red} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
        <XAxis dataKey="time" tick={{ fontSize: 9, fill: C.muted, fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis domain={[minP, maxP]} tick={{ fontSize: 9, fill: C.muted, fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={60} />
        <Tooltip content={<CustomTooltip />} />
        <Line type="monotone" dataKey="price" stroke={isUp ? C.green : C.red} strokeWidth={2} dot={false} />
        <Scatter dataKey="entryDot" shape={<CustomDot dataKey="entryDot" />} />
        <Scatter dataKey="exitDot" shape={<CustomDot dataKey="exitDot" />} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── STOCK DETAIL DRAWER ───────────────────────────────────────────────────────
function StockDetailDrawer({ stock, onClose }: { stock: any; onClose: () => void }) {
  const market = isCryptoSymbol(stock.symbol) ? 'crypto' : 'stocks';
  const { data, isLoading } = useQuery({
    queryKey: ['stock-detail', stock.symbol],
    queryFn: () => getStockDetail(stock.symbol, market),
    staleTime: 2 * 60 * 1000,
  });

  const trades = data?.trades || [];
  const decisions = data?.decisions || [];
  const fund = data?.fundamentals;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(20,23,31,0.45)', display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: 'min(700px, 100vw)', height: '100%', background: C.bg,
        borderLeft: `1px solid ${C.border}`, overflowY: 'auto', padding: 28,
        display: 'flex', flexDirection: 'column', gap: 20,
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Manrope', fontWeight: 800, fontSize: 22, color: C.text }}>{stock.name !== stock.symbol ? stock.name : stock.symbol}</span>
              <span style={{ fontFamily: 'Space Mono', fontSize: 13, color: C.accent, fontWeight: 700 }}>{stock.symbol}</span>
              {stock.sector && <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.muted, padding: '2px 8px', borderRadius: 4, background: C.card, border: `1px solid ${C.border}` }}>{stock.sector}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <VoteBadge vote={stock.lastVote} />
              <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.muted }}>{stock.debateCount} debates</span>
              {stock.hasOpenPosition && <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.green, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: `${C.green}18`, border: `1px solid ${C.green}40` }}>● OPEN POSITION</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 4 }}><X size={20} /></button>
        </div>

        {/* Key stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {[
            { label: 'Trades', value: stock.tradeCount },
            { label: 'Win Rate', value: stock.winRate != null ? `${stock.winRate}%` : '—' },
            { label: 'Total P&L', value: stock.totalPnl !== 0 ? `${stock.totalPnl >= 0 ? '+' : ''}$${stock.totalPnl}` : '—', color: stock.totalPnl >= 0 ? C.green : C.red },
            { label: 'Mkt Cap', value: fund?.marketCap ? `$${(fund.marketCap / 1e9).toFixed(1)}B` : '—' },
          ].map(s => (
            <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontFamily: 'Manrope', fontWeight: 700, fontSize: 15, color: (s as any).color || C.text }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Open position bar */}
        {stock.hasOpenPosition && (
          <div style={{ background: `${C.green}0f`, border: `1px solid ${C.green}40`, borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.green, fontWeight: 700 }}>OPEN POSITION</span>
              <span style={{ fontFamily: 'Space Mono', fontSize: 11, color: C.text, marginLeft: 12 }}>
                Entry: ${stock.entryPrice?.toFixed(2)} → Current: ${stock.currentPrice?.toFixed(2)}
              </span>
            </div>
            <span style={{ fontFamily: 'Space Mono', fontSize: 12, fontWeight: 700, color: (stock.openPositionPct || 0) >= 0 ? C.green : C.red }}>
              {(stock.openPositionPct || 0) >= 0 ? '+' : ''}{stock.openPositionPct?.toFixed(2)}% (${stock.openPositionPnl?.toFixed(2)})
            </span>
          </div>
        )}

        {/* Price chart */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 16px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <BarChart2 size={14} color={C.accent} />
            <span style={{ fontFamily: 'Manrope', fontWeight: 700, fontSize: 13, color: C.text }}>Price Chart</span>
            <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.muted }}>● Green = Entry &nbsp; ● Red/Green dot = Exit (win/loss)</span>
          </div>
          {isLoading ? <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Space Mono', fontSize: 11, color: C.muted }}>Loading…</div>
            : <StockChart symbol={stock.symbol} market={market} trades={trades} />}
        </div>

        {/* Agent decisions */}
        {decisions.length > 0 && (
          <div>
            <div style={{ fontFamily: 'Manrope', fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 10 }}>Agent Debate History</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {decisions.map((d: any) => (
                <div key={d.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <VoteBadge vote={d.finalVote} />
                      <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.muted }}>{d.goVotes}/{d.totalVotes} agents • {d.avgConfidence?.toFixed(0)}% conf</span>
                      <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: d.executed ? C.green : C.muted }}>{d.executed ? '✓ Executed' : 'Not executed'}</span>
                    </div>
                    <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.muted }}>{format(new Date(d.timestamp), 'MMM d, HH:mm')}</span>
                  </div>
                  {d.executionReason && <div style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.muted, lineHeight: 1.5, marginTop: 4 }}>{d.executionReason}</div>}
                  {/* Agent votes breakdown */}
                  {d.agentVotes && (() => {
                    try {
                      const votes: any[] = typeof d.agentVotes === 'string' ? JSON.parse(d.agentVotes) : d.agentVotes;
                      return (
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {votes.slice(0, 5).map((v: any) => (
                            <div key={v.agentId} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                              <span style={{ fontFamily: 'Space Mono', fontSize: 9, color: C.muted, flexShrink: 0, minWidth: 120 }}>{v.agentName}</span>
                              <VoteBadge vote={v.vote} />
                              <span style={{ fontFamily: 'Space Mono', fontSize: 9, color: C.muted, lineHeight: 1.4 }}>{v.reasoning?.slice(0, 100)}{v.reasoning?.length > 100 ? '…' : ''}</span>
                            </div>
                          ))}
                        </div>
                      );
                    } catch { return null; }
                  })()}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trade history */}
        {trades.length > 0 && (
          <div>
            <div style={{ fontFamily: 'Manrope', fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 10 }}>Trade History</div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Type', 'Entry', 'Exit', 'P&L', 'P&L%', 'Reason', 'Date'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'Space Mono', fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t: any) => {
                    const pos = (t.pnl || 0) >= 0;
                    return (
                      <tr key={t.id} style={{ borderBottom: `1px solid ${C.border}33` }}>
                        <td style={{ padding: '7px 12px' }}>
                          <span style={{ fontFamily: 'Space Mono', fontSize: 10, fontWeight: 700, color: t.type === 'BUY' ? C.green : C.red }}>{t.type}</span>
                        </td>
                        <td style={{ padding: '7px 12px', fontFamily: 'Space Mono', fontSize: 10, color: C.text }}>${t.entryPrice?.toFixed(2)}</td>
                        <td style={{ padding: '7px 12px', fontFamily: 'Space Mono', fontSize: 10, color: C.muted }}>{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '—'}</td>
                        <td style={{ padding: '7px 12px', fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: t.pnl != null ? (pos ? C.green : C.red) : C.muted }}>
                          {t.pnl != null ? `${pos ? '+' : ''}$${t.pnl.toFixed(2)}` : '—'}
                        </td>
                        <td style={{ padding: '7px 12px', fontFamily: 'Space Mono', fontSize: 10, color: t.pnlPct != null ? (pos ? C.green : C.red) : C.muted }}>
                          {t.pnlPct != null ? `${pos ? '+' : ''}${t.pnlPct.toFixed(2)}%` : '—'}
                        </td>
                        <td style={{ padding: '7px 12px', fontFamily: 'Space Mono', fontSize: 9, color: C.muted, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.exitReason || '—'}</td>
                        <td style={{ padding: '7px 12px', fontFamily: 'Space Mono', fontSize: 9, color: C.muted }}>{format(new Date(t.openedAt), 'MM/dd HH:mm')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {trades.length === 0 && decisions.length === 0 && !isLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: 'Space Mono', fontSize: 12, color: C.muted }}>
            No trades or debates recorded yet for {stock.symbol}
          </div>
        )}
      </div>
    </div>
  );
}

// ── STOCK CARD ────────────────────────────────────────────────────────────────
function StockCard({ stock, onClick }: { stock: any; onClick: () => void }) {
  const isTraded = stock.tradeCount > 0;
  const hasPos = stock.hasOpenPosition;
  const pnlPos = stock.totalPnl >= 0;

  return (
    <div onClick={onClick} style={{
      background: C.card,
      border: `1px solid ${hasPos ? `${C.green}60` : C.border}`,
      borderRadius: 12,
      padding: '14px 16px',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
      position: 'relative',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = hasPos ? `${C.green}60` : C.border)}
    >
      {hasPos && (
        <div style={{ position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
      )}

      {/* Company name + ticker */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontFamily: 'Manrope', fontWeight: 700, fontSize: 13, color: C.text, lineHeight: 1.3, paddingRight: 16 }}>
          {stock.name !== stock.symbol ? stock.name : <span style={{ color: C.accent }}>{stock.symbol}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: C.accent }}>{stock.symbol}</span>
          {stock.sector && <span style={{ fontFamily: 'Space Mono', fontSize: 9, color: C.muted, padding: '1px 5px', borderRadius: 3, background: `${C.border}80` }}>{stock.sector}</span>}
        </div>
      </div>

      {/* Vote + stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <VoteBadge vote={stock.lastVote} />
          <span style={{ fontFamily: 'Space Mono', fontSize: 9, color: C.muted }}>{stock.debateCount} debates</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          {isTraded ? (
            <>
              <div style={{ fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: pnlPos ? C.green : C.red }}>
                {pnlPos ? '+' : ''}${stock.totalPnl}
              </div>
              <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: C.muted }}>
                {stock.winRate != null ? `${stock.winRate}% win · ` : ''}{stock.tradeCount} trades
              </div>
            </>
          ) : (
            <span style={{ fontFamily: 'Space Mono', fontSize: 9, color: C.muted }}>No trades yet</span>
          )}
        </div>
      </div>

      {/* Mkt cap */}
      {stock.marketCap && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}50`, fontFamily: 'Space Mono', fontSize: 9, color: C.muted }}>
          Mkt Cap: ${(stock.marketCap / 1e9).toFixed(1)}B
          {stock.peRatio && ` · P/E ${stock.peRatio.toFixed(1)}`}
        </div>
      )}
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function StockUniversePage() {
  const [activeTab, setActiveTab] = useState<'all_us_market' | 'ripple_radar' | 'analyzed'>('all_us_market');
  const [search, setSearch] = useState('');
  const [selectedSector, setSelectedSector] = useState<string>('All Sectors');
  const [tradableOnly, setTradableOnly] = useState<boolean>(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sortBy, setSortBy] = useState<SortKey>('lastDebateAt' as any);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<any | null>(null);

  // 1. Full 10,400+ US Stock Marketplace Directory
  const { data: allStocksData, isLoading: allStocksLoading } = useQuery({
    queryKey: ['all-stocks', search, selectedSector, tradableOnly],
    queryFn: () => getAllStocksFiltered({
      search: search || undefined,
      sector: selectedSector === 'All Sectors' ? undefined : selectedSector,
      tradableOnly,
      limit: 150
    }),
    staleTime: 30000
  });

  // 2. Cross-Industry Alternative Boom & Ripple Radar
  const { data: rippleOpportunities, isLoading: rippleLoading } = useQuery({
    queryKey: ['cross-industry-ripple'],
    queryFn: getCrossIndustryRipple,
    staleTime: 60000
  });

  // 3. Agent Analyzed Assets
  const { data: rawStocks, isLoading } = useQuery({
    queryKey: ['stocks-universe'],
    queryFn: getStocksUniverse,
    refetchInterval: 60000,
  });

  const stocks: any[] = useMemo(() => {
    if (Array.isArray(rawStocks)) return rawStocks;
    if (Array.isArray((rawStocks as any)?.stocks)) return (rawStocks as any).stocks;
    if (Array.isArray((rawStocks as any)?.data)) return (rawStocks as any).data;
    return [];
  }, [rawStocks]);

  const allMarketStocks: any[] = useMemo(() => {
    if (Array.isArray(allStocksData?.stocks)) return allStocksData.stocks;
    if (Array.isArray(allStocksData)) return allStocksData;
    return [];
  }, [allStocksData]);

  const handleConveneDebate = async (symbol: string) => {
    try {
      await triggerDebate(symbol, 'stocks');
      toast.success(`🏛️ Convened Investment Committee for ${symbol}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || `Failed to convene debate for ${symbol}`);
    }
  };

  const filtered = useMemo(() => {
    let list = [...stocks];

    // Filter
    if (filter === 'traded') list = list.filter((s: any) => s.tradeCount > 0);
    else if (filter === 'open') list = list.filter((s: any) => s.hasOpenPosition);
    else if (filter === 'buy') list = list.filter((s: any) => s.lastVote?.toUpperCase().includes('BUY'));
    else if (filter === 'sell') list = list.filter((s: any) => s.lastVote?.toUpperCase().includes('SELL'));

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s: any) => s.symbol.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q) || s.sector?.toLowerCase().includes(q));
    }

    // Sort
    list.sort((a: any, b: any) => {
      let av = a[sortBy] ?? -Infinity;
      let bv = b[sortBy] ?? -Infinity;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

    return list;
  }, [stocks, filter, search, sortBy, sortDir]);

  const totalTraded = stocks.filter((s: any) => s.tradeCount > 0).length;
  const totalOpen = stocks.filter((s: any) => s.hasOpenPosition).length;
  const totalPnl = stocks.reduce((sum: number, s: any) => sum + (s.totalPnl || 0), 0);
  const withNames = stocks.filter((s: any) => s.name !== s.symbol).length;

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('desc'); }
  };

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => toggleSort(k)} className={`font-mono text-[11px] px-2.5 py-1 rounded-md border font-semibold flex items-center gap-1 transition ${
      sortBy === k
        ? 'bg-blue-50 text-blue-700 border-blue-300'
        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
    }`}>
      {label}{sortBy === k ? (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : null}
    </button>
  );

  return (
    <div className="flex flex-col gap-5 text-slate-900 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-mono font-bold text-blue-700 uppercase tracking-wider">INSTITUTIONAL UNIVERSE ENGINE</span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-[11px] font-mono text-emerald-600 font-bold">10,428 LISTED SECURITIES SYNCHRONIZED</span>
          </div>
          <h1 className="font-bold text-2xl text-slate-900 tracking-tight font-display">
            US Equities & Cross-Industry Intelligence
          </h1>
          <p className="font-mono text-xs text-slate-500 mt-1">
            Complete US marketplace directory, GICS sector categorization, alternative industry ripple radar, and committee deliberation
          </p>
        </div>
        <LastUpdated />
      </div>

      {/* ── Top Level 3-Tier Tab Navigation ────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3 flex-wrap">
        <button
          onClick={() => setActiveTab('all_us_market')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-mono text-xs font-bold transition-all ${
            activeTab === 'all_us_market'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200'
          }`}
        >
          <Globe size={14} />
          FULL US MARKETPLACE ({allStocksData?.total || '10,428+'})
        </button>

        <button
          onClick={() => setActiveTab('ripple_radar')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-mono text-xs font-bold transition-all ${
            activeTab === 'ripple_radar'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200'
          }`}
        >
          <Zap size={14} />
          CROSS-INDUSTRY RIPPLE & BOOM RADAR
        </button>

        <button
          onClick={() => setActiveTab('analyzed')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-mono text-xs font-bold transition-all ${
            activeTab === 'analyzed'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200'
          }`}
        >
          <Layers size={14} />
          AGENT ANALYZED MEMORIES ({stocks.length})
        </button>
      </div>

      {/* ── TAB 1: FULL US MARKETPLACE DIRECTORY ────────────────────────── */}
      {activeTab === 'all_us_market' && (
        <div className="space-y-4">
          {/* Search + Sector Filters */}
          <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm space-y-3">
            <div className="flex flex-col md:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search all 10,400+ US stocks by ticker (e.g. CEG, OKLO, LLY), name, or industry…"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto">
                <label className="flex items-center gap-2 text-xs font-mono text-slate-700 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={tradableOnly}
                    onChange={e => setTradableOnly(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                  />
                  <span>Tradable Only</span>
                </label>
              </div>
            </div>

            {/* GICS Sector Badges */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              {US_GICS_SECTORS.map(sec => (
                <button
                  key={sec}
                  onClick={() => setSelectedSector(sec)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono whitespace-nowrap transition-colors ${
                    selectedSector === sec
                      ? 'bg-blue-600 text-white font-bold shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                  }`}
                >
                  {sec}
                </button>
              ))}
            </div>
          </div>

          {/* Directory Count */}
          <div className="flex items-center justify-between text-xs font-mono text-slate-500">
            <span>
              Showing {allMarketStocks.length} listed securities (Total Matching: {allStocksData?.total || 0})
            </span>
            <span className="text-blue-700 font-bold flex items-center gap-1">
              <ShieldCheck size={13} /> Authoritative SEC EDGAR & Alpaca Registry
            </span>
          </div>

          {/* Securities Grid */}
          {allStocksLoading ? (
            <div className="text-center py-16 font-mono text-xs text-slate-400">
              Querying 10,400+ securities from dynamic database…
            </div>
          ) : allMarketStocks.length === 0 ? (
            <div className="text-center py-16 font-mono text-xs text-slate-400">
              No securities match your search and sector criteria.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {allMarketStocks.map((stock: any) => (
                <div
                  key={stock.symbol}
                  className="p-4 rounded-xl bg-white border border-slate-200/90 hover:border-blue-400 transition-all flex flex-col justify-between shadow-sm"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-base font-bold text-blue-700">
                          {stock.symbol}
                        </span>
                        <span className="ml-2 font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-semibold">
                          {stock.exchange || 'US'}
                        </span>
                      </div>
                      {stock.price ? (
                        <span className="font-mono font-bold text-sm text-slate-900">
                          ${typeof stock.price === 'number' ? stock.price.toFixed(2) : stock.price}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-slate-400 font-semibold">LIVE FEED</span>
                      )}
                    </div>

                    <div className="font-semibold text-xs text-slate-800 mt-1 line-clamp-1">
                      {stock.name}
                    </div>

                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                        {stock.sector}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 truncate max-w-[160px]">
                        {stock.industry}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-500 font-semibold">
                      {stock.tradable ? '● EXECUTION READY' : '○ SEC REGISTRANT'}
                    </span>
                    <button
                      onClick={() => handleConveneDebate(stock.symbol)}
                      className="px-2.5 py-1 text-[11px] font-mono font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors flex items-center gap-1 shadow-xs"
                    >
                      <span>CONVENE</span>
                      <ArrowUpRight size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: CROSS-INDUSTRY RIPPLE & BOOM RADAR ───────────────────── */}
      {activeTab === 'ripple_radar' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-800 mb-1">
              <Sparkles size={14} className="text-emerald-600" /> CROSS-INDUSTRY ALTERNATIVE BOOM INTELLIGENCE
            </div>
            <p className="text-xs text-emerald-900 font-sans">
              Our agents monitor primary macro catalysts and news journals to isolate second-order and third-order ripple beneficiaries across alternative industries where asymmetric capital flows occur.
            </p>
          </div>

          {rippleLoading ? (
            <div className="text-center py-16 font-mono text-xs text-slate-400">
              Evaluating global supply chains and cross-industry transmission models…
            </div>
          ) : !rippleOpportunities || rippleOpportunities.length === 0 ? (
            <div className="text-center py-16 font-mono text-xs text-slate-400">
              No active cross-industry shocks detected in today's news feeds.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rippleOpportunities.map((opp: any) => (
                <div
                  key={opp.id}
                  className="p-5 rounded-xl bg-white border border-slate-200/90 hover:border-emerald-400 transition-all space-y-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                          {opp.transmissionDegree.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 font-semibold">
                          {opp.targetSector}
                        </span>
                      </div>
                      <h3 className="font-bold text-sm text-slate-900">
                        {opp.targetIndustry}
                      </h3>
                    </div>
                    <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">
                      {opp.confidence}% Conviction
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                    <div className="text-[10px] font-mono text-slate-500 font-semibold uppercase">Primary Catalyst</div>
                    <div className="text-xs font-mono text-blue-700 font-bold">{opp.headline}</div>
                    <div className="text-xs text-slate-700 mt-1 font-sans">{opp.strategicThesis}</div>
                  </div>

                  <div>
                    <div className="text-[10px] font-mono text-slate-500 uppercase font-semibold mb-2">Recommended Beneficiary Plays</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {opp.recommendedTickers?.map((tick: any) => (
                        <div
                          key={tick.symbol}
                          className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between"
                        >
                          <div>
                            <div className="font-mono font-bold text-xs text-slate-900">{tick.symbol}</div>
                            <div className="text-[10px] text-slate-500 truncate max-w-[110px]">{tick.companyName}</div>
                          </div>
                          <button
                            onClick={() => handleConveneDebate(tick.symbol)}
                            className="px-2 py-1 text-[10px] font-mono font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors shadow-xs"
                          >
                            DEBATE
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: AGENT ANALYZED MEMORIES ──────────────────────────────── */}
      {activeTab === 'analyzed' && (
        <div className="space-y-4">
          {/* Stats bar */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Total Analyzed', value: stocks.length, icon: Activity },
              { label: 'With Full Name', value: `${withNames} / ${stocks.length}` },
              { label: 'Actively Traded', value: totalTraded },
              { label: 'Open Positions', value: totalOpen },
            ].map((s, i) => (
              <div key={i} className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm">
                <div className="font-mono text-[10px] text-slate-500 uppercase font-semibold mb-1">{s.label}</div>
                <div className="font-mono font-bold text-xl text-slate-900">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Search + filter + sort */}
          <div className="flex flex-col gap-3 p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm">
            <div className="relative">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search analyzed stocks by ticker, company name, or sector…"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex gap-2 flex-wrap items-center justify-between">
              {/* Filter buttons */}
              <div className="flex gap-1.5 flex-wrap items-center">
                {(['all', 'traded', 'open', 'buy', 'sell'] as FilterKey[]).map(f => (
                  <button key={f} onClick={() => setFilter(f)} className={`font-mono text-xs px-3 py-1.5 rounded-lg border font-bold transition ${
                    filter === f ? 'bg-blue-600 text-white border-blue-600 shadow-xs' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                  }`}>
                    {f === 'all' ? `All (${stocks.length})` : f === 'open' ? `Open (${totalOpen})` : f === 'traded' ? `Traded (${totalTraded})` : f.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="flex gap-1.5 flex-wrap items-center">
                <span className="font-mono text-xs text-slate-500 font-semibold mr-1">Sort:</span>
                <SortBtn k="name" label="Name" />
                <SortBtn k="debateCount" label="Debates" />
                <SortBtn k="tradeCount" label="Trades" />
                <SortBtn k="totalPnl" label="P&L" />
                <SortBtn k="winRate" label="Win%" />
              </div>
            </div>
          </div>

          {/* Results count */}
          <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: C.muted }}>
            Showing {filtered.length} of {stocks.length} stocks
            {totalPnl !== 0 && <span style={{ marginLeft: 16, color: totalPnl >= 0 ? C.green : C.red, fontWeight: 700 }}>Total P&L: {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}</span>}
          </div>

          {/* Grid */}
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: 'Space Mono', fontSize: 12, color: C.muted }}>
              Loading stock universe…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: 'Space Mono', fontSize: 12, color: C.muted }}>
              {stocks.length === 0
                ? 'No stocks analyzed yet — agents will start debating at the next scheduled time'
                : 'No results match your search'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {filtered.map((s: any) => (
                <StockCard key={s.symbol} stock={s} onClick={() => setSelected(s)} />
              ))}
            </div>
          )}

          {/* Detail drawer */}
          {selected && <StockDetailDrawer stock={selected} onClose={() => setSelected(null)} />}
        </div>
      )}
    </div>
  );
}
