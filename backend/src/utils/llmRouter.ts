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
import { randomUUID } from 'crypto';
import { logger } from './logger';
import { AdmissionReceipt, LlmAdmissionError, llmAdmission } from './llmAdmission';

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
export function toOpenAiChat(params: any, model: string, provider?: LlmProvider, structured = false) {
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
    // NVIDIA documents these body fields for these exact models. Do not forward
    // them to unrelated compatible endpoints or change ordinary chat sampling.
    ...(structured && provider === 'nvidia' && NEMOTRON_MODELS.has(model) ? {
      temperature: 1, top_p: 0.95,
      chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true },
    } : {}),
  };
}

// ── health tracking (surfaced on /api/system/status) ──────────────────────────
const NEMOTRON_MODELS = new Set(['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-ultra-550b-a55b']);
export type CompletionCode = 'truncated' | 'refused' | 'unexpected_tools' | 'malformed_envelope' | 'empty' | 'incomplete_reasoning' | 'invalid_json' | 'schema_invalid';
const SAFE_ERROR_CODES = new Set<CompletionCode>(['truncated', 'refused', 'unexpected_tools', 'malformed_envelope', 'empty', 'incomplete_reasoning', 'invalid_json', 'schema_invalid']);
class CompletionError extends Error {
  constructor(readonly code: CompletionCode) { super(code); }
}
export interface LlmRequestOptions {
  signal?: AbortSignal;
  /** Internal monotonic deadline, shared by caller retry attempts; never from HTTP input. */
  deadlineAt?: number;
  /** Authoritative caller guard, rechecked after waiting and before each dispatch. */
  beforeDispatch?: (signal: AbortSignal) => Promise<void> | void;
  structured?: boolean;
  /** The caller's domain schema remains authoritative. Never log thrown details. */
  validateText?: (text: string) => void;
  context?: { debateId: string; entryPoint: 'committee' | 'position_review' };
}
export interface LlmTextResponse {
  content: Array<{ type: 'text'; text: string }>;
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  provider: LlmProvider;
  model: string;
  completion: { finishReason: 'stop' | 'end_turn'; validation: 'text' | 'json' | 'schema' };
}
interface ProviderHealth {
  ok: number; fail: number; lastAccepted: boolean; transportHealthy: boolean; completionHealthy: boolean | null;
  structuredHealthy: boolean | null; lastError?: string; lastErrorAt?: string; lastOkAt?: string;
}
const health: Record<string, ProviderHealth> = {};
function mark(provider: LlmProvider, model: string, ok: boolean, transported: boolean, completed: boolean, structured: boolean, err?: any) {
  const key = `${provider}/${model}`;
  // Configuration churn cannot grow this process-local diagnostic cache forever.
  if (!health[key] && Object.keys(health).length >= 64) delete health[Object.keys(health)[0]];
  const h = (health[key] ||= { ok: 0, fail: 0, lastAccepted: false, transportHealthy: false, completionHealthy: null, structuredHealthy: null });
  h.lastAccepted = ok;
  h.transportHealthy = transported;
  h.completionHealthy = transported ? completed : null;
  if (structured) h.structuredHealthy = ok;
  if (ok) { h.ok++; h.lastOkAt = new Date().toISOString(); }
  else { h.fail++; h.lastError = describeError(err); h.lastErrorAt = new Date().toISOString(); }
}
export function getLlmHealth() {
  const describe = (tier: LlmTier) => {
    const provider = providerFor(tier);
    const model = modelFor(tier);
    const h = health[`${provider}/${model}`];
    const healthy = !!h && h.lastAccepted && h.transportHealthy && h.completionHealthy === true && h.structuredHealthy !== false;
    return { provider, model, healthy, observed: !!h, transportHealthy: h?.transportHealthy ?? null,
      completionHealthy: h?.completionHealthy ?? null, structuredHealthy: h?.structuredHealthy ?? null,
      lastError: healthy ? null : h?.lastError || null };
  };
  return { fast: describe('fast'), smart: describe('smart'), providers: health,
    admission: { scope: 'process-local' as const, providers: llmAdmission.snapshot() } };
}

export function describeError(err: any): string {
  if (err instanceof LlmAdmissionError) return err.code;
  if (err instanceof CompletionError) return err.code;
  if (SAFE_ERROR_CODES.has(err?.code) || ['transport_error', 'timeout', 'aborted'].includes(err?.code)) return err.code;
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') return 'timeout';
  if (err?.name === 'AbortError' || err?.code === 'ERR_CANCELED') return 'aborted';
  return 'transport_error';
}

/** Errors worth trying the next provider for (vs. a bug in our own request). */
function isFailover(err: any): boolean {
  // Invalid answers do not spend another attempt. Domain repair/retry requires
  // separate admission/accounting and an absolute chain deadline.
  if (err instanceof CompletionError) return false;
  const status = err?.status ?? err?.response?.status;
  // Preserve existing quota/credit failover even when a provider puts its hint
  // only in a 400 body. Inspect bounded known string fields privately; never
  // serialize the body or reuse this hint as an error/log/status message.
  const body = err?.response?.data;
  const hints = [err?.message, body, body?.message, body?.code, body?.error,
    body?.error?.message, body?.error?.type, body?.error?.code];
  if (hints.some(value => typeof value === 'string' && /credit balance|quota|overloaded/i.test(value.slice(0, 2048)))) return true;
  if (!status) return true; // network / timeout
  return status === 401 || status === 402 || status === 403 || status === 404 || status === 410 || status === 429 || status >= 500;
}

let anthropicClient: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'missing-key' });
  return anthropicClient;
}

async function callOpenAiCompat(provider: LlmProvider, model: string, params: any, options: LlmRequestOptions) {
  const { baseUrl, apiKey } = endpoint(provider);
  if (!baseUrl) throw new Error(`LLM provider ${provider} has no base URL configured`);
  if (provider === 'nvidia' && !hasKey(apiKey)) throw new Error('NVIDIA_API_KEY not set');
  const res = await axios.post(`${baseUrl.replace(/\/$/, '')}/chat/completions`, toOpenAiChat(params, model, provider, options.structured), {
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    timeout: Math.max(1, Math.ceil(Math.min(requestTimeoutMs(), (options.deadlineAt ?? Infinity) - performance.now()))),
    signal: options.signal,
  });
  return res.data;
}

function requestTimeoutMs(): number {
  const configured = Number(process.env.LLM_TIMEOUT_MS || 60000);
  return Number.isSafeInteger(configured) && configured >= 1 ? Math.min(120000, configured) : 60000;
}
export function createLlmDeadline(): number { return performance.now() + requestTimeoutMs(); }
export interface AnthropicAttemptOptions { signal?: AbortSignal; maxRetries?: number; timeout?: number }

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function reportedUsage(provider: LlmProvider, data: any): LlmTextResponse['usage'] {
  return provider === 'anthropic' ? {
    input_tokens: tokenCount(data?.usage?.input_tokens), output_tokens: tokenCount(data?.usage?.output_tokens),
    cache_read_input_tokens: tokenCount(data?.usage?.cache_read_input_tokens), cache_creation_input_tokens: tokenCount(data?.usage?.cache_creation_input_tokens),
  } : { input_tokens: tokenCount(data?.usage?.prompt_tokens), output_tokens: tokenCount(data?.usage?.completion_tokens) };
}

function completeText(provider: LlmProvider, data: any): { text: string; finishReason: 'stop' | 'end_turn'; usage: LlmTextResponse['usage'] } {
  let raw: unknown;
  let finishReason: 'stop' | 'end_turn';
  if (provider === 'anthropic') {
    if (data?.stop_reason === 'refusal') throw new CompletionError('refused');
    if (data?.stop_reason === 'max_tokens' || data?.stop_reason === 'model_context_window_exceeded') throw new CompletionError('truncated');
    if (data?.stop_reason === 'tool_use' || (Array.isArray(data?.content) && data.content.some((block: any) => block?.type === 'tool_use' || block?.type === 'server_tool_use'))) throw new CompletionError('unexpected_tools');
    if (data?.stop_reason !== 'end_turn' || !Array.isArray(data?.content)) throw new CompletionError('malformed_envelope');
    if (data.content.some((block: any) => block?.type !== 'text' || typeof block?.text !== 'string')) throw new CompletionError('malformed_envelope');
    raw = data.content.map((block: any) => block.text).join('\n');
    finishReason = 'end_turn';
  } else {
    const choice = data?.choices?.[0];
    const message = choice?.message;
    if (choice?.finish_reason === 'length') throw new CompletionError('truncated');
    if (choice?.finish_reason === 'content_filter' || message?.refusal) throw new CompletionError('refused');
    if (choice?.finish_reason === 'tool_calls' || choice?.finish_reason === 'function_call' || message?.function_call
      || (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0)) throw new CompletionError('unexpected_tools');
    if (!Array.isArray(data?.choices) || data.choices.length !== 1 || choice?.finish_reason !== 'stop'
      || message?.role !== 'assistant' || typeof message?.content !== 'string'
      || (message.tool_calls != null && !Array.isArray(message.tool_calls))) throw new CompletionError('malformed_envelope');
    raw = message.content;
    finishReason = 'stop';
  }
  if (typeof raw !== 'string' || raw.length > 65536) throw new CompletionError('malformed_envelope');
  let thinking = false;
  for (const tag of raw.match(/<\/?think>/gi) || []) {
    if (tag.toLowerCase() === '<think>') {
      if (thinking) throw new CompletionError('incomplete_reasoning');
      thinking = true;
    } else {
      if (!thinking) throw new CompletionError('incomplete_reasoning');
      thinking = false;
    }
  }
  if (thinking) throw new CompletionError('incomplete_reasoning');
  const text = stripReasoning(raw);
  if (!text) throw new CompletionError('empty');
  return { text, finishReason, usage: reportedUsage(provider, data) };
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
export async function routedMessagesCreate(params: any, anthropicCreate?: (p: any, options?: AnthropicAttemptOptions) => Promise<any>, options: LlmRequestOptions = {}): Promise<LlmTextResponse> {
  options.signal?.throwIfAborted();
  // One deadline covers the existing fallback chain and SDK retry delays. A
  // later provider cannot reset it; caller cancellation still takes precedence.
  if (options.deadlineAt !== undefined && !Number.isFinite(options.deadlineAt)) throw new LlmAdmissionError('admission_config');
  const deadlineAt = Math.min(createLlmDeadline(), options.deadlineAt ?? Infinity);
  const remaining = Math.ceil(deadlineAt - performance.now());
  if (remaining <= 0) throw Object.assign(new Error('All LLM providers failed: timeout'), { code: 'timeout', status: 504 });
  const deadline = AbortSignal.timeout(remaining);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  let lastReportedUsage: { model: string; provider: LlmProvider; usage: LlmTextResponse['usage'] } | undefined;
  const timeoutError = () => Object.assign(new Error('All LLM providers failed: timeout'), { code: 'timeout', status: 504, reportedUsage: lastReportedUsage });
  const chain = attemptChain(params);
  const callId = randomUUID();
  const rateLimitedProviders = new Set<LlmProvider>();
  let lastErr: any;
  for (const [attemptIndex, { provider, model }] of chain.entries()) {
    options.signal?.throwIfAborted();
    if (deadline.aborted) throw timeoutError();
    if (rateLimitedProviders.has(provider)) continue;
    const started = Date.now();
    let transported = false, completed = false, dispatched = false;
    let admission: AdmissionReceipt | undefined;
    let completion: ReturnType<typeof completeText> | undefined;
    const context = options.context;
    // Only internally generated debate IDs and enumerated entry points cross
    // this boundary. Never serialize caller metadata or raw model identifiers.
    const correlation = context && /^debate_[0-9a-f-]{36}$/.test(context.debateId)
      && ['committee', 'position_review'].includes(context.entryPoint)
      ? { debateId: context.debateId, entryPoint: context.entryPoint } : {};
    let observedFinishReason: string | undefined;
    let observedCharacters: number | undefined;
    let inputTokens: number | undefined, outputTokens: number | undefined;
    const emit = (validationCode: string, err?: any) => {
      const status = err?.status ?? err?.response?.status;
      const metadata = { event: !dispatched ? 'llm_admission_refused' : validationCode === 'ok' ? 'llm_attempt_completed' : 'llm_attempt_refused', callId, ...correlation,
        provider, model: NEMOTRON_MODELS.has(model) || ['openai/gpt-oss-20b', 'claude-haiku-4-5-20251001', 'claude-sonnet-5'].includes(model) ? model : 'other',
        attemptIndex, validationCode, latencyMs: Math.max(0, Date.now() - started),
        dispatched, queueWaitMs: admission?.queueWaitMs, active: admission?.active, queued: admission?.queued,
        httpStatusClass: !dispatched ? undefined : transported ? '2xx' : Number.isInteger(status) && status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : undefined,
        retryAfterMs: err instanceof LlmAdmissionError ? err.retryAfterMs : undefined,
        retryAfterSource: err instanceof LlmAdmissionError ? err.retryAfterSource : undefined,
        requestedMaxTokens: tokenCount(params.max_tokens), contentCharacters: observedCharacters,
        finishReason: observedFinishReason, inputTokens, outputTokens };
      if (validationCode === 'ok') logger.info('llm_attempt_completed', metadata);
      else logger.warn(dispatched ? 'llm_attempt_refused' : 'llm_admission_refused', metadata);
    };
    try {
      const res = await llmAdmission.run(provider, signal, async () => {
        const result = provider === 'anthropic'
          ? await (anthropicCreate || ((p: any, requestOptions?: AnthropicAttemptOptions) => anthropic().messages.create(p, requestOptions)))({ ...params, model },
            { signal, maxRetries: 0, timeout: Math.max(1, Math.ceil(deadlineAt - performance.now())) })
          : await callOpenAiCompat(provider, model, params, { ...options, signal, deadlineAt });
        lastReportedUsage = { provider, model, usage: reportedUsage(provider, result) };
        return result;
      }, { beforeDispatch: options.beforeDispatch, onDispatch: receipt => { dispatched = true; admission = receipt; } });
      transported = true;
      lastReportedUsage = { provider, model, usage: reportedUsage(provider, res) };
      signal.throwIfAborted();
      const rawFinishReason = provider === 'anthropic' ? res?.stop_reason : res?.choices?.[0]?.finish_reason;
      observedFinishReason = ['stop', 'end_turn', 'length', 'max_tokens', 'model_context_window_exceeded', 'refusal', 'content_filter', 'tool_calls', 'function_call', 'tool_use', 'stop_sequence', 'pause_turn'].includes(rawFinishReason)
        ? rawFinishReason : 'unknown';
      inputTokens = tokenCount(provider === 'anthropic' ? res?.usage?.input_tokens : res?.usage?.prompt_tokens);
      outputTokens = tokenCount(provider === 'anthropic' ? res?.usage?.output_tokens : res?.usage?.completion_tokens);
      const rawText = provider === 'anthropic' ? undefined : res?.choices?.[0]?.message?.content;
      observedCharacters = typeof rawText === 'string' ? rawText.length : undefined;
      completion = completeText(provider, res);
      completed = true;
      if (options.structured || options.validateText) {
        try {
          if (options.validateText) options.validateText(completion.text);
          else JSON.parse(completion.text);
        } catch (err) {
          throw new CompletionError(err instanceof SyntaxError ? 'invalid_json' : 'schema_invalid');
        }
      }
      signal.throwIfAborted();
      mark(provider, model, true, transported, completed, !!options.validateText);
      emit('ok');
      return { content: [{ type: 'text', text: completion.text }], usage: completion.usage, provider, model,
        completion: { finishReason: completion.finishReason, validation: options.validateText ? 'schema' : options.structured ? 'json' : 'text' } };
    } catch (err: any) {
      if (options.signal?.aborted) { emit('aborted'); throw options.signal.reason; }
      if (deadline.aborted) {
        const err = timeoutError();
        if (dispatched) mark(provider, model, false, transported, completed, !!options.validateText, err);
        emit('timeout'); throw err;
      }
      if (dispatched) mark(provider, model, false, transported, completed, !!options.validateText, err);
      emit(describeError(err), err);
      lastErr = err;
      if (err instanceof LlmAdmissionError) {
        if (err.code !== 'rate_limited') break;
        rateLimitedProviders.add(provider);
      }
      if (!isFailover(err)) break;
    }
  }
  const e: any = new Error(`All LLM providers failed: ${describeError(lastErr)}`);
  e.status = lastErr?.status ?? lastErr?.response?.status;
  // Do not retain the raw HTTP error as cause: it may contain prompts, headers
  // and response bodies and be serialized by caller error logging.
  e.code = describeError(lastErr);
  if (lastErr instanceof LlmAdmissionError && lastErr.retryAfterMs !== undefined) e.retryAfterMs = lastErr.retryAfterMs;
  // Preserve finite reported usage for callers that previously accounted a
  // returned HTTP-200 response before rejecting its JSON/domain schema.
  e.reportedUsage = lastReportedUsage;
  throw e;
}

/** Convenience: one prompt in, plain text out. */
export async function llmText(opts: { tier?: LlmTier; system?: string; prompt: string; maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<string> {
  const res = await routedMessagesCreate({
    model: opts.tier === 'fast' ? 'fast' : 'smart',
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: opts.prompt }],
  }, undefined, { signal: opts.signal });
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
