import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, getLiveAccounts, connectAlpaca, connectPolymarket, disconnectAccount, getPolymarketUsAccount } from '../services/api';
import { useSystemStatus } from '../hooks/useSystemStatus';
import {
  Settings, Shield, Zap, Wallet, CheckCircle2,
  XCircle, RefreshCw, Key, Globe, Unlink, ExternalLink,
  Database, Sparkles, BookOpen
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
  const statusQ = useSystemStatus();
  const dataProviders: Record<string, { configured: boolean; healthy?: boolean }> = (statusQ.data?.dataProviders && typeof statusQ.data.dataProviders === 'object') ? statusQ.data.dataProviders as any : {};
  const pmUsQ = useQuery({
    queryKey: ['polymarket-us-account'],
    queryFn: getPolymarketUsAccount,
    refetchInterval: 60000,
    retry: false,
  });
  const pmUs: any = pmUsQ.data;
  const pmUsOk = !pmUsQ.isError && !!pmUs && pmUs.connected !== false && !pmUs.error;
  const pmUsCash = pmUsOk && Number.isFinite(Number(pmUs.cash)) ? Number(pmUs.cash) : null;
  const pmUsBuyingPower = pmUsOk && Number.isFinite(Number(pmUs.buyingPower)) ? Number(pmUs.buyingPower) : null;
  const pmUsPositions = pmUsOk && pmUs.positions && typeof pmUs.positions === 'object' ? (Array.isArray(pmUs.positions) ? pmUs.positions.length : Object.keys(pmUs.positions).length) : null;
  const pmUsReason: string = pmUsQ.isError ? ((pmUsQ.error as any)?.response?.data?.error || (pmUsQ.error as any)?.response?.data?.reason || (pmUsQ.error as any)?.message || 'request failed') : (pmUs?.reason || pmUs?.error || '');

  const providerBadge = (key: string | undefined) => {
    if (!key) return { label: 'BUILT-IN', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
    if (statusQ.isError || !statusQ.data) return { label: statusQ.isLoading ? 'CHECKING…' : 'STATUS UNKNOWN', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
    const p = dataProviders[key];
    if (!p) return { label: 'STATUS UNKNOWN', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
    if (!p.configured) return { label: 'NOT CONFIGURED', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
    if (p.healthy === false) return { label: 'ERROR', cls: 'bg-red-50 text-red-700 border-red-200' };
    return { label: 'CONNECTED', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };
  const fmt2 = (v: any) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—');

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
      toast.success(`✅ Polymarket Connected! USDC: $${fmt2(data?.account?.usdcBalance)}`);
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
    <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          {icon}
          <h2 className="font-semibold text-slate-900 text-base">{title}</h2>
        </div>
        {badge}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );

  const SettingRow = ({ label, value, desc }: { label: string; value: any; desc?: string }) => (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <div>
        <div className="font-semibold text-xs text-slate-900">{label}</div>
        {desc && <div className="font-mono text-[10px] text-slate-500 mt-0.5">{desc}</div>}
      </div>
      <span className="font-mono text-xs font-bold text-emerald-600 tabular-nums">{value}</span>
    </div>
  );

  const alpaca = liveAccounts?.alpaca;
  const poly = liveAccounts?.polymarket;

  const OPEN_STOCK_APIS: Array<{ name: string; provider?: string; cost: string; coverage: string; envVar: string; url: string; desc: string }> = [
    {
      name: 'SEC EDGAR Public Company Directory',
      provider: 'sec',
      cost: '100% Free (No Key Required)',
      coverage: '10,412+ Public US Equities, CIK records, 10-K, 10-Q & 8-K Filings',
      envVar: 'Built into securityMaster.ts',
      url: 'https://data.sec.gov',
      desc: 'Official government directory of all registered US public securities, tickers, and standard industrial classifications (SIC).'
    },
    {
      name: 'Alpaca Markets Paper Trading API',
      provider: 'alpaca',
      cost: 'Free Instant Tier',
      coverage: 'Live IEX stock streaming quotes, level 1 orderbook, instant simulated executions',
      envVar: 'ALPACA_API_KEY & ALPACA_SECRET_KEY',
      url: 'https://alpaca.markets',
      desc: 'Institutional-grade paper trading environment. Provides real-time quotes and fractional share trade fills.'
    },
    {
      name: 'Finnhub Stock & Market News API',
      provider: 'finnhub',
      cost: 'Free Tier (60 calls/minute)',
      coverage: 'Real-time stock quotes, analyst price targets, company earnings, news sentiment',
      envVar: 'FINNHUB_API_KEY',
      url: 'https://finnhub.io',
      desc: 'Free developer key covering stock quote tickers, company financials, and market news.'
    },
    {
      name: 'Polygon.io Market Data',
      provider: 'polygon',
      cost: 'Free Tier (5 calls/minute, delayed)',
      coverage: 'End-of-day aggregates, stock reference data, ticker details, financial statements',
      envVar: 'POLYGON_API_KEY',
      url: 'https://polygon.io',
      desc: 'Standard market data provider used for daily bar candles and stock screener filters.'
    },
    {
      name: 'Alpha Vantage Global Financials',
      provider: 'alphaVantage',
      cost: 'Free Tier (25 calls/day)',
      coverage: 'Technical indicators (RSI, MACD, SMA), GDP, CPI inflation, economic indicators',
      envVar: 'ALPHA_VANTAGE_API_KEY',
      url: 'https://www.alphavantage.co',
      desc: 'Comprehensive macro indicators and algorithmic technical analysis formulas.'
    },
    {
      name: 'Polymarket CLOB & Gamma Markets',
      provider: 'polymarket',
      cost: '100% Free Public Endpoint',
      coverage: 'Prediction market contracts, real-time probability orderbooks, liquidity depth',
      envVar: 'Built into polymarket.ts',
      url: 'https://clob.polymarket.com',
      desc: 'Public read API for prediction market order books and outcome probability distributions.'
    },
    {
      name: 'FRED (Federal Reserve Economic Data)',
      provider: 'fred',
      cost: '100% Free Public API Key',
      coverage: 'US Federal Funds Rate, 10Y/2Y Yield Curve, CPI Inflation, Unemployment, M2 Money',
      envVar: 'FRED_API_KEY',
      url: 'https://fred.stlouisfed.org/docs/api/fred/',
      desc: 'Authoritative macroeconomic indicator data from the Federal Reserve Bank of St. Louis with 800,000+ time series.'
    },
    {
      name: 'Yahoo Finance Public Data Stream',
      provider: 'yahoo',
      cost: '100% Open (No Key Needed)',
      coverage: 'Historical OHLCV daily/intraday candlestick charts, company profiles, market cap, beta',
      envVar: 'Built into chart data fallback engine',
      url: 'https://finance.yahoo.com',
      desc: 'Public unauthenticated chart and quote endpoints used as zero-cost institutional fallback.'
    },
    {
      name: 'Nasdaq Trader Symbol Directory',
      provider: 'nasdaq',
      cost: 'Free (No Key Required)',
      coverage: 'Listed US symbols (Nasdaq / NYSE / AMEX) used to build the symbol universe',
      envVar: 'Built into universe sync',
      url: 'https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs',
      desc: 'Official listing files for every exchange-listed US security.'
    },
  ];
  const listedProviders = new Set(OPEN_STOCK_APIS.map(a => a.provider).filter(Boolean) as string[]);
  const otherProviders = Object.entries(dataProviders).filter(([k]) => !listedProviders.has(k));
  const connectedCount = Object.values(dataProviders).filter(p => p?.configured && p.healthy !== false).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 border border-blue-200">
              <Settings size={22} className="text-blue-600" />
            </div>
            <div>
              <h1 className="font-bold text-2xl text-slate-900 tracking-tight font-display">Terminal Settings & Market Integrations</h1>
              <p className="font-mono text-xs text-slate-500 mt-0.5">
                Connect your real Alpaca Brokerage, Polymarket Web3 Wallet, and open stock market data feeds
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 font-mono text-xs">
            <span className="text-slate-500">Total Live Equity:</span>
            <span className="text-emerald-600 font-bold">{Number.isFinite(Number(liveAccounts?.combinedLiveEquity)) && Number(liveAccounts?.combinedLiveEquity) > 0 ? `$${Number(liveAccounts.combinedLiveEquity).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</span>
          </div>
          <button
            data-testid="settings-refresh"
            onClick={() => { queryClient.invalidateQueries({ queryKey: ['live-accounts'] }); queryClient.invalidateQueries({ queryKey: ['system-status'] }); queryClient.invalidateQueries({ queryKey: ['polymarket-us-account'] }); }}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 transition-colors"
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
          icon={<Globe size={18} className="text-blue-600" />}
          badge={
            alpaca?.connected ? (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 size={10} /> CONNECTED ({alpaca.paperMode ? 'PAPER' : 'LIVE'})
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                <XCircle size={10} /> NOT CONNECTED
              </span>
            )
          }
        >
          {alpaca?.connected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-mono text-[10px] text-slate-500">PORTFOLIO VALUE</div>
                  <div className="font-mono text-base font-bold text-slate-900 mt-1">
                    {Number.isFinite(Number(alpaca.portfolioValue)) ? `$${Number(alpaca.portfolioValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-mono text-[10px] text-slate-500">CASH AVAILABLE</div>
                  <div className="font-mono text-base font-bold text-emerald-600 mt-1">
                    {Number.isFinite(Number(alpaca.cash)) ? `$${Number(alpaca.cash).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-mono text-[10px] text-slate-500">BUYING POWER</div>
                  <div className="font-mono text-base font-bold text-blue-700 mt-1">
                    {Number.isFinite(Number(alpaca.buyingPower)) ? `$${Number(alpaca.buyingPower).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-mono text-[10px] text-slate-500">OPEN POSITIONS</div>
                  <div className="font-mono text-base font-bold text-slate-900 mt-1">
                    {alpaca.positionsCount}
                  </div>
                </div>
              </div>

              {alpaca.positions && alpaca.positions.length > 0 && (
                <div className="space-y-2 mt-3">
                  <div className="font-mono text-xs text-slate-600 font-semibold">Live Alpaca Holdings:</div>
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {alpaca.positions.map((pos: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200 font-mono text-xs">
                        <span className="font-bold text-slate-900">{pos.symbol} ({pos.qty} shs)</span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-600">${pos.currentPrice}</span>
                          <span className={pos.unrealizedPnl >= 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>
                            {pos.unrealizedPnl >= 0 ? '+' : ''}${fmt2(pos.unrealizedPnl)} ({Number.isFinite(Number(pos.unrealizedPnlPct)) ? Number(pos.unrealizedPnlPct).toFixed(1) : '—'}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                <span className="font-mono text-[11px] text-slate-500">Account #{alpaca.accountNumber}</span>
                <button
                  onClick={() => disconnectMutation.mutate('alpaca')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-mono text-xs font-bold transition-colors"
                >
                  <Unlink size={12} /> Disconnect Account
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Enter your free Alpaca API credentials to pull real-time portfolio balance, trade US equities live, and track real filled positions.
              </p>
              
              <div className="space-y-2.5">
                <div>
                  <label className="block font-mono text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                    Alpaca API Key ID
                  </label>
                  <div className="relative">
                    <Key size={13} className="absolute left-3 top-3 text-slate-400" />
                    <input
                      type="text"
                      value={alpacaKey}
                      onChange={(e) => setAlpacaKey(e.target.value)}
                      placeholder="PKXXXXXXXXXXXXXXXXXX"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg py-2 pl-9 pr-3 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                    Alpaca Secret Key
                  </label>
                  <div className="relative">
                    <Key size={13} className="absolute left-3 top-3 text-slate-400" />
                    <input
                      type="password"
                      value={alpacaSecret}
                      onChange={(e) => setAlpacaSecret(e.target.value)}
                      placeholder="••••••••••••••••••••••••••••••••"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg py-2 pl-9 pr-3 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
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
                      className="rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                    />
                    <label htmlFor="paperToggle" className="font-mono text-xs text-slate-700 cursor-pointer font-medium">
                      Paper Trading Mode (Recommended for testing)
                    </label>
                  </div>
                  <a
                    href="https://app.alpaca.markets/paper/dashboard/overview"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-mono text-[10px] text-blue-600 font-bold hover:underline"
                  >
                    Get Free Alpaca Keys <ExternalLink size={10} />
                  </a>
                </div>

                <button
                  data-testid="connect-alpaca"
                  onClick={() => alpacaMutation.mutate()}
                  disabled={!alpacaKey || !alpacaSecret || alpacaMutation.isPending}
                  className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-mono text-xs font-bold transition-colors shadow-xs flex items-center justify-center gap-2"
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
          icon={<Wallet size={18} className="text-emerald-600" />}
          badge={
            poly?.connected ? (
              <span data-testid="polymarket-connection" className="flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 size={10} /> CONNECTED (POLYGON)
              </span>
            ) : pmUsOk ? (
              <span data-testid="polymarket-connection" className="flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 size={10} /> CONNECTED (Polymarket US API)
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                <XCircle size={10} /> NOT CONNECTED
              </span>
            )
          }
        >
          <div data-testid="polymarket-us-status" className={`p-3 rounded-lg border font-mono text-xs ${pmUsOk ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900">Polymarket US API</span>
              <span className={`font-bold ${pmUsOk ? 'text-emerald-700' : 'text-slate-500'}`}>{pmUsQ.isLoading ? 'CHECKING…' : pmUsOk ? 'CONNECTED' : 'NOT CONNECTED'}</span>
            </div>
            {pmUsOk ? (
              <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                <div><span className="text-slate-500">Cash</span><div className="font-bold text-slate-900" data-testid="polymarket-us-balance">{pmUsCash === null ? '—' : `$${pmUsCash.toFixed(2)}`}</div></div>
                <div><span className="text-slate-500">Buying power</span><div className="font-bold text-slate-900">{pmUsBuyingPower === null ? '—' : `$${pmUsBuyingPower.toFixed(2)}`}</div></div>
                <div><span className="text-slate-500">Positions</span><div className="font-bold text-slate-900">{pmUsPositions ?? '—'}</div></div>
              </div>
            ) : (!pmUsQ.isLoading && pmUsReason) ? (
              <div className="mt-1 text-[11px] text-slate-500">{pmUsReason}</div>
            ) : null}
          </div>

          {poly?.connected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-mono text-[10px] text-slate-500">TOTAL POLY VALUE</div>
                  <div className="font-mono text-base font-bold text-slate-900 mt-1">
                    ${fmt2(poly.portfolioValue)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-mono text-[10px] text-slate-500">USDC BALANCE</div>
                  <div className="font-mono text-base font-bold text-emerald-600 mt-1">
                    ${fmt2(poly.usdcBalance)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-mono text-[10px] text-slate-500">POL GAS</div>
                  <div className="font-mono text-base font-bold text-blue-700 mt-1">
                    {Number.isFinite(Number(poly.polBalance)) ? Number(poly.polBalance).toFixed(3) : '—'} POL
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-mono text-[10px] text-slate-500">POSITIONS</div>
                  <div className="font-mono text-base font-bold text-slate-900 mt-1">
                    {poly.positionsCount}
                  </div>
                </div>
              </div>

              {poly.positions && poly.positions.length > 0 && (
                <div className="space-y-2 mt-3">
                  <div className="font-mono text-xs text-slate-600 font-semibold">Active Polymarket Positions:</div>
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {poly.positions.map((pos: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200 font-mono text-xs">
                        <span className="font-bold text-slate-900 truncate max-w-[200px]" title={pos.title}>{pos.title}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-600">{pos.outcome} @ ${fmt2(pos.currentPrice ?? pos.avgPrice)}</span>
                          <span className={Number(pos.cashPnl) >= 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>
                            {Number(pos.cashPnl) >= 0 ? '+' : ''}${fmt2(pos.cashPnl)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                <span className="font-mono text-[11px] text-slate-500 truncate max-w-[280px]" title={poly.address}>
                  Wallet: {poly.address}
                </span>
                <button
                  onClick={() => disconnectMutation.mutate('polymarket')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-mono text-xs font-bold transition-colors"
                >
                  <Unlink size={12} /> Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Connect your Polygon wallet address to query your verified USDC balance on Polygon and monitor all your live Polymarket prediction positions.
              </p>

              <div className="space-y-2.5">
                <div>
                  <label className="block font-mono text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                    Polygon Wallet Address (0x...)
                  </label>
                  <div className="relative">
                    <Globe size={13} className="absolute left-3 top-3 text-slate-400" />
                    <input
                      type="text"
                      value={polyAddress}
                      onChange={(e) => setPolyAddress(e.target.value)}
                      placeholder="0x71C...392"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg py-2 pl-9 pr-3 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                    Private Key (Optional — for automated on-chain execution)
                  </label>
                  <div className="relative">
                    <Key size={13} className="absolute left-3 top-3 text-slate-400" />
                    <input
                      type="password"
                      value={polyPrivateKey}
                      onChange={(e) => setPolyPrivateKey(e.target.value)}
                      placeholder="Leave empty for read-only live portfolio monitoring"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg py-2 pl-9 pr-3 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <button
                  data-testid="connect-polymarket"
                  onClick={() => polyMutation.mutate()}
                  disabled={!polyAddress || polyMutation.isPending}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-mono text-xs font-bold transition-colors shadow-xs flex items-center justify-center gap-2"
                >
                  {polyMutation.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Wallet size={13} />}
                  Connect & Query Polymarket
                </button>
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* ── OPEN & FREE STOCK MARKET DATA APIS ───────────────────────────── */}
      <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <Database size={18} className="text-blue-600" />
            <div>
              <h2 className="font-semibold text-slate-900 text-base">Open & Free Stock Market APIs Directory</h2>
              <p className="font-mono text-xs text-slate-500">
                Official free and open-source data APIs giving real-time market quotes, SEC filings, economic indicators, and order books
              </p>
            </div>
          </div>
          <span data-testid="providers-connected-count" className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200 font-bold">
            {statusQ.data?.dataProviders ? `${connectedCount} / ${Object.keys(dataProviders).length} CONNECTED` : 'STATUS UNKNOWN'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {OPEN_STOCK_APIS.map((api, idx) => {
            const badge = providerBadge(api.provider);
            return (
            <div key={idx} data-testid={`provider-${api.provider || idx}`} className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 hover:border-slate-300 transition-all flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-bold text-slate-900 text-sm leading-tight">{api.name}</h3>
                  <span data-testid={`provider-status-${api.provider || idx}`} className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold border whitespace-nowrap ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="font-mono text-xs text-emerald-700 font-bold mb-2">{api.cost}</div>
                <p className="text-xs text-slate-600 leading-relaxed font-sans mb-2">{api.desc}</p>
                <div className="p-2 rounded bg-white border border-slate-200 text-[11px] font-mono text-slate-700 space-y-1">
                  <div><strong className="text-slate-900">Coverage:</strong> {api.coverage}</div>
                  <div><strong className="text-slate-900">Config:</strong> <code className="bg-slate-100 px-1 py-0.5 rounded text-blue-700">{api.envVar}</code></div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                <a
                  href={api.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1"
                >
                  <span>API Docs & Key</span>
                  <ExternalLink size={11} />
                </a>
              </div>
            </div>
            );
          })}
        </div>
        {otherProviders.length > 0 && (
          <div className="pt-3 border-t border-slate-100">
            <div className="font-mono text-[10px] text-slate-500 uppercase font-semibold mb-2">Other configured services</div>
            <div className="flex flex-wrap gap-2">
              {otherProviders.map(([k]) => {
                const b = providerBadge(k);
                return (
                  <span key={k} data-testid={`provider-status-${k}`} className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold border ${b.cls}`}>
                    {k}: {b.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── AUTONOMOUS ENGINE & RISK PARAMETERS ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Autonomous Engine Rules" icon={<Zap size={16} className="text-blue-600" />}>
          <SettingRow label="Execution Mode" value={(statusQ.data?.tradingMode ? String(statusQ.data.tradingMode).toUpperCase() : settings?.tradingMode?.toUpperCase() || '—')} desc="Real orders routed when live keys are connected" />
          <SettingRow label="Min Council Votes to Execute" value={settings?.minVotesToExecute != null ? `${settings.minVotesToExecute}` : '—'} desc="Minimum consensus threshold" />
          <SettingRow label="Min Agent Confidence" value={settings?.minAgentConfidence != null ? `${settings.minAgentConfidence}%` : '—'} desc="Average confidence gate" />
          <SettingRow label="Stop-Loss Method" value={settings?.stopLossMethod || '—'} desc="Calculated from asset volatility" />
          <SettingRow label="Take-Profit Ratio" value={settings?.takeProfitMethod || '—'} desc="Minimum 2:1 risk/reward" />
        </Section>

        <Section title="Risk Guardrails & Circuit Breakers" icon={<Shield size={16} className="text-emerald-600" />}>
          <SettingRow label="Max Risk Per Trade" value={settings?.maxRiskPerTrade != null ? `${settings.maxRiskPerTrade}%` : '—'} desc="% of portfolio risked per signal" />
          <SettingRow label="Max Position Size" value={settings?.maxPositionSize != null ? `${settings.maxPositionSize}%` : '—'} desc="Maximum capital in any single asset" />
          <SettingRow label="Daily Loss Limit" value={settings?.dailyLossLimit != null ? `${settings.dailyLossLimit}%` : '—'} desc="Halts trading when reached" />
          <SettingRow label="Weekly Drawdown Limit" value={settings?.weeklyDrawdownLimit != null ? `${settings.weeklyDrawdownLimit}%` : '—'} desc="Pauses trading for regime review" />
          <SettingRow label="Max All-Time Drawdown" value={settings?.maxDrawdown != null ? `${settings.maxDrawdown}%` : '—'} desc="Emergency stop + kill switch" />
          <SettingRow label="Cash Reserve Protection" value={settings?.cashReserve != null ? `${settings.cashReserve}%` : '—'} desc="Always kept liquid" />
        </Section>
      </div>
    </div>
  );
}
