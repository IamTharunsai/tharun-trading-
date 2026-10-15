# Personal owner REST boundary

This platform uses shared personal-account state. A valid authenticated user is
not automatically authorized to view the owner's trades, holdings or agent
history. Private routes use the existing database-backed `requireOwner`: current
role `OWNER` or current email matching configured `OWNER_EMAIL`. JWT role claims
do not override the current database user. General `requireAuth` is unchanged.

## Entirely private routers

`/api/trades`, `/api/portfolio`, `/api/journal` and `/api/settings` require owner
access before any handler. Their responses use `Cache-Control: no-store`.

## Private routes within mixed routers

These exact routes additionally require owner access and use `no-store`:

| Prefix | Routes |
| --- | --- |
| `/api/agents` | GET `/decisions`, `/decisions/:id`; POST `/trigger-debate` |
| `/api/monitor` | GET `/activities`, `/activities/summary`, `/learning`, `/recent-decisions`, `/status` |
| `/api/market` | GET `/stocks-universe`, `/stock/:symbol`, `/polymarket/scorecard`, `/polymarket/edge/predictions`, `/predictions`; POST `/predictions/scan` |
| `/api/intelligence` | GET `/activity/feed`, `/activity/agent/:agentId`, `/activity/agent/:agentId/summary`, `/activity/agent/:agentId/export`, `/dashboard`; POST `/learning/log-activity` |
| `/api/copy-trading` | GET `/followers`, `/audit-log`; POST `/followers`, `/followers/:id/toggle`; PATCH and DELETE `/followers/:id` |
| `/api/system` | GET `/status` |
| `/api/kill-switch` | POST `/activate` |

Existing owner-only account, prediction simulation, chat and research-service
routes remain owner-only. The account and prediction simulation routes also use
`no-store`. Kill-switch activation can invoke account liquidation, so ordinary
sessions cannot authorize it; the underlying liquidation behavior is unchanged.

The stock detail route contains trades, decisions, memory and positions. The
stocks universe route includes P&L and entry prices. Prediction research rows
contain generated decisions, reasoning and wager recommendations; the scorecard
also includes private paper P&L and open orders. They are not exchange quote
responses merely because they live under `/api/market`.

## Market compatibility

Market quotes, candles (including `/stock/:symbol/candles`), public-event/news
observations, macro/regime data, static strategy definitions and the fixed
retired-greed status retain ordinary authenticated access. Monitor `/context`
contains news, geopolitical events and sentiment. Intelligence `/learning/:asset`
rebuilds learning from market resources; it does not return private account
history. It retains its current shared derived-state write/quota behavior.

## Validation and limitations

`tests/privateRuntimeRoutes.test.ts` dispatches through the actual registered
Express routers without a server or HTTP listener. Business dependencies are
mocked before imports and prewarmed outside individual test timers. It checks
missing/invalid/expired/revoked/deleted/member/demoted principals before private
work, current database owner and configured-email semantics, owner read payloads,
cache headers, and member market access. Financial mutations are tested only for
denial; no actual financial controls or broker code run.

The dedicated CI job explicitly typechecks source and this test suite, then runs
typed Jest inside a network-disabled, read-only, resource-bounded container with
an empty environment plus dummy allowlisted values. Runtime verification is
pending until that job passes on the PR's exact head; authoring tests does not
establish a passing result.

All owner-qualified principals still share global personal-account resources.
This change does not provide isolation between multiple owner accounts. Ordinary
production member provisioning, deployed revision and proxy behavior have not
been inspected. Existing revocation-store fail-open behavior and unrelated
shared research/provider quota semantics remain separate concerns. This boundary
is not an end-to-end privacy or financial-readiness certification.
