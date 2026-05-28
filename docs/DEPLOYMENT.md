# Deployment

This guide covers the public deployment path for Arca's Vite frontend and FastAPI backend.

## Prerequisites

- Node.js 20
- Python 3.12
- A managed Postgres database for production
- A production frontend host such as Vercel
- A production backend host such as Render
- Privy app id and JWKS URL
- A Redis instance or confirmed gateway-managed rate limiting
- Optional FlightAware credentials
- Optional Circle CLI and agent wallet for controlled payout-rail testing

## Required Environment Variables

Backend production:

```bash
ARCA_ENV=production
ARCA_DATABASE_URL=postgresql://...
ARCA_CORS_ORIGINS=https://your-frontend-domain.example
ARCA_AUTH_REQUIRED=true
ARCA_AUTH_PROVIDER=privy
ARCA_PRIVY_APP_ID=...
ARCA_PRIVY_JWKS_URL=https://auth.privy.io/api/v1/apps/<app-id>/jwks.json
ARCA_ADMIN_API_TOKEN=<32-plus-character-random-secret>
ARCA_ENABLE_DEV_ENDPOINTS=false
ARCA_RATE_LIMIT_ENABLED=true
ARCA_RATE_LIMIT_BACKEND=redis
ARCA_REDIS_URL=redis://...
ARCA_CIRCLE_TRANSFERS_ENABLED=false
```

Frontend production:

```bash
VITE_ARCA_API_URL=https://your-api-domain.example
VITE_PRIVY_APP_ID=<privy-app-id>
```

Use `deploy/production.env.example` as the complete backend template.

## Local Production Build

```bash
npm install
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
npm run lint
npm run test:backend
npm run build
```

## Backend Deployment

1. Provision managed Postgres.
2. Set all production backend env vars.
3. Deploy `backend/Dockerfile` or the `render.yaml` service.
4. Run migrations:

```bash
npm run migrate
```

5. Verify:

```bash
curl -fsS https://your-api-domain.example/health
curl -fsS https://your-api-domain.example/ready
```

## Vercel Deployment

1. Connect the GitHub repository to Vercel.
2. Set `VITE_ARCA_API_URL` and `VITE_PRIVY_APP_ID`.
3. Use the default Vite build:

```bash
npm run build
```

4. After the Vercel URL is known, add it to backend `ARCA_CORS_ORIGINS`.

## Post-Deploy Verification

```bash
ARCA_SMOKE_API_URL=https://your-staging-api.example ARCA_SMOKE_TOKEN=test:user_demo npm run smoke
npm run ops:health
```

For production, use a real Privy session rather than the `test` auth provider. Production startup validation rejects `ARCA_AUTH_PROVIDER=test`.

## Circle Payout Safety

Keep `ARCA_CIRCLE_TRANSFERS_ENABLED=false` until a controlled live-transfer test is approved. Use small amounts, confirm the recipient address, and check Circle transaction history after every attempt.

## Troubleshooting

- `/ready` fails with config errors: fix env vars before redeploying.
- CORS errors: add the exact frontend origin to `ARCA_CORS_ORIGINS`.
- Auth failures: confirm frontend `VITE_PRIVY_APP_ID` matches backend `ARCA_PRIVY_APP_ID` and JWKS URL.
- Rate-limit startup failure: configure Redis or set `ARCA_RATE_LIMIT_GATEWAY_MANAGED=true` only when upstream limits are active.
- Circle transfer failure: inspect `/admin/circle-transfer-attempts`, retry only after reconciliation, and keep live transfers disabled if failures repeat.
