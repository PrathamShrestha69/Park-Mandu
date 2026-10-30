import json
from typing import Annotated

import httpx
from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.core.rate_limit import limiter
from app.core.redis import redis_client

router = APIRouter(prefix="/geo", tags=["geo"])

NOMINATIM = "https://nominatim.openstreetmap.org"
HEADERS = {"User-Agent": "ParkMandu/1.0 (government parking registration)", "Accept-Language": "en"}
CACHE_TTL = 7 * 24 * 3600


class Place(BaseModel):
    label: str
    area: str | None
    latitude: float
    longitude: float


def _to_place(result: dict) -> Place:
    a = result.get("address") or {}
    area_keys = ("suburb", "neighbourhood", "quarter", "city_district", "town", "city")
    area = next((a[k] for k in area_keys if a.get(k)), None)
    parts = [p for p in (a.get("road"), a.get("house_number"), area, a.get("city") or a.get("town")) if p]
    label = ", ".join(parts) if parts else ", ".join(result.get("display_name", "").split(",")[:3])
    return Place(label=label, area=area, latitude=float(result["lat"]), longitude=float(result["lon"]))


async def _cached(key: str, url: str, params: dict) -> object | None:
    cached = await redis_client.get(key)
    if cached is not None:
        return json.loads(cached)
    try:
        async with httpx.AsyncClient(timeout=8, headers=HEADERS) as client:
            res = await client.get(url, params=params)
            res.raise_for_status()
            data = res.json()
    except (httpx.HTTPError, ValueError):
        return None
    await redis_client.set(key, json.dumps(data), ex=CACHE_TTL)
    return data


@router.get("/search", response_model=list[Place], summary="Place search inside Nepal (cached)")
@limiter.limit("30/minute")
async def search(
    request: Request, _: CurrentUser, q: Annotated[str, Query(min_length=3, max_length=80)]
) -> list[Place]:
    query = q.strip().lower()
    data = await _cached(
        f"geo:search:{query}",
        f"{NOMINATIM}/search",
        {"q": query, "format": "jsonv2", "addressdetails": 1, "limit": 5, "countrycodes": "np"},
    )
    return [_to_place(r) for r in data] if isinstance(data, list) else []


@router.get("/reverse", response_model=Place | None, summary="Address for a coordinate (cached)")
@limiter.limit("60/minute")
async def reverse(
    request: Request,
    _: CurrentUser,
    lat: Annotated[float, Query(ge=26.3, le=30.5)],
    lng: Annotated[float, Query(ge=80.0, le=88.3)],
) -> Place | None:
    lat_r, lng_r = round(lat, 5), round(lng, 5)
    data = await _cached(
        f"geo:reverse:{lat_r}:{lng_r}",
        f"{NOMINATIM}/reverse",
        {"lat": lat_r, "lon": lng_r, "format": "jsonv2", "addressdetails": 1, "zoom": 18},
    )
    return _to_place(data) if isinstance(data, dict) and "lat" in data else None
