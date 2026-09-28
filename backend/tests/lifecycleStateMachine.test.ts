// Needs a real Postgres: TEST_DATABASE_URL=postgresql://... (skipped otherwise)
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
import { LifecycleStateMachine, LifecycleState } from '../src/trading/lifecycleStateMachine';
import { prisma } from '../src/utils/prisma';
import { revokeToken, isTokenRevoked } from '../src/middleware/auth';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Trading Lifecycle State Machine & Persistence', () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it('enforces full 20-state lifecycle progression and audits each step', async () => {
    const correlationId = `test-corr-${Date.now()}`;
    const symbol = 'AAPL';

    // 1. DATA_RECEIVED
    const instance = await LifecycleStateMachine.start({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      sourceDataIds: ['quote-101'],
      reason: 'Live market quote received'
    });
    expect(instance.currentState).toBe(LifecycleState.DATA_RECEIVED);

    // 2. DATA_VALIDATED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.DATA_VALIDATED,
      reason: 'Quote tick verified'
    });

    // 3. UNIVERSE_FILTERED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.UNIVERSE_FILTERED,
      reason: 'Security master tradable check'
    });

    // 4. CANDIDATE_GENERATED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.CANDIDATE_GENERATED,
      reason: 'Candidate setup generated'
    });

    // 5. STRATEGY_ANALYZED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.STRATEGY_ANALYZED,
      reason: 'Intraday rules passed'
    });

    // 6. AGENTS_EVALUATED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.AGENTS_EVALUATED,
      reason: 'AI committee consensus 85%'
    });

    // 7. RISK_CHECKED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.RISK_CHECKED,
      reason: 'Risk limits verified'
    });

    // 8. ORDER_PLANNED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.ORDER_PLANNED,
      reason: 'Order planned'
    });

    // 9. FRESH_DATA_REVALIDATED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.FRESH_DATA_REVALIDATED,
      reason: 'Fresh quote confirmed'
    });

    // 10. ORDER_SUBMITTED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.ORDER_SUBMITTED,
      reason: 'Order dispatched'
    });

    // 11. PROVIDER_ACCEPTED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.PROVIDER_ACCEPTED,
      reason: 'Broker accepted'
    });

    // 12. FILLED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.FILLED,
      reason: 'Order filled'
    });

    // 13. PROTECTION_VERIFIED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.PROTECTION_VERIFIED,
      reason: 'Bracket stops verified'
    });

    // 14. POSITION_MONITORED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.POSITION_MONITORED,
      reason: 'Monitoring position'
    });

    // 15. EXIT_SUBMITTED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.EXIT_SUBMITTED,
      reason: 'Take profit hit'
    });

    // 16. EXIT_FILLED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.EXIT_FILLED,
      reason: 'Exit filled'
    });

    // 17. PROVIDER_RECONCILED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.PROVIDER_RECONCILED,
      reason: 'Reconciled with broker ledger'
    });

    // 18. PERFORMANCE_CALCULATED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.PERFORMANCE_CALCULATED,
      reason: 'PnL calculated'
    });

    // 19. MODEL_OUTCOME_RECORDED
    await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.MODEL_OUTCOME_RECORDED,
      reason: 'Agent accuracy updated'
    });

    // 20. AUDIT_COMPLETE
    const finalInstance = await LifecycleStateMachine.transition({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol,
      newState: LifecycleState.AUDIT_COMPLETE,
      reason: 'Full audit complete'
    });

    expect(finalInstance.currentState).toBe(LifecycleState.AUDIT_COMPLETE);

    // Verify database persistence of all audit records
    const audits = await prisma.tradeLifecycleAudit.findMany({
      where: { correlationId }
    });
    expect(audits.length).toBe(20);
  });

  it('rejects skipping mandatory risk gate before order submission', async () => {
    const correlationId = `illegal-corr-${Date.now()}`;
    await LifecycleStateMachine.start({
      correlationId,
      provider: 'ALPACA',
      environment: 'paper',
      strategy: 'INTRADAY',
      symbol: 'MSFT',
      sourceDataIds: ['quote-202'],
      reason: 'Init'
    });

    // Attempt to jump straight to ORDER_SUBMITTED without passing intermediate gates
    await expect(
      LifecycleStateMachine.transition({
        correlationId,
        provider: 'ALPACA',
        environment: 'paper',
        strategy: 'INTRADAY',
        symbol: 'MSFT',
        newState: LifecycleState.ORDER_SUBMITTED,
        reason: 'Illegal jump'
      })
    ).rejects.toThrow();
  });

  it('genuinely persists revoked tokens in the database', async () => {
    const testToken = `test-revoked-token-${Date.now()}`;
    expect(await isTokenRevoked(testToken)).toBe(false);

    await revokeToken(testToken);
    expect(await isTokenRevoked(testToken)).toBe(true);

    const inDb = await prisma.revokedToken.findUnique({ where: { token: testToken } });
    expect(inDb).toBeTruthy();
    expect(inDb!.token).toBe(testToken);
  });
});
