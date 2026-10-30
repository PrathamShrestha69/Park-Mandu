import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import ColumnElement, Integer, Select, Time, and_, case, cast, func, literal, or_, select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.errors import not_found
from app.core.rate_limit import limiter
from app.models.application import ParkingApplication
from app.models.enums import PENDING_APPLICATION_STATUSES, AvailableDays, ParkingStatus, PricingMode
from app.models.parking import IssueReport, ParkingLocation
from app.schemas.parking import (
    IssueReportCreate,
    IssueReportOut,
    MapBounds,
    MapMarker,
    ParkingDetail,
    ParkingFilters,
    ParkingSummary,
)
from app.services import parking as parking_service
from app.utils.pagination import Page, paginate
from app.utils.text import escape_like

router = APIRouter(prefix="/parkings", tags=["parkings"])

MAP_MARKER_LIMIT = 500


def geography_point(lat: float, lng: float) -> ColumnElement[Any]:
    return func.geography(func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326))


def open_now_clause() -> ColumnElement[bool]:
    local = func.timezone(settings.timezone, func.now())
    now_time = cast(local, Time)
    isodow = cast(func.extract("isodow", local), Integer)  # 1 = Monday … 7 = Sunday
    day_ok = case(
        (ParkingLocation.available_days == AvailableDays.WEEKDAYS, isodow <= 5),
        (ParkingLocation.available_days == AvailableDays.MON_SAT, isodow <= 6),
        (ParkingLocation.available_days == AvailableDays.WEEKENDS, isodow >= 6),
        else_=True,
    )
    hours_ok = case(
        (
            ParkingLocation.opens_at < ParkingLocation.closes_at,
            and_(ParkingLocation.opens_at <= now_time, now_time < ParkingLocation.closes_at),
        ),
        else_=or_(now_time >= ParkingLocation.opens_at, now_time < ParkingLocation.closes_at),
    )
    return and_(ParkingLocation.status.notin_([ParkingStatus.CLOSED, ParkingStatus.SUSPENDED]), day_ok, hours_ok)


def _search(stmt: Select[Any], q: str) -> Select[Any]:
    pattern = f"%{escape_like(q.strip())}%"
    return stmt.where(
        or_(
            ParkingLocation.name.ilike(pattern, escape="\\"),
            ParkingLocation.address.ilike(pattern, escape="\\"),
            ParkingLocation.area.ilike(pattern, escape="\\"),
        )
    )


@router.get("", response_model=Page[ParkingSummary], summary="Search published parking locations")
async def list_parkings(filters: Annotated[ParkingFilters, Query()], db: DbSession) -> dict[str, Any]:
    has_origin = filters.lat is not None and filters.lng is not None
    distance: ColumnElement[Any]
    if has_origin:
        origin = geography_point(filters.lat, filters.lng)  # type: ignore[arg-type]
        distance = func.ST_Distance(ParkingLocation.location, origin).label("distance_m")
    else:
        distance = literal(None).label("distance_m")

    stmt = select(ParkingLocation, distance).where(ParkingLocation.is_published.is_(True))
    if has_origin:
        stmt = stmt.where(func.ST_DWithin(ParkingLocation.location, origin, filters.radius_m))
    if filters.q:
        stmt = _search(stmt, filters.q)
    if filters.category:
        stmt = stmt.where(ParkingLocation.category == filters.category)
    if filters.area:
        stmt = stmt.where(ParkingLocation.area == filters.area)
    if filters.available_only:
        stmt = stmt.where(ParkingLocation.available_spaces > 0, ParkingLocation.status == ParkingStatus.OPEN)
    if filters.free_only:
        stmt = stmt.where(ParkingLocation.pricing_mode == PricingMode.FREE)
    if filters.open_now:
        stmt = stmt.where(open_now_clause())

    order = {
        "distance": distance.asc() if has_origin else ParkingLocation.name.asc(),
        "name": ParkingLocation.name.asc(),
        "available": ParkingLocation.available_spaces.desc(),
        "price": func.coalesce(ParkingLocation.price_per_hour, 0).asc(),
        "newest": ParkingLocation.created_at.desc(),
    }[filters.sort]
    stmt = stmt.order_by(order, ParkingLocation.id)

    return await paginate(
        db,
        stmt,
        filters,
        scalars=False,
        transform=lambda row: parking_service.to_summary(row[0], row[1]),
    )


@router.get("/areas", response_model=list[str], summary="Areas that have published parking")
async def list_areas(db: DbSession) -> list[str]:
    rows = await db.scalars(
        select(ParkingLocation.area)
        .where(ParkingLocation.is_published.is_(True))
        .distinct()
        .order_by(ParkingLocation.area)
    )
    return list(rows)


@router.get("/map", response_model=list[MapMarker], summary="Lightweight markers inside a map viewport")
async def map_markers(bounds: Annotated[MapBounds, Query()], db: DbSession) -> list[MapMarker]:
    envelope = func.ST_MakeEnvelope(bounds.min_lng, bounds.min_lat, bounds.max_lng, bounds.max_lat, 4326)
    parkings = (
        await db.scalars(
            select(ParkingLocation)
            .where(
                ParkingLocation.is_published.is_(True),
                func.ST_Intersects(func.geometry(ParkingLocation.location), envelope),
            )
            .limit(MAP_MARKER_LIMIT)
        )
    ).all()
    markers = []
    for p in parkings:
        summary = parking_service.to_summary(p)
        price = "Free" if p.pricing_mode == PricingMode.FREE else f"NPR {p.price_per_hour:.0f}/hr"
        markers.append(
            MapMarker(
                id=p.id,
                kind="parking",
                name=p.name,
                subtitle=f"{p.available_spaces} of {p.capacity} spaces · {price}",
                latitude=p.latitude,
                longitude=p.longitude,
                tone=summary.marker_tone,
                status=p.status.value,
            )
        )

    pending = (
        await db.execute(
            select(
                ParkingApplication.id,
                ParkingApplication.property_name,
                ParkingApplication.latitude,
                ParkingApplication.longitude,
            ).where(
                ParkingApplication.status.in_(PENDING_APPLICATION_STATUSES),
                and_(
                    ParkingApplication.latitude.between(bounds.min_lat, bounds.max_lat),
                    ParkingApplication.longitude.between(bounds.min_lng, bounds.max_lng),
                ),
            )
        )
    ).all()
    markers.extend(
        MapMarker(
            id=row.id,
            kind="pending",
            name=row.property_name or "Proposed parking",
            subtitle="Pending government approval",
            latitude=row.latitude,
            longitude=row.longitude,
            tone="gray",
            status="pending",
        )
        for row in pending
    )
    return markers


@router.get("/{parking_id}", response_model=ParkingDetail)
async def get_parking(
    parking_id: uuid.UUID,
    db: DbSession,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
) -> ParkingDetail:
    distance: ColumnElement[Any] = (
        func.ST_Distance(ParkingLocation.location, geography_point(lat, lng))
        if lat is not None and lng is not None
        else literal(None)
    )
    row = (
        await db.execute(
            select(ParkingLocation, distance.label("distance_m")).where(
                ParkingLocation.id == parking_id, ParkingLocation.is_published.is_(True)
            )
        )
    ).first()
    if row is None:
        raise not_found("Parking location")
    return parking_service.to_detail(row[0], row[1])


@router.post(
    "/{parking_id}/reports",
    response_model=IssueReportOut,
    status_code=status.HTTP_201_CREATED,
    summary="Report a problem with a parking location",
)
@limiter.limit("5/minute")
async def report_issue(
    request: Request, parking_id: uuid.UUID, body: IssueReportCreate, user: CurrentUser, db: DbSession
) -> IssueReport:
    parking = await db.get(ParkingLocation, parking_id)
    if parking is None or not parking.is_published:
        raise not_found("Parking location")
    report = IssueReport(
        parking_id=parking.id, reporter_id=user.id, category=body.category, description=body.description.strip()
    )
    db.add(report)
    await db.commit()
    return report
