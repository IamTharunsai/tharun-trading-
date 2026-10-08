import { parsePredictionAssessment } from '../src/services/predictionAssessment';
const valid = { ourProbabilityYes: 0.6, confidence: 70, recommendedSide: 'YES', reasoning: 'Fixture research only' };
test.each([{ ourProbabilityYes: 1.1 }, { ourProbabilityYes: NaN }, { confidence: 101 }, { confidence: Infinity }, { recommendedSide: 'BUY' }, { reasoning: '' }, { riskFactors: ['valid', 42] }])('malformed assessments are refused: %j', invalid => {
  expect(parsePredictionAssessment({ ...valid, ...invalid })).toBeNull();
});
test('untrusted model edge and Kelly fields are not accepted as calculated evidence', () => {
  expect(parsePredictionAssessment({ ...valid, edge: 100, kellyFraction: 1 })).toEqual({ ...valid, riskFactors: [] });
});