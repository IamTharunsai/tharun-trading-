import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

// Global kill switch. The in-memory flag is the fast path; the value is also
// persisted to settings.killSwitchActive so a restart/redeploy does NOT
// silently resume trading after an emergency stop (it used to reset to false).
let KILL_SWITCH_ACTIVE = false;

function persist(active: boolean) {
  prisma.settings?.update?.({ data: { killSwitchActive: active } })
    ?.catch?.((err: any) => logger.error('Failed to persist kill switch state', { error: err?.message }));
}

export async function loadKillSwitchState(): Promise<boolean> {
  try {
    const s = await prisma.settings.findFirst();
    KILL_SWITCH_ACTIVE = Boolean(s?.killSwitchActive);
    if (KILL_SWITCH_ACTIVE) logger.warn('🔴 Kill switch was ACTIVE before restart — trading remains halted');
  } catch (err: any) {
    logger.warn('Could not load kill switch state', { error: err?.message });
  }
  return KILL_SWITCH_ACTIVE;
}

export function activateKillSwitch() {
  KILL_SWITCH_ACTIVE = true;
  persist(true);
  logger.warn('🔴 KILL SWITCH ACTIVATED — All trading halted');
}

export function deactivateKillSwitch() {
  KILL_SWITCH_ACTIVE = false;
  persist(false);
  logger.info('🟢 Kill switch deactivated — Trading resumed');
}

export function isKillSwitchActive() {
  return KILL_SWITCH_ACTIVE;
}
