# Secrets And Environment Checklist

Arca uses local `.env` only for development. Production secrets must live in the deployment provider dashboards, not in the repo.

## Never Commit

These files and values must not be committed:

- `.env`, `.env.local`, `.env.*`
- Neon/Postgres connection strings
- Privy verification keys
- FlightAware API keys
- Circle wallet credentials, CLI tokens, or exported wallet material
- Admin tokens and partner API keys

The repo keeps only placeholder examples in `deploy/*.env.example`.

## Backend Secrets

Set these on the backend host, for example Render:

```bash
ARCA_ENV=production
ARCA_DATABASE_URL=postgresql://...
ARCA_CORS_ORIGINS=https://your-real-frontend-domain
ARCA_AUTH_REQUIRED=true
ARCA_AUTH_PROVIDER=privy
ARCA_PRIVY_APP_ID=<privy-app-id>
ARCA_PRIVY_JWKS_URL=https://auth.privy.io/api/v1/apps/<privy-app-id>/jwks.json
ARCA_ADMIN_API_TOKEN=<32-plus-character-random-secret>
ARCA_ENABLE_DEV_ENDPOINTS=false
ARCA_RATE_LIMIT_ENABLED=true
ARCA_RATE_LIMIT_BACKEND=redis
ARCA_REDIS_URL=redis://...
ARCA_FLIGHTAWARE_API_KEY=<flightaware-key>
ARCA_CIRCLE_TRANSFERS_ENABLED=false
```

Production startup rejects unsafe values, including:

- SQLite database URLs
- localhost/example CORS origins
- `ARCA_AUTH_PROVIDER=test`
- missing Privy app/JWKS settings
- missing or short admin token
- memory-only rate limiting without a documented gateway-managed exception
- live Circle transfers without a configured wallet address

## Frontend Environment

Set these on the frontend host, for example Vercel:

```bash
VITE_ARCA_API_URL=https://your-real-api-domain
VITE_PRIVY_APP_ID=<privy-app-id>
```

Only `VITE_*` values are exposed to the browser. Do not put backend secrets in Vercel frontend env vars.

## Neon

Use separate branches/databases for staging and production when possible.

Required:

- Store the Neon connection string only in the backend host.
- Keep `sslmode=require`.
- Enable backups/point-in-time recovery according to the Neon project tier.
- Run `npm run migrate` during backend deploy or before promotion.

## Privy

Required:

- Use the same Privy app id in frontend `VITE_PRIVY_APP_ID` and backend `ARCA_PRIVY_APP_ID`.
- Prefer `ARCA_PRIVY_JWKS_URL` over copying a PEM verification key.
- Keep allowed origins/callback URLs aligned with the deployed frontend domain.

## Circle

Default production stance:

```bash
ARCA_CIRCLE_TRANSFERS_ENABLED=false
```

Before setting it to `true`:

- Confirm the Circle agent wallet address.
- Confirm wallet balance and policy limits.
- Confirm admin retry access is protected by `ARCA_ADMIN_API_TOKEN`.
- Run a small staging transfer first.
- Verify the withdrawal status, transaction link, receipt, and ledger entry.

## Rotating Secrets

Rotate immediately if a secret is pasted into chat, committed, logged, or shared outside the deployment provider.

Recommended order:

1. Generate a replacement in the provider dashboard.
2. Update staging.
3. Run auth smoke and `/ready`.
4. Update production.
5. Revoke the old secret.
6. Re-run `/ready` and a browser policy/payout smoke.
