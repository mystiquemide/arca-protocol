# Contributing

Thanks for taking the time to improve Arca.

## Development Setup

1. Install Node.js 20 and Python 3.12.
2. Install frontend dependencies with `npm install`.
3. Create the backend virtual environment:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

4. Copy `.env.example` to `.env` for local-only configuration.
5. Start the API and frontend in separate terminals:

```bash
backend/.venv/bin/python -m uvicorn backend.app.main:app --reload --port 8000
npm run dev
```

## Checks

Run these before opening a pull request:

```bash
npm run lint
npm run test:backend
npm run build
```

For end-to-end API behavior, start the backend and run:

```bash
npm run smoke
```

## Pull Requests

- Keep changes focused and explain the user impact.
- Include screenshots for UI changes.
- Update docs and `.env.example` when behavior or configuration changes.
- Never commit `.env`, local databases, build output, dependency folders, private keys, API tokens, or generated caches.

## Product Boundaries

Arca currently includes production-readiness foundations, but logistics monitoring and Rialo/onchain policy execution are not fully live. Keep public copy accurate when adding features.
