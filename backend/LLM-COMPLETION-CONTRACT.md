# Provider completion boundary

The committee must distinguish a successful HTTP request, a complete text answer, and an answer accepted by its domain schema. None establishes forecast accuracy or authorizes an order.

The router accepts only a final text completion: OpenAI-compatible `finish_reason=stop`, or Anthropic `stop_reason=end_turn`. Truncation, refusal, unexpected tools, missing/unknown completion reasons, non-text/empty output and incomplete reasoning tags are failures. Contract failures do not create new fallback attempts. Existing transport fallback remains separate.

One shared abort deadline covers the router's complete fallback chain and SDK waits. `LLM_TIMEOUT_MS` defaults to 60 seconds and is capped at 120 seconds; invalid values use the default. A caller's earlier cancellation is preserved and cannot start a fallback. Committee-level rate-limit retry admission is still a separate layer; held-position review retains its caller deadline.

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
