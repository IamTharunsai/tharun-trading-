# REST authentication and logout integrity

REST admission accepts the existing issued-token contract: signed HS256 JWTs,
mandatory finite future `exp`, and a nonempty `userId` of at most 128 characters.
Bearer tokens are bounded to 8192 characters. Signature, allowed algorithm and
`nbf`/expiry checks use the installed jsonwebtoken implementation; required claim
shape is then checked explicitly. Issuer and audience requirements were not added,
so current two-hour login/setup tokens remain compatible. Newly issued tokens
also have a cryptographically fresh UUID `jti`, so two logins at the same clock
second are distinct server sessions. Verification does not require `jti` on old
tokens. Already-issued identical legacy token strings remain the same credential;
revocation necessarily affects every copy of that credential. A browser epoch
alone cannot separate such credentials on the server.

Current database identity is authoritative. A token's role/email cannot override
the database. A missing/unknown role is never promoted to OWNER. The existing
explicit current configured-owner-email permission remains. The guard projects
identity fields for `/auth/me`, avoiding a second unbounded user lookup or exposure
of unrelated user fields.

## Unavailable authority is not an invalid session

Current-user and persistent-revocation reads share one three-second response
deadline. Errors, stalls and exhausted authentication work capacity return
`503 AUTH_UNAVAILABLE` with `Retry-After: 1`; they cannot reach private handlers.
Malformed/expired/revoked credentials and deleted/mismatched database identities
return `401 AUTH_INVALID`. All authentication responses use `no-store`.

Expiry and process-local revocation are rechecked after database reads, before
continuing the request. Local revocation cache entries are token digests. The
persistent schema still stores existing raw-token revocations for compatibility;
this patch is not a storage migration. Application error responses/log calls do
not include bearer tokens, database exception text or raw request headers.

The response deadline **does not cancel an in-flight Prisma query** and does not
set a PostgreSQL statement timeout. To keep timed-out authentication work bounded,
there are at most 32 outstanding authentication store operations per process,
including revocation writes and logout audit attempts. A slot remains occupied
until the actual operation settles, even if the response timed out. Capacity
recovers when queries settle; otherwise admission continues to return temporary
503 responses. Database-side timeout/configuration work is separate. Login/setup
provisioning flow and its broader existing transaction/rate-limit policy are not
redesigned here.

## Logout confirmation

Authenticated logout blocks the captured token locally and notifies existing
local socket leases immediately. Persistent revocation is bounded to three
seconds. Only a successful write (or the same token's duplicate-key race) returns
`success: true, revocationConfirmed: true`. A persistence error/deadline returns
`503 LOGOUT_UNCONFIRMED` and explicitly false confirmation. Audit recording is a
bounded best effort and does not delay the response. Other processes/restarts
cannot rely on a process-local revocation when persistence failed; expiry and
confirmed persistent storage remain the cross-process authority.

The UI clears local auth/private state immediately and sends one request with the
**captured prior token** through a separate Axios instance. It cannot attach a new
sign-in's token through the general request interceptor. A five-second deadline
aborts transport and resolves as unconfirmed even if a late ignored-abort response
later succeeds. There is no automatic retry into a newer session. When still in
the same signed-out session, the UI states that server revocation could not be
confirmed. Storage errors do not prevent immediate memory/cache clearing; browser
storage deletion itself cannot be guaranteed when that storage API throws.

## Retired-session responses

Every local auth transition increments a non-secret, in-memory `authEpoch`.
Axios synchronously captures that epoch and the token at call time. Late success
and failure responses from another epoch are canceled before they reach callers;
the guard also handles logout/re-login with the same token string. Current 401s
clear only local auth. Temporary 503s leave current auth available for retry.

The epoch is client lifecycle metadata, never server authority, a bearer token,
or persisted credentials. The existing session query controller also observes it,
so same-token reauthentication retires the old client synchronously. Sources
without an epoch keep the existing token-change behavior.

## Validation

The dedicated session-integrity CI job typechecks backend source and relevant
Jest suites, exercises actual signed JWTs and registered auth routes with mocked
database/business dependencies, and checks frontend source plus real Axios,
Zustand and query-cache controllers using in-memory adapters. It runs without a
listener, database, provider or broker. The execution container has networking
disabled, read-only sources/tooling, an empty allowlisted dummy environment and
CPU/memory/PID/file/tmpfs/wall-time limits. No target code was executed on the host.
Exact-head results are recorded in the PR; authoring tests is not passing evidence.

Coverage includes malformed/missing claims and wrong algorithms/signatures,
current role/email and identity changes, unavailable/stalled/capped queries,
expiry/revocation during lookup, durable/unconfirmed logout, immediate local clear,
same-token/new-token late request and logout races, and retained query isolation.
This does not establish production deployment state, multiple-owner separation,
or a complete security/financial-readiness certification.

Implementation references: [jsonwebtoken v9 verification and expiry](https://github.com/auth0/node-jsonwebtoken/tree/v9.0.2#jwtverifytoken-secretorpublickey-options-callback),
[Axios 1.6 synchronous interceptors](https://github.com/axios/axios/tree/v1.6.7#interceptors),
[Axios 1.6 AbortController cancellation](https://github.com/axios/axios/tree/v1.6.7#abortcontroller).
