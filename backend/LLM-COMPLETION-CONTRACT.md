# Provider completion boundary

The committee must distinguish a successful HTTP request, a complete text answer, and an answer accepted by its domain schema. None establishes forecast accuracy or authorizes an order.

The router accepts only a final text completion: OpenAI-compatible `finish_reason=stop`, or Anthropic `stop_reason=end_turn`. Truncation, refusal, unexpected tools, missing/unknown completion reasons, non-text/empty output and incomplete reasoning tags are failures. Contract failures do not create new fallback attempts. Existing transport fallback remains separate.

One shared abort deadline covers admission wait, the router's complete fallback chain and validation. `LLM_TIMEOUT_MS` defaults to 60 seconds and is capped at 120 seconds; invalid values use the default. A caller's earlier cancellation is preserved and cannot start a fallback. Committee429 retry reuses the original logical-call deadline; held-position review retains its earlier caller signal. Anthropic SDK retries are disabled per request so physical attempts pass admission. Prediction research's routed45s timeout now aborts work; its separate direct Gemini path remains outside this repair.

Admission is shared across tiers/models within each fixed provider bucket in this process. Defaults are2 active requests,32 queued and30s maximum admission wait; NVIDIA starts are additionally at least2s apart. These are conservative local controls, not a verified provider/account quota. Validated optional configuration bounds: `LLM_ADMISSION_MAX_ACTIVE`1..8, `LLM_ADMISSION_MAX_QUEUED`0..64, `LLM_ADMISSION_MAX_WAIT_MS`1..60000 and `LLM_ADMISSION_NVIDIA_INTERVAL_MS`0..60000. No production variable is changed. Other routed providers retain zero start spacing but finite active/queue bounds.

A429 preserves normalized Retry-After seconds/HTTP-date as a provider cooldown; missing/malformed hints use15s. Valid long hints are not shortened to fit a waiting call. Same-provider model fallback is skipped only after429; configured different-provider fallback and existing non429 transport fallback remain. Queued cancellation removes the waiter immediately. A deadline can return to the caller while an abort-ignoring transport/guard still holds its slot; it is released only upon actual settlement. Admission refusal is separate from observed provider transport/completion health. Safe process-local admission counters are included in health readback, without credentials, URLs or prompts.

Optional authoritative caller guards recheck budget/lease after waiting and immediately before transport. The admission gate does not infer spending authority. There is no distributed quota, durable cooldown, global reservation ledger or guarantee against other clients/replicas/provider throttling. Delayed generations settling after the caller has already returned can still have unknown cost; retained active slots prevent unbounded overlap, not remote billing. Existing market-evidence freshness and decision/financial authority checks remain necessary.

Committee calls explicitly request structured intent and pass their existing response validators to the router. JSON parsing and Zod acceptance happen before recording successful structured research. The existing downstream validation remains in place. Invalid JSON and invalid domain schema use distinct fixed diagnostic codes. There is no silent JSON repair or acceptance of partial JSON.

Other JSON consumers must opt in with their own domain validator. Text completion alone does not establish acceptance of an intraday, prediction-market or other financial schema.

Only the exact NVIDIA-hosted Nemotron Super and Ultra identifiers receive their documented sampling and nested reasoning-off controls for structured committee calls. Token caps remain caller-selected; this does not increase budgets or retry count. The router does not presume global hosted `response_format` support.

Health is tracked by provider and model. A successful fallback does not clear the failed primary model. An unobserved model is unknown and cannot display healthy. Transport, completion and caller-schema acceptance are separate states; ordinary chat cannot clear a previous caller-schema rejection. `structuredHealthy` records the caller's domain-validator result. JSON-only calls without that validator do not establish domain acceptance.

Diagnostic events contain generated call identifiers, bounded caller context, fixed provider/model categories, attempt index, completion code, token counts when actually reported, character count and latency. They do not contain prompts, replies, reasoning, provider error bodies, URLs, headers or credentials. Counts with absent/invalid provider usage remain unknown. Existing daily-spend accounting does not reserve every transport/fallback attempt; this repair does not certify it as a complete spending limit.

Refused HTTP-200 responses retain normalized reported usage in their sanitized error. The committee accounts that observed generation once, preserving the tally that previously ran before its downstream schema rejection. Missing provider usage and transport failures still cannot establish actual cost.

Official references checked for this change:

- [NVIDIA Super sampling and chat template controls](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b), API Client / Reasoning OFF. `extra_body` in its Python SDK example adds raw HTTP body fields; Axios sends `chat_template_kwargs` directly.
- [NVIDIA Ultra sampling and chat template controls](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-ultra-550b-a55b), API Client / Reasoning OFF.
- [Anthropic stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons): `end_turn` is natural completion; `max_tokens` is truncation; tool use and refusal require different handling.
- [Node AbortSignal composition](https://nodejs.org/api/globals.html#static-method-abortsignalanysignals), available since Node 20.3/18.17, composes the caller signal with the shared deadline on the deployed Node 22/24 runtimes.

These references establish protocol controls. They do not prove the cause of any historical failure or the financial quality of a future answer. Actual production completion codes must identify the next failure.
