# Security Policy

## Supported Versions

Arca is pre-1.0. Security fixes target the latest `main` branch until tagged releases are introduced.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Report security issues privately to the repository maintainer through GitHub Security Advisories or by contacting the maintainer directly. Include:

- A clear description of the issue.
- Steps to reproduce.
- Impact and affected surfaces.
- Any relevant logs, screenshots, or proof-of-concept details.

## Sensitive Areas

Pay particular attention to:

- Privy JWT verification and user isolation.
- Admin and development endpoint access controls.
- Partner API key enforcement.
- Circle transfer attempts, retries, reconciliation, and idempotency.
- Database migrations and production configuration validation.
- Environment variables and deployment secrets.

## Secret Handling

Never commit real `.env` files, API keys, private keys, wallet credentials, Circle session material, database URLs, admin tokens, or production service credentials.
