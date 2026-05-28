import time
from collections import defaultdict, deque

import jwt
import redis.asyncio as redis
from jwt import PyJWKClient, PyJWKClientError
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from . import config
from .database import get_connection


_rate_buckets: dict[str, deque[float]] = defaultdict(deque)
_privy_jwks_client: PyJWKClient | None = None
_redis_client: redis.Redis | None = None


def request_identity(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def rate_limit(request: Request, call_next):
    if not config.RATE_LIMIT_ENABLED or request.url.path in {"/health", "/ready"}:
        return await call_next(request)

    if config.RATE_LIMIT_BACKEND == "gateway":
        return await call_next(request)

    if config.RATE_LIMIT_BACKEND == "redis":
        allowed, retry_after = await redis_rate_limit(request)
        if not allowed:
            return JSONResponse(
                {"detail": "Rate limit exceeded"},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
        return await call_next(request)

    allowed, retry_after = memory_rate_limit(request)
    if not allowed:
        return JSONResponse(
            {"detail": "Rate limit exceeded"},
            status_code=429,
            headers={"Retry-After": str(retry_after)},
        )
    return await call_next(request)


def memory_rate_limit(request: Request) -> tuple[bool, int]:
    now = time.monotonic()
    key = f"{request_identity(request)}:{request.url.path}"
    bucket = _rate_buckets[key]
    while bucket and now - bucket[0] > config.RATE_LIMIT_WINDOW_SECONDS:
        bucket.popleft()

    if len(bucket) >= config.RATE_LIMIT_REQUESTS:
        retry_after = max(1, int(config.RATE_LIMIT_WINDOW_SECONDS - (now - bucket[0])))
        return False, retry_after

    bucket.append(now)
    return True, 0


def redis_client() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        if not config.REDIS_URL:
            raise RuntimeError("ARCA_REDIS_URL is not configured")
        _redis_client = redis.from_url(config.REDIS_URL, encoding="utf-8", decode_responses=True)
    return _redis_client


async def redis_rate_limit(request: Request) -> tuple[bool, int]:
    key = f"arca:rate:{request_identity(request)}:{request.url.path}"
    try:
        client = redis_client()
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, config.RATE_LIMIT_WINDOW_SECONDS)
        ttl = await client.ttl(key)
    except redis.RedisError:
        return False, config.RATE_LIMIT_WINDOW_SECONDS
    return count <= config.RATE_LIMIT_REQUESTS, max(1, ttl if ttl and ttl > 0 else config.RATE_LIMIT_WINDOW_SECONDS)


def _bearer_token(request: Request) -> str | None:
    value = request.headers.get("authorization", "")
    scheme, _, token = value.partition(" ")
    if scheme.lower() == "bearer" and token:
        return token
    return None


def _privy_verification_key() -> str | PyJWKClient:
    global _privy_jwks_client

    if config.PRIVY_JWKS_URL:
        if _privy_jwks_client is None:
            _privy_jwks_client = PyJWKClient(config.PRIVY_JWKS_URL)
        return _privy_jwks_client

    if not config.PRIVY_VERIFICATION_KEY:
        raise HTTPException(status_code=500, detail="Privy verification key or JWKS URL is not configured")
    return config.PRIVY_VERIFICATION_KEY.replace("\\n", "\n")


def verify_privy_token(token: str) -> str:
    try:
        key = _privy_verification_key()
        if isinstance(key, PyJWKClient):
            key = key.get_signing_key_from_jwt(token).key

        claims = jwt.decode(
            token,
            key,
            algorithms=config.PRIVY_ALGORITHMS,
            audience=config.PRIVY_APP_ID,
            issuer=config.PRIVY_ISSUER,
        )
    except (jwt.InvalidTokenError, PyJWKClientError) as error:
        raise HTTPException(status_code=401, detail="Invalid Privy token") from error

    subject = claims.get("sub")
    if not subject:
        raise HTTPException(status_code=401, detail="Privy token is missing subject")
    return subject


def verify_test_token(token: str) -> str:
    prefix = "test:"
    if not token.startswith(prefix):
        raise HTTPException(status_code=401, detail="Invalid test token")

    subject = token.removeprefix(prefix).strip()
    if not subject:
        raise HTTPException(status_code=401, detail="Test token is missing subject")
    return subject


def current_user_id(request: Request) -> str:
    user_id = request.headers.get("x-arca-user-id")
    token = _bearer_token(request)

    if not config.AUTH_REQUIRED:
        return user_id or "user_demo"

    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    if config.AUTH_PROVIDER == "privy":
        return verify_privy_token(token)

    if config.AUTH_PROVIDER == "test":
        return verify_test_token(token)

    if config.AUTH_SHARED_SECRET and token != config.AUTH_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Invalid API token")

    if not user_id:
        raise HTTPException(status_code=401, detail="Missing authenticated user")

    return user_id


def assert_user_access(user_id: str, request: Request) -> None:
    current_user = current_user_id(request)
    if not config.AUTH_REQUIRED:
        return

    if current_user == user_id:
        return

    with get_connection() as connection:
        row = connection.execute("SELECT privy_user_id FROM users WHERE id = ?", (user_id,)).fetchone()

    if row and row["privy_user_id"] == current_user:
        return

    raise HTTPException(status_code=403, detail="User access denied")


def assert_admin_access(request: Request) -> None:
    if config.ADMIN_API_TOKEN and request.headers.get("x-arca-admin-token") != config.ADMIN_API_TOKEN:
        raise HTTPException(status_code=401, detail="Admin token required")


def assert_dev_access(request: Request) -> None:
    if not config.DEV_ENDPOINTS_ENABLED:
        raise HTTPException(status_code=403, detail="Development endpoints are disabled")

    assert_admin_access(request)


def assert_partner_access(partner_id: str, request: Request) -> None:
    if not config.PARTNER_API_KEYS and not config.IS_PRODUCTION:
        return

    key = request.headers.get("x-arca-partner-key")
    if not key:
        raise HTTPException(status_code=401, detail="Partner API key required")

    allowed = set(config.PARTNER_API_KEYS)
    if key not in allowed and f"{partner_id}:{key}" not in allowed:
        raise HTTPException(status_code=403, detail="Partner API key denied")
