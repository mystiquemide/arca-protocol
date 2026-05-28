import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from psycopg import connect
from psycopg.rows import dict_row


load_dotenv()

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DATABASE_URL = os.getenv("ARCA_DATABASE_URL", str(DATA_DIR / "arca.sqlite3"))


def is_postgres_url(url: str | None = None) -> bool:
    value = url or DATABASE_URL
    return value.startswith(("postgres://", "postgresql://"))


def normalized_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return f"postgresql://{url.removeprefix('postgres://')}"
    return url


def sqlite_database_path(url: str) -> str:
    if url.startswith("sqlite:///"):
        return url.removeprefix("sqlite:///")
    return url


def adapt_query(sql: str) -> str:
    return sql.replace("?", "%s")


def split_sql_script(script: str) -> list[str]:
    return [statement.strip() for statement in script.split(";") if statement.strip()]


class PostgresConnection:
    driver = "postgres"

    def __init__(self, url: str):
        self.connection = connect(normalized_database_url(url), row_factory=dict_row)

    def __enter__(self):
        self.connection.__enter__()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return self.connection.__exit__(exc_type, exc_value, traceback)

    def execute(self, sql: str, params=None):
        return self.connection.execute(adapt_query(sql), params or ())

    def executescript(self, script: str):
        for statement in split_sql_script(script):
            self.execute(statement)

    def commit(self):
        self.connection.commit()

    def close(self):
        self.connection.close()


def get_connection():
    if is_postgres_url():
        return PostgresConnection(DATABASE_URL)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(sqlite_database_path(DATABASE_URL))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db():
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              email TEXT UNIQUE NOT NULL,
              privy_user_id TEXT UNIQUE,
              phone TEXT,
              rialo_address TEXT,
              kyc_status TEXT NOT NULL DEFAULT 'pending',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS policies (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              category TEXT NOT NULL,
              type TEXT NOT NULL,
              status TEXT NOT NULL,
              premium REAL NOT NULL,
              payout REAL NOT NULL,
              contract_address TEXT NOT NULL,
              target TEXT NOT NULL,
              trigger TEXT NOT NULL,
              engine TEXT NOT NULL,
              oracle TEXT NOT NULL,
              source TEXT NOT NULL,
              current_status TEXT NOT NULL,
              condition_params TEXT NOT NULL,
              created_at TEXT NOT NULL,
              triggered_at TEXT,
              paid_at TEXT,
              expired_at TEXT,
              expires_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS payouts (
              id TEXT PRIMARY KEY,
              policy_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              amount REAL NOT NULL,
              trigger_data TEXT NOT NULL,
              tx_hash TEXT NOT NULL,
              status TEXT NOT NULL,
              paid_at TEXT NOT NULL,
              FOREIGN KEY(policy_id) REFERENCES policies(id),
              FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS withdrawals (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              amount REAL NOT NULL,
              destination_name TEXT NOT NULL,
              destination_iban TEXT NOT NULL,
              destination_swift TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS ledger_events (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              event_type TEXT NOT NULL,
              amount REAL NOT NULL,
              metadata TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id)
            );
            """
        )
        run_migrations(connection)


def migration_applied(connection, version: str) -> bool:
    row = connection.execute("SELECT version FROM schema_migrations WHERE version = ?", (version,)).fetchone()
    return bool(row)


def mark_migration_applied(connection, version: str):
    connection.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", (version, datetime.now(timezone.utc).isoformat()))


def add_column_if_missing(connection, table: str, column: str, statement: str):
    columns = table_columns(connection, table)
    if column not in columns:
        connection.execute(statement)


def table_columns(connection, table: str) -> set[str]:
    if getattr(connection, "driver", None) == "postgres":
        rows = connection.execute(
            """
            SELECT column_name AS name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ?
            """,
            (table,),
        ).fetchall()
        return {row["name"] for row in rows}

    rows = connection.execute(f"PRAGMA table_info({table})").fetchall()
    return {row["name"] for row in rows}


def run_migrations(connection):
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
        """
    )

    migrations = [
        ("001_withdrawal_circle_columns", ensure_withdrawal_columns),
        ("002_operational_indexes", ensure_operational_indexes),
        ("003_withdrawal_idempotency", ensure_withdrawal_idempotency),
        ("004_reserve_events", ensure_reserve_events),
        ("005_circle_transfer_attempts", ensure_circle_transfer_attempts),
        ("006_circle_retry_metadata", ensure_circle_retry_metadata),
        ("007_user_privy_identity", ensure_user_privy_identity),
        ("008_circle_retry_worker_metadata", ensure_circle_retry_worker_metadata),
    ]

    for version, migration in migrations:
        if migration_applied(connection, version):
            continue
        migration(connection)
        mark_migration_applied(connection, version)


def ensure_withdrawal_columns(connection):
    migrations = {
        "destination_wallet_address": "ALTER TABLE withdrawals ADD COLUMN destination_wallet_address TEXT",
        "destination_chain": "ALTER TABLE withdrawals ADD COLUMN destination_chain TEXT NOT NULL DEFAULT 'BASE'",
        "rail": "ALTER TABLE withdrawals ADD COLUMN rail TEXT NOT NULL DEFAULT 'bank'",
        "rail_status": "ALTER TABLE withdrawals ADD COLUMN rail_status TEXT",
        "transfer_id": "ALTER TABLE withdrawals ADD COLUMN transfer_id TEXT",
        "tx_hash": "ALTER TABLE withdrawals ADD COLUMN tx_hash TEXT",
        "transfer_payload": "ALTER TABLE withdrawals ADD COLUMN transfer_payload TEXT",
    }

    for column, statement in migrations.items():
        add_column_if_missing(connection, "withdrawals", column, statement)


def ensure_operational_indexes(connection):
    connection.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_policies_user_status ON policies(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_policies_monitoring ON policies(category, status);
        CREATE INDEX IF NOT EXISTS idx_withdrawals_user_status ON withdrawals(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_events(user_id, created_at);
        """
    )


def ensure_withdrawal_idempotency(connection):
    add_column_if_missing(connection, "withdrawals", "idempotency_key", "ALTER TABLE withdrawals ADD COLUMN idempotency_key TEXT")
    connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_user_idempotency ON withdrawals(user_id, idempotency_key)")


def ensure_reserve_events(connection):
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS reserve_events (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          amount REAL NOT NULL,
          metadata TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reserve_events_created ON reserve_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_reserve_events_entity ON reserve_events(entity_type, entity_id);
        """
    )


def ensure_circle_transfer_attempts(connection):
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS circle_transfer_attempts (
          id TEXT PRIMARY KEY,
          withdrawal_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          status TEXT NOT NULL,
          request_payload TEXT NOT NULL,
          response_payload TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(withdrawal_id) REFERENCES withdrawals(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_circle_attempts_idempotency ON circle_transfer_attempts(idempotency_key);
        CREATE INDEX IF NOT EXISTS idx_circle_attempts_withdrawal ON circle_transfer_attempts(withdrawal_id);
        """
    )


def ensure_circle_retry_metadata(connection):
    add_column_if_missing(connection, "circle_transfer_attempts", "attempt_count", "ALTER TABLE circle_transfer_attempts ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1")
    add_column_if_missing(connection, "circle_transfer_attempts", "next_attempt_at", "ALTER TABLE circle_transfer_attempts ADD COLUMN next_attempt_at TEXT")
    add_column_if_missing(connection, "circle_transfer_attempts", "last_attempt_at", "ALTER TABLE circle_transfer_attempts ADD COLUMN last_attempt_at TEXT")


def ensure_circle_retry_worker_metadata(connection):
    add_column_if_missing(connection, "circle_transfer_attempts", "locked_at", "ALTER TABLE circle_transfer_attempts ADD COLUMN locked_at TEXT")
    add_column_if_missing(connection, "circle_transfer_attempts", "review_reason", "ALTER TABLE circle_transfer_attempts ADD COLUMN review_reason TEXT")
    add_column_if_missing(connection, "circle_transfer_attempts", "operator_notes", "ALTER TABLE circle_transfer_attempts ADD COLUMN operator_notes TEXT")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_circle_attempts_retry_due ON circle_transfer_attempts(status, next_attempt_at)")


def ensure_user_privy_identity(connection):
    add_column_if_missing(connection, "users", "privy_user_id", "ALTER TABLE users ADD COLUMN privy_user_id TEXT")
    connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_privy_user_id ON users(privy_user_id)")
