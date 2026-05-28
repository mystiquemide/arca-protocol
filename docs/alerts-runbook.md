# Alerts Runbook

Arca currently emits structured JSON request logs, supports `/health` and `/ready`, exposes provider status, and records Circle transfer attempts. This runbook defines the minimum alerts to wire into Render, UptimeRobot, Datadog, Better Stack, or a similar monitor.

## Manual Probe

Run:

```bash
ARCA_OPS_API_URL=https://your-api-domain.example npm run ops:health
```

To include Circle failed/review-needed attempts, provide the backend admin token:

```bash
ARCA_OPS_API_URL=https://your-api-domain.example ARCA_OPS_ADMIN_TOKEN=<admin-token> npm run ops:health
```

The probe exits nonzero when:

- `/ready` fails
- any recent Circle attempt is `failed` or `needs_review`

Provider outages are warnings by default. To fail on warnings:

```bash
ARCA_OPS_FAIL_ON_WARNINGS=true npm run ops:health
```

## Required Alerts

### API Not Ready

Signal:

- `GET /ready` returns non-200
- response includes `status: not_ready`

Severity: critical

Response:

1. Check backend logs around the failed request id.
2. Check `production_config_errors`.
3. Check database connectivity and Neon status.
4. Roll back the backend deployment if this started after deploy.

### API 5xx Spike

Signal:

- 5xx responses exceed normal baseline for 5 minutes.

Severity: high

Response:

1. Filter structured logs by `status_code >= 500`.
2. Group by `path`.
3. Check the latest deployment, provider status, and database status.
4. Roll back if the spike maps to a new deploy.

### 429 Spike

Signal:

- rate-limit responses rise sharply

Severity: medium

Response:

1. Confirm whether `ARCA_RATE_LIMIT_BACKEND` is `redis`, `memory`, or `gateway`.
2. If using Redis, check Redis availability and latency.
3. If using gateway-managed limits, check the upstream WAF/CDN rules.
4. If the spike is legitimate abusive traffic, keep limits in place and watch `/ready`.
5. If legitimate users are being throttled, tune the rate window or request budget after the incident.

### Circle Attempt Needs Review

Signal:

- `GET /admin/circle-transfer-attempts` includes `status: needs_review`.

Severity: high

Response:

1. Inspect the attempt response/error payload.
2. Confirm whether a tx hash or Circle transfer id exists.
3. If a transaction exists, reconcile before retrying.
4. Add operator notes with `PATCH /admin/circle-transfer-attempts/{attempt_id}`.
5. Keep live transfers disabled if repeated failures happen.

### Circle Attempt Failed

Signal:

- `GET /admin/circle-transfer-attempts` includes `status: failed`.

Severity: medium if transfers are disabled, high if live transfers are enabled.

Response:

1. Confirm `ARCA_CIRCLE_TRANSFERS_ENABLED`.
2. If live transfers are disabled and the payload is staged, no user funds moved.
3. If live transfers are enabled, check Circle and BaseScan before retrying.
4. Use `POST /admin/circle-transfer-attempts/retry-due` only after confirming retry is safe.

### Provider Outage

Signal:

- `GET /providers/status` returns a provider with `ok: false`.

Severity: medium, high if policies depend on that provider.

Response:

1. Check provider credentials and upstream status.
2. Pause affected product flow if needed.
3. Avoid settling policies from stale provider data.
4. Record affected policy ids and provider timestamps.

### Withdrawal Stuck Processing

Signal:

- Circle withdrawal remains `processing` beyond expected settlement time.

Severity: medium.

Response:

1. Run withdrawal sync for the affected user.
2. Check Circle transfer attempts and transaction hash.
3. Reconcile with Circle/BaseScan.
4. Add operator notes if review is needed.

## Log Fields To Index

Index these fields in the log sink:

- `event`
- `request_id`
- `method`
- `path`
- `status_code`
- `duration_ms`
- `environment`

## Escalation Notes

For every incident, capture:

- start/end time
- request ids
- user ids, policy ids, withdrawal ids, attempt ids
- root cause
- customer-visible impact
- recovery steps
- follow-up owner
