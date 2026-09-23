import { logger } from '../utils/logger';
import { fetchRecent8Ks } from './secEdgarService';
import { fetchForm4s, fetch13Ds } from './insiderFilings';
import { getIO } from '../websocket/server';

export interface ResearchSnapshot {
  at: number;
  eightK: number;
  form4: number;
  thirteenD: number;
}

let last: ResearchSnapshot = { at: 0, eightK: 0, form4: 0, thirteenD: 0 };

export function getResearchSnapshot(): ResearchSnapshot {
  return last;
}

export async function runDeepResearchTick(): Promise<ResearchSnapshot> {
  const [eightK, form4, thirteenD] = await Promise.all([
    fetchRecent8Ks(),
    fetchForm4s(),
    fetch13Ds(),
  ]);
  last = { at: Date.now(), eightK: eightK.length, form4: form4.length, thirteenD: thirteenD.length };
  logger.info(`🔬 Deep research tick: 8-K=${last.eightK} Form4=${last.form4} 13D=${last.thirteenD}`);
  getIO()?.emit('deep_research', last);
  return last;
}
