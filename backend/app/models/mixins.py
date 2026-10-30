from typing import Any

from geoalchemy2 import Geography
from geoalchemy2.elements import WKTElement
from sqlalchemy import Float, event
from sqlalchemy.orm import Mapped, declared_attr, mapped_column


def make_point(latitude: float, longitude: float) -> WKTElement:
    return WKTElement(f"POINT({longitude} {latitude})", srid=4326)


class GeoPoint:
    """Latitude/longitude columns plus a PostGIS geography column kept in sync for spatial queries."""

    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)

    @declared_attr
    def location(cls) -> Mapped[Any]:
        return mapped_column(Geography(geometry_type="POINT", srid=4326, spatial_index=True))


@event.listens_for(GeoPoint, "before_insert", propagate=True)
@event.listens_for(GeoPoint, "before_update", propagate=True)
def _sync_location(_mapper: Any, _connection: Any, target: GeoPoint) -> None:
    if target.latitude is not None and target.longitude is not None:
        target.location = make_point(target.latitude, target.longitude)
