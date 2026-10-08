import { authorizePersistedDecision } from '../src/trading/decisionAuthority';
import type { TradeSignal } from '../src/agents/types';

const now = 1791388800000;
const signal: TradeSignal = {
  asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 80,
  entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 105, positionSizePct: 1,
  agentDecisionId: 'decision-1', reasoning: 'fixture',
  voteCounts: { supporting: 999, opposing: 0, abstaining: 0 },
};
function decision() {
  return {
    id: 'decision-1', asset: 'AAPL', executed: false, executionReason: null,
    timestamp: new Date(now), signal: 'BUY', finalVote: 'BUY', avgConfidence: 80,
    totalVotes: 14, goVotes: 10, noGoVotes: 4,
    agentVotes: Array.from({ length: 14 }, (_, i) => ({ agentId: i + 1, finalVote: i < 10 ? 'BUY' : 'HOLD', confidence: 80, executionEligible: true })),
    marketSnapshot: { asset: 'AAPL', market: 'stocks', timestamp: now, inputFingerprint: 'a'.repeat(64), executionPlan: {
      version: 1, approved: true, mode: 'paper', market: 'stocks', direction: 'BUY', confidence: 80,
      entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 105, positionSizePct: 1,
    } },
  };
}
describe('persisted execution authority', () => {
  it('replaces fabricated caller consensus with the saved eligible votes', () => {
    expect(authorizePersistedDecision(decision(), signal, 'paper', now).voteCounts).toEqual({ supporting: 10, opposing: 0, abstaining: 4 });
  });
  it.each([
    ['missing', (d: any) => null],
    ['wrong asset', (d: any) => ({ ...d, asset: 'MSFT' })],
    ['executed', (d: any) => ({ ...d, executed: true })],
    ['blocked', (d: any) => ({ ...d, executionReason: 'risk veto' })],
    ['stale', (d: any) => ({ ...d, marketSnapshot: { ...d.marketSnapshot, timestamp: now - 300001 } })],
    ['duplicate roster', (d: any) => ({ ...d, agentVotes: d.agentVotes.map((v: any) => ({ ...v, agentId: 1 })) })],
    ['veto', (d: any) => ({ ...d, agentVotes: d.agentVotes.map((v: any) => v.agentId === 5 ? { ...v, finalVote: 'HOLD' } : v) })],
    ['forged tally', (d: any) => ({ ...d, goVotes: 14 })],
    ['unapproved plan', (d: any) => ({ ...d, marketSnapshot: { ...d.marketSnapshot, executionPlan: { ...d.marketSnapshot.executionPlan, approved: false } } })],
    ['research purpose', (d: any) => ({ ...d, marketSnapshot: { ...d.marketSnapshot, executionPlan: { ...d.marketSnapshot.executionPlan, purpose: 'POSITION_REVIEW' } } })],
    ['held research context', (d: any) => ({ ...d, marketSnapshot: { ...d.marketSnapshot, positionReview: { positionId: 'holding-1' } } })],
  ])('refuses %s persisted authority', (_, change: any) => {
    expect(() => authorizePersistedDecision(change(decision()), signal, 'paper', now)).toThrow();
  });
  it('rejects changed mode, inflated allocation and changed protection prices', () => {
    expect(() => authorizePersistedDecision(decision(), signal, 'live', now)).toThrow();
    expect(() => authorizePersistedDecision(decision(), { ...signal, positionSizePct: 2 }, 'paper', now)).toThrow();
    expect(() => authorizePersistedDecision(decision(), { ...signal, stopLossPrice: 90 }, 'paper', now)).toThrow();
  });
});
