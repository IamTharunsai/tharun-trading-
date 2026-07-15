describe('buildAgentDecisionData', () => {
  it('uses the real number of voting agents, not a hardcoded 10', () => {
    const { __test__buildAgentDecisionData } = require('../src/agents/debateEngine');
    const finalVotes = Array.from({ length: 14 }, (_, i) => ({ agentId: i + 1, finalVote: 'BUY', confidence: 70 }));
    const data = __test__buildAgentDecisionData({
      asset: 'AAPL', finalDecision: 'BUY', finalConfidence: 72, blockReason: null,
      agentArguments: finalVotes, snapshot: { asset: 'AAPL', price: 150, priceChangePct24h: 1.2, indicators: { rsi14: 55 } },
      marketRegime: 'TRENDING_BULL', buyCount: 10, sellCount: 2, holdCount: 2,
    });
    expect(data.totalVotes).toBe(14);
  });

  it('includes the real market snapshot, not just {asset, price}', () => {
    const { __test__buildAgentDecisionData } = require('../src/agents/debateEngine');
    const data = __test__buildAgentDecisionData({
      asset: 'AAPL', finalDecision: 'BUY', finalConfidence: 72, blockReason: null,
      agentArguments: [], snapshot: { asset: 'AAPL', price: 150, priceChangePct24h: 1.2, indicators: { rsi14: 55 } },
      marketRegime: 'TRENDING_BULL', buyCount: 0, sellCount: 0, holdCount: 0,
    });
    expect(data.marketSnapshot).toEqual(expect.objectContaining({ asset: 'AAPL', price: 150, priceChangePct24h: 1.2, indicators: { rsi14: 55 } }));
  });

  it('records the regime the debate happened in', () => {
    const { __test__buildAgentDecisionData } = require('../src/agents/debateEngine');
    const data = __test__buildAgentDecisionData({
      asset: 'AAPL', finalDecision: 'BUY', finalConfidence: 72, blockReason: null,
      agentArguments: [], snapshot: { asset: 'AAPL', price: 150, priceChangePct24h: 1.2, indicators: { rsi14: 55 } },
      marketRegime: 'TRENDING_BULL', buyCount: 0, sellCount: 0, holdCount: 0,
    });
    expect(data.regime).toBe('TRENDING_BULL');
  });
});
