import { logger } from '../utils/logger';

// Global kill switch state
let KILL_SWITCH_ACTIVE = false;

export function activateKillSwitch() {
  KILL_SWITCH_ACTIVE = true;
  logger.warn('🔴 KILL SWITCH ACTIVATED — All trading halted');
}

export function deactivateKillSwitch() {
  KILL_SWITCH_ACTIVE = false;
  logger.info('🟢 Kill switch deactivated — Trading resumed');
}

export function isKillSwitchActive() {
  return KILL_SWITCH_ACTIVE;
}
