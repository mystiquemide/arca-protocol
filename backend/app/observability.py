import json
import logging
import time
import uuid

from fastapi import Request

from . import config


logger = logging.getLogger("arca")


def configure_logging() -> None:
    logging.basicConfig(level=config.LOG_LEVEL.upper(), format="%(message)s")
    logger.setLevel(config.LOG_LEVEL.upper())


def log_event(event: str, **fields) -> None:
    payload = {
        "event": event,
        "service": "arca-api",
        "environment": config.ARCA_ENV,
        **fields,
    }
    logger.info(json.dumps(payload, sort_keys=True, default=str))


async def request_logging(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = request_id
    started = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        log_event(
            "http_request_error",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            duration_ms=duration_ms,
        )
        raise

    response.headers["x-request-id"] = request_id
    if config.LOG_REQUESTS and request.url.path not in {"/health"}:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        log_event(
            "http_request",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
    return response
