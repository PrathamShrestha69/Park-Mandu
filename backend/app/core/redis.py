from redis import Redis
from redis.asyncio import Redis as AsyncRedis

from app.core.config import settings

redis_client: AsyncRedis = AsyncRedis.from_url(settings.redis_url, decode_responses=True)
sync_redis: Redis = Redis.from_url(settings.redis_url, decode_responses=True)

ALERTS_CHANNEL = "alerts:live"


def revoked_session_key(session_id: str) -> str:
    return f"auth:revoked:{session_id}"
