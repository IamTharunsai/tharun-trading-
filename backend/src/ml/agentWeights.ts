import { redis } from '../utils/redis';

const KEY = 'apex:agent_weights';
const inMemory: Record<string, number> = {};

export async function updateAgentWeight(agentName: string, wasCorrect: boolean): Promise<number> {
  const current = await getAgentWeight(agentName);
  const next = Math.max(0.25, Math.min(2.0, wasCorrect ? current * 1.02 : current * 0.95));
  inMemory[agentName] = next;
  try {
    await redis.hset(KEY, agentName, String(next));
  } catch { /* redis optional */ }
  return next;
}

export async function getAgentWeight(agentName: string): Promise<number> {
  if (inMemory[agentName] != null) return inMemory[agentName];
  try {
    const raw = await redis.hget(KEY, agentName);
    if (raw) {
      const n = parseFloat(raw);
      inMemory[agentName] = n;
      return n;
    }
  } catch { /* ignore */ }
  return 1.0;
}

export function weightedConsensus(votes: Record<string, number>, weights: Record<string, number>): number {
  const names = Object.keys(votes);
  const total = names.reduce((s, a) => s + (weights[a] ?? 1), 0);
  if (!total) return 0;
  const yes = names.reduce((s, a) => s + (weights[a] ?? 1) * votes[a], 0);
  return yes / total;
}
