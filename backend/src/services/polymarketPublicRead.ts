import { LlmAdmission } from '../utils/llmAdmission';

// Reuse the transport admission primitive with a SEPARATE instance: no shared
// LLM capacity or health. All unauthenticated US gateway reads share this bucket.
// Four starts/s leaves headroom below the documented25/s shared-IP ceiling.
const admission = new LlmAdmission(() => ({ maxActive: 2, maxQueued: 16, maxWaitMs: 5000, intervalMs: 250 }));
export async function polymarketPublicRead<T>(operation: () => Promise<T>): Promise<T> {
  // The SDK has its own10s timeout. An abort-ignoring SDK retains its physical
  // permit until settlement. No cached quote and no automatic order retries.
  return admission.run('openai_compat', AbortSignal.timeout(15000), operation);
}
