# Backend Production Roadmap

## 1. Auth/User Isolation

- Use Privy access tokens on API requests.
- Configure `ARCA_AUTH_REQUIRED=true`, `ARCA_AUTH_PROVIDER=privy`, `ARCA_PRIVY_APP_ID`, and `ARCA_PRIVY_VERIFICATION_KEY`.
- Backend derives the authenticated principal from the verified token `sub`.
- Arca users store the Privy subject in `users.privy_user_id`.
- User-owned routes compare path `user_id` against that stored mapping.

## 2. Database Cutover

- Current local development database access is SQLite through `backend/app/database.py`.
- Runtime access now switches to `psycopg` automatically when `ARCA_DATABASE_URL` starts with `postgres://` or `postgresql://`.
- Alembic is now scaffolded at `backend/alembic` for formal migration history.
- Next cutover step is to provision managed Postgres, set `ARCA_DATABASE_URL`, run `npm run migrate`, and smoke test authenticated user flows against that database.
- Keep SQLite only for local demo/dev once Postgres production is live.

## 3. Circle Retry Queue

- Circle transfer attempts persist request payload, response payload, error, attempt count, and retry timing.
- Operators can inspect attempts through `GET /admin/circle-transfer-attempts`.
- Operators can retry one attempt with `POST /admin/circle-transfer-attempts/{attempt_id}/retry`.
- Operators can retry due attempts with `POST /admin/circle-transfer-attempts/retry-due`.
- Retries reconcile the prior Circle attempt before broadcasting again.
- Retry scheduling uses exponential backoff and max delay settings.
- Attempts move to `needs_review` after the retry limit is reached.
- Operators can add review reasons and notes with `PATCH /admin/circle-transfer-attempts/{attempt_id}`.
- A background retry worker can be enabled with `ARCA_CIRCLE_RETRY_WORKER_ENABLED=true`.
- Next production step is to move retries from the API process into a separate durable worker/queue such as Redis, Celery, Temporal, Vercel Queues, or a managed job runner before high-volume use.

## 4. Deployment

- Backend container packaging lives in `backend/Dockerfile`.
- The container runs migrations before starting FastAPI.
- `render.yaml` provides a backend Docker service blueprint with `/ready` as the platform health check.
- `vercel.json` provides a Vite static frontend deployment config.
- `docs/deployment-runbook.md` documents preflight checks, production env vars, staging smoke, rollback, and the Circle live-transfer checklist.

## 5. Observability

- `GET /health` is a liveness endpoint.
- `GET /ready` verifies database connectivity and production config safety.
- Request logs are structured JSON and include request id, method, path, status code, and duration.
- `x-request-id` is propagated from inbound requests or generated when missing.
- `scripts/ops-health-check.mjs` checks `/ready`, provider status, and Circle attempts.
- `docs/alerts-runbook.md` defines alert signals and operator response for readiness, 5xx spikes, Circle failures, provider outages, and stuck withdrawals.
- Next production step is to forward logs to a managed sink and configure these alerts in a monitoring provider.

## 6. Rate Limiting

- `ARCA_RATE_LIMIT_BACKEND=memory` keeps the local in-process limiter.
- `ARCA_RATE_LIMIT_BACKEND=redis` uses shared counters through `ARCA_REDIS_URL`.
- `ARCA_RATE_LIMIT_BACKEND=gateway` is allowed only when `ARCA_RATE_LIMIT_GATEWAY_MANAGED=true`.
- Production validation rejects memory-only rate limiting unless the gateway-managed override is explicitly set.

## 7. Secrets And Environment Hardening

- Local secret files are ignored through `.gitignore`.
- `deploy/production.env.example` contains placeholders only and is not safe to run unchanged.
- `docs/secrets-and-env.md` defines backend, frontend, Neon, Privy, Circle, and rotation ownership.
- Production validation rejects unsafe placeholder values, SQLite databases, local/example CORS origins, test auth, weak admin tokens, missing selected provider credentials, and live Circle transfers without a wallet address.

## 8. Backup, Restore, And Incident Recovery

- `docs/backup-restore.md` defines recovery targets, Neon backup posture, restore drills, and incident runbooks.
- `scripts/db-summary.py` prints key production table counts before and after deploys.
- `scripts/db-export-sqlite.sh` creates local SQLite snapshots and refuses to run against Postgres.
- Production restore is owned by Neon backups/PITR; the app does not provide destructive production reset tooling.
