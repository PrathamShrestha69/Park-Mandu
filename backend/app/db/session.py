from collections.abc import AsyncIterator, Iterator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

# The API uses the async engine; Celery workers use the sync engine. Both share the psycopg 3 driver.
async_engine = create_async_engine(settings.database_url, pool_pre_ping=True, pool_size=10, max_overflow=20)
AsyncSessionLocal = async_sessionmaker(async_engine, expire_on_commit=False, autoflush=False)

sync_engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)
SyncSessionLocal = sessionmaker(sync_engine, expire_on_commit=False, autoflush=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


def sync_session() -> Iterator[Session]:
    with SyncSessionLocal() as session:
        yield session
