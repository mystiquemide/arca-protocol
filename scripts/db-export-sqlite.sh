#!/usr/bin/env bash
set -euo pipefail

if [[ "${ARCA_DATABASE_URL:-}" == postgres://* || "${ARCA_DATABASE_URL:-}" == postgresql://* ]]; then
  echo "Refusing to export Postgres with sqlite tooling. Use Neon PITR or pg_dump instead." >&2
  exit 1
fi

database="${ARCA_DATABASE_URL:-backend/data/arca.sqlite3}"
database="${database#sqlite:///}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="${1:-backups/arca-${timestamp}.sqlite3}"

mkdir -p "$(dirname "$output")"
python3 - "$database" "$output" <<'PY'
import sqlite3
import sys

source_path, output_path = sys.argv[1], sys.argv[2]
with sqlite3.connect(source_path) as source:
    with sqlite3.connect(output_path) as backup:
        source.backup(backup)
PY
echo "SQLite backup written to $output"
