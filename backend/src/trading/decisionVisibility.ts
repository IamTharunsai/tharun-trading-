import type { Prisma } from '@prisma/client';

/** Account-bound held research must not enter legacy global entry feeds/memory. */
export function entryDecisionWhere(extra: Prisma.AgentDecisionWhereInput = {}): Prisma.AgentDecisionWhereInput {
  return { AND: [extra, { OR: [{ horizon: { not: 'POSITION_REVIEW' } }, { horizon: null }] }] };
}
