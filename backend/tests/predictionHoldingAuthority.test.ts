import { assertPredictionFillsReflected } from '../src/trading/predictionAuthority';

const scopeKey = 'fixture-grant';
const opening = { id: 'opening', ownerId: 'owner', credentialScopeKey: scopeKey, marketSlug: 'market', side: 'YES',
  appliedQuantity: 5, appliedNotional: 2.5, appliedFees: .1 };
const holding = { ownerId: 'owner', credentialScopeKey: scopeKey, marketSlug: 'market', side: 'YES',
  openingQuantity: 5, openingNotional: 2.5, openingFees: .1, remainingQuantity: 2 };
const snapshot = (positions: Record<string, any>) => ({ scopeKey, identity: 'fixture', observedAt: Date.now(),
  cash: 100, buyingPower: 100, positions, openOrders: [] });
const tx = (fill: any, held: any) => ({ predictionExecution: { findMany: async () => [fill] },
  predictionHolding: { findUnique: async () => held } });

test.each(['YES', 'NO'])('%s current broker quantity must reflect linked remaining ownership, not historical gross fill', async side => {
  const db = tx({ ...opening, side }, { ...holding, side });
  await expect(assertPredictionFillsReflected(db, snapshot({ market: { netPositionDecimal: side === 'YES' ? '2' : '-2' } }))).resolves.toBeUndefined();
  await expect(assertPredictionFillsReflected(db, snapshot({ market: { netPositionDecimal: side === 'YES' ? '5' : '-5' } }))).rejects.toThrow('reconciled');
});
test('a missing broker position is explained only by a fully linked reduction', async () => {
  await expect(assertPredictionFillsReflected(tx(opening, { ...holding, remainingQuantity: 0 }), snapshot({}))).resolves.toBeUndefined();
  await expect(assertPredictionFillsReflected(tx(opening, null), snapshot({}))).rejects.toThrow('reconciled');
});
test('opening basis corrections require review before a remaining holding can authorize account evidence', async () => {
  await expect(assertPredictionFillsReflected(tx({ ...opening, appliedFees: .2 }, holding),
    snapshot({ market: { netPositionDecimal: '2' } }))).rejects.toThrow('basis');
});
