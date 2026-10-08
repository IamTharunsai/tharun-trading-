import { randomUUID } from 'crypto';
import { prisma } from '../utils/prisma';
import { getPortfolioState } from './portfolio';
import { buildMarketSnapshot } from './marketData';
import { runInvestmentCommitteeDebate, PositionResearchContext } from '../agents/debateEngine';
import { getActiveMode } from '../trading/brokerRouter';
import { isKillSwitchActive } from '../agents/orchestrator';
import { detectMarketRegime } from './regimeDetector';
import { brokerSymbol, getVerifiedAccountScope } from '../trading/accountScope';

const dateKey = (value: unknown) => {
  const valueDate = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(valueDate.getTime())) throw new Error('POSITION_CYCLE_UNAVAILABLE');
  return valueDate.toISOString();
};
export const researchCycleKey = (position: { id: string; openedAt: unknown }, accountId: string, mode: string) =>
  JSON.stringify([accountId, mode, position.id, dateKey(position.openedAt)]);

/** Full specialist research of owned holdings; no order/exit module is imported. */
let passRunning = false;
export async function reviewOpenPositions() {
  if (passRunning || isKillSwitchActive()) return [];
  passRunning = true;
  try { return await performReviews(); }
  finally { passRunning = false; }
}

async function performReviews() {
  const portfolio = await getPortfolioState();
  if (!portfolio.accountId || !portfolio.brokerMode || portfolio.brokerMode !== getActiveMode()) throw new Error('REVIEW_ACCOUNT_UNAVAILABLE');
  const hours = Number(process.env.POSITION_REVIEW_INTERVAL_HOURS ?? 6);
  if (!Number.isFinite(hours) || hours < 1 / 12 || hours > 24) throw new Error('INVALID_REVIEW_INTERVAL');
  const scope = { accountId: portfolio.accountId, brokerMode: portfolio.brokerMode };
  const authority = await getVerifiedAccountScope();
  if (authority.accountId !== scope.accountId || authority.mode !== scope.brokerMode) throw new Error('REVIEW_ACCOUNT_CHANGED');
  const verifyHolding = async (position: any) => {
    const observed = await authority.broker.listPositionsVerified();
    const symbol = brokerSymbol(position.asset, position.market).split('/').join('');
    const holding = observed.find(p => p.symbol.split('/').join('') === symbol
      && p.asset_class === (position.market === 'stocks' ? 'us_equity' : 'crypto'));
    const observedSide = holding?.side === 'long' ? 'BUY' : holding?.side === 'short' ? 'SELL' : null;
    const entry = Number(holding?.avg_entry_price);
    if (!holding || observedSide !== position.side || Math.abs(Number(holding.qty)) !== position.quantity
      || !Number.isFinite(entry) || Math.abs(entry - position.entryPrice) > Math.max(1e-6, Math.abs(entry) * 1e-6)) {
      throw new Error('BROKER_HOLDING_REQUIRES_RECONCILIATION');
    }
  };
  const candidates = portfolio.positions.filter(p => p.status === 'OPEN' && p.accountId === scope.accountId
    && p.brokerMode === scope.brokerMode && ['stocks', 'crypto'].includes(p.market)
    && ['BUY', 'SELL'].includes(p.side) && Number.isFinite(p.quantity) && p.quantity > 0);
  const holdings = new Map<string, any>();
  for (const position of candidates) {
    const cycleKey = researchCycleKey(position, scope.accountId, scope.brokerMode);
    holdings.set(cycleKey, position);
    await prisma.positionResearch.upsert({ where: { cycleKey }, update: {}, create: {
      cycleKey, positionId: position.id, ...scope, asset: position.asset,
    } });
  }
  if (!holdings.size) return [];
  const now = new Date();
  const due = await prisma.positionResearch.findMany({ where: { ...scope, cycleKey: { in: [...holdings.keys()] },
    nextReviewAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
    orderBy: [{ nextReviewAt: 'asc' }, { id: 'asc' }], take: 2 });
  // At most two holdings per pass, and atomic leases prevent another replica
  // from doing the same review while this lease is valid.
  const outcomes = await Promise.allSettled(due.map(async row => {
    const token = randomUUID(), leaseUntil = new Date(Date.now() + 30 * 60000);
    const claimed = await prisma.positionResearch.updateMany({ where: { id: row.id, ...scope,
      nextReviewAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      data: { status: 'RUNNING', leaseToken: token, leaseUntil, lastAttemptAt: now, error: null } });
    if (claimed.count !== 1) return { positionId: row.positionId, status: 'LEASE_NOT_ACQUIRED' };
    const owned = { id: row.id, ...scope, leaseToken: token, status: 'RUNNING' };
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const maxAgeMs = Number(process.env.MAX_SNAPSHOT_AGE_MS ?? 300000);
      if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error('INVALID_REVIEW_FRESHNESS');
      deadline = setTimeout(() => controller.abort(new Error('REVIEW_DEADLINE_EXCEEDED')), Math.min(maxAgeMs, 15 * 60000));
      deadline.unref();
      const position = holdings.get(row.cycleKey);
      if (!position) throw new Error('POSITION_NO_LONGER_SELECTED');
      await verifyHolding(position);
      const snapshot = await buildMarketSnapshot(position.asset, position.market);
      if (!snapshot || snapshot.asset !== position.asset || snapshot.market !== position.market) throw new Error('POSITION_SNAPSHOT_UNAVAILABLE');
      if (!Number.isFinite(snapshot.timestamp) || Date.now() - snapshot.timestamp > maxAgeMs || snapshot.timestamp > Date.now() + 5000) throw new Error('REVIEW_SNAPSHOT_STALE');
      const indicators = snapshot.indicators;
      const regime = await detectMarketRegime(position.asset, { price: snapshot.price,
        priceChange24h: snapshot.priceChangePct24h, rsi: indicators.rsi14, macdHistogram: indicators.macd.histogram,
        bollingerWidth: (indicators.bollingerBands.upper - indicators.bollingerBands.lower) / indicators.bollingerBands.middle,
        ema9: indicators.ema9, ema21: indicators.ema21, ema200: indicators.ema200, volume24h: snapshot.volume24h,
        volumeAvg20: indicators.volumeAvg20, atr14: indicators.atr14 });
      const context: PositionResearchContext = { positionId: position.id, openedAt: dateKey(position.openedAt),
        ...scope, asset: position.asset, side: position.side, quantity: position.quantity, entryPrice: position.entryPrice,
        stopLossPrice: position.stopLossPrice, takeProfitPrice: position.takeProfitPrice, protectionStatus: position.protectionStatus ?? 'UNVERIFIED' };
      const transcript = await runInvestmentCommitteeDebate(snapshot, portfolio, regime.regime, regime, 'COUNCIL', context, {
        signal: controller.signal, beforeCall: async () => {
          controller.signal.throwIfAborted();
          const renewed = await prisma.positionResearch.updateMany({ where: { ...owned, leaseUntil: { gt: new Date() } },
            data: { leaseUntil: new Date(Date.now() + 30 * 60000) } });
          if (renewed.count !== 1) { controller.abort(new Error('REVIEW_LEASE_LOST')); controller.signal.throwIfAborted(); }
        },
      });
      controller.signal.throwIfAborted();
      if (!Number.isFinite(snapshot.timestamp) || Date.now() - snapshot.timestamp > maxAgeMs || snapshot.timestamp > Date.now() + 5000) {
        throw new Error('REVIEW_SNAPSHOT_STALE');
      }
      if (!transcript.decisionId || transcript.executionApproved || transcript.positionSizePct !== 0
        || transcript.purpose !== 'POSITION_REVIEW') throw new Error('REVIEW_AUTHORITY_INVALID');
      const eligible = transcript.agentVotes.filter(v => v.executionEligible !== false && !v.failureState);
      if (transcript.agentVotes.length !== 14 || new Set(transcript.agentVotes.map(v => v.agentId)).size !== 14
        || eligible.length < 7) throw new Error('REVIEW_EVIDENCE_INCOMPLETE');
      const current = await getPortfolioState();
      const stillHeld = current.positions.find(p => p.id === position.id);
      if (current.accountId !== scope.accountId || current.brokerMode !== scope.brokerMode
        || getActiveMode() !== scope.brokerMode || !stillHeld || stillHeld.side !== position.side
        || stillHeld.quantity !== position.quantity || stillHeld.entryPrice !== context.entryPrice
        || stillHeld.stopLossPrice !== context.stopLossPrice || stillHeld.takeProfitPrice !== context.takeProfitPrice
        || (stillHeld.protectionStatus ?? 'UNVERIFIED') !== context.protectionStatus
        || researchCycleKey(stillHeld, scope.accountId, scope.brokerMode) !== row.cycleKey) {
        throw new Error('POSITION_CHANGED_DURING_REVIEW');
      }
      await verifyHolding(stillHeld);
      controller.signal.throwIfAborted();
      if (Date.now() - snapshot.timestamp > maxAgeMs) throw new Error('REVIEW_SNAPSHOT_STALE');
      const directionalAgreement = eligible.filter(v => v.vote === transcript.finalDecision).length;
      const observation = transcript.finalDecision === 'HOLD' || directionalAgreement / 14 < 0.55 ? 'UNCERTAIN'
        : transcript.finalDecision === position.side ? 'THESIS_SUPPORTED' : 'THESIS_CONTRADICTED';
      const completed = await prisma.positionResearch.updateMany({ where: { ...owned, leaseUntil: { gt: new Date() } },
        data: { status: 'COMPLETE', decisionId: transcript.decisionId, observation, lastCompletedAt: new Date(),
          nextReviewAt: new Date(Date.now() + hours * 3600000), leaseToken: null, leaseUntil: null, error: null } });
      return { positionId: position.id, status: completed.count === 1 ? 'COMPLETE' : 'LEASE_LOST', observation };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'POSITION_REVIEW_FAILED';
      await prisma.positionResearch.updateMany({ where: owned, data: { status: 'FAILED', error: message.slice(0, 500),
        nextReviewAt: new Date(Date.now() + 15 * 60000), leaseToken: null, leaseUntil: null } });
      return { positionId: row.positionId, status: 'FAILED', error: message };
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }));
  return outcomes.map((outcome, i) => outcome.status === 'fulfilled' ? outcome.value
    : { positionId: due[i].positionId, status: 'FAILED', error: 'RESEARCH_STORAGE_UNAVAILABLE' });
}

export async function getPositionResearchStatus() {
  const portfolio = await getPortfolioState();
  if (!portfolio.accountId || !portfolio.brokerMode || portfolio.brokerMode !== getActiveMode()) throw new Error('REVIEW_ACCOUNT_UNAVAILABLE');
  const cycles = portfolio.positions.filter(p => p.status === 'OPEN').map(p => researchCycleKey(p, portfolio.accountId!, portfolio.brokerMode!));
  return prisma.positionResearch.findMany({ where: { accountId: portfolio.accountId, brokerMode: portfolio.brokerMode,
    cycleKey: { in: cycles } }, select: { positionId: true, asset: true, status: true, lastAttemptAt: true,
      lastCompletedAt: true, nextReviewAt: true, decisionId: true, observation: true, error: true }, orderBy: { nextReviewAt: 'asc' } });
}

export async function getPositionResearchDecision(decisionId: string) {
  const reviews = await getPositionResearchStatus();
  const review = reviews.find(item => item.decisionId === decisionId);
  if (!review) return null;
  const decision = await prisma.agentDecision.findFirst({ where: { id: decisionId, horizon: 'POSITION_REVIEW' } });
  if (!decision) return null;
  const context = (decision.marketSnapshot as any)?.positionReview;
  const authority = await getVerifiedAccountScope();
  if (!context || context.positionId !== review.positionId || context.accountId !== authority.accountId
    || context.brokerMode !== authority.mode) return null;
  const current = await getPortfolioState();
  const holding = current.positions.find(p => p.id === review.positionId);
  if (current.accountId !== authority.accountId || current.brokerMode !== authority.mode || !holding
    || dateKey(holding.openedAt) !== context.openedAt) return null;
  return { review, decision, executionAuthority: false };
}
