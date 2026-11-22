import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import socketio
from asgi_correlation_id import CorrelationIdFilter, CorrelationIdMiddleware
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.rate_limit import limiter
from app.core.realtime import sio
from app.core.redis import redis_client
from app.core.security import CLIENT_TYPE_HEADER, CSRF_HEADER
from app.db.session import async_engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(correlation_id)s] %(name)s: %(message)s",
)
for handler in logging.getLogger().handlers:
    handler.addFilter(CorrelationIdFilter(default_value="-"))


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield


api = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Government smart parking and traffic monitoring service for Kathmandu Valley.",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)

api.state.limiter = limiter
register_exception_handlers(api)

api.add_middleware(SlowAPIMiddleware)
api.add_middleware(GZipMiddleware, minimum_size=1024)
api.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", CSRF_HEADER, CLIENT_TYPE_HEADER, "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)
api.add_middleware(CorrelationIdMiddleware, header_name="X-Request-ID")


@api.middleware("http")
async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    response: Response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith(settings.api_prefix):
        response.headers.setdefault("Cache-Control", "no-store")
    if settings.cookie_secure:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


api.include_router(api_router, prefix=settings.api_prefix)


@api.get("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}


@api.get("/health/ready", include_in_schema=False)
async def readiness() -> dict[str, str]:
    async with async_engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    await redis_client.ping()
    return {"status": "ready"}


async def _shutdown() -> None:
    await redis_client.aclose()
    await async_engine.dispose()


# The ASGI entry point (`app.main:app`): Socket.IO answers /socket.io, everything else goes to FastAPI.
app = socketio.ASGIApp(sio, other_asgi_app=api, socketio_path="/socket.io", on_shutdown=_shutdown)
