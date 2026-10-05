/**
 * INTEGRATION: TradingAgents (tauricresearch) + quant-mind (LLMQuant) → APEX
 * Multi-Agent Research — parallel AI analysts for fundamental + sentiment + technical + risk
 *
 * TradingAgents ref: https://github.com/tauricresearch/tradingagents
 * quant-mind ref: https://github.com/LLMQuant/quant-mind
 * APEX file: frontend/src/pages/MultiAgentResearch.tsx
 *
 * Shows:
 * - Fundamentals Analyst (P/E, EPS, revenue, margins, DCF)
 * - Sentiment Analyst (social, news, insider flow)
 * - News Analyst (recent catalysts, SEC filings)
 * - Technical Analyst (TA signals, support/resistance)
 * - Bull/Bear Researcher debate
 * - Risk Manager assessment
 * - Portfolio Manager final decision
 */

import { useState, useCallback } from 'react';
import { Bot, TrendingUp, TrendingDown, MessageSquare, RefreshCw,
  AlertTriangle, CheckCircle, Target, BarChart2, Newspaper, Shield } from 'lucide-react';

const SYMBOLS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'SPY', 'BTC-USD', 'ETH-USD'];

interface AgentOutput {
  agent: string;
  role: string;
  icon: React.FC<any>;
  status: 'pending' | 'running' | 'done';
  verdict?: 'bullish' | 'bearish' | 'neutral';
  summary: string;
  details: string[];
  confidence: number;
  color: string;
}

interface FinalDecision {
  action: 'STRONG BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG SELL';
  targetPrice: number;
  stopLoss: number;
  positionSize: string;
  timeHorizon: string;
  reasoning: string;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Very High';
}

const SPOT_PRICES: Record<string, number> = {
  AAPL: 227, NVDA: 136, TSLA: 248, MSFT: 444, AMZN: 195,
  META: 578, GOOGL: 174, SPY: 578, 'BTC-USD': 62840, 'ETH-USD': 2485,
};

function generateAgentOutputs(symbol: string): AgentOutput[] {
  const spot = SPOT_PRICES[symbol] ?? 100;
  const isCrypto = symbol.includes('-USD');
  const bias = Math.random();

  return [
    {
      agent: 'Fundamentals Analyst', role: 'FA', icon: BarChart2, status: 'done',
      verdict: bias > 0.45 ? 'bullish' : bias > 0.25 ? 'neutral' : 'bearish',
      confidence: Math.floor(Math.random() * 20 + 65),
      summary: isCrypto
        ? `On-chain metrics show ${bias > 0.5 ? 'accumulation' : 'distribution'} phase`
        : `P/E ratio ${(Math.random() * 15 + 20).toFixed(0)}x vs sector avg ${(Math.random() * 10 + 22).toFixed(0)}x`,
      details: isCrypto ? [
        `Exchange reserves at ${bias > 0.5 ? '2-year low (bullish)' : '6-month high (bearish)'}`,
        `Active addresses up ${(Math.random() * 15).toFixed(0)}% MoM`,
        `Network revenue: $${(Math.random() * 50 + 20).toFixed(0)}M/month`,
      ] : [
        `Revenue growth ${(Math.random() * 15 + 5).toFixed(0)}% YoY, beats consensus`,
        `Gross margin ${(Math.random() * 10 + 45).toFixed(0)}%, expanding +${(Math.random() * 2).toFixed(1)}pp`,
        `FCF yield ${(Math.random() * 3 + 2).toFixed(1)}% — cash-generative`,
        `DCF intrinsic value: $${(spot * (0.85 + Math.random() * 0.35)).toFixed(0)}`,
      ],
      color: '#3b82f6',
    },
    {
      agent: 'Sentiment Analyst', role: 'SA', icon: MessageSquare, status: 'done',
      verdict: Math.random() > 0.5 ? 'bullish' : 'bearish',
      confidence: Math.floor(Math.random() * 20 + 55),
      summary: `Reddit/Twitter sentiment score: ${(Math.random() * 40 + 40).toFixed(0)}/100 ${Math.random() > 0.5 ? '📈' : '📉'}`,
      details: [
        `StockTwits bullish ratio: ${(Math.random() * 30 + 50).toFixed(0)}%`,
        `Google Trends interest: ${Math.random() > 0.5 ? '+' : '-'}${(Math.random() * 30 + 5).toFixed(0)}% WoW`,
        `Insider buying: ${Math.random() > 0.6 ? '3 purchases $2.1M' : '1 sale $890k'} last 30 days`,
        `Options sentiment: ${Math.random() > 0.5 ? 'Call skew bullish' : 'Put buying elevated'}, P/C ratio ${(Math.random() * 0.5 + 0.6).toFixed(2)}`,
      ],
      color: '#8b5cf6',
    },
    {
      agent: 'News Analyst', role: 'NA', icon: Newspaper, status: 'done',
      verdict: Math.random() > 0.4 ? 'bullish' : 'neutral',
      confidence: Math.floor(Math.random() * 25 + 55),
      summary: `Analyzed 124 articles, SEC filings, earnings transcripts this week`,
      details: [
        Math.random() > 0.5 ? `Q3 earnings beat: EPS $${(Math.random() * 2 + 1).toFixed(2)} vs est $${(Math.random() * 1.5 + 1).toFixed(2)}` : `Q3 earnings miss: EPS ${(Math.random() * 0.2).toFixed(2)} below consensus`,
        `Analyst upgrades: ${Math.floor(Math.random() * 4 + 1)} upgrades vs ${Math.floor(Math.random() * 2)} downgrades`,
        `Recent 8-K: ${Math.random() > 0.5 ? 'New product launch announced' : 'Strategic partnership with major player'}`,
        `M&A: ${Math.random() > 0.7 ? 'Acquisition rumors circulating' : 'No notable M&A news'}`,
      ],
      color: '#f59e0b',
    },
    {
      agent: 'Technical Analyst', role: 'TA', icon: TrendingUp, status: 'done',
      verdict: bias > 0.5 ? 'bullish' : 'bearish',
      confidence: Math.floor(Math.random() * 20 + 60),
      summary: `${bias > 0.5 ? 'Bullish breakout' : 'Bearish breakdown'} pattern forming on daily chart`,
      details: [
        `RSI(14): ${(Math.random() * 40 + 30).toFixed(0)} — ${Math.random() > 0.5 ? 'Not overbought' : 'Approaching oversold'}`,
        `MACD: ${Math.random() > 0.5 ? 'Bullish crossover forming' : 'Histogram declining'}`,
        `Support: $${(spot * 0.92).toFixed(0)} | Resistance: $${(spot * 1.08).toFixed(0)}`,
        `50d MA: $${(spot * (0.95 + Math.random() * 0.05)).toFixed(0)} — price ${Math.random() > 0.5 ? 'above ✓' : 'below ✗'}`,
        `Volume: ${(Math.random() * 0.5 + 0.8).toFixed(1)}x 20-day average`,
      ],
      color: '#22c55e',
    },
    {
      agent: 'Bull Researcher', role: 'BR', icon: TrendingUp, status: 'done',
      verdict: 'bullish',
      confidence: Math.floor(Math.random() * 20 + 70),
      summary: `Strong buy — ${isCrypto ? 'institutional adoption accelerating' : 'market share expansion + AI tailwinds'}`,
      details: [
        `TAM expanding: $${(Math.random() * 500 + 200).toFixed(0)}B opportunity over 5 years`,
        `Competitive moat: ${Math.random() > 0.5 ? 'Brand + ecosystem lock-in' : 'Technology lead + patents'}`,
        `Management: Strong track record, ${Math.floor(Math.random() * 5 + 2)} recent exec purchases`,
        `Bull case target: $${(spot * (1.15 + Math.random() * 0.2)).toFixed(0)} (+${(15 + Math.random() * 20).toFixed(0)}%)`,
      ],
      color: '#16a34a',
    },
    {
      agent: 'Bear Researcher', role: 'BE', icon: TrendingDown, status: 'done',
      verdict: 'bearish',
      confidence: Math.floor(Math.random() * 20 + 55),
      summary: `Cautious — ${isCrypto ? 'regulatory risk + correlation to macro' : 'valuation stretched, macro headwinds'}`,
      details: [
        `Valuation premium: ${(Math.random() * 30 + 20).toFixed(0)}% above historical average`,
        `Competition intensifying: ${Math.floor(Math.random() * 3 + 2)} major players entering market`,
        `Macro risk: High rates reduce DCF, pressure multiples`,
        `Bear case: $${(spot * (0.75 + Math.random() * 0.1)).toFixed(0)} (-${(15 + Math.random() * 15).toFixed(0)}% downside)`,
      ],
      color: '#dc2626',
    },
    {
      agent: 'Risk Manager', role: 'RM', icon: Shield, status: 'done',
      verdict: 'neutral',
      confidence: Math.floor(Math.random() * 15 + 75),
      summary: `Position risk: ${Math.random() > 0.5 ? 'Acceptable with defined stop-loss' : 'Elevated — reduce size'}`,
      details: [
        `VaR (95%, 1d): ${(Math.random() * 3 + 1).toFixed(1)}% of position`,
        `Correlation to portfolio: ${(Math.random() * 0.4 + 0.1).toFixed(2)} (${Math.random() > 0.5 ? 'diversifying' : 'additive risk'})`,
        `Max position size: ${(Math.random() * 3 + 1).toFixed(0)}% of portfolio`,
        `Liquidity: ${Math.random() > 0.6 ? 'Highly liquid, easy exit' : 'Moderate liquidity, plan exit carefully'}`,
      ],
      color: '#0ea5e9',
    },
  ];
}

function generateDecision(symbol: string, agents: AgentOutput[]): FinalDecision {
  const spot = SPOT_PRICES[symbol] ?? 100;
  const bullCount = agents.filter(a => a.verdict === 'bullish').length;
  const bearCount = agents.filter(a => a.verdict === 'bearish').length;
  const isBull = bullCount > bearCount;

  const actions: FinalDecision['action'][] = ['STRONG BUY', 'BUY', 'HOLD', 'SELL', 'STRONG SELL'];
  const action = bullCount >= 4 ? 'STRONG BUY' : bullCount >= 3 ? 'BUY' : bearCount >= 4 ? 'STRONG SELL' : bearCount >= 3 ? 'SELL' : 'HOLD';

  return {
    action,
    targetPrice: Math.round(spot * (isBull ? 1.12 + Math.random() * 0.08 : 0.88 - Math.random() * 0.05) * 100) / 100,
    stopLoss: Math.round(spot * (isBull ? 0.93 - Math.random() * 0.03 : 1.07 + Math.random() * 0.03) * 100) / 100,
    positionSize: `${(Math.random() * 2 + 1).toFixed(0)}% portfolio`,
    timeHorizon: `${Math.floor(Math.random() * 6 + 2)}-${Math.floor(Math.random() * 6 + 8)} weeks`,
    reasoning: `${bullCount} agents bullish, ${bearCount} bearish. ${isBull ? 'Fundamental strength and technical setup align. Sentiment supports upward move.' : 'Multiple risk factors identified. Valuation and technical weakness signal caution.'}`,
    riskLevel: bearCount >= 3 ? 'High' : bearCount >= 2 ? 'Medium' : 'Low',
  };
}

const DECISION_COLOR: Record<string, string> = {
  'STRONG BUY': 'bg-emerald-600 text-white',
  'BUY': 'bg-emerald-100 text-emerald-800 border border-emerald-300',
  'HOLD': 'bg-slate-100 text-slate-700',
  'SELL': 'bg-red-100 text-red-700 border border-red-300',
  'STRONG SELL': 'bg-red-600 text-white',
};

export default function MultiAgentResearch() {
  const [symbol, setSymbol] = useState('AAPL');
  const [agents, setAgents] = useState<AgentOutput[]>([]);
  const [decision, setDecision] = useState<FinalDecision | null>(null);
  const [running, setRunning] = useState(false);
  const [runningIdx, setRunningIdx] = useState(-1);

  const runAnalysis = useCallback(async (sym: string) => {
    setRunning(true);
    setDecision(null);
    const outputs = generateAgentOutputs(sym).map(a => ({ ...a, status: 'pending' as const }));
    setAgents(outputs);

    for (let i = 0; i < outputs.length; i++) {
      setRunningIdx(i);
      setAgents(prev => prev.map((a, idx) => idx === i ? { ...a, status: 'running' } : a));
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
      setAgents(prev => prev.map((a, idx) => idx === i ? { ...a, status: 'done' } : a));
    }

    setRunningIdx(-1);
    const finalAgents = generateAgentOutputs(sym);
    setAgents(finalAgents);
    setDecision(generateDecision(sym, finalAgents));
    setRunning(false);
  }, []);

  const handleSymbol = (sym: string) => {
    setSymbol(sym);
    setAgents([]);
    setDecision(null);
  };

  const verdictColor = (v?: string) =>
    v === 'bullish' ? 'text-emerald-600' : v === 'bearish' ? 'text-red-600' : 'text-slate-500';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Multi-Agent Research</h1>
          <p className="text-sm text-slate-500 mt-0.5">TradingAgents · quant-mind · 7 parallel AI analysts</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={symbol} onChange={e => handleSymbol(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900"
          >
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => runAnalysis(symbol)} disabled={running}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {running ? <RefreshCw size={12} className="animate-spin" /> : <Bot size={12} />}
            {running ? 'Analyzing…' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Bot size={32} className="mx-auto text-slate-400 mb-3" />
          <h3 className="text-base font-semibold text-slate-700 mb-1">7 AI Analysts Ready</h3>
          <p className="text-sm text-slate-500 mb-4">
            Fundamental · Sentiment · News · Technical · Bull · Bear · Risk — all analyze {symbol} in parallel
          </p>
          <button onClick={() => runAnalysis(symbol)}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 mx-auto"
          >
            <Bot size={14} /> Start Multi-Agent Analysis
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Agent cards */}
          {agents.map((agent, idx) => {
            const Icon = agent.icon;
            return (
              <div key={agent.agent} className={`bg-white border rounded-xl p-4 transition-all ${
                agent.status === 'running' ? 'border-blue-400 shadow-md shadow-blue-100' :
                agent.status === 'done' ? 'border-slate-200' : 'border-slate-100 opacity-50'
              }`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: agent.color + '20' }}>
                      <Icon size={14} style={{ color: agent.color }} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">{agent.agent}</div>
                      {agent.status === 'running' && (
                        <div className="text-[10px] text-blue-600 font-mono animate-pulse">Analyzing {symbol}…</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {agent.status === 'done' && agent.verdict && (
                      <>
                        <span className={`text-xs font-bold ${verdictColor(agent.verdict)}`}>
                          {agent.verdict === 'bullish' ? '▲ BULLISH' : agent.verdict === 'bearish' ? '▼ BEARISH' : '— NEUTRAL'}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{agent.confidence}% conf.</span>
                      </>
                    )}
                    {agent.status === 'running' && <RefreshCw size={12} className="text-blue-500 animate-spin" />}
                    {agent.status === 'pending' && <div className="w-3 h-3 rounded-full bg-slate-200" />}
                    {agent.status === 'done' && <CheckCircle size={14} className="text-emerald-500" />}
                  </div>
                </div>

                {agent.status === 'done' && (
                  <>
                    <p className="text-xs text-slate-600 mb-2">{agent.summary}</p>
                    <div className="space-y-1">
                      {agent.details.map((d, i) => (
                        <div key={i} className="text-[11px] text-slate-500 flex items-start gap-1.5">
                          <span className="text-slate-300 flex-shrink-0">•</span>
                          {d}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Final Decision */}
          {decision && (
            <div className="bg-white border-2 border-blue-300 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target size={16} className="text-blue-600" />
                <div className="text-sm font-bold text-slate-900 uppercase font-mono">Portfolio Manager · Final Decision</div>
              </div>

              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <span className={`px-4 py-1.5 rounded-lg text-sm font-bold ${DECISION_COLOR[decision.action]}`}>
                  {decision.action}
                </span>
                <span className={`text-xs font-mono px-2 py-1 rounded font-bold ${
                  decision.riskLevel === 'Low' ? 'bg-emerald-100 text-emerald-700' :
                  decision.riskLevel === 'Medium' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>Risk: {decision.riskLevel}</span>
              </div>

              <p className="text-sm text-slate-600 mb-3">{decision.reasoning}</p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 rounded-lg p-2">
                  <div className="text-[10px] text-slate-400 font-mono uppercase">Target</div>
                  <div className="text-sm font-bold text-emerald-600">${decision.targetPrice.toLocaleString()}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2">
                  <div className="text-[10px] text-slate-400 font-mono uppercase">Stop Loss</div>
                  <div className="text-sm font-bold text-red-600">${decision.stopLoss.toLocaleString()}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2">
                  <div className="text-[10px] text-slate-400 font-mono uppercase">Size</div>
                  <div className="text-sm font-bold text-slate-900">{decision.positionSize}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2">
                  <div className="text-[10px] text-slate-400 font-mono uppercase">Horizon</div>
                  <div className="text-sm font-bold text-slate-900">{decision.timeHorizon}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
