# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-28

### Added

- Initial public release of the Arca parametric insurance prototype.
- React/Vite frontend with landing, quote, dashboard, policy detail, pool, settings, admin, and API docs screens.
- FastAPI backend for quotes, policies, payouts, withdrawals, balances, ledger events, provider status, reserve status, partner policy creation, and development reset.
- Privy frontend session wiring and backend JWT verification foundation.
- Circle payout rail metadata, attempt logging, reconciliation, manual retry, due retry, and optional background worker controls.
- SQLite local persistence, migration registry, Postgres runtime adapter, and Alembic scaffold.
- Production config validation, structured request logging, health/readiness endpoints, CORS configuration, auth guardrails, partner API keys, and rate-limit backends.
- CI workflow for backend tests, lint, build, migrations, auth smoke, and ops health probing.
- CodeQL workflow, Dependabot configuration, issue templates, pull request template, contributing guide, security policy, and deployment documentation.
