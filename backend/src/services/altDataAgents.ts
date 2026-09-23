import axios from 'axios';
import { logger } from '../utils/logger';

export function jobVelocity(current30d: number, prior30d: number): { velocity: number; signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' } {
  const prior = Math.max(prior30d, 1);
  const velocity = (current30d - prior30d) / prior;
  if (velocity > 0.5) return { velocity, signal: 'BULLISH' };
  if (velocity < -0.4) return { velocity, signal: 'BEARISH' };
  return { velocity, signal: 'NEUTRAL' };
}

export async function githubCommitVelocity(ownerRepo: string, token?: string): Promise<number | null> {
  try {
    const { data } = await axios.get(`https://api.github.com/repos/${ownerRepo}/stats/participation`, {
      timeout: 8000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const weeks: number[] = data?.all || [];
    if (weeks.length < 8) return null;
    const recent = weeks.slice(-4).reduce((a, b) => a + b, 0);
    const prior = weeks.slice(-8, -4).reduce((a, b) => a + b, 0) || 1;
    return (recent - prior) / prior;
  } catch (err: any) {
    logger.warn(`GitHub velocity skipped: ${err?.message || err}`);
    return null;
  }
}

export async function itunesReviewSentiment(appId: string): Promise<number | null> {
  try {
    const { data } = await axios.get(`https://itunes.apple.com/rss/customerreviews/id=${appId}/json`, { timeout: 8000 });
    const entries = data?.feed?.entry || [];
    const ratings = entries.map((e: any) => Number(e['im:rating']?.label)).filter((n: number) => n > 0);
    if (!ratings.length) return null;
    const avg = ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length;
    return (avg - 3) / 2;
  } catch {
    return null;
  }
}
