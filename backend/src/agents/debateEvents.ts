import { logger } from '../utils/logger';
import { teamSessionRegistry, TeamSessionRegistry, TeamSessionContext, TeamEvent } from '../services/teamSessions';

interface DebateTransport { emit: (event: string, payload: unknown) => unknown }
/** Explicit source instrumentation: never patch Socket.IO or capture unrelated activity/chat. */
export function createDebateEventEmitter(context: TeamSessionContext, transport: DebateTransport | null | undefined, registry: TeamSessionRegistry = teamSessionRegistry) {
  return (event: TeamEvent, payload: Record<string, unknown>) => {
    if (context.purpose === 'POSITION_REVIEW') return;
    let observation;
    try {
      observation = registry.observe(context, event, payload, !!transport);
      if (observation && (event === 'debate:start' || event === 'debate:complete' || event === 'debate:error')) {
        logger.info('Team session observation', { event: 'team_session_observed', debateId: context.debateId,
          entryPoint: 'committee', purpose: context.purpose, observedEvent: event, sequence: observation.sequence });
      }
    } catch {
      logger.warn('Team session observation unavailable', { event: 'team_session_observation_failed', debateId: context.debateId, entryPoint: 'committee' });
    }
    const annotated = { ...payload, ...(observation ? { sessionObservation: observation } : {}) };
    if (event === 'debate:error' || event === 'debate:agent-error') {
      // These new diagnostic events must never change existing fallback decisions.
      try { transport?.emit(event, annotated); } catch { /* best-effort diagnostics */ }
    } else transport?.emit(event, annotated);
  };
}
