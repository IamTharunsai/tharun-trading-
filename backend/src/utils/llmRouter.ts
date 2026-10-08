// ── LLM ROUTER ────────────────────────────────────────────────────────────────
// One entry point for every LLM call in the backend. Lets each "tier" of agent
// run on a different provider WITHOUT changing the calling code, which is
// written against the Anthropic Messages API shape.
//
//   Tier  | used for                                  | env
//   ------|-------------------------------------------|-------------------------------
//   fast  | 13 specialist agents, cross-exam, votes   | LLM_PROVIDER_FAST, LLM_MODEL_FAST
//   smart | Master Coordinator, Polymarket estimator  | LLM_PROVIDER_SMART, LLM_MODEL_SMART
//
// Providers:
//   anthropic     — ANTHROPIC_API_KEY (supports prompt caching)
//   nvidia        — NVIDIA NIM hosted open models: NVIDIA_API_KEY, NVIDIA_BASE_URL
//                   (default https://integrate.api.nvidia.com/v1)
//   ollama        — local, free: OLLAMA_BASE_URL (default http://localhost:11434/v1)
//   openai_compat — any OpenAI-compatible server: OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_API_KEY
//
// Resilience: if the primary provider fails with a non-retryable error (out of
// credits, 4xx auth, model gone, 5xx overload, timeout) the call falls through
// a chain: primary → NVIDIA fallback model → Anthropic (if a key is set and it
// wasn't the primary). The Sept 2026 outage (Anthropic credits exhausted → all
// 14 agents errored → every debate defaulted to HOLD) cannot recur silently.
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';

export type LlmTier = 'fast' | 'smart';
export type LlmProvider = 'anthropic' | 'ollama' | 'nvidia' | 'openai_compat';

const DEFAULT_MODELS: Record<LlmProvider, Record<LlmTier, string>> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', smart: 'claude-sonnet-5' },
  nvidia: { fast: 'nvidia/nemotron-3-super-120b-a12b', smart: 'nvidia/nemotron-3-ultra-550b-a55b' },
  ollama: { fast: 'qwen2.5:14b-instruct', smart: 'qwen2.5:14b-instruct' },
  openai_compat: { fast: 'default', smart: 'default' },
};

/** Which tier a hard-coded model id in the code belongs to. */
export function tierForModel(model: string | undefined): LlmTier {
  return /haiku|fast|mini|flash|8b|super|lightning|nano/i.test(model || '') ? 'fast' : 'smart';
}

function hasKey(v: string | undefined): boolean {
  return Boolean(v && !/dummy|placeholder|your[-_]/i.test(v));
}

/** Provider for a tier. Explicit env wins; otherwise NVIDIA when its key exists, else Anthropic. */
export function providerFor(tier: LlmTier): LlmProvider {
  const raw = (tier === 'fast' ? process.env.LLM_PROVIDER_FAST : process.env.LLM_PROVIDER_SMART) || '';
  const p = raw.toLowerCase().trim();
  if (['anthropic', 'ollama', 'nvidia', 'openai_compat'].includes(p)) return p as LlmProvider;
  return hasKey(process.env.NVIDIA_API_KEY) && !hasKey(process.env.ANTHROPIC_API_KEY) ? 'nvidia' : 'anthropic';
}

export function modelFor(tier: LlmTier, requested?: string, provider: LlmProvider = providerFor(tier)): string {
  const override = tier === 'fast' ? process.env.LLM_MODEL_FAST : process.env.LLM_MODEL_SMART;
  if (override && provider === providerFor(tier)) return override;
  if (provider === 'anthropic') return requested && /claude/i.test(requested) ? requested : DEFAULT_MODELS.anthropic[tier];
  return DEFAULT_MODELS[provider][tier];
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

/** Reasoning models (Nemotron, DeepSeek, gpt-oss) may wrap chain-of-thought in <think> tags. */
export function stripReasoning(text: string): string {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
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

// ── health tracking (surfaced on /api/system/status) ──────────────────────────
interface ProviderHealth { ok: number; fail: number; lastError?: string; lastErrorAt?: string; lastOkAt?: string }
const health: Record<string, ProviderHealth> = {};
function mark(provider: string, ok: boolean, err?: any) {
  const h = (health[provider] ||= { ok: 0, fail: 0 });
  if (ok) { h.ok++; h.lastOkAt = new Date().toISOString(); }
  else { h.fail++; h.lastError = describeError(err).slice(0, 300); h.lastErrorAt = new Date().toISOString(); }
}
export function getLlmHealth() {
  const describe = (tier: LlmTier) => {
    const provider = providerFor(tier);
    const h = health[provider];
    const healthy = !h || !h.lastErrorAt || (h.lastOkAt ? h.lastOkAt > h.lastErrorAt : false);
    return { provider, model: modelFor(tier), healthy, lastError: h?.lastError || null };
  };
  return { fast: describe('fast'), smart: describe('smart'), providers: health };
}

export function describeError(err: any): string {
  const data = err?.response?.data;
  if (data) return typeof data === 'string' ? data : JSON.stringify(data);
  return err?.message || String(err);
}

/** Errors worth trying the next provider for (vs. a bug in our own request). */
function isFailover(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  const msg = describeError(err).toLowerCase();
  if (msg.includes('credit balance') || msg.includes('quota') || msg.includes('overloaded')) return true;
  if (!status) return true; // network / timeout
  return status === 401 || status === 402 || status === 403 || status === 404 || status === 410 || status === 429 || status >= 500;
}

let anthropicClient: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'missing-key' });
  return anthropicClient;
}

async function callOpenAiCompat(provider: LlmProvider, model: string, params: any, signal?: AbortSignal) {
  const { baseUrl, apiKey } = endpoint(provider);
  if (!baseUrl) throw new Error(`LLM provider ${provider} has no base URL configured`);
  if (provider === 'nvidia' && !hasKey(apiKey)) throw new Error('NVIDIA_API_KEY not set');
  const res = await axios.post(`${baseUrl.replace(/\/$/, '')}/chat/completions`, toOpenAiChat(params, model), {
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    timeout: Number(process.env.LLM_TIMEOUT_MS || 60000),
    signal,
  });
  const text = stripReasoning(res.data?.choices?.[0]?.message?.content ?? '');
  if (!text) throw Object.assign(new Error(`${provider}/${model} returned empty content`), { status: 502 });
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

type Attempt = { provider: LlmProvider; model: string };

/** The ordered list of (provider, model) pairs to try for a request. */
export function attemptChain(params: any): Attempt[] {
  const tier = tierForModel(params.model);
  const primary = providerFor(tier);
  const chain: Attempt[] = [{ provider: primary, model: modelFor(tier, params.model, primary) }];
  if (hasKey(process.env.NVIDIA_API_KEY)) {
    const nvFallback = process.env.LLM_FALLBACK_MODEL || 'openai/gpt-oss-20b';
    if (primary !== 'nvidia') chain.push({ provider: 'nvidia', model: modelFor(tier, undefined, 'nvidia') });
    if (!chain.some(a => a.provider === 'nvidia' && a.model === nvFallback)) chain.push({ provider: 'nvidia', model: nvFallback });
  }
  if (primary !== 'anthropic' && hasKey(process.env.ANTHROPIC_API_KEY)) {
    chain.push({ provider: 'anthropic', model: DEFAULT_MODELS.anthropic[tier] });
  }
  return chain;
}

/**
 * Anthropic-compatible `messages.create` that routes to the configured provider
 * and fails over down the chain. `anthropicCreate` can be injected for tests.
 */
export async function routedMessagesCreate(params: any, anthropicCreate?: (p: any, options?: { signal?: AbortSignal }) => Promise<any>, options: { signal?: AbortSignal } = {}): Promise<any> {
  options.signal?.throwIfAborted();
  const chain = attemptChain(params);
  let lastErr: any;
  for (const { provider, model } of chain) {
    options.signal?.throwIfAborted();
    try {
      const res = provider === 'anthropic'
        ? await (anthropicCreate || ((p: any, requestOptions?: { signal?: AbortSignal }) => anthropic().messages.create(p, requestOptions)))({ ...params, model }, options)
        : await callOpenAiCompat(provider, model, params, options.signal);
      options.signal?.throwIfAborted();
      mark(provider, true);
      if (provider === 'anthropic') return { ...res, provider: 'anthropic', model };
      return res;
    } catch (err: any) {
      if (options.signal?.aborted) throw options.signal.reason;
      mark(provider, false, err);
      lastErr = err;
      if (!isFailover(err)) break;
    }
  }
  const e: any = new Error(`All LLM providers failed: ${describeError(lastErr)}`);
  e.status = lastErr?.status ?? lastErr?.response?.status;
  e.cause = lastErr;
  throw e;
}

/** Convenience: one prompt in, plain text out. */
export async function llmText(opts: { tier?: LlmTier; system?: string; prompt: string; maxTokens?: number; temperature?: number }): Promise<string> {
  const res = await routedMessagesCreate({
    model: opts.tier === 'fast' ? 'fast' : 'smart',
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: opts.prompt }],
  });
  const block = (res.content || []).find((c: any) => c.type === 'text');
  return stripReasoning(block?.text || '');
}

/** Pull the first JSON object out of a model reply (handles ```json fences and prose). */
export function parseJsonLoose<T = any>(text: string): T | null {
  const clean = stripReasoning(text).replace(/```json\s*|```/g, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
}
