import { buildMacroData } from '../src/routes/intelligence';
import type { IntermarketData } from '../src/services/intermarketService';

describe('buildMacroData response shaping', () => {
  it('extracts vixLevel from analysis.assets.vix and wires other fields correctly', () => {
    // Create a mock analysis object with just the fields needed for testing
    const mockAnalysis: Partial<IntermarketData> = {
      assets: {
        dxy: 0,
        sp500: 0,
        nasdaq: 0,
        russell2000: 0,
        dxyCrypto: 0,
        dxyBonds: 0,
        oilEnergy: 0,
        stocksBonds: 0,
        stocksGold: 0,
        vix: 22.5, // The critical value from the fix
        treasuryYield10Y: 0,
        treasuryYield2Y: 0,
        treasuryYield5Y: 0,
        yield_curve: 0,
      },
    };

    const result = buildMacroData(mockAnalysis as IntermarketData);

    // Verify the fix: vixLevel is read from the correct path
    expect(result.vixLevel).toBe(22.5);
    expect(result.vixLevel).not.toBe(0);

    // Verify other fields are wired correctly
    expect(result.fedRate).toBeNull();
    expect(result.inflation).toBeNull();
    expect(result.unemployment).toBeNull();
    expect(result.usdEurRate).toBeNull();

    // Verify the note is present
    expect(result.note).toBeDefined();
    expect(typeof result.note).toBe('string');
    expect(result.note.length).toBeGreaterThan(0);
  });
});
