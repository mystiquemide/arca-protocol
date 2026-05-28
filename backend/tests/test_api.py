import importlib
import sys

import pytest
from fastapi.testclient import TestClient


def load_app(tmp_path, monkeypatch, auth_required=False, dev_endpoints=True):
    monkeypatch.setenv("ARCA_DATABASE_URL", str(tmp_path / "arca-test.sqlite3"))
    monkeypatch.setenv("ARCA_AUTH_REQUIRED", "true" if auth_required else "false")
    monkeypatch.setenv("ARCA_AUTH_PROVIDER", "test")
    monkeypatch.setenv("ARCA_ENABLE_DEV_ENDPOINTS", "true" if dev_endpoints else "false")
    monkeypatch.setenv("ARCA_RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("ARCA_CIRCLE_TRANSFERS_ENABLED", "false")
    monkeypatch.setenv("ARCA_WITHDRAWAL_SYNC_INTERVAL_SECONDS", "0")
    monkeypatch.setenv("ARCA_POLICY_SYNC_INTERVAL_SECONDS", "0")
    monkeypatch.setenv("ARCA_WEATHER_DEMO_RAIN_MM", "20")

    for name in list(sys.modules):
        if name == "backend.app" or name.startswith("backend.app."):
            sys.modules.pop(name)

    main = importlib.import_module("backend.app.main")
    main.configure_logging()
    main.init_db()
    main.seed_demo_data()
    return main.app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    return TestClient(load_app(tmp_path, monkeypatch))


def test_policy_payout_withdrawal_and_ledger_flow(client):
    quote_response = client.post(
        "/quotes",
        json={
            "category": "weather",
            "target": "Test Farm",
            "coverage_amount": 10,
            "condition_params": {"rainfall_mm": 10},
        },
    )
    assert quote_response.status_code == 200
    quote = quote_response.json()
    assert quote["premium"] > 0

    policy_response = client.post("/policies", json={"user_id": "user_demo", "quote": quote})
    assert policy_response.status_code == 200
    policy = policy_response.json()
    assert policy["status"] == "active"

    trigger_response = client.post(
        f"/policies/{policy['id']}/trigger",
        json={"source_payload": {"provider": "pytest"}},
    )
    assert trigger_response.status_code == 200
    assert trigger_response.json()["status"] == "triggered"

    settle_response = client.post(f"/policies/{policy['id']}/settle")
    assert settle_response.status_code == 200
    payout = settle_response.json()
    assert payout["status"] == "paid"
    assert payout["amount"] == 10

    withdrawal_response = client.post(
        "/withdrawals",
        json={
            "user_id": "user_demo",
            "amount": 0.01,
            "destination_name": "Pytest Account",
            "destination_iban": "PYTEST-LOCAL-ACCOUNT",
            "destination_swift": "ARCAUSDC",
            "destination_wallet_address": None,
            "destination_chain": "BASE",
        },
    )
    assert withdrawal_response.status_code == 200
    withdrawal = withdrawal_response.json()
    assert withdrawal["status"] == "initiated"

    ledger = client.get("/users/user_demo/ledger").json()
    assert any(row["event_type"] == "payout_paid" and row["metadata"]["policy_id"] == policy["id"] for row in ledger)
    assert any(row["event_type"] == "withdrawal_initiated" and row["entity_id"] == withdrawal["id"] for row in ledger)


def test_auth_required_rejects_missing_token_and_accepts_test_token(tmp_path, monkeypatch):
    client = TestClient(load_app(tmp_path, monkeypatch, auth_required=True))

    unauthenticated = client.get("/auth/me")
    assert unauthenticated.status_code == 401

    authenticated = client.get("/auth/me", headers={"Authorization": "Bearer test:user_demo"})
    assert authenticated.status_code == 200
    assert authenticated.json()["authenticated_user_id"] == "user_demo"


def test_admin_routes_survive_when_dev_routes_are_disabled(tmp_path, monkeypatch):
    monkeypatch.setenv("ARCA_ADMIN_API_TOKEN", "test-admin-token")
    client = TestClient(load_app(tmp_path, monkeypatch, dev_endpoints=False))

    admin_response = client.get("/admin/circle-transfer-attempts", headers={"X-Arca-Admin-Token": "test-admin-token"})
    assert admin_response.status_code == 200

    dev_response = client.post("/dev/reset", headers={"X-Arca-Admin-Token": "test-admin-token"})
    assert dev_response.status_code == 403
