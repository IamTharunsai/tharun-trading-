// ═══════════════════════════════════════════════════════════════════════════
// SMOKE TESTS - Verify All Services Can Be Imported and Called
// ═══════════════════════════════════════════════════════════════════════════

describe('Service Imports', () => {
  it('should import sectorRotationService', () => {
    const { sectorRotationService } = require('../src/services/sectorRotationService');
    expect(sectorRotationService).toBeDefined();
  });

  it('should import intermarketService', () => {
    const { intermarketService } = require('../src/services/intermarketService');
    expect(intermarketService).toBeDefined();
  });

  it('should import sentimentService', () => {
    const { sentimentService } = require('../src/services/sentimentService');
    expect(sentimentService).toBeDefined();
  });

  it('should import socialMediaService', () => {
    const { socialMediaService } = require('../src/services/socialMediaService');
    expect(socialMediaService).toBeDefined();
  });

  it('should import premarketService', () => {
    const { premarketService } = require('../src/services/premarketService');
    expect(premarketService).toBeDefined();
  });

  it('should import regimeTransitionService', () => {
    const { regimeTransitionService } = require('../src/services/regimeTransitionService');
    expect(regimeTransitionService).toBeDefined();
  });

  it('should import liquidityService', () => {
    const { liquidityService } = require('../src/services/liquidityService');
    expect(liquidityService).toBeDefined();
  });

  it('should import earningsService', () => {
    const { earningsService } = require('../src/services/earningsService');
    expect(earningsService).toBeDefined();
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
  it('sectorRotationService should have getSectorRotation method', () => {
    const { sectorRotationService } = require('../src/services/sectorRotationService');
    expect(typeof sectorRotationService.getSectorRotation).toBe('function');
  });

  it('intermarketService should have getIntermarketAnalysis method', () => {
    const { intermarketService } = require('../src/services/intermarketService');
    expect(typeof intermarketService.getIntermarketAnalysis).toBe('function');
  });

  it('sentimentService should have analyzeSentiment method', () => {
    const { sentimentService } = require('../src/services/sentimentService');
    expect(typeof sentimentService.analyzeSentiment).toBe('function');
  });

  it('socialMediaService should have getSocialMediaMetrics method', () => {
    const { socialMediaService } = require('../src/services/socialMediaService');
    expect(typeof socialMediaService.getSocialMediaMetrics).toBe('function');
  });

  it('premarketService should have getPremarketAnalysis method', () => {
    const { premarketService } = require('../src/services/premarketService');
    expect(typeof premarketService.getPremarketAnalysis).toBe('function');
  });

  it('regimeTransitionService should have getRegimeTransition method', () => {
    const { regimeTransitionService } = require('../src/services/regimeTransitionService');
    expect(typeof regimeTransitionService.getRegimeTransition).toBe('function');
  });
});
