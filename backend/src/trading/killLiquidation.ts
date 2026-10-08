import { getVerifiedAccountScope } from './accountScope';
import { syncBrokerPositions } from '../services/brokerSync';
import { prisma } from '../utils/prisma';
import { requestPositionExit } from './positionExits';

export async function liquidateCurrentAccount() {
  const result = { confirmedClosed: [] as string[], pending: [] as string[], errors: [] as string[], broker: 'unavailable' };
  try {
    if (process.env.DRY_RUN === 'true') return { ...result, broker: 'dry-run' };
    const scope = await getVerifiedAccountScope();
    await scope.broker.cancelAllOrders();
    const sync = await syncBrokerPositions(scope);
    if (sync.skipped) throw new Error(sync.skipped);
    const positions = await prisma.position.findMany({ where: { accountId: scope.accountId, brokerMode: scope.mode, status: 'OPEN' } });
    for (const position of positions) {
      const exit = await requestPositionExit(position.id, 'kill_switch', scope);
      if (exit.closed) result.confirmedClosed.push(position.asset);
      else { result.pending.push(position.asset); if (exit.error) result.errors.push(`${position.asset}: ${exit.error}`); }
    }
    result.broker = result.pending.length ? 'exits-pending' : 'confirmed-flat';
  } catch (error: any) { result.errors.push(error?.message || 'Broker liquidation unavailable'); }
  return result;
}
