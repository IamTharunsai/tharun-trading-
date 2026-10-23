/**
 * seedQualification.ts (entry-point wrapper)
 * Seeds StrategyQualification records for BHISHMA_COUNCIL and BHISHMA_POLYMARKET_US.
 * Run via: npx ts-node scripts/seedQualification.ts
 * Or triggered via POST /api/admin/seed-qualification (owner-only).
 *
 * The actual implementation lives in src/scripts/seedQualification.ts
 * so it is within the TypeScript rootDir and can be imported by routes.
 */
export { seedQualification, seedAllStrategies, STRATEGY_KEYS } from '../src/scripts/seedQualification';

// Run directly
if (require.main === module) {
  const { seedAllStrategies: run } = require('../src/scripts/seedQualification');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  run()
    .then((r: unknown) => {
      console.log('\n✅ Done:', JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('❌ Failed:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
