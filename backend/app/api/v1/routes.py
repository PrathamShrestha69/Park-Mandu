from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from app.core.rate_limit import limiter
from app.services.routing import driving_route

router = APIRouter(tags=["navigation"])


class RouteStepOut(BaseModel):
    instruction: str
    distance_m: float
    duration_s: float
    road: str
    maneuver: str
    location: tuple[float, float]


class RouteOut(BaseModel):
    distance_m: float
    duration_s: float
    # [lng, lat] pairs, ready for a GeoJSON LineString.
    geometry: list[tuple[float, float]]
    steps: list[RouteStepOut]
    provider: str


@router.get("/routes/driving", response_model=RouteOut, summary="Driving route for in-app navigation")
@limiter.limit("60/minute")
async def route(
    request: Request,
    from_lat: Annotated[float, Query(ge=-90, le=90)],
    from_lng: Annotated[float, Query(ge=-180, le=180)],
    to_lat: Annotated[float, Query(ge=-90, le=90)],
    to_lng: Annotated[float, Query(ge=-180, le=180)],
) -> dict:
    return await driving_route((from_lat, from_lng), (to_lat, to_lng))
