import axios from 'axios';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const FMP_KEY = process.env.FMP_API_KEY || 'demo'; // Financial Modeling Prep

// ── FETCH & STORE FUNDAMENTALS FROM POLYGON ──────────────────────────────────
export async function fetchAndStoreFundamentals(symbol: string): Promise<void> {
  try {
    const [details, financials] = await Promise.allSettled([
      axios.get(`https://api.polygon.io/v3/reference/tickers/${symbol}`, {
        params: { apiKey: POLYGON_KEY }, timeout: 8000
      }),
      axios.get(`https://api.polygon.io/vX/reference/financials`, {
        params: { ticker: symbol, limit: 4, apiKey: POLYGON_KEY }, timeout: 8000
      })
    ]);

    const d = details.status === 'fulfilled' ? details.value.data?.results : null;
    const f = financials.status === 'fulfilled' ? financials.value.data?.results?.[0] : null;
    const inc = f?.financials?.income_statement;
    const bal = f?.financials?.balance_sheet;
    const cf = f?.financials?.cash_flow_statement;

    await prisma.companyFundamentals.upsert({
      where: { symbol },
      update: {
        name: d?.name,
        sector: d?.sic_description,
        marketCap: d?.market_cap,
        beta: d?.weighted_shares_outstanding ? undefined : undefined,
        week52High: d?.session?.high,
        week52Low: d?.session?.low,
        sharesOutstanding: d?.weighted_shares_outstanding,
        grossMargin: inc?.gross_profit?.value && inc?.revenues?.value
          ? (inc.gross_profit.value / inc.revenues.value) * 100 : undefined,
        netMargin: inc?.net_income_loss?.value && inc?.revenues?.value
          ? (inc.net_income_loss.value / inc.revenues.value) * 100 : undefined,
        debtToEquity: bal?.liabilities?.value && bal?.equity?.value
          ? bal.liabilities.value / bal.equity.value : undefined,
        lastUpdated: new Date(),
      },
      create: {
        symbol,
        name: d?.name,
        sector: d?.sic_description,
        marketCap: d?.market_cap,
        sharesOutstanding: d?.weighted_shares_outstanding,
        grossMargin: inc?.gross_profit?.value && inc?.revenues?.value
          ? (inc.gross_profit.value / inc.revenues.value) * 100 : undefined,
        netMargin: inc?.net_income_loss?.value && inc?.revenues?.value
          ? (inc.net_income_loss.value / inc.revenues.value) * 100 : undefined,
        debtToEquity: bal?.liabilities?.value && bal?.equity?.value
          ? bal.liabilities.value / bal.equity.value : undefined,
      }
    });
  } catch (err) {
    logger.warn(`Fundamentals fetch failed for ${symbol}`, { err });
  }
}

// ── FETCH & STORE ANNUAL REPORTS FROM FMP ────────────────────────────────────
export async function fetchAndStoreAnnualReports(symbol: string): Promise<void> {
  try {
    const res = await axios.get(`https://financialmodelingprep.com/api/v3/income-statement/${symbol}`, {
      params: { limit: 4, apikey: FMP_KEY }, timeout: 8000
    });
    const reports = res.data;
    if (!Array.isArray(reports)) return;

    for (let i = 0; i < reports.length; i++) {
      const r = reports[i];
      const prev = reports[i + 1];
      const year = new Date(r.date).getFullYear();

      await prisma.annualReport.upsert({
        where: { symbol_year: { symbol, year } },
        update: {
          revenue: r.revenue,
          netIncome: r.netIncome,
          eps: r.eps,
          freeCashFlow: r.freeCashFlow,
          totalDebt: r.totalDebt,
          revenueGrowth: prev?.revenue ? ((r.revenue - prev.revenue) / prev.revenue) * 100 : null,
          netIncomeGrowth: prev?.netIncome ? ((r.netIncome - prev.netIncome) / prev.netIncome) * 100 : null,
          epsGrowth: prev?.eps ? ((r.eps - prev.eps) / prev.eps) * 100 : null,
        },
        create: {
          symbol, year,
          revenue: r.revenue,
          netIncome: r.netIncome,
          eps: r.eps,
          freeCashFlow: r.freeCashFlow,
          totalDebt: r.totalDebt,
          revenueGrowth: prev?.revenue ? ((r.revenue - prev.revenue) / prev.revenue) * 100 : null,
          netIncomeGrowth: prev?.netIncome ? ((r.netIncome - prev.netIncome) / prev.netIncome) * 100 : null,
          epsGrowth: prev?.eps ? ((r.eps - prev.eps) / prev.eps) * 100 : null,
        }
      });
    }
    logger.info(`📋 Annual reports stored for ${symbol} (${reports.length} years)`);
  } catch (err) {
    logger.warn(`Annual reports fetch failed for ${symbol}`, { err });
  }
}

// ── GET FUNDAMENTALS SUMMARY FOR AGENT PROMPT ────────────────────────────────
export async function getFundamentalsSummary(symbol: string): Promise<string> {
  try {
    const [fund, reports] = await Promise.all([
      prisma.companyFundamentals.findUnique({ where: { symbol } }),
      prisma.annualReport.findMany({ where: { symbol }, orderBy: { year: 'desc' }, take: 3 })
    ]);

    if (!fund && reports.length === 0) return 'No fundamental data available yet.';

    const lines: string[] = [];
    if (fund) {
      if (fund.name) lines.push(`Company: ${fund.name}`);
      if (fund.sector) lines.push(`Sector: ${fund.sector}`);
      if (fund.marketCap) lines.push(`Market Cap: $${(fund.marketCap / 1e9).toFixed(1)}B`);
      if (fund.peRatio) lines.push(`P/E Ratio: ${fund.peRatio.toFixed(1)}`);
      if (fund.netMargin) lines.push(`Net Margin: ${fund.netMargin.toFixed(1)}%`);
      if (fund.debtToEquity) lines.push(`Debt/Equity: ${fund.debtToEquity.toFixed(2)}`);
      if (fund.analystRating) lines.push(`Analyst Rating: ${fund.analystRating}`);
      if (fund.analystTargetPrice) lines.push(`Analyst Target: $${fund.analystTargetPrice}`);
    }

    if (reports.length > 0) {
      const revs = reports.map((r: { revenue: number | null }) => r.revenue ? `$${(r.revenue / 1e9).toFixed(1)}B` : 'N/A');
      lines.push(`Revenue (last ${reports.length} yrs): ${revs.join(' → ')}`);
      const eps = reports.map((r: { eps: number | null }) => r.eps?.toFixed(2) || 'N/A');
      lines.push(`EPS (last ${reports.length} yrs): ${eps.join(' → ')}`);
      if (reports[0].revenueGrowth != null) lines.push(`Revenue Growth YoY: ${reports[0].revenueGrowth.toFixed(1)}%`);
      if (reports[0].netIncomeGrowth != null) lines.push(`Net Income Growth YoY: ${reports[0].netIncomeGrowth.toFixed(1)}%`);
    }

    return lines.length > 0 ? lines.join(' | ') : 'No fundamental data available yet.';
  } catch {
    return 'No fundamental data available yet.';
  }
}
