// Anthropic responses aren't guaranteed to put the text block first — assuming
// content[0] is text broke silently (wrong data, or a swallowed crash) in the
// debate engine, Polymarket analysis, journal generator, and self-learning
// service, all independently. One place to get it right.
export function extractResponseText(content: Array<{ type: string; text?: string }>): string {
  const block = content.find(c => c.type === 'text');
  if (!block?.text) throw new Error('No text content block in Anthropic response');
  return block.text;
}

// One retry with a short backoff — for the once-a-night/week crons
// (journal, weekly report) where a single transient API blip previously
// meant losing that day's entry silently with no second chance.
export async function withRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 3000): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === attempts - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}
