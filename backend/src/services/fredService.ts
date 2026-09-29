// ── FRED (Federal Reserve Economic Data) ──────────────────────────────────────
// Real macro numbers for the Macro Economist agent and the Macro panel:
// Fed funds rate, 10Y and 2Y Treasury yields (→ curve slope), CPI YoY and the
// unemployment rate. Free key: FRED_API_KEY. Cached for 6 hours (these series
// update daily at most). Returns null fields — never guesses — when unavailable.
import axios from 'axios';
import { logger } from '../utils/logger';
import { isPlaceholderKey } from '../utils/apiKeys';

export interface MacroSnapshot {
  fedFundsRate: number | null;
  treasury10Y: number | null;
  treasury2Y: number | null;
  yieldCurve10Y2Y: number | null;
  cpiYoY: number | null;
  unemploymentRate: number | null;
  asOf: string | null;
  source: 'FRED' | 'UNAVAILABLE';
}

let cache: { at: number; data: MacroSnapshot } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000;

async function observations(seriesId: string, limit: number): Promise<Array<{ date: string; value: number }>> {
  const res = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
    params: { series_id: seriesId, api_key: process.env.FRED_API_KEY, file_type: 'json', sort_order: 'desc', limit },
    timeout: 12000,
  });
  return (res.data?.observations || [])
    .map((o: any) => ({ date: o.date, value: Number(o.value) }))
    .filter((o: any) => Number.isFinite(o.value));
}

export function isFredConfigured(): boolean {
  return !isPlaceholderKey(process.env.FRED_API_KEY);
}

export async function getMacroSnapshot(force = false): Promise<MacroSnapshot> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const empty: MacroSnapshot = { fedFundsRate: null, treasury10Y: null, treasury2Y: null, yieldCurve10Y2Y: null, cpiYoY: null, unemploymentRate: null, asOf: null, source: 'UNAVAILABLE' };
  if (!isFredConfigured()) return empty;
  try {
    const [dff, dgs10, dgs2, cpi, unrate] = await Promise.all([
      observations('DFF', 1), observations('DGS10', 5), observations('DGS2', 5), observations('CPIAUCSL', 13), observations('UNRATE', 1),
    ]);
    const cpiYoY = cpi.length >= 13 ? ((cpi[0].value / cpi[12].value) - 1) * 100 : null;
    const t10 = dgs10[0]?.value ?? null;
    const t2 = dgs2[0]?.value ?? null;
    const data: MacroSnapshot = {
      fedFundsRate: dff[0]?.value ?? null,
      treasury10Y: t10,
      treasury2Y: t2,
      yieldCurve10Y2Y: t10 !== null && t2 !== null ? +(t10 - t2).toFixed(2) : null,
      cpiYoY: cpiYoY !== null ? +cpiYoY.toFixed(2) : null,
      unemploymentRate: unrate[0]?.value ?? null,
      asOf: dff[0]?.date || dgs10[0]?.date || null,
      source: 'FRED',
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (err: any) {
    logger.warn('FRED macro fetch failed', { error: err?.message });
    return cache?.data || empty;
  }
}

/** One-line summary for agent prompts. */
export function macroLine(m: MacroSnapshot): string {
  if (m.source !== 'FRED') return '';
  const f = (v: number | null, suffix = '%') => (v === null ? 'n/a' : `${v.toFixed(2)}${suffix}`);
  return `FRED (${m.asOf}): Fed funds ${f(m.fedFundsRate)} | 10Y ${f(m.treasury10Y)} | 2Y ${f(m.treasury2Y)} | 10Y-2Y ${f(m.yieldCurve10Y2Y, 'pp')} | CPI YoY ${f(m.cpiYoY)} | Unemployment ${f(m.unemploymentRate)}`;
}
