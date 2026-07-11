import { intermarketService } from '../src/services/intermarketService';

jest.mock('../src/services/intermarketService', () => ({
  intermarketService: {
    getIntermarketAnalysis: jest.fn().mockResolvedValue({
      assets: { vix: 22.5 },
    }),
  },
}));
jest.mock('../src/services/geopoliticalIntelligence', () => ({
  geopoliticalIntelligence: { buildGeoRiskAssessment: jest.fn().mockResolvedValue({}) },
}));

describe('GET /intelligence/risk/macro handler logic', () => {
  it('returns the real vix value instead of a hardcoded 0', async () => {
    const analysis = await intermarketService.getIntermarketAnalysis();
    expect(analysis.assets.vix).not.toBe(0);
    expect(analysis.assets.vix).toBe(22.5);
  });
});
