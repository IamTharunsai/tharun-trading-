// Anthropic responses aren't guaranteed to put the text block first — assuming
// content[0] is text broke silently (wrong data, or a swallowed crash) in the
// debate engine, Polymarket analysis, journal generator, and self-learning
// service, all independently. One place to get it right.
export function extractResponseText(content: Array<{ type: string; text?: string }>): string {
  const block = content.find(c => c.type === 'text');
  if (!block?.text) throw new Error('No text content block in Anthropic response');
  return block.text;
}
