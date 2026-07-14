describe('daily loss limit default consistency', () => {
  it('debateEngine.ts and riskManager.ts use the same fallback default', () => {
    const fs = require('fs');
    const path = require('path');
    const debateSrc = fs.readFileSync(path.join(__dirname, '../src/agents/debateEngine.ts'), 'utf-8');
    const riskSrc = fs.readFileSync(path.join(__dirname, '../src/trading/riskManager.ts'), 'utf-8');

    const debateMatch = debateSrc.match(/DAILY_LOSS_LIMIT_PCT["']?\s*\|\|\s*["'](\d+)["']/);
    const riskMatch = riskSrc.match(/DAILY_LOSS_LIMIT_PCT["']?\s*\|\|\s*["'](\d+)["']/);

    expect(debateMatch).not.toBeNull();
    expect(riskMatch).not.toBeNull();
    expect(debateMatch![1]).toBe(riskMatch![1]);
  });
});
