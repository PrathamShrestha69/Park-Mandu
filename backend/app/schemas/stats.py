from pydantic import BaseModel

from app.schemas.parking import MapMarker


class OverviewStats(BaseModel):
    registered_parkings: int
    registered_this_month: int
    pending_applications: int
    approved_applications: int
    rejected_applications: int
    changes_requested: int
    cameras_live: int
    cameras_total: int
    active_alerts: int
    high_priority_alerts: int
    resolved_incidents: int
    registered_users: int


class MonthPoint(BaseModel):
    month: str
    submitted: int
    approved: int


class OutcomeSlice(BaseModel):
    approved: int
    rejected: int
    changes_requested: int


class AreaCount(BaseModel):
    area: str
    count: int


class ActivityPoint(BaseModel):
    label: str
    detections: int


class ChartStats(BaseModel):
    applications_over_time: list[MonthPoint]
    outcomes: OutcomeSlice
    incidents_by_area: list[AreaCount]
    cctv_activity: list[ActivityPoint]


class DashboardStats(BaseModel):
    overview: OverviewStats
    charts: ChartStats


class AdminMapOut(BaseModel):
    markers: list[MapMarker]
    counts: dict[str, int]
