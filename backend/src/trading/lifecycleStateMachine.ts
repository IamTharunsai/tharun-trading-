import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

export enum LifecycleState {
  DATA_RECEIVED = 'DATA_RECEIVED',
  DATA_VALIDATED = 'DATA_VALIDATED',
  UNIVERSE_FILTERED = 'UNIVERSE_FILTERED',
  CANDIDATE_GENERATED = 'CANDIDATE_GENERATED',
  STRATEGY_ANALYZED = 'STRATEGY_ANALYZED',
  AGENTS_EVALUATED = 'AGENTS_EVALUATED',
  RISK_CHECKED = 'RISK_CHECKED',
  ORDER_PLANNED = 'ORDER_PLANNED',
  FRESH_DATA_REVALIDATED = 'FRESH_DATA_REVALIDATED',
  ORDER_SUBMITTED = 'ORDER_SUBMITTED',
  PROVIDER_ACCEPTED = 'PROVIDER_ACCEPTED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  PROTECTION_VERIFIED = 'PROTECTION_VERIFIED',
  POSITION_MONITORED = 'POSITION_MONITORED',
  EXIT_SUBMITTED = 'EXIT_SUBMITTED',
  EXIT_FILLED = 'EXIT_FILLED',
  PROVIDER_RECONCILED = 'PROVIDER_RECONCILED',
  PERFORMANCE_CALCULATED = 'PERFORMANCE_CALCULATED',
  MODEL_OUTCOME_RECORDED = 'MODEL_OUTCOME_RECORDED',
  AUDIT_COMPLETE = 'AUDIT_COMPLETE',
  // Terminal failure states
  REJECTED = 'REJECTED',
  FAILED = 'FAILED'
}

export interface TransitionPayload {
  correlationId: string;
  account?: string;
  provider: 'ALPACA' | 'POLYMARKET' | 'BINANCE' | 'SIMULATION';
  environment: 'paper' | 'live';
  strategy: 'INTRADAY' | 'SWING' | 'LONG_TERM' | 'POLYMARKET' | 'CRYPTO';
  symbol: string;
  newState: LifecycleState;
  providerTimestamp?: Date | string | null;
  sourceDataIds?: string[];
  reason: string;
  errors?: string[] | null;
  retryCount?: number;
  modelVersion?: string;
  configVersion?: string;
  metadata?: Record<string, any>;
}

export interface LifecycleInstance {
  correlationId: string;
  symbol: string;
  currentState: LifecycleState;
  history: LifecycleState[];
  account: string;
  provider: string;
  environment: string;
  strategy: string;
  riskVerified: boolean;
  freshDataVerified: boolean;
  protectionVerified: boolean;
  reconciled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Memory tracking of active trading lifecycles keyed by correlationId
const activeLifecycles = new Map<string, LifecycleInstance>();

// Allowed state transitions mapping
const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  [LifecycleState.DATA_RECEIVED]: [LifecycleState.DATA_VALIDATED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.DATA_VALIDATED]: [LifecycleState.UNIVERSE_FILTERED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.UNIVERSE_FILTERED]: [LifecycleState.CANDIDATE_GENERATED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.CANDIDATE_GENERATED]: [LifecycleState.STRATEGY_ANALYZED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.STRATEGY_ANALYZED]: [LifecycleState.AGENTS_EVALUATED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.AGENTS_EVALUATED]: [LifecycleState.RISK_CHECKED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.RISK_CHECKED]: [LifecycleState.ORDER_PLANNED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.ORDER_PLANNED]: [LifecycleState.FRESH_DATA_REVALIDATED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.FRESH_DATA_REVALIDATED]: [LifecycleState.ORDER_SUBMITTED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.ORDER_SUBMITTED]: [LifecycleState.PROVIDER_ACCEPTED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.PROVIDER_ACCEPTED]: [LifecycleState.PARTIALLY_FILLED, LifecycleState.FILLED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.PARTIALLY_FILLED]: [LifecycleState.PARTIALLY_FILLED, LifecycleState.FILLED, LifecycleState.FAILED, LifecycleState.REJECTED],
  [LifecycleState.FILLED]: [LifecycleState.PROTECTION_VERIFIED, LifecycleState.FAILED],
  [LifecycleState.PROTECTION_VERIFIED]: [LifecycleState.POSITION_MONITORED, LifecycleState.FAILED],
  [LifecycleState.POSITION_MONITORED]: [LifecycleState.EXIT_SUBMITTED, LifecycleState.FAILED],
  [LifecycleState.EXIT_SUBMITTED]: [LifecycleState.EXIT_FILLED, LifecycleState.FAILED],
  [LifecycleState.EXIT_FILLED]: [LifecycleState.PROVIDER_RECONCILED, LifecycleState.FAILED],
  [LifecycleState.PROVIDER_RECONCILED]: [LifecycleState.PERFORMANCE_CALCULATED, LifecycleState.FAILED],
  [LifecycleState.PERFORMANCE_CALCULATED]: [LifecycleState.MODEL_OUTCOME_RECORDED, LifecycleState.FAILED],
  [LifecycleState.MODEL_OUTCOME_RECORDED]: [LifecycleState.AUDIT_COMPLETE, LifecycleState.FAILED],
  [LifecycleState.AUDIT_COMPLETE]: [],
  [LifecycleState.REJECTED]: [],
  [LifecycleState.FAILED]: []
};

export class LifecycleStateMachine {
  /**
   * Initializes a brand-new trading lifecycle starting at DATA_RECEIVED
   */
  static async start(payload: Omit<TransitionPayload, 'newState'> & { sourceDataIds: string[] }): Promise<LifecycleInstance> {
    const correlationId = payload.correlationId || `corr-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    
    const instance: LifecycleInstance = {
      correlationId,
      symbol: payload.symbol,
      currentState: LifecycleState.DATA_RECEIVED,
      history: [LifecycleState.DATA_RECEIVED],
      account: payload.account || 'DEFAULT',
      provider: payload.provider,
      environment: payload.environment,
      strategy: payload.strategy,
      riskVerified: false,
      freshDataVerified: false,
      protectionVerified: false,
      reconciled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    activeLifecycles.set(correlationId, instance);

    await prisma.tradeLifecycleAudit.create({
      data: {
        correlationId,
        account: instance.account,
        provider: instance.provider,
        environment: instance.environment,
        strategy: instance.strategy,
        symbol: instance.symbol,
        previousState: null,
        newState: LifecycleState.DATA_RECEIVED,
        providerTimestamp: payload.providerTimestamp || null,
        sourceDataIds: (payload.sourceDataIds ?? undefined) as any,
        reason: payload.reason || 'Lifecycle initialized',
        errors: (payload.errors ?? undefined) as any,
        retryCount: payload.retryCount || 0,
        modelVersion: payload.modelVersion || '1.0.0',
        configVersion: payload.configVersion || '1.0.0',
        metadata: (payload.metadata ?? undefined) as any
      }
    });

    logger.info(`[LIFECYCLE ${correlationId}] Started at DATA_RECEIVED for ${payload.symbol}`);
    return instance;
  }

  /**
   * Enforces strict state transitions. Throws error if rule or stage is skipped.
   */
  static async transition(payload: TransitionPayload): Promise<LifecycleInstance> {
    const instance = activeLifecycles.get(payload.correlationId);
    if (!instance) {
      throw new Error(`[LIFECYCLE ERROR] No active trading lifecycle found for correlation ID: ${payload.correlationId}`);
    }

    const previousState = instance.currentState;
    const allowed = VALID_TRANSITIONS[previousState];

    if (!allowed || !allowed.includes(payload.newState)) {
      const err = `[LIFECYCLE VIOLATION] Invalid state transition from ${previousState} -> ${payload.newState} for ${instance.symbol}`;
      logger.error(err);
      await prisma.tradeLifecycleAudit.create({
        data: {
          correlationId: payload.correlationId,
          account: instance.account,
          provider: instance.provider,
          environment: instance.environment,
          strategy: instance.strategy,
          symbol: instance.symbol,
          previousState,
          newState: LifecycleState.FAILED,
          sourceDataIds: payload.sourceDataIds || [],
          reason: `Illegal state jump attempted: ${err}`,
          errors: [err],
          modelVersion: payload.modelVersion || '1.0.0',
          configVersion: payload.configVersion || '1.0.0'
        }
      });
      instance.currentState = LifecycleState.FAILED;
      throw new Error(err);
    }

    // MANDATORY AUDIT GATE CHECKS: Never skip risk, fresh-data, protection, or reconciliation
    if (payload.newState === LifecycleState.RISK_CHECKED) {
      instance.riskVerified = true;
    }
    if (payload.newState === LifecycleState.FRESH_DATA_REVALIDATED) {
      if (!instance.riskVerified) {
        throw new Error(`[SAFETY CRITICAL] Cannot proceed to FRESH_DATA_REVALIDATED without passing RISK_CHECKED for ${instance.symbol}`);
      }
      instance.freshDataVerified = true;
    }
    if (payload.newState === LifecycleState.ORDER_SUBMITTED) {
      if (!instance.riskVerified || !instance.freshDataVerified) {
        throw new Error(`[SAFETY CRITICAL] Order submission blocked! Risk gate or fresh data gate was skipped for ${instance.symbol}`);
      }
    }
    if (payload.newState === LifecycleState.PROTECTION_VERIFIED) {
      instance.protectionVerified = true;
    }
    if (payload.newState === LifecycleState.PROVIDER_RECONCILED) {
      instance.reconciled = true;
    }
    if (payload.newState === LifecycleState.AUDIT_COMPLETE) {
      if (!instance.riskVerified || !instance.freshDataVerified || !instance.protectionVerified || !instance.reconciled) {
        throw new Error(`[SAFETY CRITICAL] Audit complete rejected! Trade lifecycle bypassed one of [Risk, FreshData, Protection, Reconciliation] stages.`);
      }
    }

    instance.currentState = payload.newState;
    instance.history.push(payload.newState);
    instance.updatedAt = new Date();

    // Persist immutable audit log for every single transition
    await prisma.tradeLifecycleAudit.create({
      data: {
        correlationId: payload.correlationId,
        account: instance.account,
        provider: instance.provider,
        environment: instance.environment,
        strategy: instance.strategy,
        symbol: instance.symbol,
        previousState,
        newState: payload.newState,
        providerTimestamp: payload.providerTimestamp || null,
        sourceDataIds: payload.sourceDataIds || [],
        reason: payload.reason,
        errors: (payload.errors ?? undefined) as any,
        retryCount: payload.retryCount || 0,
        modelVersion: payload.modelVersion || '1.0.0',
        configVersion: payload.configVersion || '1.0.0',
        metadata: (payload.metadata ?? undefined) as any
      }
    });

    logger.info(`[LIFECYCLE ${instance.correlationId}] Transitioned: ${previousState} -> ${payload.newState} (${payload.reason})`);
    return instance;
  }

  static get(correlationId: string): LifecycleInstance | undefined {
    return activeLifecycles.get(correlationId);
  }

  static async getHistory(correlationId: string) {
    return prisma.tradeLifecycleAudit.findMany({
      where: { correlationId }
    });
  }
}
