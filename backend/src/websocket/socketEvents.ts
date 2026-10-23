/**
 * SOCKET EVENT CONTRACT — the one list of server→client events.
 *
 * Before this module existed the emit/listen sets had drifted apart: the
 * frontend listened for 8 events no backend code ever emitted (including
 * `trade:executed`, so the trade toast could never fire, and the kill-switch
 * events, so the UI flag could never be set by the server), while the
 * backend emitted 10 events nothing listened to. Every event below has a
 * named producer and a named consumer; adding an event means adding it here
 * and wiring BOTH ends in the same change.
 *
 * This module is a leaf (no imports) on purpose: producers such as the
 * kill-switch orchestrator and the execution engine must be able to emit
 * without importing the Socket.IO server (owner-session auth, prisma, …).
 * `initWebSocket` registers the real transport; in tests (or before the
 * server boots) emitting is a no-op, and tests can register a spy.
 *
 * FINAL CONTRACT (server → client)
 *
 *   price:update            producer services/marketData.ts (Binance stream)
 *                           consumer frontend/src/services/socket.ts → store.updatePrice
 *                           payload  { asset, price, change24h, volume24h, high24h, low24h, timestamp }
 *
 *   debate:start | debate:round | debate:agent-speaking | debate:agent-voted |
 *   debate:cross-examination | debate:final-vote | debate:master-thinking |
 *   debate:complete | debate:error | debate:agent-error
 *                           producer agents/debateEngine.ts via agents/debateEvents.ts
 *                           consumer frontend/src/services/socket.ts → store.receiveDebateEvent
 *                                    (+ AgentMonitor for agent-voted / final-vote)
 *                           payload  debate-scoped objects carrying at least { debateId, asset? }
 *                                    (see services/teamSessions.ts TeamEvent)
 *
 *   agent:status            producer services/agentActivityMonitor.ts (all five
 *                                    activity kinds — gathering, learning, analyzing,
 *                                    voting, trading — unified under this one name;
 *                                    the old per-kind names agent:gathering etc. are gone)
 *                           consumer frontend/src/services/socket.ts → store.updateAgentStatus
 *                                    (+ AgentMonitor, filtered to activityType 'VOTING')
 *                           payload  AgentActivity { timestamp, agentId, agentName,
 *                                    activityType, source?, content, dataPoints?,
 *                                    confidence?, impact? } — VOTING adds { vote },
 *                                    TRADING adds { action, amount, price }
 *
 *   trade:executed          producer trading/executionEngine.ts recordConfirmedExecution
 *                                    (only after the recording transaction commits;
 *                                    an already-recorded intent re-play emits nothing)
 *                           consumer frontend/src/services/socket.ts → store.addTrade + toast
 *                                    (+ AgentMonitor activity feed)
 *                           payload  TradeExecutedPayload (below)
 *
 *   kill:switch:activated   producer agents/orchestrator.ts activateKillSwitch
 *   kill:switch:deactivated producer agents/orchestrator.ts deactivateKillSwitch
 *                           consumer frontend/src/services/socket.ts → store.setKillSwitch + toast
 *                           payload  { active: boolean, timestamp: number }
 *
 * REMOVED (were emitted/listened to, now deliberately gone — see the PR
 * description for the per-event justification): quote:update, trade:update
 * (Alpaca broker stream), polymarket:scanning, polymarket:scan-complete,
 * agent:gathering, agent:learning, agent:analyzing, agent:voting,
 * agent:trading (renamed to agent:status), council:start, council:complete,
 * position:closed, guardrail:triggered.
 */

/** Payload of the normalized `trade:executed` event. */
export interface TradeExecutedPayload {
  trade: {
    /** Trade row id created by recordConfirmedExecution. */
    id: string;
    /** Symbol / asset traded (e.g. 'AAPL', 'BTC'). */
    asset: string;
    /** Side of the fill. */
    type: 'BUY' | 'SELL';
    /** Confirmed filled quantity. */
    quantity: number;
    /** Confirmed fill price (the trade row's entryPrice). */
    entryPrice: number;
  };
  /** Account mode the fill was recorded under: 'paper' | 'live'. */
  mode: string;
  /** Account scope the fill belongs to (broker account id). */
  accountId: string;
}

/** Payload of `kill:switch:activated` / `kill:switch:deactivated`. */
export interface KillSwitchPayload {
  active: boolean;
  timestamp: number;
}

export type ContractEvent = 'trade:executed' | 'kill:switch:activated' | 'kill:switch:deactivated';

type Emitter = (event: string, payload: unknown) => void;

let emitter: Emitter | null = null;

/** Called once by initWebSocket; tests may register a spy instead. */
export function registerSocketEmitter(fn: Emitter | null): void {
  emitter = fn;
}

/**
 * Best-effort broadcast of a contract event. Never throws into the producer:
 * a trade recording or a kill-switch flip must not fail because a socket
 * hiccuped.
 */
export function emitContractEvent(event: ContractEvent, payload: TradeExecutedPayload | KillSwitchPayload): void {
  try {
    emitter?.(event, payload);
  } catch {
    /* best-effort diagnostics — the durable record is the database row */
  }
}
