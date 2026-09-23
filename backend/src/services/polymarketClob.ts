import axios from 'axios';
import { logger } from '../utils/logger';
import { askOllama } from './ollamaClient';

const CLOB = process.env.POLYMARKET_CLOB_API || 'https://clob.polymarket.com';

export async function fetchYesBookImbalance(tokenId?: string): Promise<{ imbalance: number; depthUsd: number }> {
  if (!tokenId) return { imbalance: 0, depthUsd: 0 };
  try {
    const { data } = await axios.get(`${CLOB}/book`, { params: { token_id: tokenId }, timeout: 8000 });
    const bids = (data?.bids || []).slice(0, 10);
    const asks = (data?.asks || []).slice(0, 10);
    const bidVol = bids.reduce((s: number, l: any) => s + Number(l.size || 0) * Number(l.price || 0), 0);
    const askVol = asks.reduce((s: number, l: any) => s + Number(l.size || 0) * Number(l.price || 0), 0);
    const tot = bidVol + askVol;
    const imbalance = tot > 0 ? (bidVol - askVol) / tot : 0;
    return { imbalance, depthUsd: tot };
  } catch (err: any) {
    logger.warn(`CLOB book skipped: ${err?.message || err}`);
    return { imbalance: 0, depthUsd: 0 };
  }
}

export function resolutionRiskFromText(description: string): 'SAFE' | 'RISKY' | 'TRAP' {
  const t = description.toLowerCase();
  if (t.includes('cme') || t.includes('settlement price') || t.includes('not spot') || t.includes('official index')) {
    return 'TRAP';
  }
  if (t.includes('subject to') || t.includes('amend') || t.includes('discretion')) return 'RISKY';
  return 'SAFE';
}

export async function parseResolutionCriteria(description: string): Promise<'SAFE' | 'RISKY' | 'TRAP'> {
  const heuristic = resolutionRiskFromText(description);
  const llm = await askOllama(
    `Score this Polymarket resolution criteria as SAFE, RISKY, or TRAP (settlement mismatch vs retail interpretation). Text:\n${description.slice(0, 1500)}\nRespond JSON {"risk":"SAFE"|"RISKY"|"TRAP"}`
  );
  if (!llm) return heuristic;
  try {
    const parsed = JSON.parse(llm);
    if (['SAFE', 'RISKY', 'TRAP'].includes(parsed.risk)) return parsed.risk;
  } catch { /* use heuristic */ }
  return heuristic;
}

export function isSportsCategory(category: string, question: string): boolean {
  const t = `${category} ${question}`.toLowerCase();
  return /\b(nba|nfl|mlb|nhl|soccer|football|tennis|ufc|sports?)\b/.test(t);
}
