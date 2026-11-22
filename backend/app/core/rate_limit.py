from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings

# Redis-backed so limits hold across gunicorn workers and API replicas.
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.redis_url,
    default_limits=["300/minute"],
    headers_enabled=False,
    enabled=settings.environment != "test",
)
