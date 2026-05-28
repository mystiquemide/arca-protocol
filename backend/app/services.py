import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from .database import get_connection
from .providers import fetch_flightaware_snapshot, fetch_logistics_snapshot, fetch_open_meteo_snapshot, provider_config
from .schemas import QuoteRequest
from . import config


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def row_to_dict(row) -> dict[str, Any]:
    data = dict(row)
    for key in ("condition_params", "trigger_data", "metadata", "transfer_payload", "request_payload", "response_payload"):
        if key in data and isinstance(data[key], str):
            data[key] = json.loads(data[key])
    return data


def add_ledger_event(connection, user_id: str, entity_type: str, entity_id: str, event_type: str, amount: float, metadata: dict[str, Any]):
    connection.execute(
        """
        INSERT INTO ledger_events (id, user_id, entity_type, entity_id, event_type, amount, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (new_id("ledger"), user_id, entity_type, entity_id, event_type, amount, json.dumps(metadata), now_iso()),
    )


def add_reserve_event(connection, user_id: str | None, entity_type: str, entity_id: str, event_type: str, amount: float, metadata: dict[str, Any]):
    connection.execute(
        """
        INSERT INTO reserve_events (id, user_id, entity_type, entity_id, event_type, amount, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (new_id("reserve"), user_id, entity_type, entity_id, event_type, amount, json.dumps(metadata), now_iso()),
    )


def get_reserve_status() -> dict[str, float | None]:
    initial_reserve = config.INITIAL_RESERVE_USDC
    with get_connection() as connection:
        premium_income = connection.execute(
            "SELECT COALESCE(SUM(premium), 0) AS total FROM policies",
        ).fetchone()["total"]
        paid_payouts = connection.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM payouts WHERE status = 'paid'",
        ).fetchone()["total"]
        active_liabilities = connection.execute(
            "SELECT COALESCE(SUM(payout), 0) AS total FROM policies WHERE status IN ('active', 'triggered')",
        ).fetchone()["total"]

    reserve_balance = initial_reserve + float(premium_income) - float(paid_payouts)
    active_liabilities = float(active_liabilities)
    return {
        "reserve_balance": round(reserve_balance, 2),
        "initial_reserve": round(initial_reserve, 2),
        "premium_income": round(float(premium_income), 2),
        "paid_payouts": round(float(paid_payouts), 2),
        "active_liabilities": round(active_liabilities, 2),
        "available_capacity": round(max(reserve_balance - active_liabilities, 0), 2),
        "reserve_ratio": round(reserve_balance / active_liabilities, 4) if active_liabilities > 0 else None,
    }


def assert_reserve_capacity(payout_amount: float):
    if not config.ENFORCE_RESERVE_CAPS:
        return

    if payout_amount > config.MAX_POLICY_PAYOUT_USDC:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="Policy payout exceeds configured maximum")

    reserve = get_reserve_status()
    projected_liabilities = float(reserve["active_liabilities"]) + payout_amount
    reserve_balance = float(reserve["reserve_balance"])
    projected_ratio = reserve_balance / projected_liabilities if projected_liabilities > 0 else None

    if projected_ratio is not None and projected_ratio < config.MIN_RESERVE_RATIO:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Insufficient reserve capacity for this policy")


def quote_policy(payload: QuoteRequest) -> dict[str, Any]:
    category = payload.category
    coverage = float(payload.coverage_amount)
    params = payload.condition_params

    if category == "flight":
        delay_minutes = int(params.get("delay_minutes", 120))
        flight_snapshot = fetch_flightaware_snapshot(payload.target)
        premium_rate = 0.048 if delay_minutes <= 120 else 0.04
        trigger = f"> {delay_minutes} Minutes Delay"
        engine = f"Aviation Risk Model (Flight: {payload.target})"
        oracle = "FlightAware AeroAPI"
        source = "FlightAware Global Flight API"
        params["flightaware_configured"] = provider_config()["flightaware_configured"]
        params["provider_ok"] = flight_snapshot["ok"]
        params["provider_checked_at"] = flight_snapshot["checked_at"]
        params["observed_delay_minutes"] = flight_snapshot.get("delay_minutes")
        params["flight_status"] = flight_snapshot.get("status")
        params["flight_origin"] = flight_snapshot.get("origin")
        params["flight_destination"] = flight_snapshot.get("destination")
    elif category == "weather":
        rainfall_mm = float(params.get("rainfall_mm", 10))
        weather_snapshot = fetch_open_meteo_snapshot()
        current = weather_snapshot.get("current", {})
        premium_rate = 0.026 if rainfall_mm <= 10 else 0.02
        trigger = f"< {rainfall_mm:g}mm Rainfall (30 Days)"
        engine = f"Weather Risk Model (Region: {payload.target})"
        oracle = "Open-Meteo Global Forecast API"
        source = "Open-Meteo"
        params["provider_ok"] = weather_snapshot["ok"]
        params["provider_checked_at"] = weather_snapshot["checked_at"]
        params["observed_rain_mm"] = current.get("rain")
        params["observed_precipitation_mm"] = current.get("precipitation")
        params["forecast_precipitation_sum_mm"] = weather_snapshot.get("forecast_precipitation_sum_mm")
        params["latitude"] = weather_snapshot.get("latitude")
        params["longitude"] = weather_snapshot.get("longitude")
    else:
        max_transit_hours = int(params.get("max_transit_hours", 48))
        logistics_snapshot = fetch_logistics_snapshot(payload.target)
        premium_rate = 0.017 if max_transit_hours <= 48 else 0.014
        trigger = f"> {max_transit_hours} Hours Transit"
        engine = f"Logistics Risk Model (AWB: {payload.target})"
        oracle = "Arca simulated carrier feed"
        source = "Arca SLA Simulation"
        params["provider_ok"] = logistics_snapshot["ok"]
        params["provider_checked_at"] = logistics_snapshot["checked_at"]
        params["observed_transit_hours"] = logistics_snapshot.get("transit_hours")
        params["shipment_status"] = logistics_snapshot.get("status")
        params["shipment_location"] = logistics_snapshot.get("location")
        params["logistics_demo_mode"] = logistics_snapshot.get("simulated")

    protocol_fee = 1.08
    premium = round(max(2.5, coverage * premium_rate * protocol_fee), 2)

    return {
        "category": category,
        "premium": premium,
        "payout": round(coverage, 2),
        "trigger": trigger,
        "engine": engine,
        "oracle": oracle,
        "source": source,
        "target": payload.target,
        "condition_params": params,
    }


def get_balance(user_id: str) -> dict[str, float | str]:
    with get_connection() as connection:
        paid_payouts = connection.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM payouts WHERE user_id = ? AND status = 'paid'",
            (user_id,),
        ).fetchone()["total"]
        withdrawals = connection.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals WHERE user_id = ? AND status IN ('initiated', 'processing', 'complete')",
            (user_id,),
        ).fetchone()["total"]

    return {
        "user_id": user_id,
        "available_balance": max(float(paid_payouts) - float(withdrawals), 0),
        "paid_payouts": float(paid_payouts),
        "initiated_withdrawals": float(withdrawals),
    }


def seed_demo_data():
    with get_connection() as connection:
        user = connection.execute("SELECT id FROM users WHERE email = ?", ("demo@arca.xyz",)).fetchone()
        if user:
            return

        created_at = now_iso()
        user_id = "user_demo"
        connection.execute(
            "INSERT INTO users (id, email, privy_user_id, phone, rialo_address, kyc_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, "demo@arca.xyz", None, None, "0xDemoRialoAddress", "level_1", created_at),
        )

        policy_id = "policy_demo_paid"
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
                user_id,
                "logistics",
                "Logistics SLA",
                "paid",
                8.5,
                400,
                "0x2B9c44dA0E7F5b2014F",
                "DL-404",
                "> 48 Hours Transit",
                "Logistics Risk Model (AWB: DL-404)",
                "Arca simulated carrier feed",
                "Arca SLA Simulation",
                "Payout Executed",
                json.dumps({"max_transit_hours": 48}),
                created_at,
                created_at,
                created_at,
                None,
                (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            ),
        )
        payout_id = "payout_demo_paid"
        connection.execute(
            "INSERT INTO payouts (id, policy_id, user_id, amount, trigger_data, tx_hash, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (payout_id, policy_id, user_id, 400, json.dumps({"source": "seed"}), "0xseed", "paid", created_at),
        )
        add_ledger_event(connection, user_id, "policy", policy_id, "premium_collected", -8.5, {"target": "DL-404"})
        add_ledger_event(connection, user_id, "payout", payout_id, "payout_paid", 400, {"target": "DL-404", "policy_id": policy_id})
