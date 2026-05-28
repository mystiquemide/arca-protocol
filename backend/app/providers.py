import json
import os
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from urllib.error import URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

from . import config as app_config


load_dotenv()

DEFAULT_OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude=52.52&longitude=13.41"
    "&hourly=precipitation,rain,showers,weather_code"
    "&current=temperature_2m,rain,precipitation,showers,weather_code,is_day"
)
BASE_USDC_TOKEN_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
DEFAULT_FLIGHTAWARE_BASE_URL = "https://aeroapi.flightaware.com/aeroapi"
FLIGHTAWARE_HEALTH = {
    "last_checked_at": None,
    "last_success_at": None,
    "last_ident": None,
    "last_status": None,
    "last_delay_minutes": None,
    "last_error": None,
}


def parse_circle_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def provider_config() -> dict:
    return {
        "flightaware_configured": bool(os.getenv("ARCA_FLIGHTAWARE_API_KEY")),
        "flightaware_base_url": os.getenv("ARCA_FLIGHTAWARE_BASE_URL", DEFAULT_FLIGHTAWARE_BASE_URL),
        "flight_demo_delay_minutes": os.getenv("ARCA_FLIGHT_DEMO_DELAY_MINUTES"),
        "weather_demo_rain_mm": os.getenv("ARCA_WEATHER_DEMO_RAIN_MM"),
        "logistics_demo_transit_hours": os.getenv("ARCA_LOGISTICS_DEMO_TRANSIT_HOURS"),
        "logistics_demo_status": os.getenv("ARCA_LOGISTICS_DEMO_STATUS", "In Transit"),
        "logistics_provider": app_config.LOGISTICS_PROVIDER,
        "project44_configured": bool(app_config.PROJECT44_API_KEY),
        "fourkites_configured": bool(app_config.FOURKITES_API_KEY),
        "open_meteo_url": os.getenv("ARCA_OPEN_METEO_FORECAST_URL", DEFAULT_OPEN_METEO_URL),
        "circle_plugin_requested": os.getenv("ARCA_CIRCLE_PLUGIN", "circle-skills@circle"),
        "circle_cli_path": os.getenv("ARCA_CIRCLE_CLI_PATH") or shutil.which("circle"),
        "circle_base_wallet_address": os.getenv("ARCA_CIRCLE_BASE_WALLET_ADDRESS"),
        "circle_transfers_enabled": os.getenv("ARCA_CIRCLE_TRANSFERS_ENABLED", "false").lower() in ("1", "true", "yes"),
    }


def fetch_logistics_snapshot(tracking_id: str) -> dict:
    config = provider_config()
    checked_at = datetime.now(timezone.utc).isoformat()
    requested_provider = config.get("logistics_provider") or "simulation"
    if requested_provider in {"project44", "fourkites"}:
        configured = bool(config["project44_configured"] if requested_provider == "project44" else config["fourkites_configured"])
        if not configured:
            return {
                "provider": requested_provider,
                "ok": False,
                "configured": False,
                "simulated": False,
                "checked_at": checked_at,
                "tracking_id": tracking_id,
                "status": "Provider not configured",
                "transit_hours": 0,
                "location": None,
                "eta": None,
                "error": f"{requested_provider} credentials are not configured.",
            }

    demo_hours = config.get("logistics_demo_transit_hours")
    if demo_hours not in (None, ""):
        try:
            transit_hours = max(0, float(demo_hours))
        except (TypeError, ValueError):
            transit_hours = 0
        return {
            "provider": "Arca simulated carrier feed",
            "ok": True,
            "configured": False,
            "simulated": True,
            "checked_at": checked_at,
            "tracking_id": tracking_id,
            "status": config.get("logistics_demo_status") or "In Transit",
            "transit_hours": transit_hours,
            "location": "Demo checkpoint",
            "eta": None,
        }

    return {
        "provider": "Arca simulated carrier feed",
        "ok": True,
        "configured": False,
        "simulated": True,
        "checked_at": checked_at,
        "tracking_id": tracking_id,
        "status": "In Transit",
        "transit_hours": 0,
        "location": "Simulated checkpoint",
        "eta": None,
        "note": "Logistics monitoring intentionally uses Arca's built-in SLA simulation rail.",
    }


def fetch_json(url: str, headers: dict[str, str] | None = None, timeout: int = 8) -> dict:
    request = Request(url, headers=headers or {})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_open_meteo_snapshot() -> dict:
    url = provider_config()["open_meteo_url"]
    checked_at = datetime.now(timezone.utc).isoformat()
    demo_rain = provider_config().get("weather_demo_rain_mm")
    if demo_rain not in (None, ""):
        try:
            rain_mm = max(0, float(demo_rain))
        except (TypeError, ValueError):
            rain_mm = 0
        return {
            "provider": "Open-Meteo",
            "ok": True,
            "checked_at": checked_at,
            "simulated": True,
            "forecast_precipitation_sum_mm": rain_mm,
            "current": {"rain": rain_mm, "precipitation": rain_mm},
        }

    try:
        data = fetch_json(url)
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        return {
            "provider": "Open-Meteo",
            "ok": False,
            "checked_at": checked_at,
            "error": str(error),
        }

    current = data.get("current", {})
    hourly = data.get("hourly", {})
    precipitation_values = hourly.get("precipitation") if isinstance(hourly, dict) else []
    if not isinstance(precipitation_values, list):
        precipitation_values = []
    forecast_precipitation_sum = round(sum(float(value or 0) for value in precipitation_values), 2)
    return {
        "provider": "Open-Meteo",
        "ok": True,
        "checked_at": checked_at,
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude"),
        "timezone": data.get("timezone"),
        "forecast_precipitation_sum_mm": forecast_precipitation_sum,
        "current": {
            "temperature_2m": current.get("temperature_2m"),
            "rain": current.get("rain"),
            "precipitation": current.get("precipitation"),
            "showers": current.get("showers"),
            "weather_code": current.get("weather_code"),
            "is_day": current.get("is_day"),
        },
    }


def flightaware_headers() -> dict[str, str]:
    api_key = os.getenv("ARCA_FLIGHTAWARE_API_KEY")
    return {"x-apikey": api_key} if api_key else {}


def record_flightaware_health(snapshot: dict) -> dict:
    FLIGHTAWARE_HEALTH.update(
        {
            "last_checked_at": snapshot.get("checked_at"),
            "last_ident": snapshot.get("ident"),
            "last_status": snapshot.get("status"),
            "last_delay_minutes": snapshot.get("delay_minutes"),
            "last_error": snapshot.get("error"),
        }
    )
    if snapshot.get("ok"):
        FLIGHTAWARE_HEALTH["last_success_at"] = snapshot.get("checked_at")
        FLIGHTAWARE_HEALTH["last_error"] = None
    return snapshot


def minutes_between(later: str | None, earlier: str | None) -> int | None:
    later_dt = parse_circle_datetime(later)
    earlier_dt = parse_circle_datetime(earlier)
    if not later_dt or not earlier_dt:
        return None
    return int((later_dt - earlier_dt).total_seconds() // 60)


def flight_delay_minutes(flight: dict) -> int:
    candidates = [
        minutes_between(flight.get("actual_in") or flight.get("estimated_in"), flight.get("scheduled_in")),
        minutes_between(flight.get("actual_out") or flight.get("estimated_out"), flight.get("scheduled_out")),
      ]
    observed = [value for value in candidates if value is not None]
    return max([0, *observed])


def choose_relevant_flight(flights: list[dict]) -> dict | None:
    if not flights:
        return None
    active = [flight for flight in flights if not flight.get("cancelled")]
    rows = active or flights
    return sorted(rows, key=lambda flight: flight.get("scheduled_out") or flight.get("scheduled_in") or "", reverse=True)[0]


def fetch_flightaware_snapshot(ident: str) -> dict:
    config = provider_config()
    checked_at = datetime.now(timezone.utc).isoformat()
    demo_delay = config.get("flight_demo_delay_minutes")
    if demo_delay not in (None, ""):
        try:
            delay_minutes = max(0, int(float(demo_delay)))
        except (TypeError, ValueError):
            delay_minutes = 0
        return record_flightaware_health({
            "provider": "FlightAware AeroAPI",
            "ok": True,
            "configured": config["flightaware_configured"],
            "simulated": True,
            "checked_at": checked_at,
            "ident": ident,
            "status": f"Observed delay {delay_minutes}m",
            "delay_minutes": delay_minutes,
            "raw": {"demo_delay_minutes": demo_delay},
        })

    if not config["flightaware_configured"]:
        return record_flightaware_health({
            "provider": "FlightAware AeroAPI",
            "ok": False,
            "configured": False,
            "checked_at": checked_at,
            "ident": ident,
            "error": "FlightAware AeroAPI key is not configured.",
        })

    url = f"{config['flightaware_base_url'].rstrip('/')}/flights/{quote(ident)}"
    try:
        data = fetch_json(url, headers=flightaware_headers(), timeout=12)
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        return record_flightaware_health({
            "provider": "FlightAware AeroAPI",
            "ok": False,
            "configured": True,
            "checked_at": checked_at,
            "ident": ident,
            "error": str(error),
        })

    flights = data.get("flights", []) if isinstance(data, dict) else []
    flight = choose_relevant_flight(flights)
    if not flight:
        return record_flightaware_health({
            "provider": "FlightAware AeroAPI",
            "ok": False,
            "configured": True,
            "checked_at": checked_at,
            "ident": ident,
            "error": "No matching flight returned.",
            "raw": data,
        })

    delay_minutes = flight_delay_minutes(flight)
    return record_flightaware_health({
        "provider": "FlightAware AeroAPI",
        "ok": True,
        "configured": True,
        "checked_at": checked_at,
        "ident": flight.get("ident") or ident,
        "fa_flight_id": flight.get("fa_flight_id"),
        "status": flight.get("status") or ("Cancelled" if flight.get("cancelled") else f"Observed delay {delay_minutes}m"),
        "origin": flight.get("origin", {}).get("code") if isinstance(flight.get("origin"), dict) else flight.get("origin"),
        "destination": flight.get("destination", {}).get("code") if isinstance(flight.get("destination"), dict) else flight.get("destination"),
        "scheduled_out": flight.get("scheduled_out"),
        "estimated_out": flight.get("estimated_out"),
        "actual_out": flight.get("actual_out"),
        "scheduled_in": flight.get("scheduled_in"),
        "estimated_in": flight.get("estimated_in"),
        "actual_in": flight.get("actual_in"),
        "cancelled": bool(flight.get("cancelled")),
        "delay_minutes": delay_minutes,
        "raw": {"data": flight},
    })


def run_circle_command(args: list[str], timeout: int = 8) -> dict:
    circle_path = provider_config()["circle_cli_path"]
    if not circle_path:
        return {"ok": False, "error": "Circle CLI is not on PATH."}

    try:
        completed = subprocess.run(
            [circle_path, *args],
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"ok": False, "error": str(error)}

    stdout = completed.stdout.strip()
    stderr = completed.stderr.strip()
    payload = None
    if stdout:
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError:
            payload = stdout

    return {
        "ok": completed.returncode == 0,
        "returncode": completed.returncode,
        "stdout": payload,
        "stderr": stderr,
    }


def circle_status() -> dict:
    config = provider_config()
    circle_path = config["circle_cli_path"]
    status = {
        "provider": "Circle",
        "ok": False,
        "configured": bool(circle_path),
        "plugin": config["circle_plugin_requested"],
        "cli_path": circle_path,
        "cli_version": None,
        "terms_accepted": False,
        "agent_wallet_authenticated": False,
        "base_wallet_address": config["circle_base_wallet_address"],
        "base_usdc_balance": None,
        "transfers_enabled": config["circle_transfers_enabled"],
        "next_step": "Install @circle-fin/cli in WSL, then accept Circle Terms and log in.",
    }

    if not circle_path:
        return status

    version = run_circle_command(["--version"], timeout=20)
    if version["ok"] and isinstance(version["stdout"], str):
        status["cli_version"] = version["stdout"]
    elif version.get("stderr"):
        status["error"] = version["stderr"]

    terms = run_circle_command(["terms", "show", "--output", "json"], timeout=20)
    if terms["ok"] and isinstance(terms["stdout"], dict):
        terms_data = terms["stdout"].get("data", {})
        status["terms_accepted"] = bool(terms_data.get("accepted"))
        status["terms_version"] = terms_data.get("currentVersion")
        status["terms_of_use_url"] = terms_data.get("termsOfUseUrl")
        status["privacy_policy_url"] = terms_data.get("privacyPolicyUrl")
        if not status["terms_accepted"]:
            status["next_step"] = "Review and explicitly accept the Circle CLI Terms, then log in an agent wallet."
            return status
    elif terms.get("stderr") or terms.get("error"):
        status["terms_check_error"] = terms.get("stderr") or terms.get("error")

    wallet = run_circle_command(["wallet", "status", "--type", "agent", "--output", "json"], timeout=20)
    if wallet["ok"] and isinstance(wallet["stdout"], dict):
        wallet_data = wallet["stdout"].get("data", wallet["stdout"])
        mainnet_status = wallet_data.get("mainnet", {})
        testnet_status = wallet_data.get("testnet", {})
        status["agent_wallet_authenticated"] = bool(
            wallet_data.get("authenticated")
            or wallet_data.get("loggedIn")
            or mainnet_status.get("authenticated")
            or testnet_status.get("authenticated")
            or mainnet_status.get("tokenStatus") == "VALID"
            or testnet_status.get("tokenStatus") == "VALID"
        )
        status["agent_wallet_email"] = wallet_data.get("email")
        status["session_expires_in"] = mainnet_status.get("expiresIn") or testnet_status.get("expiresIn")
        if status["agent_wallet_authenticated"]:
            status["terms_accepted"] = True

    if status["agent_wallet_authenticated"]:
        wallets = run_circle_command(["wallet", "list", "--chain", "BASE", "--type", "agent", "--output", "json"], timeout=20)
        if wallets["ok"] and isinstance(wallets["stdout"], dict):
            wallet_rows = wallets["stdout"].get("data", {}).get("wallets", [])
            if wallet_rows:
                status["base_wallet_address"] = wallet_rows[0].get("address")
        elif wallets.get("stderr") or wallets.get("error"):
            status["wallet_list_error"] = wallets.get("stderr") or wallets.get("error")

        if status["base_wallet_address"]:
            balance = run_circle_command(
                ["wallet", "balance", "--address", status["base_wallet_address"], "--chain", "BASE", "--output", "json"],
                timeout=20,
            )
            if balance["ok"] and isinstance(balance["stdout"], dict):
                balances = balance["stdout"].get("data", {}).get("balances", [])
                usdc = next((item for item in balances if item.get("token", {}).get("symbol") == "USDC"), None)
                if usdc:
                    status["base_usdc_balance"] = usdc.get("amount")

    status["ok"] = bool(status["terms_accepted"] and status["agent_wallet_authenticated"] and status["base_wallet_address"])
    status["next_step"] = (
        "Wire Circle wallet transfers into payout withdrawals."
        if status["ok"]
        else "Create or log in a Circle agent wallet for payout rail testing."
    )
    return status


def transaction_matches(tx: dict, source_address: str, to_address: str, amount: float, attempted_at: datetime | None) -> bool:
    if tx.get("transactionType") != "OUTBOUND":
        return False
    if tx.get("sourceAddress", "").lower() != source_address.lower():
        return False
    if tx.get("destinationAddress", "").lower() != to_address.lower():
        return False

    amounts = tx.get("amounts") or []
    if not amounts:
        return False
    try:
        if abs(float(amounts[0]) - amount) > 0.000001:
            return False
    except (TypeError, ValueError):
        return False

    if attempted_at:
        tx_created_at = parse_circle_datetime(tx.get("createDate"))
        if not tx_created_at:
            return False
        if tx_created_at < attempted_at - timedelta(minutes=2):
            return False

    return True


def find_matching_circle_transfer(source_address: str, to_address: str, amount: float, attempted_at: str | None) -> dict | None:
    attempted_dt = parse_circle_datetime(attempted_at)
    rows = list_circle_transactions(source_address)
    return next((tx for tx in rows if transaction_matches(tx, source_address, to_address, amount, attempted_dt)), None)


def list_circle_transactions(source_address: str) -> list[dict]:
    transactions = run_circle_command(
        [
            "transaction",
            "list",
            "--chain",
            "BASE",
            "--address",
            source_address,
            "--operation",
            "transfer",
            "--tx-type",
            "outbound",
            "--limit",
            "50",
            "--output",
            "json",
        ],
        timeout=30,
    )
    if not transactions["ok"] or not isinstance(transactions["stdout"], dict):
        return []
    return transactions["stdout"].get("data", {}).get("transactions", [])


def find_circle_transfer_by_id(source_address: str, transfer_id: str) -> dict | None:
    rows = list_circle_transactions(source_address)
    return next((tx for tx in rows if tx.get("id") == transfer_id or tx.get("transactionId") == transfer_id), None)


def circle_state_to_status(state: str | None) -> tuple[str, str]:
    normalized = (state or "").lower()
    if normalized in {"complete", "confirmed"}:
        return "complete", "complete"
    if normalized in {"failed", "cancelled", "denied"}:
        return "failed", "failed"
    if normalized in {"initiated", "queued", "sent", "cleared", "stuck"}:
        return "processing", normalized
    return "processing", "broadcast"


def transfer_payload_from_transaction(tx: dict, status: dict, to_address: str, amount: float, arca_reference: str, cli_result: dict | None = None) -> dict:
    withdrawal_status, rail_status = circle_state_to_status(tx.get("state"))
    payload = {
        "ok": True,
        "broadcast": True,
        "status": withdrawal_status,
        "rail_status": rail_status,
        "circle_state": tx.get("state"),
        "source_address": status["base_wallet_address"],
        "destination_address": to_address,
        "amount": amount,
        "chain": "BASE",
        "token": "USDC",
        "arca_reference": arca_reference,
        "circle_idempotency_key": tx.get("idempotencyKey"),
        "transfer_id": tx.get("id") or tx.get("transactionId"),
        "tx_hash": tx.get("txHash") or tx.get("transactionHash"),
        "raw": {"data": tx},
    }
    if cli_result:
        payload["reconciled_after_cli_error"] = True
        payload["cli_error"] = {
            "returncode": cli_result.get("returncode"),
            "stdout": cli_result.get("stdout"),
            "stderr": cli_result.get("stderr"),
            "error": cli_result.get("error"),
        }
    return payload


def execute_circle_usdc_transfer(to_address: str, amount: float, arca_reference: str, attempted_at: str | None = None) -> dict:
    status = circle_status()
    if not status["ok"]:
        return {
            "ok": False,
            "broadcast": False,
            "rail_status": "not_ready",
            "error": status["next_step"],
            "provider_status": status,
        }

    if not status["transfers_enabled"]:
        return {
            "ok": True,
            "broadcast": False,
            "rail_status": "ready_not_broadcast",
            "source_address": status["base_wallet_address"],
            "destination_address": to_address,
            "amount": amount,
            "chain": "BASE",
            "token": "USDC",
            "arca_reference": arca_reference,
            "message": "Circle transfer is staged. Set ARCA_CIRCLE_TRANSFERS_ENABLED=true to broadcast live USDC.",
        }

    result = run_circle_command(
        [
            "wallet",
            "transfer",
            to_address,
            "--amount",
            f"{amount:.6f}",
            "--token",
            BASE_USDC_TOKEN_ADDRESS,
            "--address",
            status["base_wallet_address"],
            "--chain",
            "BASE",
            "--output",
            "json",
        ],
        timeout=30,
    )

    if not result["ok"]:
        matched_transfer = find_matching_circle_transfer(status["base_wallet_address"], to_address, amount, attempted_at)
        if matched_transfer:
            return transfer_payload_from_transaction(matched_transfer, status, to_address, amount, arca_reference, result)

        return {
            "ok": False,
            "broadcast": True,
            "rail_status": "failed",
            "arca_reference": arca_reference,
            "error": result.get("stderr") or result.get("stdout") or "Circle transfer failed.",
            "cli_returncode": result.get("returncode"),
            "cli_stdout": result.get("stdout"),
            "cli_stderr": result.get("stderr"),
        }

    payload = result["stdout"] if isinstance(result["stdout"], dict) else {"output": result["stdout"]}
    data = payload.get("data", payload)
    return transfer_payload_from_transaction(data, status, to_address, amount, arca_reference)


def provider_status() -> dict:
    config = provider_config()
    weather = fetch_open_meteo_snapshot()
    logistics_provider = config.get("logistics_provider")
    logistics_configured = (
        logistics_provider == "simulation"
        or (logistics_provider == "project44" and config.get("project44_configured"))
        or (logistics_provider == "fourkites" and config.get("fourkites_configured"))
    )
    return {
        "flightaware": {
            "provider": "FlightAware AeroAPI",
            "ok": config["flightaware_configured"],
            "configured": config["flightaware_configured"],
            "demo_delay_enabled": config.get("flight_demo_delay_minutes") not in (None, ""),
            "base_url": config["flightaware_base_url"],
            "health": dict(FLIGHTAWARE_HEALTH),
        },
        "weather": weather,
        "logistics": {
            "provider": "Arca simulated carrier feed" if logistics_provider == "simulation" else logistics_provider,
            "ok": bool(logistics_configured),
            "configured": bool(logistics_configured),
            "demo_mode": logistics_provider == "simulation",
            "requested_provider": logistics_provider,
            "project44_configured": config.get("project44_configured"),
            "fourkites_configured": config.get("fourkites_configured"),
            "demo_transit_hours": config.get("logistics_demo_transit_hours"),
            "next_step": "Logistics monitoring uses Arca's built-in SLA simulation rail."
            if logistics_provider == "simulation"
            else "Configure logistics provider credentials before enabling this rail.",
        },
        "circle": circle_status(),
    }
