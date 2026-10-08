import { getActiveMode, getTradingBroker, BrokerMode } from './brokerRouter';
import type { AlpacaBroker } from '../services/alpacaBroker';

export interface AccountScope { broker: AlpacaBroker; accountId: string; mode: BrokerMode; }
export function positionScopeKey(accountId: string, mode: string, asset: string): string {
  return ['alpaca', mode, accountId, asset].map(encodeURIComponent).join(':');
}
export async function getVerifiedAccountScope(): Promise<AccountScope> {
  const mode = getActiveMode();
  const broker = getTradingBroker();
  if (!broker) throw new Error('BROKER_UNAVAILABLE');
  const account = await broker.getPortfolioSummary();
  if (!account?.account_id || mode !== getActiveMode()) throw new Error('ACCOUNT_AUTHORITY_UNAVAILABLE');
  return { broker, accountId: account.account_id, mode };
}
export function brokerSymbol(asset: string, market: string): string {
  return market === 'crypto' ? (asset.endsWith('/USD') ? asset : `${asset}/USD`) : asset;
}
