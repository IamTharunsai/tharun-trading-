import { useState } from 'react';
import {
  X, BookOpen, Cpu, ShieldCheck, Zap, TrendingUp, Layers,
  CheckCircle2, ArrowRight, Activity, DollarSign, Database,
  Compass, Radio, AlertTriangle, Users
} from 'lucide-react';
import { AGENTS } from '../../constants/agents';

interface ArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ArchitectureModal({ isOpen, onClose }: ArchitectureModalProps) {
  const [activeTab, setActiveTab] = useState<'agents' | 'lifecycle' | 'survival' | 'horizons' | 'apis'>('survival');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden text-slate-900">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-600 text-white shadow-sm">
              <Cpu size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-sans font-bold text-xl text-slate-900 tracking-tight">
                  System Architecture & AI Whitepaper
                </h2>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                  AUTONOMOUS HEDGE CORE v1.0.0
                </span>
              </div>
              <p className="font-mono text-xs text-slate-500 mt-0.5">
                Full-Stack Technical Blueprint · 15 Multi-Agent Council · Darwinian $100 Micro-Fund Survival Engine
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-slate-200 bg-white overflow-x-auto">
          {[
            { id: 'survival' as const, label: '$100 Survival Engine', icon: DollarSign },
            { id: 'agents' as const, label: '15 Specialized Agents', icon: Users },
            { id: 'lifecycle' as const, label: 'Order Execution Lifecycle', icon: Activity },
            { id: 'horizons' as const, label: 'Intraday & Polymarket', icon: Zap },
            { id: 'apis' as const, label: '8 Open Stock APIs', icon: Database },
          ].map(t => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-3.5 py-2 font-mono text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? 'border-blue-600 text-blue-700 bg-blue-50/50 rounded-t-lg'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon size={14} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* TAB 1: $100 SELF-SURVIVAL ALGORITHM */}
          {activeTab === 'survival' && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
                  <ShieldCheck size={18} />
                  <span>The Darwinian $100 Micro-Fund Self-Survival Algorithm</span>
                </div>
                <p className="text-xs text-emerald-900 leading-relaxed font-sans">
                  The primary design invariant of this platform is: <strong>"Given only $100.00 starting capital and zero human intervention, how does the system generate money without ever dying?"</strong> Standard retail traders blow up small accounts because transaction fees and outsized bets create mathematical ruin. Our autonomous engine solves this via 5 inviolable mathematical laws.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <div className="font-mono text-xs font-bold text-blue-700">LAW 1: THE $1.00 MAXIMUM RISK RULE</div>
                  <h4 className="font-bold text-slate-900 text-sm">Fixed Fractional Sizing (0.5% - 1.0%)</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    On a $100 portfolio, the system NEVER risks more than $1.00 on any single trade. If buying a $200 stock like NVDA with a 1% stop-loss ($2/share), it executes fractional share sizing of exactly <strong>0.5 shares ($10.00 position)</strong> so max potential loss is capped at $1.00.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <div className="font-mono text-xs font-bold text-emerald-700">LAW 2: ASYMMETRIC EXPECTANCY (&ge; 3:1)</div>
                  <h4 className="font-bold text-slate-900 text-sm">Mathematically Positive Expectancy</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Every trade requires a minimum 2.5x to 3.5x reward-to-risk distance. Risking $1.00 to make $3.50 means the system compounds even with a 40% win rate:
                    <span className="block font-mono text-[11px] bg-white p-1.5 mt-1 rounded border border-slate-200 text-slate-800">
                      Expectancy = (0.40 &times; $3.50) - (0.60 &times; $1.00) = +$0.80 / trade
                    </span>
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <div className="font-mono text-xs font-bold text-amber-700">LAW 3: FEE FRICTION DEFENSE GATE</div>
                  <h4 className="font-bold text-slate-900 text-sm">Exchange Fee Viability Check</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Prior to routing any order, <code className="text-blue-700 font-mono">checkTradeViability()</code> simulates entry and exit exchange fees. If fees consume &gt; 20% of projected profit, the order is blocked and routed to zero-fee commission venues (Alpaca commission-free equities or Polymarket 0% fee contracts).
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <div className="font-mono text-xs font-bold text-purple-700">LAW 4: 4-TIER RECOVERY CIRCUIT BREAKER</div>
                  <h4 className="font-bold text-slate-900 text-sm">Autonomous Capital Preservation State</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    If drawdown occurs, the system dynamically changes operating modes:
                    <span className="block font-mono text-[11px] text-slate-700 mt-1">
                      &bull; NORMAL (&gt;$95): 100% position sizing<br/>
                      &bull; CAUTION ($88-$94): Risk cut to 0.3% ($0.27)<br/>
                      &bull; RECOVERY ($80-$87): Risk cut to 0.2%, max 1 position<br/>
                      &bull; DEFEND (&lt;$80): Equities paused; 90%+ Polymarket arbitrage only
                    </span>
                  </p>
                </div>
              </div>

              {/* Compounding Projection Table */}
              <div className="p-5 rounded-xl border border-slate-200 bg-white space-y-3">
                <h4 className="font-bold text-sm text-slate-900">Geometric Compounding Schedule ($100 &rarr; $1,000+)</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 bg-slate-50">
                        <th className="p-2">Stage</th>
                        <th className="p-2">Portfolio Equity</th>
                        <th className="p-2">Risk Per Trade</th>
                        <th className="p-2">Max Position</th>
                        <th className="p-2">Profit Lockdown</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="p-2 font-bold text-blue-700">Stage 1: Seed Base</td>
                        <td className="p-2 font-bold">$100.00</td>
                        <td className="p-2">$0.50 - $1.00</td>
                        <td className="p-2">$10.00 (10%)</td>
                        <td className="p-2 text-slate-500">Full reinvestment</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-emerald-700">Stage 2: 2x Milestone</td>
                        <td className="p-2 font-bold">$200.00</td>
                        <td className="p-2">$1.00 - $2.00</td>
                        <td className="p-2">$20.00 (10%)</td>
                        <td className="p-2 text-emerald-700 font-bold">$40.00 locked to liquid cash</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-purple-700">Stage 3: 5x Milestone</td>
                        <td className="p-2 font-bold">$500.00</td>
                        <td className="p-2">$2.50 - $5.00</td>
                        <td className="p-2">$50.00 (10%)</td>
                        <td className="p-2 text-purple-700 font-bold">$100.00 locked to liquid cash</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-slate-900">Stage 4: Graduation</td>
                        <td className="p-2 font-bold">$1,000.00+</td>
                        <td className="p-2">$10.00</td>
                        <td className="p-2">$100.00 (10%)</td>
                        <td className="p-2 text-blue-700 font-bold">Standard Institutional Sizing</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 15 SPECIALIZED AGENTS */}
          {activeTab === 'agents' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-sans">
                The Autonomous Council operates like a hedge fund investment committee. No single model or indicator decides a trade. 15 specialized perspectives debate across 3 rounds, cross-examining theses and calculating mathematical consensus.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {AGENTS.map(agent => (
                  <div key={agent.id} className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xl">{agent.icon}</span>
                        <div className="flex items-center gap-1.5">
                          {agent.veto && (
                            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded font-bold bg-red-50 text-red-700 border border-red-200">
                              ABSOLUTE VETO
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-slate-400">#{agent.id}</span>
                        </div>
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm">{agent.name}</h4>
                      <div className="font-mono text-[10px] text-blue-700 font-semibold mb-2">{agent.role}</div>
                      <p className="text-xs text-slate-600 font-sans leading-relaxed">
                        {agent.id === 1 && "Applies Wyckoff accumulation/distribution, RSI divergence, and multi-moving average alignment."}
                        {agent.id === 2 && "Performs real-time NLP sentiment analysis on global news wires and SEC 8-K emergency filings."}
                        {agent.id === 3 && "Measures retail crowd euphoria vs. institutional put/call skew and Polymarket implied odds."}
                        {agent.id === 4 && "Parses SEC 10-K/10-Q balance sheets, DCF fair value, and quarterly revenue acceleration."}
                        {agent.id === 5 && "Strict gatekeeper enforcing Kelly position sizing, drawdown boundaries, and cash reserves."}
                        {agent.id === 6 && "Tracks higher-timeframe momentum persistence across 15m, 1h, and daily trend ribbons."}
                        {agent.id === 7 && "Evaluates On-Balance Volume (OBV), Volume Weighted Average Price (VWAP), and orderbook liquidity."}
                        {agent.id === 8 && "Tracks dark pool block trades and institutional Form 13F whale accumulation footprints."}
                        {agent.id === 9 && "Monitors Federal Reserve rates, 10Y/2Y Treasury yield curve, and CPI inflation indices."}
                        {agent.id === 10 && "Adversarial stress-tester: systematically attacks majority consensus with counter-theses."}
                        {agent.id === 11 && "Maps 5-wave motive cycles and Fibonacci retracement/extension golden ratio targets."}
                        {agent.id === 12 && "Detects unusual options sweeps, institutional gamma exposure, and implied volatility crush."}
                        {agent.id === 13 && "Scans cross-venue mispricings and positive EV prediction contracts on Polymarket."}
                        {agent.id === 14 && "Runs autoregressive ML volatility forecasting and statistical mean-reversion bands."}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: ORDER LIFECYCLE */}
          {activeTab === 'lifecycle' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <h3 className="font-bold text-slate-900 text-sm mb-1">Autonomous Execution Pipeline</h3>
                <p className="text-xs text-slate-600 font-sans leading-relaxed">
                  Every trade passes through an automated 8-step lifecycle. If any risk invariant or confidence threshold is not met, the process aborts immediately.
                </p>
              </div>

              <div className="space-y-3 font-mono text-xs">
                {[
                  { step: '01', title: 'Signal Detection & Anomaly Ingestion', desc: 'Price breakouts, news alerts, SEC filings, or Polymarket mispricings trigger automated analysis.' },
                  { step: '02', title: 'Round 1: Independent Agent Opening Arguments', desc: 'All 15 agents evaluate the asset independently and output vote, confidence, and thesis.' },
                  { step: '03', title: 'Round 2: Adversarial Cross-Examination', desc: 'Devil\'s Advocate stress-tests the leading thesis. Agents adjust confidence based on counter-evidence.' },
                  { step: '04', title: 'Round 3: Final Consensus & Weight Aggregation', desc: 'Votes aggregated using dynamic Bayesian weights based on historical win rates. Requires >= 70% consensus.' },
                  { step: '05', title: 'Risk Invariant & Circuit Breaker Gate', desc: 'Agent 5 checks daily loss limit, portfolio cash reserve (>=30%), and 2:1 risk/reward. Has absolute veto power.' },
                  { step: '06', title: 'Smart Order Routing (Alpaca / Polymarket)', desc: 'Fee viability confirmed. Routes fractional orders to Alpaca paper/live or Polymarket CLOB.' },
                  { step: '07', title: 'Dynamic ATR Bracket & Trailing Engine', desc: 'Automated Stop-Loss and dual Take-Profit targets (TP1 @ 2.0x, TP2 @ 3.5x) armed upon order fill.' },
                  { step: '08', title: 'Post-Trade Learning & Weight Calibration', desc: 'P&L outcome attributed back to each agent. Winning agents gain voting weight; losing agents are downweighted.' },
                ].map(s => (
                  <div key={s.step} className="p-3 rounded-lg border border-slate-200 bg-white flex items-start gap-3">
                    <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 font-bold text-xs shrink-0">
                      STEP {s.step}
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-900">{s.title}</h5>
                      <p className="text-slate-600 font-sans text-xs mt-0.5">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: INTRADAY & POLYMARKET */}
          {activeTab === 'horizons' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="flex items-center gap-2 font-bold text-sm text-blue-700 font-mono">
                    <Activity size={16} />
                    <span>Intraday Scalping & Momentum (1m - 15m)</span>
                  </div>
                  <ul className="text-xs text-slate-700 space-y-2 font-sans">
                    <li>&bull; <strong>Zero Overnight Gap Risk:</strong> All intraday scalps are systematically closed before market close (3:55 PM EST).</li>
                    <li>&bull; <strong>Core Triggers:</strong> VWAP shelf breakouts, EMA 9/21 crossovers, and 1-minute order flow volume surges.</li>
                    <li>&bull; <strong>Tight Dynamic Stops:</strong> Stop-loss strictly bounded between 0.8% and 1.5% to ensure rapid loss truncation.</li>
                  </ul>
                </div>

                <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="flex items-center gap-2 font-bold text-sm text-purple-700 font-mono">
                    <Compass size={16} />
                    <span>Long-Term Secular Ripple Engine (Days - Months)</span>
                  </div>
                  <ul className="text-xs text-slate-700 space-y-2 font-sans">
                    <li>&bull; <strong>Cross-Industry Spillover:</strong> When hyperscaler AI booms occur, the ripple engine accumulates alternative power utilities (CEG, VST) and copper (FCX).</li>
                    <li>&bull; <strong>SEC DCF Valuation:</strong> Accumulates securities trading at &gt; 25% discount to intrinsic cash flow value.</li>
                    <li>&bull; <strong>Trailing Hold:</strong> Uses wider 5% to 12% trailing stops to ride extended multi-month trends.</li>
                  </ul>
                </div>
              </div>

              {/* Polymarket Engine */}
              <div className="p-5 rounded-xl border border-slate-200 bg-white space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm text-emerald-700 font-mono">
                  <Zap size={16} />
                  <span>Polymarket Binary +EV Arbitrage Mechanics</span>
                </div>
                <p className="text-xs text-slate-600 font-sans leading-relaxed">
                  Polymarket prediction contracts offer mathematically quantifiable edges where our Bayesian AI model probability diverges from market-implied odds:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500 font-bold mb-1">BAYESIAN PROBABILITY</div>
                    <div className="text-slate-900 font-bold">P(AI) vs P(Market)</div>
                    <p className="text-[11px] text-slate-600 font-sans mt-1">If market prices YES at 40¢ (40%) and AI fair value is 65¢ (65%), EV edge is +25%.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500 font-bold mb-1">KELLY CRITERION</div>
                    <div className="text-slate-900 font-bold">Optimal Fraction (f*)</div>
                    <p className="text-[11px] text-slate-600 font-sans mt-1">Sizes bet mathematically to maximize logarithmic wealth growth while preventing ruin.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500 font-bold mb-1">ZERO TRANSACTION FEES</div>
                    <div className="text-slate-900 font-bold">0% Commission</div>
                    <p className="text-[11px] text-slate-600 font-sans mt-1">Unlike broker fees, Polymarket has $0 commission and fractions of a penny Polygon gas.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: 8 OPEN STOCK APIS */}
          {activeTab === 'apis' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs font-sans text-slate-700">
                Institutional hedge funds pay $24,000/year per Bloomberg terminal. Our platform achieves parity by synthesizing 8 completely free, open, and verified market data APIs:
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                {[
                  { name: 'SEC EDGAR Public Directory', status: '100% Free (No Key)', coverage: '10,412+ Public US Equities, CIK records, 10-K/10-Q balance sheets.' },
                  { name: 'Alpaca Markets Paper API', status: 'Free Paper Tier', coverage: 'Commission-free stock execution, fractional share engine, live streaming quotes.' },
                  { name: 'Finnhub Stock & News API', status: 'Free (60 calls/min)', coverage: 'Real-time stock quotes, analyst price targets, company earnings, news sentiment.' },
                  { name: 'Polygon.io Market Data', status: 'Free Tier', coverage: 'End-of-day aggregates, stock reference data, ticker details, financial statements.' },
                  { name: 'Alpha Vantage Global Financials', status: 'Free (25 calls/day)', coverage: 'Technical indicators (RSI, MACD, SMA), GDP, CPI inflation, economic indicators.' },
                  { name: 'Polymarket CLOB & Gamma', status: '100% Free Public', coverage: 'Prediction market contracts, real-time probability orderbooks, liquidity depth.' },
                  { name: 'FRED (Federal Reserve Economic Data)', status: 'Free API Key', coverage: 'US Federal Funds Rate, 10Y/2Y Yield Curve, CPI Inflation, Unemployment.' },
                  { name: 'Yahoo Finance Public Data Stream', status: '100% Open Fallback', coverage: 'Historical OHLCV daily/intraday candlestick charts, company profiles, market cap.' },
                ].map((api, idx) => (
                  <div key={idx} className="p-3.5 rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between mb-1">
                      <strong className="text-slate-900 text-xs">{api.name}</strong>
                      <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {api.status}
                      </span>
                    </div>
                    <p className="text-slate-600 font-sans text-xs mt-1">{api.coverage}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="font-mono text-xs text-slate-500">
            Automated Multi-Agent Architecture · Zero Human Interference
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold transition shadow-xs"
          >
            CLOSE WHITEPAPER
          </button>
        </div>

      </div>
    </div>
  );
}
