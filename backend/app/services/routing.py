"""Road routes for in-app navigation, from an OSRM-compatible routing service (ROUTING_BASE_URL).

The maps draw the route themselves; this module only asks the routing service and turns its answer
into a small, stable shape: the line to draw, distance, travel time and plain-language steps.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import asdict, dataclass

import httpx

from app.core.config import settings
from app.core.errors import AppError
from app.core.redis import redis_client

log = logging.getLogger(__name__)

CACHE_SECONDS = 60
# Straight-line limit: in-app navigation is for driving to parking, not across the country.
MAX_STRAIGHT_LINE_KM = 150


@dataclass(frozen=True)
class RouteStep:
    instruction: str
    distance_m: float
    duration_s: float
    road: str
    maneuver: str
    location: tuple[float, float]  # lng, lat


@dataclass(frozen=True)
class Route:
    distance_m: float
    duration_s: float
    geometry: list[tuple[float, float]]  # lng, lat pairs
    steps: list[RouteStep]
    provider: str = "osrm"


class RoutingError(AppError):
    pass


def _compass(bearing: float | None) -> str:
    if bearing is None:
        return ""
    names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
    return names[round(bearing / 45) % 8]


def instruction(step: dict) -> str:
    """Plain-language instruction for one OSRM step."""
    maneuver = step.get("maneuver", {})
    kind = maneuver.get("type", "")
    modifier = (maneuver.get("modifier") or "").replace("uturn", "U-turn")
    road = step.get("name") or ""
    onto = f" onto {road}" if road else ""
    if kind == "depart":
        heading = _compass(maneuver.get("bearing_after"))
        return f"Head {heading}{onto}".replace("Head  ", "Head ").strip() if heading else f"Start{onto}"
    if kind == "arrive":
        return "You have arrived at the parking" if not modifier or modifier == "straight" else f"The parking is on your {modifier}"
    if kind in ("roundabout", "rotary", "roundabout turn"):
        exit_no = maneuver.get("exit")
        return f"At the roundabout, take exit {exit_no}{onto}" if exit_no else f"Go through the roundabout{onto}"
    if kind in ("fork", "on ramp", "off ramp"):
        return f"Keep {modifier or 'straight'}{onto}"
    if kind == "merge":
        return f"Merge {modifier}{onto}".replace("Merge  ", "Merge ")
    if kind in ("new name", "continue", "notification") or modifier == "straight":
        return f"Continue{onto}" if road else "Continue straight"
    if kind == "end of road":
        return f"At the end of the road, turn {modifier}{onto}"
    if modifier == "U-turn":
        return f"Make a U-turn{onto}"
    if modifier:
        return f"Turn {modifier}{onto}"
    return f"Continue{onto}" if road else "Continue"


def _straight_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def parse(body: dict) -> Route:
    code = body.get("code")
    routes = body.get("routes") or []
    if code in ("NoRoute", "NoSegment") or (code == "Ok" and not routes):
        raise RoutingError(404, "no_route", "No road route was found to this parking. Try moving closer to a road.")
    if code != "Ok":
        raise RoutingError(503, "routing_unavailable", "Directions are unavailable right now. Please try again.")
    best = routes[0]
    steps = [
        RouteStep(
            instruction=instruction(s),
            distance_m=round(float(s.get("distance", 0)), 1),
            duration_s=round(float(s.get("duration", 0)), 1),
            road=s.get("name") or "",
            maneuver=s.get("maneuver", {}).get("type", ""),
            location=tuple(s.get("maneuver", {}).get("location", (0.0, 0.0))),  # type: ignore[arg-type]
        )
        for leg in best.get("legs", [])
        for s in leg.get("steps", [])
    ]
    coordinates = [(round(c[0], 6), round(c[1], 6)) for c in best.get("geometry", {}).get("coordinates", [])]
    if len(coordinates) < 2:
        raise RoutingError(503, "routing_unavailable", "Directions are unavailable right now. Please try again.")
    return Route(
        distance_m=round(float(best["distance"]), 1),
        duration_s=round(float(best["duration"]), 1),
        geometry=coordinates,
        steps=steps,
    )


async def driving_route(origin: tuple[float, float], destination: tuple[float, float]) -> dict:
    """Route between two (lat, lng) points, as a JSON-ready dict. Raises RoutingError."""
    if _straight_km(origin, destination) > MAX_STRAIGHT_LINE_KM:
        raise RoutingError(422, "too_far", "This parking is too far away for in-app directions.")
    # ~10 m grid: a driver who has barely moved gets the cached route instead of a new request.
    key = "routes:{}:{:.4f},{:.4f}:{:.4f},{:.4f}".format(settings.routing_profile, *origin, *destination)
    try:
        cached = await redis_client.get(key)
    except Exception:  # noqa: BLE001 - cache is optional
        cached = None
    if cached:
        return json.loads(cached)
    coords = f"{origin[1]:.6f},{origin[0]:.6f};{destination[1]:.6f},{destination[0]:.6f}"
    url = f"{settings.routing_base_url.rstrip('/')}/route/v1/{settings.routing_profile}/{coords}"
    try:
        async with httpx.AsyncClient(timeout=settings.routing_timeout_seconds) as client:
            response = await client.get(
                url,
                params={"overview": "full", "geometries": "geojson", "steps": "true", "alternatives": "false"},
                headers={"User-Agent": "ParkMandu/1.0 (in-app parking navigation)"},
            )
    except httpx.HTTPError as exc:
        log.warning("Routing service unreachable: %s", exc)
        raise RoutingError(503, "routing_unavailable", "Directions are unavailable right now. Please try again.") from exc
    try:
        body = response.json()
    except ValueError as exc:
        raise RoutingError(503, "routing_unavailable", "Directions are unavailable right now. Please try again.") from exc
    if response.status_code == 429:
        raise RoutingError(503, "routing_busy", "The directions service is busy. Trying again shortly.")
    route = asdict(parse(body if isinstance(body, dict) else {}))
    try:
        await redis_client.set(key, json.dumps(route), ex=CACHE_SECONDS)
    except Exception:  # noqa: BLE001 - the cache is optional; the route is still returned
        log.debug("Could not cache route %s", key, exc_info=True)
    return route
