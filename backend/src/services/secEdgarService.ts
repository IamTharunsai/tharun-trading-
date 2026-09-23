import axios from 'axios';
import { logger } from '../utils/logger';

const EDGAR_CURRENT = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=20&output=atom';
const USER_AGENT = process.env.SEC_EDGAR_USER_AGENT || 'ApexTrader research@localhost';

export interface EdgarEvent {
  title: string;
  link: string;
  published: string;
  type: '8-K' | 'Form4' | '13D' | 'other';
  sentimentHint: 'POSITIVE' | 'NEGATIVE' | 'BREAKING' | 'NEUTRAL';
}

function hintFromTitle(title: string): EdgarEvent['sentimentHint'] {
  const t = title.toLowerCase();
  if (t.includes('departure') || t.includes('default') || t.includes('bankruptcy') || t.includes('investigation')) {
    return 'NEGATIVE';
  }
  if (t.includes('acquisition') || t.includes('buyback') || t.includes('dividend')) return 'POSITIVE';
  return 'BREAKING';
}

export async function fetchRecent8Ks(): Promise<EdgarEvent[]> {
  try {
    const { data } = await axios.get(EDGAR_CURRENT, {
      timeout: 10000,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/atom+xml,application/xml,text/xml' },
    });
    const xml = String(data);
    const entries = xml.split('<entry>').slice(1);
    return entries.slice(0, 15).map(chunk => {
      const title = (chunk.match(/<title[^>]*>([^<]+)/) || [])[1] || '8-K';
      const link = (chunk.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
      const published = (chunk.match(/<updated>([^<]+)/) || [])[1] || '';
      return { title, link, published, type: '8-K' as const, sentimentHint: hintFromTitle(title) };
    });
  } catch (err: any) {
    logger.warn(`SEC EDGAR poll skipped: ${err?.message || err}`);
    return [];
  }
}

const MDNA_RED_FLAGS = [
  'challenging macroeconomic environment',
  'revenue timing',
  'investment phase',
  'as previously disclosed',
  'headwinds',
  'opportunity to streamline operations',
  'strategic alternatives',
  'visibility is limited',
  'withdrew guidance',
];

const MDNA_GREEN_FLAGS = [
  'record revenue',
  'ahead of expectations',
  'accelerating momentum',
  'repurchasing shares',
  'raised full-year',
];

export function scoreMdaLanguage(text: string): { score: number; flags: string[] } {
  const lower = text.toLowerCase();
  const flags: string[] = [];
  let score = 0;
  for (const f of MDNA_RED_FLAGS) if (lower.includes(f)) { score -= 1; flags.push(`RED:${f}`); }
  for (const f of MDNA_GREEN_FLAGS) if (lower.includes(f)) { score += 1; flags.push(`GREEN:${f}`); }
  return { score, flags };
}

export const EARNINGS_BULLISH: Record<string, number> = {
  'guidance raised': 0.82,
  'share buyback': 0.61,
  'raised full-year': 0.88,
  beat: 0.71,
  accelerating: 0.59,
};

export const EARNINGS_BEARISH: Record<string, number> = {
  'withdrew guidance': -0.91,
  investigations: -0.85,
  'lowering our expectations': -0.79,
  'visibility is limited': -0.67,
  'restructuring charges': -0.71,
};

export function scoreEarningsTranscript(text: string): { trade: boolean; direction: 'BUY' | 'SELL' | null; ev: number; phrase?: string } {
  const lower = text.toLowerCase();
  let best = { phrase: '', ev: 0 };
  for (const [phrase, ev] of Object.entries({ ...EARNINGS_BULLISH, ...EARNINGS_BEARISH })) {
    if (lower.includes(phrase) && Math.abs(ev) >= Math.abs(best.ev)) best = { phrase, ev };
  }
  if (Math.abs(best.ev) > 0.6) {
    return { trade: true, direction: best.ev > 0 ? 'BUY' : 'SELL', ev: best.ev, phrase: best.phrase };
  }
  return { trade: false, direction: null, ev: best.ev, phrase: best.phrase || undefined };
}
