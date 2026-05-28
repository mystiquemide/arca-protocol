import json
import os
import asyncio
from contextlib import suppress
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .database import get_connection, init_db
from .observability import configure_logging, log_event, request_logging
from .providers import circle_status, execute_circle_usdc_transfer, fetch_flightaware_snapshot, fetch_logistics_snapshot, fetch_open_meteo_snapshot, find_circle_transfer_by_id, find_matching_circle_transfer, transfer_payload_from_transaction, provider_status
from .schemas import (
    BalanceOut,
    CircleAttemptReviewUpdate,
    CircleRetryOut,
    CircleTransferAttemptOut,
    LedgerEventOut,
    PayoutOut,
    PartnerPolicyCreate,
    PartnerPolicyOut,
    PolicyCreate,
    PolicyOut,
    QuoteOut,
    QuoteRequest,
    ReserveStatusOut,
    TriggerRequest,
    UserCreate,
    UserOut,
    WithdrawalCreate,
    WithdrawalOut,
)
from .security import assert_admin_access, assert_dev_access, assert_partner_access, assert_user_access, current_user_id, rate_limit
from .services import add_ledger_event, add_reserve_event, assert_reserve_capacity, get_balance, get_reserve_status, new_id, now_iso, quote_policy, row_to_dict, seed_demo_data


app = FastAPI(title="Arca Protocol API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.middleware("http")(rate_limit)
app.middleware("http")(request_logging)


@app.on_event("startup")
def on_startup():
    configure_logging()
    config_errors = config.production_config_errors()
    if config_errors:
        raise RuntimeError("Invalid production config: " + "; ".join(config_errors))
    init_db()
    seed_demo_data()
    log_event("startup", auth_required=config.AUTH_REQUIRED, auth_provider=config.AUTH_PROVIDER)
    interval = int(os.getenv("ARCA_WITHDRAWAL_SYNC_INTERVAL_SECONDS", "60"))
    if interval > 0:
        app.state.withdrawal_sync_task = asyncio.create_task(periodic_withdrawal_sync(interval))
    policy_interval = int(os.getenv("ARCA_POLICY_SYNC_INTERVAL_SECONDS", "90"))
    if policy_interval > 0:
        app.state.policy_sync_task = asyncio.create_task(periodic_policy_sync(policy_interval))
    if config.CIRCLE_RETRY_WORKER_ENABLED:
        app.state.circle_retry_task = asyncio.create_task(periodic_circle_retry())


@app.on_event("shutdown")
async def on_shutdown():
    task = getattr(app.state, "withdrawal_sync_task", None)
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    policy_task = getattr(app.state, "policy_sync_task", None)
    if policy_task:
        policy_task.cancel()
        with suppress(asyncio.CancelledError):
            await policy_task
    circle_retry_task = getattr(app.state, "circle_retry_task", None)
    if circle_retry_task:
        circle_retry_task.cancel()
        with suppress(asyncio.CancelledError):
            await circle_retry_task


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "arca-api",
        "environment": config.ARCA_ENV,
        "production_config_errors": config.production_config_errors(),
    }


@app.get("/ready")
def ready():
    try:
        with get_connection() as connection:
            connection.execute("SELECT 1").fetchone()
    except Exception as error:
        raise HTTPException(status_code=503, detail={"status": "not_ready", "database": "unavailable"}) from error

    config_errors = config.production_config_errors()
    if config_errors:
        raise HTTPException(status_code=503, detail={"status": "not_ready", "config_errors": config_errors})

    return {
        "status": "ready",
        "service": "arca-api",
        "environment": config.ARCA_ENV,
        "database": "ok",
    }


@app.get("/providers/status")
def get_provider_status():
    status = provider_status()
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT target, condition_params FROM policies
            WHERE category = 'flight'
            ORDER BY created_at DESC
            """
        ).fetchall()

    latest_health = None
    for row in rows:
        params = json.loads(row["condition_params"]) if isinstance(row["condition_params"], str) else row["condition_params"]
        if params.get("provider_checked_at"):
            latest_health = {
                "last_checked_at": params.get("provider_checked_at"),
                "last_success_at": params.get("provider_checked_at") if params.get("provider_ok") else None,
                "last_ident": row["target"],
                "last_status": params.get("flight_status"),
                "last_delay_minutes": params.get("observed_delay_minutes"),
                "last_error": params.get("provider_error"),
            }
            break

    if latest_health and not status["flightaware"]["health"].get("last_checked_at"):
        status["flightaware"]["health"] = latest_health
    return status


@app.get("/reserve/status", response_model=ReserveStatusOut)
def reserve_status():
    return get_reserve_status()


@app.post("/users", response_model=UserOut)
def create_user(payload: UserCreate, request: Request):
    user_id = new_id("user")
    created_at = now_iso()
    privy_user_id = current_user_id(request) if config.AUTH_REQUIRED else None
    with get_connection() as connection:
        existing = connection.execute("SELECT * FROM users WHERE email = ?", (payload.email,)).fetchone()
        if existing:
            if privy_user_id and not existing["privy_user_id"]:
                connection.execute("UPDATE users SET privy_user_id = ? WHERE id = ?", (privy_user_id, existing["id"]))
                existing = connection.execute("SELECT * FROM users WHERE id = ?", (existing["id"],)).fetchone()
            return row_to_dict(existing)
        connection.execute(
            "INSERT INTO users (id, email, privy_user_id, phone, rialo_address, kyc_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, payload.email, privy_user_id, payload.phone, payload.rialo_address, "pending", created_at),
        )
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return row_to_dict(row)


@app.get("/auth/me")
def auth_me(request: Request):
    principal = current_user_id(request)
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE id = ? OR privy_user_id = ?",
            (principal, principal),
        ).fetchone()
    return {
        "authenticated_user_id": principal,
        "arca_user_id": row["id"] if row else None,
        "user": row_to_dict(row) if row else None,
    }


@app.get("/users/{user_id}", response_model=UserOut)
def get_user(user_id: str, request: Request):
    assert_user_access(user_id, request)
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return row_to_dict(row)


@app.post("/quotes", response_model=QuoteOut)
def create_quote(payload: QuoteRequest):
    return quote_policy(payload)


def create_policy_record(payload: PolicyCreate) -> dict:
    assert_reserve_capacity(payload.quote.payout)
    policy_id = new_id("policy")
    created_at = now_iso()
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=36)).isoformat()
    contract_address = f"0x{new_id('').replace('_', '')[:18]}"

    category_type = {
        "flight": "Aviation Delay",
        "weather": "Weather Parametric",
        "logistics": "Logistics SLA",
    }[payload.quote.category]

    default_status = {
        "flight": "On Time (0m Delay)",
        "weather": "Monitoring Rainfall",
        "logistics": "In Transit",
    }[payload.quote.category]

    with get_connection() as connection:
        user = connection.execute("SELECT id FROM users WHERE id = ?", (payload.user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        connection.execute(
            """
            INSERT INTO policies (
              id, user_id, category, type, status, premium, payout, contract_address, target, trigger,
              engine, oracle, source, current_status, condition_params, created_at, triggered_at,
              paid_at, expired_at, expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                policy_id,
                payload.user_id,
                payload.quote.category,
                category_type,
                "active",
                payload.quote.premium,
                payload.quote.payout,
                contract_address,
                payload.quote.target,
                payload.quote.trigger,
                payload.quote.engine,
                payload.quote.oracle,
                payload.quote.source,
                default_status,
                json.dumps(payload.quote.condition_params),
                created_at,
                None,
                None,
                None,
                expires_at,
            ),
        )
        add_ledger_event(connection, payload.user_id, "policy", policy_id, "premium_collected", -payload.quote.premium, {"target": payload.quote.target})
        add_reserve_event(connection, payload.user_id, "policy", policy_id, "premium_collected", payload.quote.premium, {"target": payload.quote.target})
        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
    return row_to_dict(row)


@app.post("/policies", response_model=PolicyOut)
def create_policy(payload: PolicyCreate, request: Request):
    assert_user_access(payload.user_id, request)
    return create_policy_record(payload)


@app.post("/partners/policies", response_model=PartnerPolicyOut)
def create_partner_policy(payload: PartnerPolicyCreate, request: Request):
    assert_partner_access(payload.partner_id, request)
    quote = quote_policy(payload.quote_request)
    policy = create_policy_record(PolicyCreate(user_id=payload.user_id, quote=QuoteOut(**quote)))
    policy["condition_params"] = {
        **policy.get("condition_params", {}),
        "partner_id": payload.partner_id,
        "external_reference": payload.external_reference,
        "customer_email": payload.customer_email,
    }
    with get_connection() as connection:
        connection.execute(
            "UPDATE policies SET condition_params = ? WHERE id = ?",
            (json.dumps(policy["condition_params"]), policy["id"]),
        )
        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy["id"],)).fetchone()

    return {
        "partner_id": payload.partner_id,
        "external_reference": payload.external_reference,
        "quote": quote,
        "policy": row_to_dict(row),
    }


def delay_threshold_minutes(policy: dict) -> int:
    params = json.loads(policy["condition_params"]) if isinstance(policy["condition_params"], str) else policy["condition_params"]
    try:
        return int(params.get("delay_minutes") or 120)
    except (TypeError, ValueError):
        return 120


def rainfall_threshold_mm(policy: dict) -> float:
    params = policy_condition_params(policy)
    try:
        return float(params.get("rainfall_mm") or 10)
    except (TypeError, ValueError):
        return 10


def transit_threshold_hours(policy: dict) -> float:
    params = policy_condition_params(policy)
    try:
        return float(params.get("max_transit_hours") or 48)
    except (TypeError, ValueError):
        return 48


def policy_condition_params(policy: dict) -> dict:
    params = policy["condition_params"]
    if isinstance(params, str):
        return json.loads(params)
    return dict(params or {})


def settle_policy_row(connection, policy, trigger_data: dict, paid_at: str):
    existing = connection.execute("SELECT * FROM payouts WHERE policy_id = ? AND status = 'paid'", (policy["id"],)).fetchone()
    if existing:
        return existing

    payout_id = new_id("payout")
    tx_hash = f"0x{new_id('').replace('_', '')[:32]}"
    connection.execute(
        "UPDATE policies SET status = ?, current_status = ?, triggered_at = COALESCE(triggered_at, ?), paid_at = ? WHERE id = ?",
        ("paid", "Payout Executed", paid_at, paid_at, policy["id"]),
    )
    connection.execute(
        "INSERT INTO payouts (id, policy_id, user_id, amount, trigger_data, tx_hash, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (payout_id, policy["id"], policy["user_id"], policy["payout"], json.dumps(trigger_data), tx_hash, "paid", paid_at),
    )
    add_ledger_event(connection, policy["user_id"], "payout", payout_id, "payout_paid", policy["payout"], trigger_data)
    add_reserve_event(connection, policy["user_id"], "payout", payout_id, "payout_paid", -policy["payout"], trigger_data)
    return connection.execute("SELECT * FROM payouts WHERE id = ?", (payout_id,)).fetchone()


def sync_flight_policy(policy_id: str) -> dict | None:
    checked_at = now_iso()
    with get_connection() as connection:
        policy = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
        if not policy or policy["category"] != "flight" or policy["status"] not in ("active", "triggered"):
            return row_to_dict(policy) if policy else None

        expires_at = datetime.fromisoformat(policy["expires_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expires_at and policy["status"] == "active":
            connection.execute(
                "UPDATE policies SET status = ?, current_status = ?, expired_at = ? WHERE id = ?",
                ("expired", "Policy expired without delay trigger", checked_at, policy_id),
            )
            row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
            return row_to_dict(row)

        snapshot = fetch_flightaware_snapshot(policy["target"])
        threshold = delay_threshold_minutes(policy)
        observed_delay = int(snapshot.get("delay_minutes") or 0)
        status_text = snapshot.get("status") or f"Observed delay {observed_delay}m"
        params = policy_condition_params(policy)
        params.update(
            {
                "provider_ok": bool(snapshot.get("ok")),
                "provider_checked_at": snapshot.get("checked_at"),
                "observed_delay_minutes": observed_delay,
                "flight_status": status_text,
                "flight_origin": snapshot.get("origin"),
                "flight_destination": snapshot.get("destination"),
            }
        )
        metadata = {
            "target": policy["target"],
            "trigger": policy["trigger"],
            "policy_id": policy_id,
            "provider": snapshot.get("provider"),
            "checked_at": snapshot.get("checked_at"),
            "observed_delay_minutes": observed_delay,
            "threshold_minutes": threshold,
            "flight_status": status_text,
            "origin": snapshot.get("origin"),
            "destination": snapshot.get("destination"),
        }

        if snapshot.get("ok") and observed_delay >= threshold:
            connection.execute(
                "UPDATE policies SET condition_params = ? WHERE id = ?",
                (json.dumps(params), policy_id),
            )
            trigger_exists = connection.execute(
                "SELECT id FROM ledger_events WHERE entity_type = 'policy' AND entity_id = ? AND event_type = 'trigger_met'",
                (policy_id,),
            ).fetchone()
            if not trigger_exists:
                add_ledger_event(connection, policy["user_id"], "policy", policy_id, "trigger_met", 0, metadata)
            settle_policy_row(connection, policy, metadata, checked_at)
        elif snapshot.get("ok"):
            connection.execute(
                "UPDATE policies SET current_status = ?, condition_params = ? WHERE id = ?",
                (f"{status_text} ({observed_delay}m delay observed)", json.dumps(params), policy_id),
            )
        else:
            params.update({"provider_ok": False, "provider_checked_at": snapshot.get("checked_at"), "provider_error": snapshot.get("error")})
            connection.execute(
                "UPDATE policies SET current_status = ?, condition_params = ? WHERE id = ?",
                (f"Flight data pending: {snapshot.get('error', 'provider unavailable')}", json.dumps(params), policy_id),
            )

        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
    return row_to_dict(row)


def sync_weather_policy(policy_id: str) -> dict | None:
    checked_at = now_iso()
    with get_connection() as connection:
        policy = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
        if not policy or policy["category"] != "weather" or policy["status"] not in ("active", "triggered"):
            return row_to_dict(policy) if policy else None

        expires_at = datetime.fromisoformat(policy["expires_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expires_at and policy["status"] == "active":
            connection.execute(
                "UPDATE policies SET status = ?, current_status = ?, expired_at = ? WHERE id = ?",
                ("expired", "Policy expired without rainfall trigger", checked_at, policy_id),
            )
            row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
            return row_to_dict(row)

        snapshot = fetch_open_meteo_snapshot()
        current = snapshot.get("current", {})
        threshold = rainfall_threshold_mm(policy)
        observed_rain = float(current.get("rain") or 0)
        observed_precipitation = float(current.get("precipitation") or 0)
        forecast_sum = float(snapshot.get("forecast_precipitation_sum_mm") or observed_precipitation or observed_rain or 0)
        params = policy_condition_params(policy)
        params.update(
            {
                "provider_ok": bool(snapshot.get("ok")),
                "provider_checked_at": snapshot.get("checked_at"),
                "observed_rain_mm": observed_rain,
                "observed_precipitation_mm": observed_precipitation,
                "forecast_precipitation_sum_mm": forecast_sum,
                "latitude": snapshot.get("latitude"),
                "longitude": snapshot.get("longitude"),
                "weather_simulated": bool(snapshot.get("simulated")),
            }
        )
        metadata = {
            "target": policy["target"],
            "trigger": policy["trigger"],
            "policy_id": policy_id,
            "provider": snapshot.get("provider"),
            "checked_at": snapshot.get("checked_at"),
            "observed_rain_mm": observed_rain,
            "forecast_precipitation_sum_mm": forecast_sum,
            "threshold_mm": threshold,
            "demo": bool(snapshot.get("simulated")),
        }

        if snapshot.get("ok") and forecast_sum < threshold:
            connection.execute(
                "UPDATE policies SET condition_params = ? WHERE id = ?",
                (json.dumps(params), policy_id),
            )
            trigger_exists = connection.execute(
                "SELECT id FROM ledger_events WHERE entity_type = 'policy' AND entity_id = ? AND event_type = 'trigger_met'",
                (policy_id,),
            ).fetchone()
            if not trigger_exists:
                add_ledger_event(connection, policy["user_id"], "policy", policy_id, "trigger_met", 0, metadata)
            settle_policy_row(connection, policy, metadata, checked_at)
        elif snapshot.get("ok"):
            connection.execute(
                "UPDATE policies SET current_status = ?, condition_params = ? WHERE id = ?",
                (f"Forecast rainfall {forecast_sum:g}mm observed", json.dumps(params), policy_id),
            )
        else:
            params.update({"provider_ok": False, "provider_checked_at": snapshot.get("checked_at"), "provider_error": snapshot.get("error")})
            connection.execute(
                "UPDATE policies SET current_status = ?, condition_params = ? WHERE id = ?",
                (f"Weather data pending: {snapshot.get('error', 'provider unavailable')}", json.dumps(params), policy_id),
            )

        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
    return row_to_dict(row)


def sync_logistics_policy(policy_id: str) -> dict | None:
    checked_at = now_iso()
    with get_connection() as connection:
        policy = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
        if not policy or policy["category"] != "logistics" or policy["status"] not in ("active", "triggered"):
            return row_to_dict(policy) if policy else None

        expires_at = datetime.fromisoformat(policy["expires_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expires_at and policy["status"] == "active":
            connection.execute(
                "UPDATE policies SET status = ?, current_status = ?, expired_at = ? WHERE id = ?",
                ("expired", "Policy expired without SLA breach", checked_at, policy_id),
            )
            row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
            return row_to_dict(row)

        snapshot = fetch_logistics_snapshot(policy["target"])
        threshold = transit_threshold_hours(policy)
        observed_hours = float(snapshot.get("transit_hours") or 0)
        status_text = snapshot.get("status") or "In Transit"
        params = policy_condition_params(policy)
        params.update(
            {
                "provider_ok": bool(snapshot.get("ok")),
                "provider_checked_at": snapshot.get("checked_at"),
                "observed_transit_hours": observed_hours,
                "shipment_status": status_text,
                "shipment_location": snapshot.get("location"),
                "shipment_eta": snapshot.get("eta"),
                "logistics_demo_mode": bool(snapshot.get("simulated")),
            }
        )
        metadata = {
            "target": policy["target"],
            "trigger": policy["trigger"],
            "policy_id": policy_id,
            "provider": snapshot.get("provider"),
            "checked_at": snapshot.get("checked_at"),
            "observed_transit_hours": observed_hours,
            "threshold_hours": threshold,
            "shipment_status": status_text,
            "shipment_location": snapshot.get("location"),
            "demo": bool(snapshot.get("simulated")),
        }

        if snapshot.get("ok") and observed_hours > threshold:
            connection.execute(
                "UPDATE policies SET condition_params = ? WHERE id = ?",
                (json.dumps(params), policy_id),
            )
            trigger_exists = connection.execute(
                "SELECT id FROM ledger_events WHERE entity_type = 'policy' AND entity_id = ? AND event_type = 'trigger_met'",
                (policy_id,),
            ).fetchone()
            if not trigger_exists:
                add_ledger_event(connection, policy["user_id"], "policy", policy_id, "trigger_met", 0, metadata)
            settle_policy_row(connection, policy, metadata, checked_at)
        elif snapshot.get("ok"):
            connection.execute(
                "UPDATE policies SET current_status = ?, condition_params = ? WHERE id = ?",
                (f"{status_text} ({observed_hours:g}h transit observed)", json.dumps(params), policy_id),
            )
        else:
            params.update({"provider_ok": False, "provider_checked_at": snapshot.get("checked_at"), "provider_error": snapshot.get("error")})
            connection.execute(
                "UPDATE policies SET current_status = ?, condition_params = ? WHERE id = ?",
                (f"Logistics data pending: {snapshot.get('error', 'provider unavailable')}", json.dumps(params), policy_id),
            )

        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
    return row_to_dict(row)


def sync_policy_by_category(policy_id: str) -> dict | None:
    with get_connection() as connection:
        policy = connection.execute("SELECT category FROM policies WHERE id = ?", (policy_id,)).fetchone()
    if not policy:
        return None
    if policy["category"] == "flight":
        return sync_flight_policy(policy_id)
    if policy["category"] == "weather":
        return sync_weather_policy(policy_id)
    if policy["category"] == "logistics":
        return sync_logistics_policy(policy_id)
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
    return row_to_dict(row)


def sync_user_monitoring_policies(user_id: str) -> list[dict]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id FROM policies
            WHERE user_id = ?
              AND category IN ('flight', 'weather', 'logistics')
              AND status IN ('active', 'triggered')
            ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()
    return [policy for policy in (sync_policy_by_category(row["id"]) for row in rows) if policy]


def sync_all_monitoring_policies() -> list[dict]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id FROM policies
            WHERE category IN ('flight', 'weather', 'logistics')
              AND status IN ('active', 'triggered')
            ORDER BY created_at DESC
            """
        ).fetchall()
    return [policy for policy in (sync_policy_by_category(row["id"]) for row in rows) if policy]


async def periodic_policy_sync(interval: int):
    while True:
        await asyncio.sleep(interval)
        try:
            synced = await asyncio.to_thread(sync_all_monitoring_policies)
            paid = [policy for policy in synced if policy.get("status") == "paid"]
            if synced:
                print(f"Synced {len(synced)} monitored policy/policies; {len(paid)} paid.")
        except Exception as error:
            print(f"Policy sync failed: {error}")


@app.get("/users/{user_id}/policies", response_model=list[PolicyOut])
def list_policies(user_id: str, request: Request):
    assert_user_access(user_id, request)
    sync_user_monitoring_policies(user_id)
    with get_connection() as connection:
        rows = connection.execute("SELECT * FROM policies WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    return [row_to_dict(row) for row in rows]


@app.get("/policies/{policy_id}", response_model=PolicyOut)
def get_policy(policy_id: str, request: Request):
    sync_policy_by_category(policy_id)
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Policy not found")
    assert_user_access(row["user_id"], request)
    return row_to_dict(row)


@app.post("/users/{user_id}/policies/sync", response_model=list[PolicyOut])
def sync_policies(user_id: str, request: Request):
    assert_user_access(user_id, request)
    return sync_user_monitoring_policies(user_id)


@app.post("/policies/{policy_id}/sync", response_model=PolicyOut)
def sync_policy(policy_id: str, request: Request):
    policy = sync_policy_by_category(policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    assert_user_access(policy["user_id"], request)
    return policy


@app.post("/dev/policies/{policy_id}/simulate-flight-delay", response_model=PolicyOut)
def simulate_flight_delay(request: Request, policy_id: str, delay_minutes: int = Query(default=180, ge=0, le=1440)):
    assert_dev_access(request)
    checked_at = now_iso()
    with get_connection() as connection:
        policy = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
        if not policy:
            raise HTTPException(status_code=404, detail="Policy not found")
        if policy["category"] != "flight":
            raise HTTPException(status_code=400, detail="Demo delay simulation is only available for flight policies")
        if policy["status"] not in ("active", "triggered"):
            raise HTTPException(status_code=409, detail="Policy cannot be simulated")

        threshold = delay_threshold_minutes(policy)
        params = policy_condition_params(policy)
        params.update(
            {
                "provider_ok": True,
                "provider_checked_at": checked_at,
                "observed_delay_minutes": delay_minutes,
                "flight_status": "Delayed",
                "flight_origin": None,
                "flight_destination": None,
                "demo_delay": True,
            }
        )
        metadata = {
            "target": policy["target"],
            "trigger": policy["trigger"],
            "policy_id": policy_id,
            "provider": "FlightAware AeroAPI",
            "checked_at": checked_at,
            "observed_delay_minutes": delay_minutes,
            "threshold_minutes": threshold,
            "flight_status": "Delayed",
            "origin": None,
            "destination": None,
            "demo": True,
        }

        if delay_minutes >= threshold:
            connection.execute(
                "UPDATE policies SET condition_params = ? WHERE id = ?",
                (json.dumps(params), policy_id),
            )
            trigger_exists = connection.execute(
                "SELECT id FROM ledger_events WHERE entity_type = 'policy' AND entity_id = ? AND event_type = 'trigger_met'",
                (policy_id,),
            ).fetchone()
            if not trigger_exists:
                add_ledger_event(connection, policy["user_id"], "policy", policy_id, "trigger_met", 0, metadata)
            settle_policy_row(connection, policy, metadata, checked_at)
        else:
            connection.execute(
                "UPDATE policies SET current_status = ?, condition_params = ? WHERE id = ?",
                (f"Delayed ({delay_minutes}m delay observed)", json.dumps(params), policy_id),
            )

        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
    return row_to_dict(row)


@app.post("/dev/policies/{policy_id}/simulate-weather-rainfall", response_model=PolicyOut)
def simulate_weather_rainfall(request: Request, policy_id: str, rainfall_mm: float = Query(default=0, ge=0, le=1000)):
    assert_dev_access(request)
    checked_at = now_iso()
    with get_connection() as connection:
        policy = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
        if not policy:
            raise HTTPException(status_code=404, detail="Policy not found")
        if policy["category"] != "weather":
            raise HTTPException(status_code=400, detail="Demo rainfall simulation is only available for weather policies")
        if policy["status"] not in ("active", "triggered"):
            raise HTTPException(status_code=409, detail="Policy cannot be simulated")

        threshold = rainfall_threshold_mm(policy)
        params = policy_condition_params(policy)
        params.update(
            {
                "provider_ok": True,
                "provider_checked_at": checked_at,
                "observed_rain_mm": rainfall_mm,
                "observed_precipitation_mm": rainfall_mm,
                "forecast_precipitation_sum_mm": rainfall_mm,
                "weather_simulated": True,
            }
        )
        metadata = {
            "target": policy["target"],
            "trigger": policy["trigger"],
            "policy_id": policy_id,
            "provider": "Open-Meteo",
            "checked_at": checked_at,
            "observed_rain_mm": rainfall_mm,
            "forecast_precipitation_sum_mm": rainfall_mm,
            "threshold_mm": threshold,
            "demo": True,
        }

        if rainfall_mm < threshold:
            connection.execute(
                "UPDATE policies SET condition_params = ? WHERE id = ?",
                (json.dumps(params), policy_id),
            )
            trigger_exists = connection.execute(
                "SELECT id FROM ledger_events WHERE entity_type = 'policy' AND entity_id = ? AND event_type = 'trigger_met'",
                (policy_id,),
            ).fetchone()
            if not trigger_exists:
                add_ledger_event(connection, policy["user_id"], "policy", policy_id, "trigger_met", 0, metadata)
            settle_policy_row(connection, policy, metadata, checked_at)
        else:
            connection.execute(
                "UPDATE policies SET current_status = ?, condition_params = ? WHERE id = ?",
                (f"Forecast rainfall {rainfall_mm:g}mm observed", json.dumps(params), policy_id),
            )

        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
    return row_to_dict(row)


@app.post("/dev/policies/{policy_id}/simulate-logistics-delay", response_model=PolicyOut)
def simulate_logistics_delay(request: Request, policy_id: str, transit_hours: float = Query(default=72, ge=0, le=10000)):
    assert_dev_access(request)
    checked_at = now_iso()
    with get_connection() as connection:
        policy = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
        if not policy:
            raise HTTPException(status_code=404, detail="Policy not found")
        if policy["category"] != "logistics":
            raise HTTPException(status_code=400, detail="Demo SLA simulation is only available for logistics policies")
        if policy["status"] not in ("active", "triggered"):
            raise HTTPException(status_code=409, detail="Policy cannot be simulated")

        threshold = transit_threshold_hours(policy)
        params = policy_condition_params(policy)
        params.update(
            {
                "provider_ok": True,
                "provider_checked_at": checked_at,
                "observed_transit_hours": transit_hours,
                "shipment_status": "Delayed",
                "shipment_location": "Demo checkpoint",
                "logistics_demo_mode": True,
            }
        )
        metadata = {
            "target": policy["target"],
            "trigger": policy["trigger"],
            "policy_id": policy_id,
            "provider": "Arca simulated carrier feed",
            "checked_at": checked_at,
            "observed_transit_hours": transit_hours,
            "threshold_hours": threshold,
            "shipment_status": "Delayed",
            "shipment_location": "Demo checkpoint",
            "demo": True,
        }

        if transit_hours > threshold:
            connection.execute(
                "UPDATE policies SET condition_params = ? WHERE id = ?",
                (json.dumps(params), policy_id),
            )
            trigger_exists = connection.execute(
                "SELECT id FROM ledger_events WHERE entity_type = 'policy' AND entity_id = ? AND event_type = 'trigger_met'",
                (policy_id,),
            ).fetchone()
            if not trigger_exists:
                add_ledger_event(connection, policy["user_id"], "policy", policy_id, "trigger_met", 0, metadata)
            settle_policy_row(connection, policy, metadata, checked_at)
        else:
            connection.execute(
                "UPDATE policies SET current_status = ?, condition_params = ? WHERE id = ?",
                (f"In Transit ({transit_hours:g}h transit observed)", json.dumps(params), policy_id),
            )

        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
    return row_to_dict(row)


@app.post("/policies/{policy_id}/trigger", response_model=PolicyOut)
def trigger_policy(policy_id: str, payload: TriggerRequest, request: Request):
    triggered_at = now_iso()
    with get_connection() as connection:
        policy = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
        if not policy:
            raise HTTPException(status_code=404, detail="Policy not found")
        assert_user_access(policy["user_id"], request)
        if policy["status"] != "active":
            raise HTTPException(status_code=409, detail="Policy is not active")
        connection.execute(
            "UPDATE policies SET status = ?, current_status = ?, triggered_at = ? WHERE id = ?",
            ("triggered", "Threshold Breached", triggered_at, policy_id),
        )
        add_ledger_event(connection, policy["user_id"], "policy", policy_id, "trigger_met", 0, payload.model_dump())
        row = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
    return row_to_dict(row)


@app.post("/policies/{policy_id}/settle", response_model=PayoutOut)
def settle_policy(policy_id: str, request: Request):
    paid_at = now_iso()
    with get_connection() as connection:
        policy = connection.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
        if not policy:
            raise HTTPException(status_code=404, detail="Policy not found")
        assert_user_access(policy["user_id"], request)
        if policy["status"] not in ("triggered", "active"):
            raise HTTPException(status_code=409, detail="Policy cannot be settled")
        trigger_data = {"target": policy["target"], "trigger": policy["trigger"], "source": policy["source"], "policy_id": policy_id}
        row = settle_policy_row(connection, policy, trigger_data, paid_at)
    return row_to_dict(row)


@app.get("/users/{user_id}/balance", response_model=BalanceOut)
def user_balance(user_id: str, request: Request):
    assert_user_access(user_id, request)
    return get_balance(user_id)


def pending_circle_withdrawal_user_ids() -> list[str]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT DISTINCT user_id FROM withdrawals
            WHERE rail = 'circle'
              AND transfer_id IS NOT NULL
              AND status IN ('initiated', 'processing')
            """
        ).fetchall()
    return [row["user_id"] for row in rows]


def sync_all_circle_withdrawals() -> list[dict]:
    synced = []
    for user_id in pending_circle_withdrawal_user_ids():
        synced.extend(sync_circle_withdrawals(user_id))
    return synced


async def periodic_withdrawal_sync(interval: int):
    while True:
        await asyncio.sleep(interval)
        try:
            synced = await asyncio.to_thread(sync_all_circle_withdrawals)
            if synced:
                print(f"Synced {len(synced)} Circle payout withdrawal(s).")
        except Exception as error:
            print(f"Withdrawal sync failed: {error}")


async def periodic_circle_retry():
    interval = max(10, config.CIRCLE_RETRY_WORKER_INTERVAL_SECONDS)
    while True:
        await asyncio.sleep(interval)
        try:
            result = await asyncio.to_thread(retry_due_circle_transfer_attempts, config.CIRCLE_RETRY_WORKER_BATCH_SIZE)
            if result["retried"] or result["needs_review"]:
                log_event(
                    "circle_retry_worker",
                    retried=result["retried"],
                    needs_review=result["needs_review"],
                )
        except Exception as error:
            log_event("circle_retry_worker_error", error=str(error))


def sync_circle_withdrawals(user_id: str) -> list[dict]:
    status = circle_status()
    if not status["ok"]:
        return []

    synced = []
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM withdrawals
            WHERE user_id = ?
              AND rail = 'circle'
              AND transfer_id IS NOT NULL
              AND status IN ('initiated', 'processing')
            ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()

        for row in rows:
            tx = find_circle_transfer_by_id(status["base_wallet_address"], row["transfer_id"])
            if not tx:
                continue

            payload = transfer_payload_from_transaction(
                tx,
                status,
                row["destination_wallet_address"],
                float(row["amount"]),
                row["id"],
            )
            next_status = payload.get("status", row["status"])
            next_rail_status = payload.get("rail_status", row["rail_status"])
            connection.execute(
                """
                UPDATE withdrawals
                SET status = ?, rail_status = ?, tx_hash = ?, transfer_payload = ?
                WHERE id = ?
                """,
                (
                    next_status,
                    next_rail_status,
                    payload.get("tx_hash") or row["tx_hash"],
                    json.dumps(payload),
                    row["id"],
                ),
            )
            synced.append({"id": row["id"], "status": next_status, "rail_status": next_rail_status, "tx_hash": payload.get("tx_hash")})

    return synced


def circle_attempt_next_retry(status: str, attempt_count: int, rail_status: str | None = None) -> str | None:
    if status in {"complete", "processing", "needs_review"}:
        return None
    if rail_status == "ready_not_broadcast":
        return None
    if attempt_count >= config.CIRCLE_RETRY_MAX_ATTEMPTS:
        return None
    delay = config.CIRCLE_RETRY_DELAY_SECONDS * (config.CIRCLE_RETRY_BACKOFF_MULTIPLIER ** max(0, attempt_count - 1))
    delay = min(delay, config.CIRCLE_RETRY_MAX_DELAY_SECONDS)
    return (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat()


def circle_attempt_terminal_status(status: str, attempt_count: int) -> tuple[str, str | None]:
    if status in {"complete", "processing", "initiated"}:
        return status, None
    if attempt_count >= config.CIRCLE_RETRY_MAX_ATTEMPTS:
        return "needs_review", "Circle retry limit reached. Operator review is required before another attempt."
    return status, None


def ensure_withdrawal_ledger(connection, withdrawal) -> None:
    existing = connection.execute(
        "SELECT id FROM ledger_events WHERE entity_type = 'withdrawal' AND entity_id = ?",
        (withdrawal["id"],),
    ).fetchone()
    if existing:
        return

    add_ledger_event(
        connection,
        withdrawal["user_id"],
        "withdrawal",
        withdrawal["id"],
        "withdrawal_initiated",
        -float(withdrawal["amount"]),
        {
            "destination": withdrawal["destination_name"],
            "rail": withdrawal["rail"],
            "rail_status": withdrawal["rail_status"],
            "destination_wallet_address": withdrawal["destination_wallet_address"],
            "tx_hash": withdrawal["tx_hash"],
        },
    )


def reconcile_circle_attempt(connection, attempt: dict, status: dict | None = None) -> dict | None:
    request_payload = attempt["request_payload"]
    status = status or circle_status()
    source_address = status.get("base_wallet_address")
    if not status.get("ok") or not source_address:
        return None

    matched_transfer = None
    if attempt.get("transfer_id"):
        matched_transfer = find_circle_transfer_by_id(source_address, attempt["transfer_id"])
    if not matched_transfer and attempt.get("last_attempt_at"):
        matched_transfer = find_matching_circle_transfer(
            source_address,
            request_payload["destination_wallet_address"],
            float(request_payload["amount"]),
            attempt["last_attempt_at"],
        )
    if not matched_transfer:
        return None

    transfer = transfer_payload_from_transaction(
        matched_transfer,
        status,
        request_payload["destination_wallet_address"],
        float(request_payload["amount"]),
        attempt["withdrawal_id"],
    )
    next_status = transfer.get("status") or "processing"
    updated_at = now_iso()
    connection.execute(
        """
        UPDATE circle_transfer_attempts
        SET status = ?, response_payload = ?, error = NULL, next_attempt_at = NULL,
            locked_at = NULL, review_reason = NULL, updated_at = ?
        WHERE id = ?
        """,
        (next_status, json.dumps(transfer), updated_at, attempt["id"]),
    )
    connection.execute(
        """
        UPDATE withdrawals
        SET status = ?, rail_status = ?, transfer_id = ?, tx_hash = ?, transfer_payload = ?
        WHERE id = ?
        """,
        (
            next_status,
            transfer.get("rail_status"),
            transfer.get("transfer_id"),
            transfer.get("tx_hash") or attempt.get("tx_hash"),
            json.dumps(transfer),
            attempt["withdrawal_id"],
        ),
    )
    withdrawal = connection.execute("SELECT * FROM withdrawals WHERE id = ?", (attempt["withdrawal_id"],)).fetchone()
    if withdrawal and next_status != "failed":
        ensure_withdrawal_ledger(connection, withdrawal)
    return row_to_dict(connection.execute("SELECT * FROM circle_transfer_attempts WHERE id = ?", (attempt["id"],)).fetchone())


def mark_circle_attempt_needs_review(connection, attempt_id: str, reason: str) -> dict:
    updated_at = now_iso()
    connection.execute(
        """
        UPDATE circle_transfer_attempts
        SET status = 'needs_review', next_attempt_at = NULL, locked_at = NULL,
            review_reason = ?, updated_at = ?
        WHERE id = ?
        """,
        (reason, updated_at, attempt_id),
    )
    row = connection.execute("SELECT * FROM circle_transfer_attempts WHERE id = ?", (attempt_id,)).fetchone()
    return row_to_dict(row)


def retry_circle_transfer_attempt(attempt_id: str) -> dict:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
              attempts.*,
              withdrawals.user_id,
              withdrawals.amount,
              withdrawals.destination_name,
              withdrawals.destination_wallet_address,
              withdrawals.destination_chain,
              withdrawals.rail,
              withdrawals.rail_status AS withdrawal_rail_status,
              withdrawals.transfer_id,
              withdrawals.tx_hash
            FROM circle_transfer_attempts AS attempts
            JOIN withdrawals ON withdrawals.id = attempts.withdrawal_id
            WHERE attempts.id = ?
            """,
            (attempt_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Circle transfer attempt not found")

        attempt = row_to_dict(row)
        if attempt["status"] in {"complete", "processing"}:
            return attempt
        if attempt["status"] == "needs_review":
            raise HTTPException(status_code=409, detail="Circle transfer attempt requires operator review")

        reconciled = reconcile_circle_attempt(connection, attempt)
        if reconciled:
            return reconciled

        if attempt["attempt_count"] >= config.CIRCLE_RETRY_MAX_ATTEMPTS:
            return mark_circle_attempt_needs_review(
                connection,
                attempt_id,
                "Circle retry limit reached. Operator review is required before another attempt.",
            )

        request_payload = attempt["request_payload"]
        attempted_at = now_iso()
        connection.execute(
            "UPDATE circle_transfer_attempts SET locked_at = ?, updated_at = ? WHERE id = ?",
            (attempted_at, attempted_at, attempt_id),
        )
        transfer = execute_circle_usdc_transfer(
            request_payload["destination_wallet_address"],
            float(request_payload["amount"]),
            attempt["withdrawal_id"],
            attempted_at,
        )
        next_status = "failed" if not transfer["ok"] else transfer.get("status") or ("processing" if transfer["broadcast"] else "initiated")
        next_rail_status = "failed" if not transfer["ok"] else transfer["rail_status"]
        attempt_count = int(attempt["attempt_count"]) + 1
        next_status, review_reason = circle_attempt_terminal_status(next_status, attempt_count)
        next_attempt_at = circle_attempt_next_retry(next_status, attempt_count, next_rail_status)

        connection.execute(
            """
            UPDATE circle_transfer_attempts
            SET status = ?, response_payload = ?, error = ?, attempt_count = ?,
                next_attempt_at = ?, last_attempt_at = ?, locked_at = NULL,
                review_reason = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                next_status,
                json.dumps(transfer),
                transfer.get("error") if isinstance(transfer, dict) else None,
                attempt_count,
                next_attempt_at,
                attempted_at,
                review_reason,
                now_iso(),
                attempt_id,
            ),
        )
        connection.execute(
            """
            UPDATE withdrawals
            SET status = ?, rail_status = ?, transfer_id = ?, tx_hash = ?, transfer_payload = ?
            WHERE id = ?
            """,
            (
                next_status,
                next_rail_status,
                transfer.get("transfer_id"),
                transfer.get("tx_hash") or row["tx_hash"],
                json.dumps(transfer),
                attempt["withdrawal_id"],
            ),
        )
        withdrawal = connection.execute("SELECT * FROM withdrawals WHERE id = ?", (attempt["withdrawal_id"],)).fetchone()
        if next_status != "failed":
            ensure_withdrawal_ledger(connection, withdrawal)
        updated = connection.execute("SELECT * FROM circle_transfer_attempts WHERE id = ?", (attempt_id,)).fetchone()
    return row_to_dict(updated)


@app.post("/withdrawals", response_model=WithdrawalOut)
def create_withdrawal(payload: WithdrawalCreate, request: Request):
    assert_user_access(payload.user_id, request)
    idempotency_key = payload.idempotency_key or request.headers.get("x-idempotency-key") or new_id("idem")
    with get_connection() as connection:
        existing = connection.execute(
            "SELECT * FROM withdrawals WHERE user_id = ? AND idempotency_key = ?",
            (payload.user_id, idempotency_key),
        ).fetchone()
        if existing:
            return row_to_dict(existing)

    balance = get_balance(payload.user_id)
    if payload.amount > balance["available_balance"]:
        raise HTTPException(status_code=409, detail="Insufficient available balance")

    withdrawal_id = new_id("withdrawal")
    created_at = now_iso()
    rail = "circle" if payload.destination_wallet_address else "bank"
    transfer_payload = None
    transfer_id = None
    tx_hash = None
    rail_status = "fiat_pending"
    withdrawal_status = "initiated"

    if payload.destination_wallet_address:
        if payload.destination_chain != "BASE":
            raise HTTPException(status_code=400, detail="Circle withdrawals currently support BASE USDC only")
        transfer = execute_circle_usdc_transfer(payload.destination_wallet_address, payload.amount, withdrawal_id, created_at)
        transfer_payload = transfer
        transfer_id = transfer.get("transfer_id")
        tx_hash = transfer.get("tx_hash")
        rail_status = transfer["rail_status"]
        if not transfer["ok"]:
            withdrawal_status = "failed"
            rail_status = "failed"
        else:
            withdrawal_status = transfer.get("status") or ("processing" if transfer["broadcast"] else "initiated")

    next_attempt_at = circle_attempt_next_retry(withdrawal_status, 1, rail_status) if rail == "circle" else None

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO withdrawals (
              id, user_id, amount, destination_name, destination_iban, destination_swift,
              destination_wallet_address, destination_chain, rail, rail_status, transfer_id,
              tx_hash, transfer_payload, idempotency_key, status, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                withdrawal_id,
                payload.user_id,
                payload.amount,
                payload.destination_name,
                payload.destination_iban,
                payload.destination_swift,
                payload.destination_wallet_address,
                payload.destination_chain,
                rail,
                rail_status,
                transfer_id,
                tx_hash,
                json.dumps(transfer_payload) if transfer_payload else None,
                idempotency_key,
                withdrawal_status,
                created_at,
            ),
        )
        if rail == "circle":
            connection.execute(
                """
                INSERT INTO circle_transfer_attempts (
                  id, withdrawal_id, idempotency_key, status, request_payload,
                  response_payload, error, attempt_count, next_attempt_at, last_attempt_at,
                  created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id("circle_attempt"),
                    withdrawal_id,
                    idempotency_key,
                    withdrawal_status,
                    json.dumps(
                        {
                            "amount": payload.amount,
                            "destination_wallet_address": payload.destination_wallet_address,
                            "destination_chain": payload.destination_chain,
                        }
                    ),
                    json.dumps(transfer_payload) if transfer_payload else None,
                    transfer_payload.get("error") if isinstance(transfer_payload, dict) else None,
                    1,
                    next_attempt_at,
                    created_at,
                    created_at,
                    now_iso(),
                ),
            )
        if withdrawal_status != "failed":
            add_ledger_event(
                connection,
                payload.user_id,
                "withdrawal",
                withdrawal_id,
                "withdrawal_initiated",
                -payload.amount,
                {
                    "destination": payload.destination_name,
                    "rail": rail,
                    "rail_status": rail_status,
                    "destination_wallet_address": payload.destination_wallet_address,
                    "tx_hash": tx_hash,
                },
            )
        row = connection.execute("SELECT * FROM withdrawals WHERE id = ?", (withdrawal_id,)).fetchone()
    return row_to_dict(row)


@app.get("/admin/circle-transfer-attempts", response_model=list[CircleTransferAttemptOut])
def list_circle_transfer_attempts(request: Request, limit: int = Query(default=50, ge=1, le=200)):
    assert_admin_access(request)
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM circle_transfer_attempts
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [row_to_dict(row) for row in rows]


@app.post("/admin/circle-transfer-attempts/{attempt_id}/retry", response_model=CircleTransferAttemptOut)
def retry_circle_transfer(attempt_id: str, request: Request):
    assert_admin_access(request)
    return retry_circle_transfer_attempt(attempt_id)


def retry_due_circle_transfer_attempts(limit: int | None = None) -> dict:
    now = now_iso()
    batch_size = limit or config.CIRCLE_RETRY_WORKER_BATCH_SIZE
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id FROM circle_transfer_attempts
            WHERE status IN ('failed', 'not_ready', 'initiated')
              AND attempt_count < ?
              AND next_attempt_at IS NOT NULL
              AND next_attempt_at <= ?
            ORDER BY next_attempt_at ASC
            LIMIT ?
            """,
            (config.CIRCLE_RETRY_MAX_ATTEMPTS, now, batch_size),
        ).fetchall()

    attempts = []
    needs_review = 0
    for row in rows:
        try:
            attempt = retry_circle_transfer_attempt(row["id"])
        except HTTPException as error:
            if error.status_code == 409:
                with get_connection() as connection:
                    attempt = mark_circle_attempt_needs_review(connection, row["id"], str(error.detail))
            else:
                raise
        if attempt["status"] == "needs_review":
            needs_review += 1
        attempts.append(attempt)
    return {"retried": len(attempts) - needs_review, "needs_review": needs_review, "attempts": attempts}


@app.post("/admin/circle-transfer-attempts/retry-due", response_model=CircleRetryOut)
def retry_due_circle_transfers(request: Request, limit: int = Query(default=10, ge=1, le=50)):
    assert_admin_access(request)
    return retry_due_circle_transfer_attempts(limit)


@app.patch("/admin/circle-transfer-attempts/{attempt_id}", response_model=CircleTransferAttemptOut)
def update_circle_transfer_attempt(attempt_id: str, payload: CircleAttemptReviewUpdate, request: Request):
    assert_admin_access(request)
    updates = []
    params = []
    if payload.status is not None:
        updates.append("status = ?")
        params.append(payload.status)
        if payload.status == "needs_review":
            updates.append("next_attempt_at = NULL")
    if payload.review_reason is not None:
        updates.append("review_reason = ?")
        params.append(payload.review_reason)
    if payload.operator_notes is not None:
        updates.append("operator_notes = ?")
        params.append(payload.operator_notes)
    if not updates:
        raise HTTPException(status_code=400, detail="No update fields provided")
    updates.append("updated_at = ?")
    params.append(now_iso())
    params.append(attempt_id)

    with get_connection() as connection:
        existing = connection.execute("SELECT id FROM circle_transfer_attempts WHERE id = ?", (attempt_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Circle transfer attempt not found")
        connection.execute(f"UPDATE circle_transfer_attempts SET {', '.join(updates)} WHERE id = ?", params)
        row = connection.execute("SELECT * FROM circle_transfer_attempts WHERE id = ?", (attempt_id,)).fetchone()
    return row_to_dict(row)


@app.get("/users/{user_id}/withdrawals", response_model=list[WithdrawalOut])
def list_withdrawals(user_id: str, request: Request):
    assert_user_access(user_id, request)
    sync_circle_withdrawals(user_id)
    with get_connection() as connection:
        rows = connection.execute("SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    return [row_to_dict(row) for row in rows]


@app.post("/users/{user_id}/withdrawals/sync")
def sync_withdrawals(user_id: str, request: Request):
    assert_user_access(user_id, request)
    synced = sync_circle_withdrawals(user_id)
    return {"synced": synced, "count": len(synced)}


@app.post("/dev/users/{user_id}/withdrawals/cleanup-failed")
def cleanup_failed_withdrawals(user_id: str, request: Request, include_staged: bool = Query(default=False)):
    assert_dev_access(request)

    statuses = ["failed"]
    rail_statuses = ["failed"]
    if include_staged:
        statuses.append("initiated")
        rail_statuses.append("ready_not_broadcast")

    placeholders = ",".join("?" for _ in statuses)
    rail_placeholders = ",".join("?" for _ in rail_statuses)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT id FROM withdrawals
            WHERE user_id = ?
              AND (status IN ({placeholders}) OR rail_status IN ({rail_placeholders}))
            """,
            (user_id, *statuses, *rail_statuses),
        ).fetchall()
        ids = [row["id"] for row in rows]
        if ids:
            id_placeholders = ",".join("?" for _ in ids)
            connection.execute(f"DELETE FROM ledger_events WHERE entity_type = 'withdrawal' AND entity_id IN ({id_placeholders})", ids)
            connection.execute(f"DELETE FROM circle_transfer_attempts WHERE withdrawal_id IN ({id_placeholders})", ids)
            connection.execute(f"DELETE FROM withdrawals WHERE id IN ({id_placeholders})", ids)

    return {"deleted": len(ids), "ids": ids}


@app.get("/users/{user_id}/ledger", response_model=list[LedgerEventOut])
def user_ledger(user_id: str, request: Request):
    assert_user_access(user_id, request)
    with get_connection() as connection:
        rows = connection.execute("SELECT * FROM ledger_events WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    return [row_to_dict(row) for row in rows]


@app.post("/dev/reset")
def reset_dev_data(request: Request):
    assert_dev_access(request)

    with get_connection() as connection:
        for table in ("circle_transfer_attempts", "reserve_events", "ledger_events", "withdrawals", "payouts", "policies", "users"):
            connection.execute(f"DELETE FROM {table}")
    seed_demo_data()
    return {"status": "reset", "demo_user_id": "user_demo"}
