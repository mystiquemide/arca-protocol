# Arca Deployment Runbook

This runbook covers the current production-style setup:

- Frontend: Vite static app
- Backend: FastAPI Docker service
- Database: managed Postgres through `ARCA_DATABASE_URL`
- Auth: Privy bearer tokens in production, test tokens only for staging smoke
- Circle transfers: off by default until operator approval

Read `docs/secrets-and-env.md` before adding production values. Do not deploy with copied placeholder values from `deploy/production.env.example`.

Read `docs/backup-restore.md` before the first production deploy. It defines backup posture, restore drills, and incident recovery steps.

## 1. Preflight

Run these locally before deploying:

```bash
npm run lint
backend/.venv/bin/python -m py_compile backend/app/*.py
npm run build
npm run migrate
```

Then run the auth-required smoke path against staging:

```bash
ARCA_AUTH_REQUIRED=true ARCA_AUTH_PROVIDER=test backend/.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8002
ARCA_SMOKE_API_URL=http://127.0.0.1:8002 npm run smoke:auth
```

GitHub Actions runs the same safety lane in `.github/workflows/ci.yml`: backend compile, frontend lint/build, migrations, auth-required API boot, `401` auth assertion, and `npm run smoke:auth`.

## 2. Backend Deploy

Use `render.yaml` for a Render Blueprint deployment, or use the same Dockerfile on another container host.

Required production env vars:

```bash
ARCA_ENV=production
ARCA_DATABASE_URL=postgresql://...
ARCA_CORS_ORIGINS=https://your-frontend-domain.example
ARCA_AUTH_REQUIRED=true
ARCA_AUTH_PROVIDER=privy
ARCA_PRIVY_APP_ID=...
ARCA_PRIVY_JWKS_URL=https://auth.privy.io/api/v1/apps/<app-id>/jwks.json
ARCA_ADMIN_API_TOKEN=<long-random-secret>
ARCA_ENABLE_DEV_ENDPOINTS=false
ARCA_RATE_LIMIT_ENABLED=true
ARCA_RATE_LIMIT_BACKEND=redis
ARCA_REDIS_URL=redis://...
ARCA_FLIGHTAWARE_API_KEY=...
ARCA_CIRCLE_TRANSFERS_ENABLED=false
```

Production startup fails fast when dangerous placeholder values are present. Before deploying, confirm:

- `ARCA_DATABASE_URL` is managed Postgres, not SQLite.
- `ARCA_CORS_ORIGINS` is the real frontend domain, not localhost or an example domain.
- `ARCA_AUTH_PROVIDER=privy`, not `test`.
- `ARCA_ADMIN_API_TOKEN` is a random value with at least 32 characters.
- `ARCA_PRIVY_APP_ID` and `ARCA_PRIVY_JWKS_URL` match the same Privy app.
- rate limiting uses Redis, or `ARCA_RATE_LIMIT_GATEWAY_MANAGED=true` is intentionally set for an upstream gateway/WAF.
- `ARCA_CIRCLE_TRANSFERS_ENABLED=false` until a live transfer test is approved.

The container runs migrations before starting the API:

```bash
python -m backend.app.migrate && uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

Liveness check:

```bash
curl https://your-api-domain.example/health
```

Expected:

```json
{"status":"ok","service":"arca-api","environment":"production","production_config_errors":[]}
```

Readiness check:

```bash
curl https://your-api-domain.example/ready
```

Expected:

```json
{"status":"ready","service":"arca-api","environment":"production","database":"ok"}
```

Use `/ready` for platform health checks because it verifies database connectivity and production config safety. `/health` only proves the process is alive.

## 3. Frontend Deploy

Use `vercel.json` for the Vite static app.

Required frontend env vars:

```bash
VITE_ARCA_API_URL=https://your-api-domain.example
VITE_PRIVY_APP_ID=<privy-app-id>
```

After deployment, open the frontend URL, sign in with Privy, and confirm the dashboard loads without `401` or `403` API errors.

## 4. Post-Deploy Smoke

For staging, keep test auth enabled and Circle live transfers disabled:

```bash
ARCA_SMOKE_API_URL=https://your-staging-api.example ARCA_SMOKE_TOKEN=test:user_demo npm run smoke
```

For production, do not use `ARCA_AUTH_PROVIDER=test`. Production validation rejects it. Production smoke should be browser-based with a real Privy session until a CI-safe Privy test-token flow exists.

Run the ops health probe after smoke:

```bash
ARCA_OPS_API_URL=https://your-api-domain.example ARCA_OPS_ADMIN_TOKEN=<admin-token> npm run ops:health
```

See `docs/alerts-runbook.md` for alert signals and operator responses.

## 5. Rollback

If deploy health fails:

1. Roll back to the previous backend image or platform deployment.
2. Keep the database intact; do not reset production data.
3. Check `/health`, `/ready`, backend JSON logs, and `production_config_errors`.
4. Re-run staging smoke before promoting again.

## 6. Backup And Restore

Production Postgres backup/restore is owned by Neon. The app provides operator checks:

```bash
backend/.venv/bin/python scripts/db-summary.py
```

For local SQLite snapshots only:

```bash
scripts/db-export-sqlite.sh
```

Run a staging restore drill before production launch. See `docs/backup-restore.md`.

## 7. Live Circle Transfers

Leave this off until the operator is ready:

```bash
ARCA_CIRCLE_TRANSFERS_ENABLED=false
```

Before turning it on:

- Confirm the Circle agent wallet balance and policy limits.
- Confirm `ARCA_CIRCLE_BASE_WALLET_ADDRESS`.
- Run a small staged transfer in staging.
- Verify payout receipt, transaction link, withdrawal status, and ledger event.
- Keep `ARCA_CIRCLE_RETRY_WORKER_ENABLED=false` until the first live transfer test has been reviewed.
- After live transfers are approved, enable the retry worker only in one backend process:

```bash
ARCA_CIRCLE_RETRY_WORKER_ENABLED=true
ARCA_CIRCLE_RETRY_WORKER_INTERVAL_SECONDS=60
ARCA_CIRCLE_RETRY_WORKER_BATCH_SIZE=10
```

Retry safety:

- The backend checks for a matching prior Circle transaction before retrying.
- Attempts use exponential backoff and stop at `needs_review`.
- Use `PATCH /admin/circle-transfer-attempts/{attempt_id}` to add review notes or move an attempt back to `failed` / `initiated` after operator review.
