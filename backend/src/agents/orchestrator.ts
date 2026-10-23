import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { emitContractEvent } from '../websocket/socketEvents';

// Global kill switch. The in-memory flag is the fast path; the value is also
// persisted to settings.killSwitchActive so a restart/redeploy does NOT
// silently resume trading after an emergency stop (it used to reset to false).
// The switch fails CLOSED: if the persisted state cannot be loaded, or a
// state change cannot be persisted, the switch is treated as engaged until
// the state is known-good again. An unknown state is never permission to trade.
let KILL_SWITCH_ACTIVE = false;
let KILL_SWITCH_STATE_UNCERTAIN = false;

function persist(active: boolean) {
  prisma.settings.upsert({ where: { id: 'settings-1' }, create: { id: 'settings-1', killSwitchActive: active }, update: { killSwitchActive: active } })
    .then(() => { if (KILL_SWITCH_ACTIVE === active) KILL_SWITCH_STATE_UNCERTAIN = false; })
    .catch((err: any) => {
      KILL_SWITCH_STATE_UNCERTAIN = true;
      logger.error('Failed to persist kill switch state — treating the switch as ENGAGED until the state is known-good', { error: err?.message });
    });
}

export async function loadKillSwitchState(): Promise<boolean> {
  try {
    const s = await prisma.settings.findFirst();
    KILL_SWITCH_ACTIVE = Boolean(s?.killSwitchActive);
    if (KILL_SWITCH_ACTIVE) logger.warn('🔴 Kill switch was ACTIVE before restart — trading remains halted');
  } catch (err: any) {
    KILL_SWITCH_ACTIVE = true;
    logger.error('Could not load kill switch state — failing CLOSED, trading remains halted', { error: err?.message });
  }
  return KILL_SWITCH_ACTIVE;
}

export function activateKillSwitch() {
  // Contract event (websocket/socketEvents.ts): the dashboard kill-switch
  // flag/toast listens for this name — fire on EVERY activation, including
  // the risk manager's automatic drawdown trip.
  KILL_SWITCH_ACTIVE = true;
  persist(true);
  emitContractEvent('kill:switch:activated', { active: true, timestamp: Date.now() });
  logger.warn('🔴 KILL SWITCH ACTIVATED — All trading halted');
}

export function deactivateKillSwitch() {
  KILL_SWITCH_ACTIVE = false;
  persist(false);
  emitContractEvent('kill:switch:deactivated', { active: false, timestamp: Date.now() });
  logger.info('🟢 Kill switch deactivated — Trading resumed');
}

export function isKillSwitchActive() {
  return KILL_SWITCH_ACTIVE || KILL_SWITCH_STATE_UNCERTAIN;
}
