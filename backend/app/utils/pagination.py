import math
from collections.abc import Callable, Sequence
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")


class PageParams(BaseModel):
    page: int = Field(1, ge=1, le=10_000)
    size: int = Field(20, ge=1, le=100)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    size: int
    pages: int
    has_next: bool


async def paginate(
    session: AsyncSession,
    stmt: Select[Any],
    params: PageParams,
    *,
    transform: Callable[[Any], Any] | None = None,
    scalars: bool = True,
) -> dict[str, Any]:
    """Offset pagination with an exact total. Callers must apply a deterministic ORDER BY."""
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(await session.scalar(count_stmt) or 0)
    page_stmt = stmt.limit(params.size).offset((params.page - 1) * params.size)
    result = await session.execute(page_stmt)
    rows: Sequence[Any] = result.scalars().all() if scalars else result.all()
    items = [transform(row) for row in rows] if transform else list(rows)
    pages = math.ceil(total / params.size) if total else 0
    return {
        "items": items,
        "total": total,
        "page": params.page,
        "size": params.size,
        "pages": pages,
        "has_next": params.page < pages,
    }
