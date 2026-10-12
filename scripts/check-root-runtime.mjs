// Import runtime dependencies and construct the generated client without opening
// a database connection, starting the scheduler, or submitting any orders.
import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { PolymarketUS } from 'polymarket-us';

assert.equal(typeof PolymarketUS, 'function', 'Polymarket US SDK must resolve from the root package');
const models = Prisma.dmmf.datamodel.models;
for (const name of ['Position', 'ExecutionIntent', 'PositionExit', 'StrategyQualification', 'PositionResearch', 'PredictionExecution', 'PredictionAccountAuthority']) {
  assert.ok(models.some(model => model.name === name), `Generated client is missing ${name}`);
}
const scope = models.find(model => model.name === 'Position').fields.find(field => field.name === 'scopeKey');
assert.equal(scope.isRequired, false, 'Legacy positions must survive without fabricated account scope');
const client = new PrismaClient();
assert.ok(client.position && client.executionIntent && client.positionExit);
await client.$disconnect();
console.log('Root runtime dependencies and current Prisma models verified without a database connection.');
