import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.database import get_connection  # noqa: E402


TABLES = (
    "users",
    "policies",
    "payouts",
    "withdrawals",
    "ledger_events",
    "reserve_events",
    "circle_transfer_attempts",
    "schema_migrations",
)


def main() -> None:
    with get_connection() as connection:
        for table in TABLES:
            row = connection.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()
            print(f"{table}: {row['count']}")


if __name__ == "__main__":
    main()
