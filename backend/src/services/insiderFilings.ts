import axios from 'axios';
import { logger } from '../utils/logger';

const UA = process.env.SEC_EDGAR_USER_AGENT || 'ApexTrader research@localhost';

export interface Form4Filing {
  title: string;
  link: string;
  published: string;
  ticker?: string;
  side: 'BUY' | 'SELL' | 'UNKNOWN';
}

function parseSide(title: string): Form4Filing['side'] {
  const t = title.toLowerCase();
  if (t.includes('purchase') || t.includes('buy') || t.includes('acquired')) return 'BUY';
  if (t.includes('sale') || t.includes('sell') || t.includes('disposed')) return 'SELL';
  return 'UNKNOWN';
}

export async function fetchForm4s(): Promise<Form4Filing[]> {
  try {
    const { data } = await axios.get(
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=40&output=atom',
      { timeout: 10000, headers: { 'User-Agent': UA, Accept: 'application/atom+xml' } }
    );
    const xml = String(data);
    return xml.split('<entry>').slice(1).slice(0, 30).map(chunk => {
      const title = (chunk.match(/<title[^>]*>([^<]+)/) || [])[1] || 'Form 4';
      const link = (chunk.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
      const published = (chunk.match(/<updated>([^<]+)/) || [])[1] || '';
      const ticker = (title.match(/\(([A-Z]{1,5})\)/) || [])[1];
      return { title, link, published, ticker, side: parseSide(title) };
    });
  } catch (err: any) {
    logger.warn(`Form 4 RSS skipped: ${err?.message || err}`);
    return [];
  }
}

export function detectClusterBuys(filings: Form4Filing[], ticker: string, windowMs = 7 * 86400000): {
  signal: 'CLUSTER_BUY' | 'SELL' | 'NEUTRAL';
  buyCount: number;
} {
  const now = Date.now();
  const recent = filings.filter(f => {
    const t = f.ticker?.toUpperCase() === ticker.toUpperCase();
    const ts = f.published ? Date.parse(f.published) : now;
    return t && now - ts <= windowMs;
  });
  const buys = recent.filter(f => f.side === 'BUY');
  const sells = recent.filter(f => f.side === 'SELL');
  if (buys.length >= 3) return { signal: 'CLUSTER_BUY', buyCount: buys.length };
  if (sells.length > buys.length + 2) return { signal: 'SELL', buyCount: buys.length };
  return { signal: 'NEUTRAL', buyCount: buys.length };
}

export async function fetch13Ds(): Promise<{ title: string; link: string; published: string }[]> {
  try {
    const { data } = await axios.get(
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC%2013D&count=20&output=atom',
      { timeout: 10000, headers: { 'User-Agent': UA, Accept: 'application/atom+xml' } }
    );
    const xml = String(data);
    return xml.split('<entry>').slice(1).slice(0, 15).map(chunk => ({
      title: (chunk.match(/<title[^>]*>([^<]+)/) || [])[1] || '13D',
      link: (chunk.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '',
      published: (chunk.match(/<updated>([^<]+)/) || [])[1] || '',
    }));
  } catch (err: any) {
    logger.warn(`13D RSS skipped: ${err?.message || err}`);
    return [];
  }
}
