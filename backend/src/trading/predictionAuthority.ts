import { createHash } from 'crypto';
import type { PmUsExecutionSnapshot } from '../services/polymarketUS';

export const predictionPendingStates = ['PREPARING', 'SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED'];
export const predictionActiveStates = [...predictionPendingStates, 'FILLED', 'TERMINAL_PARTIAL'];

export function predictionAccountExposure(snapshot: PmUsExecutionSnapshot) {
  if (snapshot.openOrders.length) throw new Error('Broker orders require reconciliation before a new prediction entry');
  const slugs = new Set<string>(); let cost = 0;
  for (const [slug, p] of Object.entries(snapshot.positions)) {
    const raw = p?.netPositionDecimal ?? p?.netPosition;
    if (typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error('Prediction position quantity unavailable');
    const quantity = Number(raw);
    if (!Number.isFinite(quantity)) throw new Error('Prediction position quantity unavailable');
    if (quantity === 0) continue;
    if (p?.expired !== false) throw new Error('Prediction position settlement requires reconciliation');
    slugs.add(slug); cost += Math.abs(quantity);
  }
  if (!Number.isFinite(cost)) throw new Error('Prediction exposure invalid');
  return { cost, slugs };
}

export async function assertPredictionFillsReflected(tx: any, snapshot: PmUsExecutionSnapshot) {
  const fills = await tx.predictionExecution.findMany({ where: { credentialScopeKey: snapshot.scopeKey,
    status: { in: ['FILLED', 'TERMINAL_PARTIAL'] } } });
  for (const fill of fills) {
    const holding = await tx.predictionHolding.findUnique({ where: { openingExecutionId: fill.id } });
    if (holding && (holding.ownerId !== fill.ownerId || holding.credentialScopeKey !== fill.credentialScopeKey
      || holding.marketSlug !== fill.marketSlug || holding.side !== fill.side || holding.openingQuantity !== fill.appliedQuantity
      || holding.openingNotional !== fill.appliedNotional || holding.openingFees !== fill.appliedFees
      || !Number.isFinite(holding.remainingQuantity) || holding.remainingQuantity < 0 || holding.remainingQuantity > fill.appliedQuantity)) {
      throw new Error('Prediction holding basis requires reconciliation');
    }
    const remaining = holding ? holding.remainingQuantity : fill.appliedQuantity;
    const p = snapshot.positions[fill.marketSlug];
    // Absence is consistent only with a linked, corroborated complete reduction;
    // a missing historical fill without that holding is still a discrepancy.
    if (!p && remaining === 0) continue;
    const raw = p?.netPositionDecimal ?? p?.netPosition;
    if (typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error('Broker positions have not reconciled confirmed local fills');
    const signed = Number(raw);
    if (!Number.isFinite(signed) || Math.abs(signed - (fill.side === 'YES' ? remaining : -remaining)) > 1e-8) {
      throw new Error('Broker positions have not reconciled confirmed local fills');
    }
  }
}

export async function predictionDailyRealizedPnl(tx: any, scopeKey: string): Promise<number> {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const closed = await tx.trade.findMany({ where: { accountId: scopeKey, brokerMode: 'live', brokerConfirmed: true,
    asset: 'POLYMARKET', status: 'CLOSED', closedAt: { gte: start } }, select: { pnl: true } });
  let pnl = 0;
  for (const t of closed) { if (!Number.isFinite(t.pnl)) throw new Error('Prediction daily realized P&L unavailable'); pnl += t.pnl; }
  if (!Number.isFinite(pnl)) throw new Error('Prediction daily realized P&L unavailable');
  return pnl;
}

export function predictionRiskPolicyHash(risk: any): string {
  return createHash('sha256').update(JSON.stringify([
    risk?.maxPositionSizePct, risk?.maxRiskPerTradePct, risk?.dailyLossLimitPct,
  ])).digest('hex');
}

export async function readPredictionGeneration(db: any, scopeKey: string): Promise<number> {
  const row = await db.predictionAccountAuthority.findUnique({ where: { scopeKey } });
  const generation = row?.generation ?? 0;
  if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('Prediction account generation unavailable');
  return generation;
}

/** Call only while holding the account advisory lock, in the same transaction
 * as the claim or fill mutation. Snapshots from an older generation are refused. */
export async function advancePredictionGeneration(tx: any, scopeKey: string): Promise<number> {
  await tx.predictionAccountAuthority.upsert({ where: { scopeKey }, create: { scopeKey, generation: 0 }, update: {} });
  const row = await tx.predictionAccountAuthority.update({ where: { scopeKey }, data: { generation: { increment: 1 } } });
  return row.generation;
}
