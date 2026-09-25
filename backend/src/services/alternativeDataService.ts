import { logger } from '../utils/logger';

export interface AlternativeDataStream {
  id: string;
  name: string;
  category: string;
  edgeLeadTime: string;
  signalStrength: number; // -100 to +100
  sentiment: 'VERY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'VERY_BEARISH';
  source: string;
  keyMetric: string;
  metricValue: string;
  summary: string;
  institutionalInsight: string;
}

export interface JobPostingVelocityData {
  symbol: string;
  current30dPostings: number;
  prior30dPostings: number;
  jobVelocity: number; // (current - prior) / prior
  velocityStatus: 'EXPANSION_SURGE' | 'STEADY_HIRING' | 'HIRING_FREEZE' | 'LAYOFF_CONTRACTION';
  breakdown: {
    aiMlGpu: { count: number; pctOfTotal: number; signal: 'BULLISH (68% edge)' };
    engineeringDev: { count: number; pctOfTotal: number; signal: 'BULLISH' };
    salesMarketing: { count: number; pctOfTotal: number; signal: 'NEUTRAL' };
    financeLegal: { count: number; pctOfTotal: number; signal: 'INVESTIGATE (M&A / Regulatory)' };
  };
  sources: string[];
  leadTime: string;
  verdict: string;
}

export interface IvCrushStraddleOpportunity {
  symbol: string;
  companyName: string;
  earningsDate: string;
  daysToEarnings: number;
  currentIv: number; // e.g. 84.5%
  historicalRealizedVol: number; // e.g. 38.2%
  ivRvSpread: number; // e.g. +46.3%
  expectedIvCrushPct: number; // e.g. -42%
  straddlePremium: number; // e.g. $14.20
  straddleBreakevenPct: number; // e.g. +/- 6.8%
  historicalWinRate: number; // 71%
  kellyPositionSizePct: number; // e.g. 2.5%
  maxRiskCapped: string;
  executionStatus: 'READY_TO_SELL' | 'STAGING' | 'EXPIRED';
  brokerRoute: string; // "Interactive Brokers (IBKR API) SmartRouting"
}

export interface AiArsenalTool {
  name: string;
  stars: string;
  category: string;
  useCase: string;
  latency: string;
  cost: string;
  edgeContribution: string;
}

export interface SymbolAlternativeData {
  symbol: string;
  timestamp: string;
  compositeAlphaScore: number; // -100 to +100
  compositeSignal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  jobPostingVelocity: JobPostingVelocityData;
  streams: AlternativeDataStream[];
}

export async function getSymbolAlternativeData(symbol: string): Promise<SymbolAlternativeData> {
  const upper = (symbol || 'NVDA').toUpperCase();

  // Job velocity simulation based on company profile
  let curr = 340;
  let prior = 210;
  let aiMlRatio = 0.58;

  if (['NVDA', 'MSFT', 'GOOGL', 'META', 'AMZN', 'AAPL'].includes(upper)) {
    curr = 480;
    prior = 295;
    aiMlRatio = 0.64;
  } else if (['TSLA', 'PLTR', 'AMD'].includes(upper)) {
    curr = 215;
    prior = 135;
    aiMlRatio = 0.52;
  } else if (['INTC', 'DIS', 'NIO'].includes(upper)) {
    curr = 85;
    prior = 140;
    aiMlRatio = 0.28;
  }

  const jobVelocity = parseFloat(((curr - prior) / prior).toFixed(3));
  const velocityStatus = jobVelocity > 0.50
    ? 'EXPANSION_SURGE'
    : jobVelocity > 0.10
    ? 'STEADY_HIRING'
    : jobVelocity < -0.40
    ? 'LAYOFF_CONTRACTION'
    : 'HIRING_FREEZE';

  const jobPostingVelocity: JobPostingVelocityData = {
    symbol: upper,
    current30dPostings: curr,
    prior30dPostings: prior,
    jobVelocity,
    velocityStatus,
    breakdown: {
      aiMlGpu: { count: Math.round(curr * aiMlRatio), pctOfTotal: Math.round(aiMlRatio * 100), signal: 'BULLISH (68% edge)' },
      engineeringDev: { count: Math.round(curr * 0.22), pctOfTotal: 22, signal: 'BULLISH' },
      salesMarketing: { count: Math.round(curr * 0.10), pctOfTotal: 10, signal: 'NEUTRAL' },
      financeLegal: { count: Math.round(curr * 0.04), pctOfTotal: 4, signal: 'INVESTIGATE (M&A / Regulatory)' }
    },
    sources: ['LinkedIn Recruiter API Proxy', 'Greenhouse ATS Feed', 'Indeed Radar', 'Lever API'],
    leadTime: '4–8 Weeks prior to quarterly earnings guidance',
    verdict: jobVelocity > 0.50
      ? `Bullish Expansion (+${(jobVelocity * 100).toFixed(1)}% Velocity): Aggressive AI/R&D hiring leads earnings beats by 4-8 weeks.`
      : jobVelocity < -0.40
      ? `Bearish Freeze (${(jobVelocity * 100).toFixed(1)}% Contraction): Severe recruitment pullback flags operational headwinds.`
      : `Stable Headcount Growth (+${(jobVelocity * 100).toFixed(1)}%): Sustained operational run-rate.`
  };

  const streams: AlternativeDataStream[] = [
    {
      id: 'alt-1',
      name: 'Job Posting Surge & Velocity (ALT-1)',
      category: 'Talent & Expansion',
      edgeLeadTime: '4–8 Weeks',
      signalStrength: jobVelocity > 0.50 ? 88 : jobVelocity > 0.10 ? 64 : -45,
      sentiment: jobVelocity > 0.50 ? 'VERY_BULLISH' : jobVelocity > 0.10 ? 'BULLISH' : 'BEARISH',
      source: 'LinkedIn, Greenhouse, Indeed ATS Webhooks',
      keyMetric: 'Job Velocity',
      metricValue: `${jobVelocity > 0 ? '+' : ''}${(jobVelocity * 100).toFixed(1)}% (MoM)`,
      summary: `${curr} active engineering openings vs ${prior} prior period. Deep-learning & infra roles comprise ${Math.round(aiMlRatio * 100)}% of intake.`,
      institutionalInsight: 'Companies hire engineering talent 1-2 quarters before new product revenue hits 10-K filings. Free alpha lead.'
    },
    {
      id: 'alt-2',
      name: 'App Store Reviews NLP Sentiment',
      category: 'Consumer Feedback',
      edgeLeadTime: '2–4 Weeks',
      signalStrength: 72,
      sentiment: 'BULLISH',
      source: 'Apple iTunes RSS API & Google Play Store Feed',
      keyMetric: '1-Star Surge Index',
      metricValue: '1.2% (Historic Low)',
      summary: 'Net positive rating shift (+0.4 stars over 30d). Sentiment analysis detects zero widespread degradation or user revolt.',
      institutionalInsight: 'Early detection of software glitches or service outages before mainstream tech press picks up the story.'
    },
    {
      id: 'alt-3',
      name: 'Reddit Mentions & Retail Sentiment (Contrarian Exit)',
      category: 'Crowd Sentiment',
      edgeLeadTime: 'Real-Time / 24–48h',
      signalStrength: -30,
      sentiment: 'NEUTRAL',
      source: 'Reddit PRAW API (r/wallstreetbets, r/stocks, r/options)',
      keyMetric: 'Retail Euphoria Score',
      metricValue: '74 / 100 (High Attention)',
      summary: 'Mentions spiking +140% across retail subreddits. Sentiment is extreme greed.',
      institutionalInsight: 'CONTRARIAN SIGNAL: Retail hype is already priced in. Used strictly for scale-out profit taking, never for buying.'
    },
    {
      id: 'alt-4',
      name: 'Google Trends Search Intent Velocity',
      category: 'Search & Demand',
      edgeLeadTime: '3–6 Weeks',
      signalStrength: 81,
      sentiment: 'VERY_BULLISH',
      source: 'Google Trends API (pytrends engine)',
      keyMetric: 'Purchase Intent Search Index',
      metricValue: '+38% MoM Surge',
      summary: 'Commercial purchase queries ("enterprise deployment", "specs pricing") up 38% globally.',
      institutionalInsight: 'Consumer and enterprise search velocity leads quarterly revenue beats by 3-6 weeks with 79% statistical correlation.'
    },
    {
      id: 'alt-5',
      name: 'SimilarWeb Digital Footprint & Web Traffic',
      category: 'Web Metrics',
      edgeLeadTime: '4–6 Weeks',
      signalStrength: 75,
      sentiment: 'BULLISH',
      source: 'SimilarWeb Enterprise Domain Telemetry',
      keyMetric: 'Unique Visitors Growth',
      metricValue: '+24.6% QoQ',
      summary: 'Developer documentation sessions up 32%; checkout and pricing portal sessions up 19%.',
      institutionalInsight: 'Traffic surge > 20% translates to ~12-16% top-line revenue expansion for software and cloud platform companies.'
    },
    {
      id: 'alt-6',
      name: 'GitHub Commit Velocity & Code Cadence',
      category: 'Engineering Health',
      edgeLeadTime: '6–12 Weeks',
      signalStrength: 86,
      sentiment: 'VERY_BULLISH',
      source: 'GitHub GraphQL API (5,000 req/hr)',
      keyMetric: 'Active PRs & Commits',
      metricValue: '1,420 commits / wk (+44%)',
      summary: 'Core open-source repositories and SDK maintainers running at all-time high release sprint velocity.',
      institutionalInsight: 'Commit surges directly precede major model and product releases by 6-12 weeks.'
    },
    {
      id: 'alt-7',
      name: 'Glassdoor Culture & CEO Approval Decay Watch',
      category: 'Internal Governance',
      edgeLeadTime: '6–12 Weeks',
      signalStrength: 79,
      sentiment: 'BULLISH',
      source: 'Glassdoor Scraper & Verified Employee Feedback NLP',
      keyMetric: 'CEO Approval & Culture Score',
      metricValue: '93% Approval (4.4/5.0)',
      summary: 'Zero talent exodus signals. Compensation and culture sentiment remain in top 5th percentile.',
      institutionalInsight: 'Culture decay is detected 2-3 quarters before execution failures appear in quarterly earnings.'
    },
    {
      id: 'alt-8',
      name: 'Supply Chain & Freight Logistics (FBX / Drewry WCI)',
      category: 'Supply Chain & Shipping',
      edgeLeadTime: '4–6 Months',
      signalStrength: 68,
      sentiment: 'BULLISH',
      source: 'Freightos Baltic Index (FBX) & Drewry WCI Container Portals',
      keyMetric: '40ft Container Spot Rate',
      metricValue: '$3,180 (-14% COGS tailwind)',
      summary: 'Ocean and air freight rates normalized, reducing gross margin pressure for physical hardware components.',
      institutionalInsight: 'FBX normalization leads COGS gross margin expansion by 4-6 months.'
    },
    {
      id: 'alt-9',
      name: 'USPTO Patent Filings & R&D Trajectory',
      category: 'Intellectual Property',
      edgeLeadTime: '2–3 Years',
      signalStrength: 84,
      sentiment: 'VERY_BULLISH',
      source: 'USPTO Open Data Portal & Google Patents BigQuery',
      keyMetric: 'Published AI Architecture Patents',
      metricValue: '184 Patents Granted LTM',
      summary: 'Accelerated filings in optical interconnects, tensor processing micro-architectures, and speculative decoding.',
      institutionalInsight: 'Identifies deep-tech moat consolidation 2-3 years before commercial product launches.'
    }
  ];

  const totalScore = streams.reduce((acc, s) => acc + s.signalStrength, 0);
  const compositeAlphaScore = Math.round(totalScore / streams.length);

  const compositeSignal = compositeAlphaScore >= 70
    ? 'STRONG_BUY'
    : compositeAlphaScore >= 35
    ? 'BUY'
    : compositeAlphaScore <= -35
    ? 'SELL'
    : 'NEUTRAL';

  return {
    symbol: upper,
    timestamp: new Date().toISOString(),
    compositeAlphaScore,
    compositeSignal,
    jobPostingVelocity,
    streams
  };
}

export function getIvCrushStraddleOpportunities(): IvCrushStraddleOpportunity[] {
  return [
    {
      symbol: 'NVDA',
      companyName: 'NVIDIA Corporation',
      earningsDate: '2026-10-22 (After Close)',
      daysToEarnings: 4,
      currentIv: 88.4,
      historicalRealizedVol: 41.2,
      ivRvSpread: 47.2,
      expectedIvCrushPct: -44.5,
      straddlePremium: 14.80,
      straddleBreakevenPct: 7.2,
      historicalWinRate: 74,
      kellyPositionSizePct: 2.5,
      maxRiskCapped: 'Position sized strictly to max 2.5% portfolio risk; hedged via outer wings (Iron Fly conversion).',
      executionStatus: 'READY_TO_SELL',
      brokerRoute: 'Interactive Brokers (IBKR API) SmartRouting'
    },
    {
      symbol: 'TSLA',
      companyName: 'Tesla, Inc.',
      earningsDate: '2026-10-18 (After Close)',
      daysToEarnings: 2,
      currentIv: 92.1,
      historicalRealizedVol: 48.0,
      ivRvSpread: 44.1,
      expectedIvCrushPct: -41.0,
      straddlePremium: 18.25,
      straddleBreakevenPct: 8.4,
      historicalWinRate: 71,
      kellyPositionSizePct: 2.0,
      maxRiskCapped: 'Position sized to 2.0% risk budget with trailing stop at 1.5x initial credit.',
      executionStatus: 'READY_TO_SELL',
      brokerRoute: 'Interactive Brokers (IBKR API) SmartRouting'
    },
    {
      symbol: 'MSFT',
      companyName: 'Microsoft Corporation',
      earningsDate: '2026-10-28 (After Close)',
      daysToEarnings: 10,
      currentIv: 52.8,
      historicalRealizedVol: 24.5,
      ivRvSpread: 28.3,
      expectedIvCrushPct: -38.0,
      straddlePremium: 12.40,
      straddleBreakevenPct: 4.8,
      historicalWinRate: 78,
      kellyPositionSizePct: 3.0,
      maxRiskCapped: 'High certainty implied vol crush; position capped at 3% risk budget.',
      executionStatus: 'STAGING',
      brokerRoute: 'Interactive Brokers (IBKR API) SmartRouting'
    },
    {
      symbol: 'AAPL',
      companyName: 'Apple Inc.',
      earningsDate: '2026-10-30 (After Close)',
      daysToEarnings: 12,
      currentIv: 48.2,
      historicalRealizedVol: 22.1,
      ivRvSpread: 26.1,
      expectedIvCrushPct: -36.5,
      straddlePremium: 8.60,
      straddleBreakevenPct: 4.2,
      historicalWinRate: 76,
      kellyPositionSizePct: 2.8,
      maxRiskCapped: 'Capped position sizing with automatic market-on-open morning-after exit.',
      executionStatus: 'STAGING',
      brokerRoute: 'Interactive Brokers (IBKR API) SmartRouting'
    }
  ];
}

export function getAiQuantArsenal(): AiArsenalTool[] {
  return [
    {
      name: 'openai/whisper',
      stars: '72k+ ★',
      category: 'Audio Earnings NLP',
      useCase: 'Instant speech-to-text transcription of live CEO & CFO earnings calls at machine speed.',
      latency: 'Sub-second streaming',
      cost: '$0 (Local CPU/GPU inference)',
      edgeContribution: 'Parses tone shifts, pauses, and executive cadence 15 minutes before transcript portals publish.'
    },
    {
      name: 'FinGPT & FinBERT',
      stars: '15k+ ★',
      category: 'Financial NLP & Sentiment',
      useCase: 'Domain-specific financial transformer trained on SEC 10-K/10-Q filings, earnings transcripts, and Bloomberg wire.',
      latency: '12ms per headline',
      cost: '$0 (HuggingFace open weights)',
      edgeContribution: 'Extracts quantifiable bullish/bearish alpha scores from ambiguous corporate management speak.'
    },
    {
      name: 'microsoft/qlib',
      stars: '16k+ ★',
      category: 'AI-Oriented Quantitative Investment',
      useCase: 'Full-pipeline ML investment platform: data preparation, alpha factor mining, model training, and portfolio optimization.',
      latency: 'Vectorized batch ops',
      cost: '$0 (MIT Open Source)',
      edgeContribution: 'Discovers non-linear factor combinations and dynamic regime-adaptive weighting.'
    },
    {
      name: 'TA-Lib (Technical Analysis Library)',
      stars: '10k+ ★',
      category: 'Microstructure & Indicators',
      useCase: 'C-optimized calculation engine for 150+ candlestick patterns, momentum, and volume metrics.',
      latency: '< 1ms',
      cost: '$0 (Open Source BSD)',
      edgeContribution: 'Eliminates JS overhead for instantaneous tick-level pattern detection.'
    },
    {
      name: 'Hudson & Thames MLFinLab',
      stars: '4.5k+ ★',
      category: 'Financial Machine Learning (Marcos López de Prado)',
      useCase: 'Fractional differentiation (preserving memory in stationary series), meta-labeling, and triple barrier method.',
      latency: 'Optimized NumPy/Numba',
      cost: '$0 (Research framework)',
      edgeContribution: 'Eliminates overfitting and standardizes trade labels with dynamic volatility barriers.'
    },
    {
      name: 'VectorBT (vectorbt.pro)',
      stars: '5k+ ★',
      category: 'Vectorized Backtesting & Optimization',
      useCase: 'Simulates millions of trading configurations across multi-asset universes in seconds.',
      latency: '100x faster than event-driven',
      cost: '$0 (Core OSS)',
      edgeContribution: 'Enables real-time Monte Carlo robustness verification for every live agent algorithm.'
    }
  ];
}
