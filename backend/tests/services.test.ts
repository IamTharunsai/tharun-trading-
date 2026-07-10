// ═══════════════════════════════════════════════════════════════════════════
// SMOKE TESTS - Verify All Services Can Be Imported and Called
// ═══════════════════════════════════════════════════════════════════════════

describe('Service Imports', () => {
  it('should import intermarketService', () => {
    const { intermarketService } = require('../src/services/intermarketService');
    expect(intermarketService).toBeDefined();
  });

  it('should import correlationService', () => {
    const { correlationService } = require('../src/services/correlationService');
    expect(correlationService).toBeDefined();
  });

  it('should import optionsFlowService', () => {
    const { optionsFlowService } = require('../src/services/optionsFlowService');
    expect(optionsFlowService).toBeDefined();
  });
});

describe('Service Methods', () => {
  it('intermarketService should have getIntermarketAnalysis method', () => {
    const { intermarketService } = require('../src/services/intermarketService');
    expect(typeof intermarketService.getIntermarketAnalysis).toBe('function');
  });
});
