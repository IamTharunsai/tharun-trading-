# Service deployment boundaries

The trading backend and forecasting worker previously accepted automatic builds
for unrelated repository changes. Frontend updates could restart the scheduler
and re-download the forecasting runtime even when neither service changed.

Railway deployment metadata checked 2026-10-21 identifies the active backend's
config as `/backend/railway.json`, root `backend`, and the forecasting config as
`/kronos-service/railway.json`, root `/kronos-service`. Each builds from its own
directory and dependency manifests. No shared source outside those directories
is copied by either current build configuration.

The backend now watches `/backend/**`; the forecasting worker watches
`/kronos-service/**`. These include source, database compatibility/migrations,
dependency manifests and each service's own deployment configuration. Frontend,
design assets and documentation changes alone do not match either service.

Railway's [watch-path reference](https://docs.railway.com/builds/build-configuration#configure-watch-paths)
specifies repository-root gitignore patterns even when a service has a root
directory. Its [configuration reference](https://docs.railway.com/config-as-code/reference#watch-patterns)
defines `build.watchPatterns`. If a future build starts consuming a shared file
outside the service directory, extend the patterns in the same change.

This affects GitHub automatic deployment selection. It does not prevent manual
CLI deployments, variable changes, operational restarts or deployment of actual
backend changes. It does not persist in-flight committee work across a required
restart or provide a distributed scheduler lease. Those remain separate work.

Validation: parse both JSON files, inspect the actual consumed manifests and
the current build inputs, then run the repository's existing deployment checks.
After release, verify the resolved service manifest contains the patterns. A
later genuine frontend-only change is needed to prove automatic skip behavior;
do not create a pointless production deployment solely to demonstrate it.
