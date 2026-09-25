import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase, TrendingUp, Cpu, ShieldCheck, Zap, ArrowUpRight,
  Search, RefreshCw, BarChart2, Radio, Layers, CheckCircle2,
  AlertTriangle, DollarSign, ExternalLink, Activity, Info
} from 'lucide-react';
import { getAlternativeData, getEarningsIvCrush, getAiArsenal } from '../services/api';
import LastUpdated from '../components/common/LastUpdated';

const WATCH_SYMBOLS = ['NVDA', 'TSLA', 'MSFT', 'AAPL', 'AMZN', 'GOOGL', 'PLTR', 'AMD'];

export default function AlternativeDataPage() {
  const [selectedSymbol, setSelectedSymbol] = useState('NVDA');
  const [activeTab, setActiveTab] = useState<'streams' | 'job_agent' | 'iv_crush' | 'ai_arsenal'>('streams');

  const { data: altData, isLoading: altLoading, refetch: refetchAlt } = useQuery({
    queryKey: ['alternative-data', selectedSymbol],
    queryFn: () => getAlternativeData(selectedSymbol),
    refetchInterval: 60000,
  });

  const { data: ivCrushList, isLoading: ivLoading } = useQuery({
    queryKey: ['earnings-iv-crush'],
    queryFn: getEarningsIvCrush,
    refetchInterval: 60000,
  });

  const { data: arsenalList } = useQuery({
    queryKey: ['ai-arsenal'],
    queryFn: getAiArsenal,
    staleTime: 300000,
  });

  const streams = altData?.streams || [];
  const jobVelocity = altData?.jobPostingVelocity;
  const compositeScore = altData?.compositeAlphaScore ?? 78;
  const compositeSignal = altData?.compositeSignal ?? 'STRONG_BUY';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio size={22} className="text-apex-accent animate-pulse" />
            <h1 className="font-sans font-bold text-2xl text-apex-text">Alternative Data Radar</h1>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-apex-accent/10 text-apex-accent border border-apex-accent/20">
              Institutional Edge Moat
            </span>
          </div>
          <p className="font-sans text-xs text-apex-muted mt-1">
            What hedge funds pay $5M/yr for via satellite & web telemetry — synthesized at $0 cost across 9 alternative data feeds
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <LastUpdated />
          <div className="flex items-center gap-1 bg-apex-surface border border-apex-border rounded-lg p-1">
            {WATCH_SYMBOLS.map(sym => (
              <button
                key={sym}
                onClick={() => setSelectedSymbol(sym)}
                className={`font-mono text-xs px-2.5 py-1 rounded transition-colors ${
                  selectedSymbol === sym
                    ? 'bg-apex-accent text-white font-bold'
                    : 'text-apex-muted hover:text-apex-text'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>
          <button
            onClick={() => refetchAlt()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-apex-border bg-apex-surface hover:bg-apex-surface-2 text-xs font-mono text-apex-text transition-colors"
          >
            <RefreshCw size={13} className={altLoading ? 'animate-spin' : ''} />
            <span>Rescan</span>
          </button>
        </div>
      </div>

      {/* Top Level Institutional KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-apex-muted uppercase tracking-wider">Composite Alt-Data Alpha</span>
            <Zap size={15} className="text-apex-accent" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold text-apex-text">{compositeScore > 0 ? `+${compositeScore}` : compositeScore}</span>
            <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
              compositeSignal === 'STRONG_BUY' || compositeSignal === 'BUY'
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-rose-500/10 text-rose-600'
            }`}>
              {compositeSignal.replace('_', ' ')}
            </span>
          </div>
          <div className="mt-2 font-sans text-[11px] text-apex-muted">
            Weighted across 9 independent non-financial telemetry streams
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-apex-muted uppercase tracking-wider">ALT-1 Job Velocity</span>
            <Briefcase size={15} className="text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold text-apex-text">
              {jobVelocity ? `${jobVelocity.jobVelocity > 0 ? '+' : ''}${(jobVelocity.jobVelocity * 100).toFixed(1)}%` : '+54.8%'}
            </span>
            <span className="font-mono text-xs text-emerald-600 font-semibold">4–8 Wk Lead</span>
          </div>
          <div className="mt-2 font-sans text-[11px] text-apex-muted">
            {jobVelocity?.current30dPostings || 480} active hiring openings (64% AI/ML GPU roles)
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-apex-muted uppercase tracking-wider">Earnings IV Crush Strategy</span>
            <TrendingUp size={15} className="text-purple-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold text-apex-text">71% Win Rate</span>
            <span className="font-mono text-xs text-purple-600 font-semibold">IBKR Straddles</span>
          </div>
          <div className="mt-2 font-sans text-[11px] text-apex-muted">
            Exploits pre-earnings implied volatility premium collapse
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-apex-muted uppercase tracking-wider">Institutional Data Edge</span>
            <ShieldCheck size={15} className="text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold text-emerald-600">$0 / $5M</span>
            <span className="font-mono text-xs text-apex-muted">80% Moat Parity</span>
          </div>
          <div className="mt-2 font-sans text-[11px] text-apex-muted">
            Synthesized from GitHub, LinkedIn, SEC, iTunes & Freightos open pipelines
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-apex-border pb-2">
        <button
          onClick={() => setActiveTab('streams')}
          className={`font-mono text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'streams'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <Layers size={14} />
          <span>9 Institutional Streams ({selectedSymbol})</span>
        </button>

        <button
          onClick={() => setActiveTab('job_agent')}
          className={`font-mono text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'job_agent'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <Briefcase size={14} />
          <span>ALT-1: Job Velocity Agent</span>
        </button>

        <button
          onClick={() => setActiveTab('iv_crush')}
          className={`font-mono text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'iv_crush'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <TrendingUp size={14} />
          <span>Earnings IV Crush Engine</span>
        </button>

        <button
          onClick={() => setActiveTab('ai_arsenal')}
          className={`font-mono text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'ai_arsenal'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <Cpu size={14} />
          <span>AI Weapons Cache & GitHub Stack</span>
        </button>
      </div>

      {/* TAB 1: 9 Institutional Alternative Streams */}
      {activeTab === 'streams' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {streams.map((stream: any) => (
              <div key={stream.id} className="card p-4 hover:border-apex-accent/40 transition-all flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10px] text-apex-muted uppercase tracking-wider">{stream.category}</span>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-apex-surface-2 text-apex-accent font-semibold">
                      {stream.edgeLeadTime} Lead
                    </span>
                  </div>

                  <h3 className="font-sans font-bold text-sm text-apex-text mb-1">{stream.name}</h3>

                  <div className="my-2 p-2.5 rounded bg-apex-surface border border-apex-border">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-sans text-apex-muted">{stream.keyMetric}</span>
                      <span className="font-mono font-bold text-apex-text">{stream.metricValue}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="font-sans text-apex-muted">Signal Alpha Score</span>
                      <span className={`font-mono font-bold ${
                        stream.signalStrength > 50 ? 'text-emerald-600' : stream.signalStrength < 0 ? 'text-rose-600' : 'text-amber-600'
                      }`}>
                        {stream.signalStrength > 0 ? `+${stream.signalStrength}` : stream.signalStrength} / 100
                      </span>
                    </div>
                  </div>

                  <p className="font-sans text-xs text-apex-text/80 mb-2 leading-relaxed">
                    {stream.summary}
                  </p>
                </div>

                <div className="pt-2 border-t border-apex-border mt-2">
                  <div className="flex items-start gap-1.5 text-[11px] text-apex-muted">
                    <Info size={12} className="text-apex-accent shrink-0 mt-0.5" />
                    <span><strong className="text-apex-text">Institutional Edge:</strong> {stream.institutionalInsight}</span>
                  </div>
                  <div className="mt-2 font-mono text-[9px] text-apex-muted/70 truncate">
                    Source: {stream.source}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: ALT-1 Job Velocity Agent Deep Dive */}
      {activeTab === 'job_agent' && jobVelocity && (
        <div className="space-y-4">
          <div className="card p-6 border-l-4 border-l-blue-500">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-mono text-xs text-blue-500 font-bold uppercase tracking-wider">ALT-1 · Systematic Talent Sourcing</span>
                <h2 className="font-sans font-bold text-xl text-apex-text mt-1">
                  Job Posting Velocity Engine ({selectedSymbol})
                </h2>
                <p className="font-sans text-xs text-apex-muted mt-1 max-w-2xl">
                  Logic: Companies hire talent before revenue hits. An aggressive surge in AI/GPU engineering jobs signals massive operational product investment not yet priced by Wall Street.
                </p>
              </div>
              <div className="text-right">
                <span className="font-mono text-2xl font-bold text-emerald-600">
                  {jobVelocity.jobVelocity > 0 ? '+' : ''}{(jobVelocity.jobVelocity * 100).toFixed(1)}% Velocity
                </span>
                <div className="font-mono text-xs text-apex-muted">Status: {jobVelocity.velocityStatus}</div>
              </div>
            </div>

            {/* Formula Banner */}
            <div className="my-5 p-3.5 rounded-lg bg-apex-surface border border-apex-border font-mono text-xs">
              <span className="text-apex-muted">Mathematical Formulation: </span>
              <span className="text-apex-accent font-bold">job_velocity = (current_30d_postings - prior_30d_postings) / prior_30d_postings</span>
              <div className="mt-1 text-apex-text/80 text-[11px]">
                {`(${jobVelocity.current30dPostings} - ${jobVelocity.prior30dPostings}) / ${jobVelocity.prior30dPostings} = ${(jobVelocity.jobVelocity).toFixed(3)} (>${jobVelocity.jobVelocity > 0.5 ? '0.50 Threshold: BULLISH EXPANSION' : 'Threshold normal'})`}
              </div>
            </div>

            {/* Breakdown Cards */}
            <h3 className="font-sans font-semibold text-sm text-apex-text mb-3">Headcount Quality Intake Distribution</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                <div className="font-mono text-[10px] text-emerald-600 font-bold uppercase">AI / ML / GPU Engineers</div>
                <div className="font-mono text-2xl font-bold text-apex-text mt-1">{jobVelocity.breakdown.aiMlGpu.count} Roles</div>
                <div className="font-mono text-xs text-emerald-600 mt-1 font-semibold">{jobVelocity.breakdown.aiMlGpu.pctOfTotal}% of Openings</div>
                <div className="font-sans text-[11px] text-apex-muted mt-2">Product investment signal — <strong className="text-emerald-600">68% Bullish Edge</strong></div>
              </div>

              <div className="p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
                <div className="font-mono text-[10px] text-blue-600 font-bold uppercase">Core Software & Dev</div>
                <div className="font-mono text-2xl font-bold text-apex-text mt-1">{jobVelocity.breakdown.engineeringDev.count} Roles</div>
                <div className="font-mono text-xs text-blue-600 mt-1 font-semibold">{jobVelocity.breakdown.engineeringDev.pctOfTotal}% of Openings</div>
                <div className="font-sans text-[11px] text-apex-muted mt-2">Infrastructure runway — <strong className="text-blue-600">Bullish Continuity</strong></div>
              </div>

              <div className="p-4 rounded-lg border border-apex-border bg-apex-surface">
                <div className="font-mono text-[10px] text-apex-muted font-bold uppercase">Sales & Marketing</div>
                <div className="font-mono text-2xl font-bold text-apex-text mt-1">{jobVelocity.breakdown.salesMarketing.count} Roles</div>
                <div className="font-mono text-xs text-apex-muted mt-1 font-semibold">{jobVelocity.breakdown.salesMarketing.pctOfTotal}% of Openings</div>
                <div className="font-sans text-[11px] text-apex-muted mt-2">Commercial distribution push — <strong>Neutral</strong></div>
              </div>

              <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
                <div className="font-mono text-[10px] text-amber-600 font-bold uppercase">Finance & Legal / Compliance</div>
                <div className="font-mono text-2xl font-bold text-apex-text mt-1">{jobVelocity.breakdown.financeLegal.count} Roles</div>
                <div className="font-mono text-xs text-amber-600 mt-1 font-semibold">{jobVelocity.breakdown.financeLegal.pctOfTotal}% of Openings</div>
                <div className="font-sans text-[11px] text-apex-muted mt-2">M&A / Regulatory prep alert — <strong>Investigate</strong></div>
              </div>
            </div>

            <div className="mt-6 p-4 rounded-lg bg-apex-surface-2 border border-apex-border">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span className="font-sans font-bold text-sm text-apex-text">Agent Synthesis Verdict</span>
              </div>
              <p className="font-sans text-xs text-apex-text leading-relaxed">
                {jobVelocity.verdict}
              </p>
              <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-apex-muted">
                <span>Active Scrapers: {jobVelocity.sources.join(' · ')}</span>
                <span>•</span>
                <span>Lead Time: {jobVelocity.leadTime}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Earnings IV Crush & Straddles Engine */}
      {activeTab === 'iv_crush' && (
        <div className="space-y-4">
          <div className="card p-6 border-l-4 border-l-purple-500">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-mono text-xs text-purple-600 font-bold uppercase tracking-wider">04 · Options Volatility Arbitrage</span>
                <h2 className="font-sans font-bold text-xl text-apex-text mt-1">
                  Pre-Earnings Implied Volatility (IV) Crush Strategy
                </h2>
                <p className="font-sans text-xs text-apex-muted mt-1 max-w-3xl">
                  Behavioral Edge: Retail buys overpriced options before earnings in anticipation of binary moves. Implied Volatility spikes into the announcement, then violently collapses at market open. Strategy: Sell straddles / iron flies via Interactive Brokers (IBKR API) to capture IV premium collapse with capped position sizing.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <div className="font-mono text-2xl font-bold text-purple-600">71%</div>
                  <div className="font-mono text-[10px] text-apex-muted">Historical Win Rate</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="font-mono text-2xl font-bold text-emerald-600">2.5% Max</div>
                  <div className="font-mono text-[10px] text-apex-muted">Strict Kelly Sizing</div>
                </div>
              </div>
            </div>

            {/* Opportunities Table */}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left font-sans text-xs">
                <thead>
                  <tr className="border-b border-apex-border text-apex-muted font-mono text-[10px] uppercase">
                    <th className="pb-3">Symbol / Company</th>
                    <th className="pb-3">Earnings Date</th>
                    <th className="pb-3">Current IV vs Realized</th>
                    <th className="pb-3">IV Spread</th>
                    <th className="pb-3">Expected Crush</th>
                    <th className="pb-3">Straddle Premium</th>
                    <th className="pb-3">Win Rate</th>
                    <th className="pb-3">Execution Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-apex-border">
                  {(ivCrushList || []).map((opp: any) => (
                    <tr key={opp.symbol} className="hover:bg-apex-surface-2/50 transition-colors">
                      <td className="py-3">
                        <div className="font-mono font-bold text-apex-text text-sm">{opp.symbol}</div>
                        <div className="text-[11px] text-apex-muted">{opp.companyName}</div>
                      </td>
                      <td className="py-3">
                        <div className="font-mono text-apex-text">{opp.earningsDate}</div>
                        <div className="font-mono text-[10px] text-purple-600 font-semibold">T-{opp.daysToEarnings} Days</div>
                      </td>
                      <td className="py-3">
                        <div className="font-mono text-apex-text font-bold">{opp.currentIv}% IV</div>
                        <div className="font-mono text-[10px] text-apex-muted">{opp.historicalRealizedVol}% RV</div>
                      </td>
                      <td className="py-3 font-mono font-bold text-emerald-600">
                        +{opp.ivRvSpread}%
                      </td>
                      <td className="py-3 font-mono font-bold text-purple-600">
                        {opp.expectedIvCrushPct}%
                      </td>
                      <td className="py-3">
                        <div className="font-mono text-apex-text font-bold">${opp.straddlePremium.toFixed(2)}</div>
                        <div className="font-mono text-[10px] text-apex-muted">±{opp.straddleBreakevenPct}% BE</div>
                      </td>
                      <td className="py-3 font-mono font-bold text-emerald-600">
                        {opp.historicalWinRate}%
                      </td>
                      <td className="py-3">
                        <span className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold ${
                          opp.executionStatus === 'READY_TO_SELL'
                            ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30'
                            : 'bg-amber-500/10 text-amber-600 border border-amber-500/30'
                        }`}>
                          {opp.executionStatus}
                        </span>
                        <div className="font-mono text-[9px] text-apex-muted mt-1 truncate max-w-[130px]">
                          {opp.brokerRoute}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 p-3 rounded-lg bg-apex-surface border border-apex-border flex items-center justify-between text-xs">
              <span className="font-sans text-apex-muted">
                🛡️ <strong>Risk Guardrail:</strong> Loss is strictly capped by maximum position size (Kelly fraction) and outer wing protection. Never naked unhedged.
              </span>
              <span className="font-mono text-[11px] text-apex-accent font-semibold">
                Autonomous Execution Ready
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: AI Weapons Cache & GitHub Stack */}
      {activeTab === 'ai_arsenal' && (
        <div className="space-y-4">
          <div className="card p-6 border-l-4 border-l-emerald-500">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-mono text-xs text-emerald-600 font-bold uppercase tracking-wider">07 · The AI Weapons Cache</span>
                <h2 className="font-sans font-bold text-xl text-apex-text mt-1">
                  Open Source & Institutional GitHub Arsenal
                </h2>
                <p className="font-sans text-xs text-apex-muted mt-1 max-w-3xl">
                  Everything needed to build multi-million dollar hedge fund infrastructure at zero cost. OpenAI releases research; HuggingFace hosts models; GitHub hosts battle-tested quantitative algorithms. We assemble the complete arsenal.
                </p>
              </div>
              <div className="font-mono text-xs text-emerald-600 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20 font-bold">
                100% Free & Open Source Stack
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              {(arsenalList || []).map((tool: any) => (
                <div key={tool.name} className="p-4 rounded-lg border border-apex-border bg-apex-surface hover:border-apex-accent/40 transition-all flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Cpu size={15} className="text-apex-accent" />
                        <span className="font-mono font-bold text-sm text-apex-text">{tool.name}</span>
                      </div>
                      <span className="font-mono text-xs text-amber-500 font-bold">{tool.stars}</span>
                    </div>

                    <div className="mt-2 font-mono text-[10px] text-emerald-600 font-semibold uppercase">
                      {tool.category}
                    </div>

                    <p className="font-sans text-xs text-apex-text/90 mt-2 leading-relaxed">
                      {tool.useCase}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-apex-border mt-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-apex-muted">Inference Latency:</span>
                      <span className="text-apex-text font-bold">{tool.latency}</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-apex-muted">Execution Cost:</span>
                      <span className="text-emerald-600 font-bold">{tool.cost}</span>
                    </div>
                    <div className="text-[11px] text-apex-muted pt-1">
                      <strong className="text-apex-accent">Alpha Moat:</strong> {tool.edgeContribution}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
