# Bhishma research services

These are separate research runtimes for the existing Bhishma backend. The connection is frontend (`incredible-embrace`) → backend (`artistic-imagination`) → research services (`Bhishma research`). Service credentials belong only to the backend and the corresponding research service. No broker keys, production database access, JWT signing key or financial execution authority are admitted into a research worker.

## Deployment and contracts

Each service uses its own Dockerfile, a single Railway replica and a `/data` volume. The runtime initializes that directory and permanently drops to UID/GID 10001. The gateway disables process inspection before launching lower-trust workers. Configure a unique, random `RESEARCH_SERVICE_KEY` of at least 32 characters. Configure `PORT=8080`, `RESEARCH_STATE=/data` and the corresponding `RAILWAY_DOCKERFILE_PATH`. Do not copy `.env` files or pass secrets as Docker build arguments.

Source commits and licenses are recorded in [pins.json](pins.json). Frozen upstream lockfiles supply dependencies. Docker builds fetch and verify exact commits. Images retain upstream licenses; the original MiroFish source is available at its pinned public commit, and this public directory supplies the integration source. Source pinning and focused contract review are not a full upstream security certification.

| Endpoint | Authentication | Meaning |
|---|---|---|
| `GET /health` | Public | Gateway process liveness; does not prove provider or research behavior |
| `GET /v1/status` | Service bearer key | Configured source, capabilities and explicit blockers; no model request |
| `GET /v1/ready` | Service bearer key | Same configuration checks; 503 while blocked |
| `POST /v1/research` | Service bearer key | Exactly `{question,evidence}`; actual research result or a visible error |

Configuration readiness is not a functional certification. Deployment acceptance also requires a real authenticated request and an inspected result. Only the owner can reach the backend routes `GET /api/system/research-services` and `POST /api/system/research-services/:service`. Results are untrusted evidence and cannot authorize trades or alter risk limits.

The common gateway has an absolute 10-second HTTP input deadline, bounded connection slots, one active research job, response limits and a persisted allowance of 16 admitted jobs per UTC day, including failures. There is no automatic order loop, automatic financial flag activation, or retry of uncertain research submissions. A child and its process group are killed at the job deadline. Only the protected provider subprocess receives the NVIDIA credential after its process-inspection protection is established; Hermes/MiroFish receive a per-job loopback proxy token. Provider requests have an independent 38-second deadline.

## Graphify

Uses pinned Graphify, including its SQL parser, for actual code extraction. The corpus is a verified public Bhishma commit, prepared through an extension allowlist with no dotenv files, Git metadata, dependencies or operator home. Output is built outside a Git checkout, stamped with the independently verified corpus revision and manifest digest, and copied into the runtime image. The direct query path exposes no GitHub, shell, PR or arbitrary-project tools.

The provenance verifier distinguishes indexed source nodes from external package references. The pinned extractor creates code-shaped references for dynamic imports such as `vite`; those are converted to explicit external concepts only when their source-backed edge and shape match. Unapproved source paths and structural definitions remain rejected.

Extraction is partial coverage: the public corpus at `3280a7c` produced 2,208 nodes and 5,120 edges. Earlier extraction recorded three TSX parser warnings and additional unsupported/no-symbol files. CSS and Prisma files in the prepared manifest are not proof those files were indexed. A graph cannot substitute for complete source review. A known-symbol query, nonzero graph counts, corpus commit and artifact digest are required in deployment evidence.

## Hermes

Uses Python 3.14 and frozen core dependencies with `--no-install-project`: upstream deliberately refuses wheel installation. The pinned source tree supplies direct `AIAgent` imports. The worker receives fresh private home/configuration, safe mode, no tools, no memory providers, no context files, no background review, no environment probing or automatic recovery. Nonstreaming is explicitly configured and asserted; quiet mode alone does not disable streaming.

There are at most two admitted model requests per job, each reconstructed by the gateway with the fixed model, text-only messages, no tool schemas and at most 1,024 output tokens. Constructor iteration/token settings alone do not enforce these bounds. Output is limited research text; raw messages, reasoning, provider errors and credentials are discarded. Job timeout is 75 seconds.

## MiroFish

Requires a real `ZEP_API_KEY` for Zep Cloud and the existing NVIDIA configuration on its isolated service. Graphiti is not a substitute for this pinned contract. Upstream Flask APIs never bind a public listener: the worker calls the actual app through a private in-process client. There is one scenario at a time, a 480-second process deadline, a 32-call provider allowance and fixed local social-simulation action names. Those actions change only the synthetic OASIS database, not real social accounts or broker accounts.

The genuine pipeline is ontology → own cloud graph → capped profiles → Twitter-only OASIS rounds → verified terminal state/action trace → bounded report. The integration corrects upstream's disabled-platform profile readiness check and uses the parallel script's Twitter-only branch because the single-platform script does not publish the completion events the runner awaits. It observes actual rounds rather than presenting the two-round cap as executed work.

The pinned source has one explicit deployment patch: `patch_mirofish.py` replaces its import-time log directory with the gateway's per-job `MIROFISH_LOG_DIR`. The build rejects a changed source assignment and checks upstream imports as runtime UID 10001. Engine source remains root-owned; no broad write permissions are granted. This patch is published alongside the Dockerfile as corresponding source.

Report context includes bounded actual SQLite action observations and an action-log digest. These are explicitly synthetic and uncalibrated; they do not establish forecasting accuracy or profitability. Graph memory writeback is disabled. The report may refuse oversized populations/output or exhaust its budget; it must not fabricate success. The proxy allows only the six source-backed local social action schemas for MiroFish; Hermes remains tools-disabled.

Minimal graph ownership claims are recorded before cloud creation and retained in `/data/quota.sqlite` even when a worker times out. These records require owner review; they do not authorize automatic deletion of a cloud graph. Worker/container cleanup does not prove already-admitted cloud processing stopped. Cloud retention, deletion verification and long-job asynchronous recovery remain lifecycle work.

## Validation

MiroFish schema requests allow at most 8,192 output tokens, respecting smaller positive upstream requests. Other responses remain capped at 1,024. Each MiroFish job conservatively reserves at most 65,536 output tokens across at most 32 calls, including failed calls; unused reservation is not refunded. Hermes retains its two-call, 2,048-token allowance. These bounds do not certify accuracy or completeness and do not allow unlimited generation.

Operational diagnostics answer three questions: which scenario stage failed, whether provider generation stopped at its token limit, and how many calls that job admitted. Logs contain fixed event names, a random job ID, entry point, bounded counts and an allowlisted completion reason. Ontology errors become fixed enum codes; no raw exceptions, document content, model text or provider credentials are logged. Configuration readiness alone does not prove a functional scenario. A complete metrics/tracing dashboard remains separate work.

Pure Python fixture tests cover authentication, absolute input deadlines, quotas, provenance, scenario sequencing, platform readiness, process containment, trace binding and ownership recording. Backend fixtures cover pinned identity, fixed hosts, owner route configuration, deadlines, response bounds, sanitization and evidence-only results. Fixtures do not prove upstream providers or live scenario outcomes.

CI runs the Python boundary tests in a read-only, unprivileged container with no external network and explicit CPU/memory/process/scratch limits. Actual Railway image builds and authenticated functional checks provide separate deployment evidence. No trading qualification or financial accuracy is inferred from these checks.
