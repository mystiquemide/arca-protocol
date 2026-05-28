# Backup, Restore, And Incident Recovery

This is the operator checklist for Arca's current backend foundation.

## Recovery Targets

- **RPO:** 15 minutes for production Postgres once Neon point-in-time recovery is enabled.
- **RTO:** 60 minutes for API restore after database recovery.
- **No destructive resets in production.** Never run `/dev/reset` or delete production data.

## Normal Backup Posture

Production data lives in managed Postgres through `ARCA_DATABASE_URL`.

Required:

- Enable Neon backups or point-in-time recovery on the production project.
- Keep staging and production on separate Neon databases or branches.
- Store the production connection string only in the backend host.
- Run `npm run migrate` before promotion or during backend deploy.
- Run `backend/.venv/bin/python scripts/db-summary.py` after deploy to record table counts.

For local SQLite-only snapshots:

```bash
scripts/db-export-sqlite.sh
```

The SQLite export helper refuses to run against Postgres. Use Neon restore/PITR or `pg_dump` for managed Postgres.

## Pre-Deploy Database Checklist

Before each production deploy:

1. Confirm Neon backups/PITR are enabled.
2. Confirm latest staging smoke passed.
3. Confirm `ARCA_CIRCLE_TRANSFERS_ENABLED=false` unless a live payout test is explicitly approved.
4. Record current production summary:

```bash
backend/.venv/bin/python scripts/db-summary.py
```

5. Deploy backend.
6. Check `/ready`.
7. Run browser smoke with a real Privy user.
8. Record post-deploy summary and compare counts.

## Restore Drill

Run this drill on staging before trusting production recovery:

1. Create a staging policy and payout-history record.
2. Record `scripts/db-summary.py` output.
3. Restore staging database to an earlier Neon restore point or branch.
4. Point staging backend to the restored database.
5. Run `npm run migrate`.
6. Check `/ready`.
7. Run `npm run smoke:auth`.
8. Confirm expected records exist or were intentionally rolled back.
9. Document restore time and any manual steps.

## Incident: Bad Backend Deploy

Symptoms:

- `/health` works but `/ready` fails.
- API returns 5xx after deploy.
- Browser shows authenticated API failures.

Response:

1. Roll back backend image/platform deployment.
2. Do not modify the database.
3. Check structured logs by `request_id`.
4. Check `/ready` details and `production_config_errors`.
5. Re-run staging smoke before re-promoting.

## Incident: Bad Migration

Symptoms:

- Startup fails during migration.
- `/ready` fails after deploy.
- Table counts or schema look wrong after migration.

Response:

1. Stop further deploys.
2. Keep the current database intact.
3. Restore a staging copy from the latest production backup.
4. Reproduce the migration failure against staging.
5. Patch the migration.
6. Run staging smoke.
7. Restore production from PITR only if data is corrupted or unavailable.

## Incident: Circle Payout Failure

Symptoms:

- Withdrawal status is `failed`.
- Circle attempt has error payload.
- User reports missing payout.

Response:

1. Check `GET /admin/circle-transfer-attempts`.
2. Confirm whether a transaction hash exists.
3. If a hash exists, reconcile the withdrawal from BaseScan/Circle before retrying.
4. If no hash exists and retry is safe, use `POST /admin/circle-transfer-attempts/{attempt_id}/retry`.
5. If retry limit is reached, the attempt moves to `needs_review`.
6. Add operator notes with `PATCH /admin/circle-transfer-attempts/{attempt_id}`.
7. Keep `ARCA_CIRCLE_TRANSFERS_ENABLED=false` if repeated failures happen.
8. Record incident notes: withdrawal id, attempt id, destination, amount, error, tx hash if any.

## Incident: Provider Outage

Symptoms:

- Flight/weather/logistics quote or sync failures.
- Provider status shows stale or failed checks.

Response:

1. Check `GET /providers/status`.
2. Confirm provider credentials are present.
3. Disable affected product flow in the frontend if needed.
4. Avoid settling policies from stale provider data.
5. Record affected policies and provider timestamps.

## Minimum Incident Notes

For every production incident, capture:

- Start/end time
- Request ids from logs
- Affected user ids/policy ids/withdrawal ids
- Root cause
- Data recovery steps
- Follow-up action
