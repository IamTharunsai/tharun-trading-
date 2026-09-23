export interface AgentAccuracy {
  agentName: string;
  samples: number;
  correct: number;
}

const MIN_SAMPLES = 14; // ~2 weeks if 1 prediction/day
const MIN_ACCURACY = 0.55;

export function isAgentProductionReady(a: AgentAccuracy): boolean {
  if (a.samples < MIN_SAMPLES) return false;
  return a.correct / a.samples >= MIN_ACCURACY;
}

export function consecutiveLossKill(lossesInARow: number, threshold = 7): boolean {
  return lossesInARow >= threshold;
}

export function productionAgents(list: AgentAccuracy[]): string[] {
  return list.filter(isAgentProductionReady).map(a => a.agentName);
}
