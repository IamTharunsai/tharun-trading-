import axios from 'axios';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const FH_KEY = process.env.FINNHUB_API_KEY;
const POLY_KEY = process.env.POLYGON_API_KEY;

export interface DeepCompanyAnalysis {
  symbol: string;
  // Company identity
  companyName: string;
  sector: string;
  industry: string;
  marketCap: number;
  employees: number;
  description: string;
  // Valuation
  peRatio: number | null;
  pbRatio: number | null;
  psRatio: number | null;
  evToEbitda: number | null;
  priceToFCF: number | null;
  // Income statement (last 4 years)
  revenueHistory: { year: string; value: number; growth: number | null }[];
  netIncomeHistory: { year: string; value: number; growth: number | null }[];
  epsHistory: { year: string; value: number; growth: number | null }[];
  grossMarginHistory: { year: string; value: number }[];
  operatingMarginHistory: { year: string; value: number }[];
  // Balance sheet
  totalDebt: number | null;
  totalCash: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  bookValuePerShare: number | null;
  // Cash flow
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  capex: number | null;
  // Earnings quality
  earningsBeatRate: number; // % of quarters beat estimate
  earningsSurprises: { quarter: string; estimate: number; actual: number; surprise: number }[];
  nextEarningsDate: string | null;
  daysToEarnings: number | null;
  // Insider activity (last 6 months)
  insiderBuying: number;
  insiderSelling: number;
  insiderNetSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  recentInsiderTrades: { name: string; action: string; shares: number; date: string }[];
  // Analyst consensus
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  analystConsensus: string;
  // Growth metrics
  revenueGrowth3yr: number | null;
  epsGrowth3yr: number | null;
  // Risk metrics
  debtLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  profitabilityScore: number; // 0-100
  growthScore: number; // 0-100
  valueScore: number; // 0-100
  overallFundamentalScore: number; // 0-100
  // Summary for agents
  bullCase: string;
  bearCase: string;
  keyRisks: string[];
  keyStrengths: string[];
}

// ── MASTER DEEP FETCH ────────────────────────────────────────────────────────
export async function fetchDeepAnalysis(symbol: string): Promise<DeepCompanyAnalysis | null> {
  try {
    const [incomeRes, balanceRes, cashFlowRes, earningsRes, insiderRes, recRes, polyRes] =
      await Promise.allSettled([
        axios.get('https://www.alphavantage.co/query', { params: { function: 'INCOME_STATEMENT', symbol, apikey: AV_KEY }, timeout: 10000 }),
        axios.get('https://www.alphavantage.co/query', { params: { function: 'BALANCE_SHEET', symbol, apikey: AV_KEY }, timeout: 10000 }),
        axios.get('https://www.alphavantage.co/query', { params: { function: 'CASH_FLOW', symbol, apikey: AV_KEY }, timeout: 10000 }),
        axios.get('https://www.alphavantage.co/query', { params: { function: 'EARNINGS', symbol, apikey: AV_KEY }, timeout: 10000 }),
        axios.get('https://finnhub.io/api/v1/stock/insider-transactions', { params: { symbol, token: FH_KEY }, timeout: 8000 }),
        axios.get('https://finnhub.io/api/v1/stock/recommendation', { params: { symbol, token: FH_KEY }, timeout: 8000 }),
        axios.get(`https://api.polygon.io/v3/reference/tickers/${symbol}`, { params: { apiKey: POLY_KEY }, timeout: 8000 }),
      ]);

    const income = incomeRes.status === 'fulfilled' ? incomeRes.value.data : null;
    const balance = balanceRes.status === 'fulfilled' ? balanceRes.value.data : null;
    const cashFlow = cashFlowRes.status === 'fulfilled' ? cashFlowRes.value.data : null;
    const earnings = earningsRes.status === 'fulfilled' ? earningsRes.value.data : null;
    const insiderRaw = insiderRes.status === 'fulfilled' ? insiderRes.value.data?.data || [] : [];
    const recRaw = recRes.status === 'fulfilled' ? recRes.value.data?.[0] || {} : {};
    const polyData = polyRes.status === 'fulfilled' ? polyRes.value.data?.results : null;

    // ── INCOME STATEMENT ────────────────────────────────────────────────────
    const annualIncome = income?.annualReports?.slice(0, 4) || [];
    const revenueHistory = annualIncome.map((r: any, i: number) => {
      const prev = annualIncome[i + 1];
      const val = parseFloat(r.totalRevenue) || 0;
      const prevVal = prev ? parseFloat(prev.totalRevenue) || 0 : null;
      return { year: r.fiscalDateEnding?.slice(0, 4), value: val, growth: prevVal ? ((val - prevVal) / prevVal) * 100 : null };
    });
    const netIncomeHistory = annualIncome.map((r: any, i: number) => {
      const prev = annualIncome[i + 1];
      const val = parseFloat(r.netIncome) || 0;
      const prevVal = prev ? parseFloat(prev.netIncome) || 0 : null;
      return { year: r.fiscalDateEnding?.slice(0, 4), value: val, growth: prevVal ? ((val - prevVal) / prevVal) * 100 : null };
    });
    const grossMarginHistory = annualIncome.map((r: any) => ({
      year: r.fiscalDateEnding?.slice(0, 4),
      value: r.totalRevenue ? (parseFloat(r.grossProfit) / parseFloat(r.totalRevenue)) * 100 : 0
    }));
    const operatingMarginHistory = annualIncome.map((r: any) => ({
      year: r.fiscalDateEnding?.slice(0, 4),
      value: r.totalRevenue ? (parseFloat(r.operatingIncome) / parseFloat(r.totalRevenue)) * 100 : 0
    }));

    // ── BALANCE SHEET ────────────────────────────────────────────────────────
    const latestBalance = balance?.annualReports?.[0] || {};
    const totalDebt = parseFloat(latestBalance.shortLongTermDebtTotal) || parseFloat(latestBalance.longTermDebt) || null;
    const totalCash = parseFloat(latestBalance.cashAndCashEquivalentsAtCarryingValue) || null;
    const totalEquity = parseFloat(latestBalance.totalShareholderEquity) || null;
    const currentAssets = parseFloat(latestBalance.totalCurrentAssets) || null;
    const currentLiabilities = parseFloat(latestBalance.totalCurrentLiabilities) || null;
    const sharesOutstanding = parseFloat(latestBalance.commonStockSharesOutstanding) || null;

    // ── CASH FLOW ────────────────────────────────────────────────────────────
    const latestCF = cashFlow?.annualReports?.[0] || {};
    const operatingCashFlow = parseFloat(latestCF.operatingCashflow) || null;
    const capex = Math.abs(parseFloat(latestCF.capitalExpenditures) || 0);
    const freeCashFlow = operatingCashFlow ? operatingCashFlow - capex : null;

    // ── EARNINGS ─────────────────────────────────────────────────────────────
    const quarterlyEarnings = earnings?.quarterlyEarnings?.slice(0, 8) || [];
    const earningsSurprises = quarterlyEarnings
      .filter((e: any) => e.reportedEPS && e.estimatedEPS)
      .map((e: any) => ({
        quarter: e.fiscalDateEnding,
        estimate: parseFloat(e.estimatedEPS),
        actual: parseFloat(e.reportedEPS),
        surprise: parseFloat(e.surprisePercentage) || 0
      }));
    const beats = earningsSurprises.filter(e => e.actual > e.estimate).length;
    const earningsBeatRate = earningsSurprises.length > 0 ? (beats / earningsSurprises.length) * 100 : 0;

    // ── INSIDER TRADING ──────────────────────────────────────────────────────
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    const recentInsider = insiderRaw.filter((t: any) => t.filingDate >= sixMonthsAgo && !t.isDerivative);
    const insiderBuying = recentInsider.filter((t: any) => t.change > 0).reduce((s: number, t: any) => s + t.change, 0);
    const insiderSelling = Math.abs(recentInsider.filter((t: any) => t.change < 0).reduce((s: number, t: any) => s + t.change, 0));
    const insiderNetSentiment = insiderBuying > insiderSelling * 1.5 ? 'BULLISH'
      : insiderSelling > insiderBuying * 1.5 ? 'BEARISH' : 'NEUTRAL';
    const recentInsiderTrades = recentInsider.slice(0, 5).map((t: any) => ({
      name: t.name, action: t.change > 0 ? 'BUY' : 'SELL',
      shares: Math.abs(t.change), date: t.filingDate
    }));

    // ── ANALYST CONSENSUS ────────────────────────────────────────────────────
    const strongBuy = recRaw.strongBuy || 0;
    const buy = recRaw.buy || 0;
    const hold = recRaw.hold || 0;
    const sell = recRaw.sell || 0;
    const strongSell = recRaw.strongSell || 0;
    const totalAnalysts = strongBuy + buy + hold + sell + strongSell;
    const bullishAnalysts = strongBuy + buy;
    const analystConsensus = totalAnalysts === 0 ? 'NO DATA'
      : bullishAnalysts / totalAnalysts > 0.7 ? 'STRONG BUY'
      : bullishAnalysts / totalAnalysts > 0.5 ? 'BUY'
      : (sell + strongSell) / totalAnalysts > 0.3 ? 'SELL'
      : 'HOLD';

    // ── SCORES ───────────────────────────────────────────────────────────────
    const netMargin = grossMarginHistory[0]?.value || 0;
    const profitabilityScore = Math.min(100, Math.max(0,
      (netMargin > 20 ? 40 : netMargin > 10 ? 25 : netMargin > 0 ? 10 : 0) +
      (freeCashFlow && freeCashFlow > 0 ? 30 : 0) +
      (earningsBeatRate > 75 ? 30 : earningsBeatRate > 50 ? 20 : 10)
    ));
    const rev3yr = revenueHistory[0]?.growth;
    const growthScore = Math.min(100, Math.max(0,
      (rev3yr && rev3yr > 20 ? 50 : rev3yr && rev3yr > 10 ? 30 : rev3yr && rev3yr > 0 ? 15 : 0) +
      (insiderNetSentiment === 'BULLISH' ? 25 : insiderNetSentiment === 'NEUTRAL' ? 10 : 0) +
      (bullishAnalysts / Math.max(totalAnalysts, 1) * 25)
    ));
    const debtRatio = totalDebt && totalEquity ? totalDebt / totalEquity : null;
    const debtLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' =
      !debtRatio ? 'MODERATE' :
      debtRatio < 0.3 ? 'LOW' : debtRatio < 1 ? 'MODERATE' :
      debtRatio < 3 ? 'HIGH' : 'CRITICAL';
    const valueScore = Math.min(100, Math.max(0,
      (debtLevel === 'LOW' ? 40 : debtLevel === 'MODERATE' ? 25 : debtLevel === 'HIGH' ? 10 : 0) +
      (totalCash && totalDebt && totalCash > totalDebt ? 30 : 10) +
      (analystConsensus.includes('BUY') ? 30 : analystConsensus === 'HOLD' ? 15 : 0)
    ));
    const overallFundamentalScore = Math.round((profitabilityScore * 0.4) + (growthScore * 0.35) + (valueScore * 0.25));

    // ── BULL/BEAR CASE ───────────────────────────────────────────────────────
    const latestRev = revenueHistory[0];
    const bullCase = [
      latestRev?.growth && latestRev.growth > 5 ? `Revenue growing ${latestRev.growth.toFixed(1)}% YoY` : '',
      earningsBeatRate > 70 ? `Beats earnings ${earningsBeatRate.toFixed(0)}% of the time` : '',
      insiderNetSentiment === 'BULLISH' ? `Insiders are net BUYING (${insiderBuying.toLocaleString()} shares)` : '',
      analystConsensus.includes('BUY') ? `${bullishAnalysts}/${totalAnalysts} analysts rate BUY` : '',
      freeCashFlow && freeCashFlow > 0 ? `Strong free cash flow: $${(freeCashFlow / 1e9).toFixed(1)}B` : '',
    ].filter(Boolean).join('. ') || 'No clear bull case identified.';

    const bearCase = [
      latestRev?.growth && latestRev.growth < 0 ? `Revenue declining ${Math.abs(latestRev.growth).toFixed(1)}% YoY` : '',
      earningsBeatRate < 50 ? `Misses earnings ${(100 - earningsBeatRate).toFixed(0)}% of the time` : '',
      insiderNetSentiment === 'BEARISH' ? `Insiders net SELLING (${insiderSelling.toLocaleString()} shares)` : '',
      debtLevel === 'HIGH' || debtLevel === 'CRITICAL' ? `${debtLevel} debt load (D/E: ${debtRatio?.toFixed(2)})` : '',
      freeCashFlow && freeCashFlow < 0 ? `Negative free cash flow: $${(freeCashFlow / 1e9).toFixed(1)}B` : '',
    ].filter(Boolean).join('. ') || 'No clear bear case identified.';

    const keyStrengths = [
      freeCashFlow && freeCashFlow > 0 ? 'Positive FCF' : null,
      earningsBeatRate > 70 ? 'Consistent earnings beats' : null,
      insiderNetSentiment === 'BULLISH' ? 'Insider buying' : null,
      debtLevel === 'LOW' ? 'Low debt' : null,
      operatingMarginHistory[0]?.value > 20 ? 'High operating margin' : null,
    ].filter(Boolean) as string[];

    const keyRisks = [
      debtLevel === 'HIGH' || debtLevel === 'CRITICAL' ? `${debtLevel} debt` : null,
      insiderNetSentiment === 'BEARISH' ? 'Insider selling' : null,
      earningsBeatRate < 40 ? 'Consistent earnings misses' : null,
      latestRev?.growth && latestRev.growth < 0 ? 'Revenue declining' : null,
      freeCashFlow && freeCashFlow < 0 ? 'Burning cash' : null,
    ].filter(Boolean) as string[];

    const analysis: DeepCompanyAnalysis = {
      symbol,
      companyName: polyData?.name || symbol,
      sector: polyData?.sic_description || 'Unknown',
      industry: polyData?.sic_description || 'Unknown',
      marketCap: polyData?.market_cap || 0,
      employees: polyData?.total_employees || 0,
      description: polyData?.description?.slice(0, 300) || '',
      peRatio: null, pbRatio: null, psRatio: null, evToEbitda: null, priceToFCF: null,
      revenueHistory, netIncomeHistory, epsHistory: [],
      grossMarginHistory, operatingMarginHistory,
      totalDebt, totalCash,
      debtToEquity: debtRatio,
      currentRatio: currentAssets && currentLiabilities ? currentAssets / currentLiabilities : null,
      quickRatio: null,
      bookValuePerShare: totalEquity && sharesOutstanding ? totalEquity / sharesOutstanding : null,
      operatingCashFlow, freeCashFlow, capex,
      earningsBeatRate, earningsSurprises: earningsSurprises.slice(0, 4),
      nextEarningsDate: null, daysToEarnings: null,
      insiderBuying, insiderSelling, insiderNetSentiment, recentInsiderTrades,
      strongBuy, buy, hold, sell, strongSell, analystConsensus,
      revenueGrowth3yr: revenueHistory[2]?.growth || null,
      epsGrowth3yr: null,
      debtLevel, profitabilityScore, growthScore, valueScore, overallFundamentalScore,
      bullCase, bearCase, keyRisks, keyStrengths,
    };

    // Store to DB
    await storeDeepAnalysis(symbol, analysis);
    return analysis;

  } catch (err) {
    logger.warn(`Deep analysis failed for ${symbol}`, { err });
    return null;
  }
}

// ── STORE IN DB ───────────────────────────────────────────────────────────────
async function storeDeepAnalysis(symbol: string, a: DeepCompanyAnalysis): Promise<void> {
  try {
    await prisma.companyFundamentals.upsert({
      where: { symbol },
      update: {
        name: a.companyName,
        sector: a.sector,
        industry: a.industry,
        marketCap: a.marketCap,
        grossMargin: a.grossMarginHistory[0]?.value,
        operatingMargin: a.operatingMarginHistory[0]?.value,
        netMargin: a.grossMarginHistory[0]?.value,
        debtToEquity: a.debtToEquity,
        currentRatio: a.currentRatio,
        insiderOwnership: a.insiderBuying > 0 ? a.insiderBuying / (a.insiderBuying + a.insiderSelling) * 100 : undefined,
        analystRating: a.analystConsensus,
        lastUpdated: new Date(),
      },
      create: {
        symbol,
        name: a.companyName,
        sector: a.sector,
        industry: a.industry,
        marketCap: a.marketCap,
        grossMargin: a.grossMarginHistory[0]?.value,
        operatingMargin: a.operatingMarginHistory[0]?.value,
        debtToEquity: a.debtToEquity,
        currentRatio: a.currentRatio,
        analystRating: a.analystConsensus,
      }
    });

    // Store annual reports
    for (const r of a.revenueHistory) {
      if (!r.year) continue;
      const netIncome = a.netIncomeHistory.find(n => n.year === r.year);
      await prisma.annualReport.upsert({
        where: { symbol_year: { symbol, year: parseInt(r.year) } },
        update: { revenue: r.value, netIncome: netIncome?.value, revenueGrowth: r.growth, netIncomeGrowth: netIncome?.growth },
        create: { symbol, year: parseInt(r.year), revenue: r.value, netIncome: netIncome?.value, revenueGrowth: r.growth, netIncomeGrowth: netIncome?.growth }
      });
    }
  } catch (err) {
    logger.warn(`DB store failed for ${symbol}`, { err });
  }
}

// ── FORMAT FOR AGENT PROMPT ───────────────────────────────────────────────────
export function formatDeepAnalysisForAgents(a: DeepCompanyAnalysis): string {
  const mcap = a.marketCap > 1e12 ? `$${(a.marketCap / 1e12).toFixed(1)}T`
    : a.marketCap > 1e9 ? `$${(a.marketCap / 1e9).toFixed(1)}B`
    : a.marketCap > 1e6 ? `$${(a.marketCap / 1e6).toFixed(0)}M` : 'N/A';

  const revenueStr = a.revenueHistory.slice(0, 3).map(r =>
    `${r.year}: $${(r.value / 1e9).toFixed(1)}B${r.growth != null ? ` (${r.growth > 0 ? '+' : ''}${r.growth.toFixed(1)}%)` : ''}`
  ).join(' | ');

  const marginStr = a.operatingMarginHistory.slice(0, 2).map(r =>
    `${r.year}: ${r.value.toFixed(1)}%`
  ).join(' | ');

  const analystStr = `${a.strongBuy}StrongBuy/${a.buy}Buy/${a.hold}Hold/${a.sell}Sell → ${a.analystConsensus}`;

  const insiderStr = a.insiderNetSentiment === 'NEUTRAL' ? 'Neutral'
    : `${a.insiderNetSentiment} — ${a.insiderBuying > a.insiderSelling ? `buying ${a.insiderBuying.toLocaleString()} shares` : `selling ${a.insiderSelling.toLocaleString()} shares`}`;

  const lines = [
    `[${a.symbol}] ${a.companyName} | ${a.sector} | MCap: ${mcap}`,
    `Revenue: ${revenueStr}`,
    `Op Margin: ${marginStr} | FCF: ${a.freeCashFlow ? `$${(a.freeCashFlow / 1e9).toFixed(1)}B` : 'N/A'}`,
    `Debt/Equity: ${a.debtToEquity?.toFixed(2) || 'N/A'} (${a.debtLevel}) | Cash: ${a.totalCash ? `$${(a.totalCash / 1e9).toFixed(1)}B` : 'N/A'}`,
    `Earnings Beat Rate: ${a.earningsBeatRate.toFixed(0)}% of quarters`,
    `Analysts: ${analystStr}`,
    `Insiders: ${insiderStr}`,
    `Fundamental Score: ${a.overallFundamentalScore}/100`,
    `Bull Case: ${a.bullCase}`,
    `Bear Case: ${a.bearCase}`,
    a.keyRisks.length > 0 ? `Key Risks: ${a.keyRisks.join(', ')}` : '',
    a.keyStrengths.length > 0 ? `Key Strengths: ${a.keyStrengths.join(', ')}` : '',
  ];

  return lines.filter(Boolean).join('\n');
}

// ── BATCH REFRESH (run weekly for all known stocks) ───────────────────────────
export async function refreshFundamentalsForSymbol(symbol: string): Promise<void> {
  await fetchDeepAnalysis(symbol);
}
