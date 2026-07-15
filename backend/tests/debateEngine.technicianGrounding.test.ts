describe('Technician agent — anti-hallucination grounding', () => {
  it('systemPrompt instructs against unsupported historical/precise claims', () => {
    const { AGENT_ROSTER } = require('../src/agents/debateEngine');
    const technician = AGENT_ROSTER.find((a: any) => a.id === 1);
    expect(technician.systemPrompt).toMatch(/do not claim|never claim/i);
    expect(technician.systemPrompt).toMatch(/unless.*(directly supported|backed by|confirmed by)/i);
  });
});
