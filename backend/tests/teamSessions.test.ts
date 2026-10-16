jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
import { TeamSessionRegistry, TeamSessionContext, TEAM_SESSION_LIMITS, TeamEvent } from '../src/services/teamSessions';
import { createDebateEventEmitter } from '../src/agents/debateEvents';

const context = (id = 'debate-fixture', purpose: TeamSessionContext['purpose'] = 'ENTRY'): TeamSessionContext =>
  ({ debateId: id, asset: 'AAPL', market: 'stocks', purpose, marketSnapshotAt: 100 });
let now: number, registry: TeamSessionRegistry;
beforeEach(() => { now = 1000; registry = new TeamSessionRegistry(() => now); });
function observe(event: TeamEvent, payload: Record<string, unknown> = {}, ctx = context()) {
  return registry.observe(ctx, event, { debateId: ctx.debateId, ...payload }, false);
}
const current = () => registry.snapshot().sessions[0];

test('empty coverage has 14 actual roles, a separate coordinator and unknown execution', () => {
  const snapshot = registry.snapshot();
  expect(snapshot.sessions).toEqual([]); expect(snapshot.roster.specialists).toHaveLength(14);
  expect(snapshot.roster.specialists.map(x => x.id)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  expect(snapshot.roster.coordinator.name).toBe('Master Coordinator');
  expect(snapshot.semantics).toMatchObject({ executionLiveness: 'unknown', heartbeat: false, socketDelivery: 'not-tracked' });
  expect(snapshot.process.id).toMatch(/^[a-f0-9-]{36}$/); expect(snapshot.process.durable).toBe(false);
  expect(new TeamSessionRegistry().snapshot().process.id).not.toBe(snapshot.process.id);
});

test('same-asset concurrent sessions and explicit research purpose remain separate', () => {
  observe('debate:start'); observe('debate:start', {}, context('research', 'RESEARCH'));
  observe('debate:agent-speaking', { agentId: 1, round: 1 });
  observe('debate:agent-voted', { agentId: 2, vote: 'SELL', confidence: 72, openingArgument: 'Observed source' }, context('research', 'RESEARCH'));
  const sessions = registry.snapshot().sessions;
  expect(sessions).toHaveLength(2);
  expect(sessions.find(s => s.id === 'research')!.purpose).toBe('RESEARCH');
  expect(Object.keys(sessions.find(s => s.id === 'research')!.agents)).toEqual(['2']);
  expect(Object.keys(sessions.find(s => s.id === 'debate-fixture')!.agents)).toEqual(['1']);
});

test('round transitions never manufacture per-agent activity and timestamps stay distinct', () => {
  observe('debate:start', { resumedFromCheckpoint: true, checkpointStage: 'ROUND2_DONE' });
  now = 1200; const metadata = observe('debate:agent-voted', { agentId: 1, openingArgument: 'First', vote: 'BUY', confidence: 80, timestamp: 900 });
  now = 1300; observe('debate:round', { round: 3 });
  expect(current()).toMatchObject({ marketSnapshotAt: 100, exchangeObservedAt: null, stage: 'final-voting', resumedFromCheckpoint: true, checkpointStage: 'ROUND2_DONE' });
  expect(current().agents[1].lastObservation).toMatchObject({ kind: 'opening-vote', sourceEventAt: 900, receivedAt: 1200, ...metadata });
  expect(current().entries[0].sourceEventAt).toBeNull();
  expect(Object.keys(current().agents)).toEqual(['1']);
  expect(observe('debate:agent-speaking', { agentId: 2, round: 3 })).toBeNull();
  expect(observe('debate:start')).toBeNull(); expect(current().stage).toBe('final-voting');
});

test('challenge and rebuttal attach only explicit canonical IDs, not source names', () => {
  observe('debate:start');
  expect(observe('debate:cross-examination', { challenger: 'The Technician', target: 'Options Flow', challenge: 'Unscoped' })).toBeNull();
  observe('debate:cross-examination', { challengerId: 1, targetId: 12, challenger: 'forged', challenge: 'Question', rebuttal: 'Answer' });
  expect(current().entries.slice(-2).map(x => [x.kind, x.agentId, x.agentName, x.content])).toEqual([
    ['challenge', 1, 'The Technician', 'Question'], ['rebuttal', 12, 'Options Flow', 'Answer'],
  ]);
  expect(current().entries[1].sequence).toBe(current().entries[2].sequence);
});

test('position review, unrelated activity, malformed contexts and missing starts cannot enter coverage', () => {
  expect(observe('debate:start', {}, context('private', 'POSITION_REVIEW'))).toBeNull();
  expect(observe('agent:analyzing' as TeamEvent)).toBeNull();
  expect(observe('debate:agent-voted', { agentId: 1 })).toBeNull();
  expect(observe('debate:start', { debateId: 'another' })).toBeNull();
  expect(observe('debate:start', {}, { ...context(), market: 'invalid' as any })).toBeNull();
  observe('debate:start');
  expect(observe('debate:agent-speaking', { agentId: 99, round: 1 })).toBeNull();
  expect(observe('debate:round', { round: 3 }, { ...context(), asset: 'MSFT' })).toBeNull();
  expect(registry.snapshot().sessions).toHaveLength(1); expect(current().entries).toHaveLength(1);
});

test('whitelisted completion exposes a real decision identity and never hidden transcript fields or execution', () => {
  observe('debate:start');
  const transcript = { id: context().debateId, asset: 'AAPL', market: 'stocks', purpose: 'ENTRY', finalDecision: 'BUY', finalConfidence: 81,
    executionApproved: true, masterSynthesis: 'Observed synthesis', blockReason: null, decisionId: 'actual-decision', timestamp: 1050,
    tradeExecuted: true, portfolio: 'PRIVATE_PORTFOLIO', agentArguments: ['PRIVATE_PROMPT'], credentials: 'PRIVATE_SECRET' };
  expect(observe('debate:complete', { transcript: { ...transcript, purpose: 'POSITION_REVIEW' } })).toBeNull();
  observe('debate:complete', { transcript });
  expect(current()).toMatchObject({ status: 'complete', result: { decisionId: 'actual-decision', decision: 'BUY', committeeApproved: true,
    transcriptCreatedAt: 1050, tradeExecution: 'not-observed' } });
  expect(JSON.stringify(current())).not.toContain('PRIVATE_'); expect(JSON.stringify(current())).not.toContain('tradeExecuted');
  expect(observe('debate:error', { errorCode: 'session_failed', fatal: true })).toBeNull();
});

test('observed safe failures are distinct from a merely silent or old session', () => {
  observe('debate:start'); observe('debate:error', { errorCode: 'coordinator_unavailable', error: 'PRIVATE_PROVIDER_DETAIL', fatal: false });
  expect(current().status).toBe('incomplete'); expect(current().coordinator?.lastObservation.errorCode).toBe('coordinator_unavailable');
  observe('debate:agent-error', { agentId: 14, round: 3, errorCode: 'final_unavailable', error: 'PRIVATE_PROVIDER_DETAIL' });
  expect(current().agents[14].lastObservation.kind).toBe('error');
  expect(observe('debate:error', { errorCode: 'PRIVATE_PROVIDER_DETAIL', fatal: true })).toBeNull();
  now += 30_000; expect(current().status).toBe('incomplete');
  observe('debate:error', { errorCode: 'session_failed', fatal: true }); expect(current().status).toBe('failed');
  expect(JSON.stringify(current())).not.toContain('PRIVATE_');
});

test('bounded text and entry retention visibly report partial content', () => {
  observe('debate:start');
  for (let i = 0; i < 110; i++) observe('debate:agent-voted', { agentId: 1, vote: 'BUY', openingArgument: 'x'.repeat(3000) });
  expect(current().entries).toHaveLength(TEAM_SESSION_LIMITS.maxEntriesPerSession);
  expect(current()).toMatchObject({ entriesTruncated: true, observedEventCount: 111, droppedEntryCount: 15 });
  expect(current().agents[1].lastObservation).toMatchObject({ contentTruncated: true, originalCharacters: 3000 });
  expect(current().agents[1].lastObservation.content).toHaveLength(2048);
  observe('debate:complete', { transcript: { id: context().debateId, asset: 'AAPL', market: 'stocks', purpose: 'ENTRY', masterSynthesis: 'z'.repeat(3000), blockReason: 'b'.repeat(3000) } });
  expect(current().result).toMatchObject({ synthesisTruncated: true, synthesisOriginalCharacters: 3000, blockReasonTruncated: true });
});

test('session eviction and age expiration are explicit bounded coverage, not failure or restoration', () => {
  for (let i = 0; i < 33; i++) observe('debate:start', {}, context(`session-${i}`));
  expect(registry.snapshot().sessions).toHaveLength(32); expect(registry.snapshot().counters.evictedSessions).toBe(1);
  expect(observe('debate:agent-speaking', { agentId: 1, round: 1 }, context('session-0'))).toBeNull();
  now += TEAM_SESSION_LIMITS.retentionMs + 1;
  expect(registry.snapshot().sessions).toEqual([]); expect(registry.snapshot().counters.expiredSessions).toBe(32);
  expect(observe('debate:round', { round: 3 }, context('session-32'))).toBeNull();
});

test('snapshots cannot mutate retained state', () => {
  observe('debate:start'); const snapshot = registry.snapshot(); snapshot.sessions[0].asset = 'FORGED'; snapshot.roster.specialists[0].name = 'FORGED' as any;
  expect(current().asset).toBe('AAPL'); expect(registry.snapshot().roster.specialists[0].name).toBe('The Technician');
});

test('actual explicit emitter annotates transport and snapshot with matching sequence, without mutation', () => {
  const transport = { emit: jest.fn() }; const emit = createDebateEventEmitter(context(), transport, registry);
  const payload = { debateId: context().debateId, asset: 'AAPL' }; emit('debate:start', payload);
  const sent = transport.emit.mock.calls[0][1];
  expect(sent.sessionObservation).toMatchObject({ processId: registry.snapshot().process.id, sequence: current().lastSequence, receivedAt: current().lastObservedAt });
  expect(payload).not.toHaveProperty('sessionObservation'); expect(registry.snapshot().semantics.lastSocketTransportAvailable).toBe(true);
});

test('no socket still records observations and private held reviews never record or broadcast', () => {
  createDebateEventEmitter(context(), null, registry)('debate:start', { debateId: context().debateId });
  expect(current().status).toBe('incomplete');
  const transport = { emit: jest.fn() };
  createDebateEventEmitter(context('private', 'POSITION_REVIEW'), transport, registry)('debate:start', { debateId: 'private' });
  expect(transport.emit).not.toHaveBeenCalled(); expect(registry.snapshot().sessions).toHaveLength(1);
});

test('registry failure cannot alter original transport payload or stop the business event', () => {
  jest.spyOn(registry, 'observe').mockImplementation(() => { throw new Error('PRIVATE_DETAIL'); });
  const transport = { emit: jest.fn() };
  createDebateEventEmitter(context(), transport, registry)('debate:start', { debateId: context().debateId });
  expect(transport.emit).toHaveBeenCalledWith('debate:start', { debateId: context().debateId });
});

test('new diagnostic transport failure does not change existing fallback decisions', () => {
  observe('debate:start');
  const transport = { emit: jest.fn(() => { throw new Error('fixture transport unavailable'); }) };
  expect(() => createDebateEventEmitter(context(), transport, registry)('debate:error', { debateId: context().debateId, errorCode: 'coordinator_unavailable', fatal: false })).not.toThrow();
  expect(current().status).toBe('incomplete'); expect(current().coordinator?.lastObservation.errorCode).toBe('coordinator_unavailable');
});
