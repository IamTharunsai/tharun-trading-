// ── LLM ROUTER ────────────────────────────────────────────────────────────────
// Lets each "tier" of agent run on a different provider WITHOUT changing the
// debate code, which is written against the Anthropic Messages API shape.
//
//   Tier  | used for                                  | env
//   ------|-------------------------------------------|-------------------------------
//   fast  | 13 specialist agents, cross-exam, votes   | LLM_PROVIDER_FAST, LLM_MODEL_FAST
//   smart | Master Coordinator, Polymarket estimator  | LLM_PROVIDER_SMART, LLM_MODEL_SMART
//
// Providers:
//   anthropic — ANTHROPIC_API_KEY (default; supports prompt caching)
//   ollama    — local, free: OLLAMA_BASE_URL (default http://localhost:11434/v1), e.g. qwen2.5:14b, llama3.1:8b
//   nvidia    — NVIDIA NIM hosted open models: NVIDIA_API_KEY, NVIDIA_BASE_URL
//               (default https://integrate.api.nvidia.com/v1), e.g. meta/llama-3.1-70b-instruct
//   openai_compat — any OpenAI-compatible server: OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_API_KEY
//
// Ollama and NVIDIA speak the OpenAI /chat/completions protocol, so we translate
// the Anthropic-shaped request and return an Anthropic-shaped response
// ({ content: [{ type: 'text', text }], usage }).
import axios from 'axios';

export type LlmTier = 'fast' | 'smart';
export type LlmProvider = 'anthropic' | 'ollama' | 'nvidia' | 'openai_compat';

const DEFAULT_MODELS: Record<LlmTier, string> = {
  fast: 'claude-haiku-4-5-20251001',
  smart: 'claude-sonnet-5',
};

/** Which tier a hard-coded model id in the code belongs to. */
export function tierForModel(model: string): LlmTier {
  return /haiku|fast|mini|flash|8b/i.test(model) ? 'fast' : 'smart';
}

export function providerFor(tier: LlmTier): LlmProvider {
  const raw = (tier === 'fast' ? process.env.LLM_PROVIDER_FAST : process.env.LLM_PROVIDER_SMART) || 'anthropic';
  const p = raw.toLowerCase().trim();
  return (['anthropic', 'ollama', 'nvidia', 'openai_compat'].includes(p) ? p : 'anthropic') as LlmProvider;
}

export function modelFor(tier: LlmTier, requested?: string): string {
  const override = tier === 'fast' ? process.env.LLM_MODEL_FAST : process.env.LLM_MODEL_SMART;
  if (override) return override;
  // Only keep the in-code Anthropic model id when the provider is Anthropic.
  return providerFor(tier) === 'anthropic' ? (requested || DEFAULT_MODELS[tier]) : (
    providerFor(tier) === 'ollama' ? 'qwen2.5:14b-instruct' : 'meta/llama-3.1-70b-instruct'
  );
}

function endpoint(provider: LlmProvider): { baseUrl: string; apiKey?: string } {
  switch (provider) {
    case 'ollama':
      return { baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1' };
    case 'nvidia':
      return { baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1', apiKey: process.env.NVIDIA_API_KEY };
    default:
      return { baseUrl: process.env.OPENAI_COMPAT_BASE_URL || '', apiKey: process.env.OPENAI_COMPAT_API_KEY };
  }
}

function flattenContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => (typeof c === 'string' ? c : c?.text || '')).join('\n');
  return '';
}

/** Translate an Anthropic Messages request into an OpenAI chat request. */
export function toOpenAiChat(params: any, model: string) {
  const messages: Array<{ role: string; content: string }> = [];
  const system = flattenContent(params.system);
  if (system) messages.push({ role: 'system', content: system });
  for (const m of params.messages || []) messages.push({ role: m.role, content: flattenContent(m.content) });
  return {
    model,
    messages,
    max_tokens: params.max_tokens,
    temperature: params.temperature ?? 0.3,
    stream: false,
  };
}

/**
 * Anthropic-compatible `messages.create` that routes to the configured provider.
 * `anthropicCreate` is the real Anthropic SDK call (injected to keep this testable).
 */
export async function routedMessagesCreate(params: any, anthropicCreate: (p: any) => Promise<any>): Promise<any> {
  const tier = tierForModel(params.model);
  const provider = providerFor(tier);
  const model = modelFor(tier, params.model);
  if (provider === 'anthropic') return anthropicCreate({ ...params, model });

  const { baseUrl, apiKey } = endpoint(provider);
  if (!baseUrl) throw new Error(`LLM provider ${provider} has no base URL configured`);
  const res = await axios.post(`${baseUrl.replace(/\/$/, '')}/chat/completions`, toOpenAiChat(params, model), {
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    timeout: Number(process.env.LLM_TIMEOUT_MS || 120000),
  });
  const text = res.data?.choices?.[0]?.message?.content ?? '';
  return {
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: res.data?.usage?.prompt_tokens || 0,
      output_tokens: res.data?.usage?.completion_tokens || 0,
    },
    model,
    provider,
  };
}
