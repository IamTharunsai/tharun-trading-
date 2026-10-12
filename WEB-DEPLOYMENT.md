# Separate Railway web deployment

The configured `artistic-imagination` service remains the sole backend and scheduler. `incredible-embrace` has no database/authentication configuration and must not accidentally start a second trading backend.

Set its non-secret web configuration to `DEPLOYMENT_ROLE=frontend` and `VITE_API_URL=https://tharun-trading-production.up.railway.app`. Vite embeds that API origin during build. The root server then serves compiled pages/assets and a web-role health response, without importing backend authentication, connecting to the database or starting agents. Unified development/startup remains available with the default `DEPLOYMENT_ROLE=unified` and its required backend configuration.

The web health endpoint confirms the static server role, API origin and deployment revision. It does not claim that the upstream backend, agents, or brokers are healthy. CI starts the actual production entrypoint without backend secrets, checks its health, page and compiled API origin, and verifies that private API routes are absent. A public Railway web domain additionally needs inclusion in the backend FRONTEND_URL CORS allowlist; the current Vercel website already uses the configured backend.

Trading mode and broker credentials are unchanged. This configuration does not activate real orders.
