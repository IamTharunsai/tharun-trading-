import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

const DATE_KEY = () => new Date().toISOString().slice(0, 10);

export function dailyApiBudgetUsd(bankroll: number): number {
  return Math.min(2.0, Math.max(0, 0.02 * bankroll));
}

async function readSpent(): Promise<number> {
  try {
    const raw = await redis.get(`api_cost:${DATE_KEY()}`);
    return raw ? parseFloat(raw) : 0;
  } catch {
    return inMemorySpend[DATE_KEY()] || 0;
  }
}

const inMemorySpend: Record<string, number> = {};

export async function getApiSpendToday(): Promise<number> {
  return readSpent();
}

export async function canCallClaude(bankroll: number, estimatedCostUsd = 0.02): Promise<boolean> {
  const budget = dailyApiBudgetUsd(bankroll);
  const spent = await readSpent();
  return spent + estimatedCostUsd <= budget;
}

export async function recordClaudeCall(costUsd: number): Promise<number> {
  const key = `api_cost:${DATE_KEY()}`;
  const date = DATE_KEY();
  inMemorySpend[date] = (inMemorySpend[date] || 0) + costUsd;
  try {
    const next = await redis.incrbyfloat(key, costUsd);
    await redis.expire(key, 60 * 60 * 36);
    logger.info(`💵 API spend today: $${Number(next).toFixed(4)} (this call $${costUsd.toFixed(4)})`);
    return Number(next);
  } catch {
    logger.info(`💵 API spend today (memory): $${inMemorySpend[date].toFixed(4)}`);
    return inMemorySpend[date];
  }
}

/** Haiku ~$0.003, Sonnet ~$0.02 per typical debate call — conservative estimates. */
export function estimateCallCost(model: string): number {
  if (model.includes('sonnet')) return 0.02;
  if (model.includes('haiku')) return 0.003;
  return 0.01;
}
