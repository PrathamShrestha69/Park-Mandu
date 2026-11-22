import pytest
from redis import Redis

from app.core.config import settings


@pytest.fixture(scope="session", autouse=True)
def reset_rate_limits() -> None:
    """Rate limits are per IP; clear counters so back-to-back runs from one container are isolated."""
    client = Redis.from_url(settings.redis_url)
    for pattern in ("LIMITS*", "auth:failures:*"):
        keys = list(client.scan_iter(match=pattern, count=500))
        if keys:
            client.delete(*keys)
