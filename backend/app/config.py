import os

from dotenv import load_dotenv


load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _csv(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


ARCA_ENV = os.getenv("ARCA_ENV", "development")
IS_PRODUCTION = ARCA_ENV == "production"
DATABASE_URL = os.getenv("ARCA_DATABASE_URL")

AUTH_REQUIRED = _bool("ARCA_AUTH_REQUIRED", IS_PRODUCTION)
AUTH_PROVIDER = os.getenv("ARCA_AUTH_PROVIDER", "privy" if IS_PRODUCTION else "header")
AUTH_SHARED_SECRET = os.getenv("ARCA_AUTH_SHARED_SECRET")
PRIVY_APP_ID = os.getenv("ARCA_PRIVY_APP_ID")
PRIVY_VERIFICATION_KEY = os.getenv("ARCA_PRIVY_VERIFICATION_KEY")
PRIVY_JWKS_URL = os.getenv("ARCA_PRIVY_JWKS_URL")
PRIVY_ISSUER = os.getenv("ARCA_PRIVY_ISSUER", "privy.io")
PRIVY_ALGORITHMS = _csv("ARCA_PRIVY_ALGORITHMS", "ES256,EdDSA,RS256")
ADMIN_API_TOKEN = os.getenv("ARCA_ADMIN_API_TOKEN")
PARTNER_API_KEYS = _csv("ARCA_PARTNER_API_KEYS")

DEV_ENDPOINTS_ENABLED = _bool("ARCA_ENABLE_DEV_ENDPOINTS", not IS_PRODUCTION)
CORS_ORIGINS = _csv(
    "ARCA_CORS_ORIGINS",
    "http://localhost:5173,http://localhost:5174,http://localhost:5175,"
    "http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175",
)

RATE_LIMIT_ENABLED = _bool("ARCA_RATE_LIMIT_ENABLED", IS_PRODUCTION)
RATE_LIMIT_BACKEND = os.getenv("ARCA_RATE_LIMIT_BACKEND", "memory")
RATE_LIMIT_REQUESTS = int(os.getenv("ARCA_RATE_LIMIT_REQUESTS", "120"))
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("ARCA_RATE_LIMIT_WINDOW_SECONDS", "60"))
RATE_LIMIT_GATEWAY_MANAGED = _bool("ARCA_RATE_LIMIT_GATEWAY_MANAGED", False)
REDIS_URL = os.getenv("ARCA_REDIS_URL")

LOG_LEVEL = os.getenv("ARCA_LOG_LEVEL", "INFO")
LOG_REQUESTS = _bool("ARCA_LOG_REQUESTS", True)

CIRCLE_RETRY_MAX_ATTEMPTS = int(os.getenv("ARCA_CIRCLE_RETRY_MAX_ATTEMPTS", "3"))
CIRCLE_RETRY_DELAY_SECONDS = int(os.getenv("ARCA_CIRCLE_RETRY_DELAY_SECONDS", "300"))
CIRCLE_RETRY_BACKOFF_MULTIPLIER = float(os.getenv("ARCA_CIRCLE_RETRY_BACKOFF_MULTIPLIER", "2"))
CIRCLE_RETRY_MAX_DELAY_SECONDS = int(os.getenv("ARCA_CIRCLE_RETRY_MAX_DELAY_SECONDS", "3600"))
CIRCLE_RETRY_WORKER_ENABLED = _bool("ARCA_CIRCLE_RETRY_WORKER_ENABLED", False)
CIRCLE_RETRY_WORKER_INTERVAL_SECONDS = int(os.getenv("ARCA_CIRCLE_RETRY_WORKER_INTERVAL_SECONDS", "60"))
CIRCLE_RETRY_WORKER_BATCH_SIZE = int(os.getenv("ARCA_CIRCLE_RETRY_WORKER_BATCH_SIZE", "10"))

ENFORCE_RESERVE_CAPS = _bool("ARCA_ENFORCE_RESERVE_CAPS", IS_PRODUCTION)
INITIAL_RESERVE_USDC = float(os.getenv("ARCA_INITIAL_RESERVE_USDC", "25000"))
MIN_RESERVE_RATIO = float(os.getenv("ARCA_MIN_RESERVE_RATIO", "1.5"))
MAX_POLICY_PAYOUT_USDC = float(os.getenv("ARCA_MAX_POLICY_PAYOUT_USDC", "5000"))

LOGISTICS_PROVIDER = os.getenv("ARCA_LOGISTICS_PROVIDER", "simulation")
PROJECT44_API_KEY = os.getenv("ARCA_PROJECT44_API_KEY")
FOURKITES_API_KEY = os.getenv("ARCA_FOURKITES_API_KEY")
CIRCLE_TRANSFERS_ENABLED = _bool("ARCA_CIRCLE_TRANSFERS_ENABLED", False)
CIRCLE_BASE_WALLET_ADDRESS = os.getenv("ARCA_CIRCLE_BASE_WALLET_ADDRESS")


def _is_placeholder(value: str | None) -> bool:
    if value is None:
        return True
    normalized = value.strip().lower()
    if not normalized:
        return True
    return any(
        marker in normalized
        for marker in (
            "replace_with",
            "example.com",
            "your-",
            "<",
            ">",
            "postgresql://user:password@host",
        )
    )


def _is_postgres_url(value: str | None) -> bool:
    return bool(value and value.startswith(("postgres://", "postgresql://")))


def production_config_errors() -> list[str]:
    if not IS_PRODUCTION:
        return []

    errors = []
    if not _is_postgres_url(DATABASE_URL):
        errors.append("ARCA_DATABASE_URL must be a managed postgres:// or postgresql:// URL in production")
    if not CORS_ORIGINS:
        errors.append("ARCA_CORS_ORIGINS must be set in production")
    if any(_is_placeholder(origin) or "localhost" in origin or "127.0.0.1" in origin for origin in CORS_ORIGINS):
        errors.append("ARCA_CORS_ORIGINS must contain real production frontend origins")
    if AUTH_REQUIRED and AUTH_PROVIDER == "header" and not AUTH_SHARED_SECRET:
        errors.append("ARCA_AUTH_SHARED_SECRET must be set when ARCA_AUTH_REQUIRED=true")
    if AUTH_PROVIDER == "header" and _is_placeholder(AUTH_SHARED_SECRET):
        errors.append("ARCA_AUTH_SHARED_SECRET must be a real secret when ARCA_AUTH_PROVIDER=header")
    if AUTH_REQUIRED and AUTH_PROVIDER == "test":
        errors.append("ARCA_AUTH_PROVIDER=test is only for local smoke tests and must not be used in production")
    if AUTH_REQUIRED and AUTH_PROVIDER == "privy":
        if _is_placeholder(PRIVY_APP_ID):
            errors.append("ARCA_PRIVY_APP_ID must be set to a real Privy app id when ARCA_AUTH_PROVIDER=privy")
        if _is_placeholder(PRIVY_VERIFICATION_KEY) and _is_placeholder(PRIVY_JWKS_URL):
            errors.append("ARCA_PRIVY_VERIFICATION_KEY or ARCA_PRIVY_JWKS_URL must be set when ARCA_AUTH_PROVIDER=privy")
    if DEV_ENDPOINTS_ENABLED:
        errors.append("ARCA_ENABLE_DEV_ENDPOINTS must be false in production")
    if _is_placeholder(ADMIN_API_TOKEN) or len(ADMIN_API_TOKEN or "") < 32:
        errors.append("ARCA_ADMIN_API_TOKEN must be set to a real random secret with at least 32 characters")
    if not RATE_LIMIT_ENABLED:
        errors.append("ARCA_RATE_LIMIT_ENABLED should be true in production")
    if RATE_LIMIT_BACKEND not in {"memory", "redis", "gateway"}:
        errors.append("ARCA_RATE_LIMIT_BACKEND must be memory, redis, or gateway")
    if RATE_LIMIT_ENABLED and RATE_LIMIT_BACKEND == "redis" and _is_placeholder(REDIS_URL):
        errors.append("ARCA_REDIS_URL must be set when ARCA_RATE_LIMIT_BACKEND=redis")
    if RATE_LIMIT_ENABLED and RATE_LIMIT_BACKEND == "memory" and not RATE_LIMIT_GATEWAY_MANAGED:
        errors.append("Use ARCA_RATE_LIMIT_BACKEND=redis in production, or set ARCA_RATE_LIMIT_GATEWAY_MANAGED=true when limits are enforced upstream")
    if RATE_LIMIT_ENABLED and RATE_LIMIT_BACKEND == "gateway" and not RATE_LIMIT_GATEWAY_MANAGED:
        errors.append("ARCA_RATE_LIMIT_GATEWAY_MANAGED=true must be set when ARCA_RATE_LIMIT_BACKEND=gateway")
    if LOGISTICS_PROVIDER != "simulation" and LOGISTICS_PROVIDER not in {"project44", "fourkites"}:
        errors.append("ARCA_LOGISTICS_PROVIDER must be simulation, project44, or fourkites")
    if LOGISTICS_PROVIDER == "project44" and _is_placeholder(PROJECT44_API_KEY):
        errors.append("ARCA_PROJECT44_API_KEY must be set when ARCA_LOGISTICS_PROVIDER=project44")
    if LOGISTICS_PROVIDER == "fourkites" and _is_placeholder(FOURKITES_API_KEY):
        errors.append("ARCA_FOURKITES_API_KEY must be set when ARCA_LOGISTICS_PROVIDER=fourkites")
    if CIRCLE_TRANSFERS_ENABLED and _is_placeholder(CIRCLE_BASE_WALLET_ADDRESS):
        errors.append("ARCA_CIRCLE_BASE_WALLET_ADDRESS must be set before enabling live Circle transfers")
    return errors
