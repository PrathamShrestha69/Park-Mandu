from enum import StrEnum


class UserRole(StrEnum):
    PUBLIC = "public"
    POLICE = "police"
    ADMIN = "admin"


class UserStatus(StrEnum):
    ACTIVE = "active"
    PENDING = "pending"
    SUSPENDED = "suspended"


class ParkingCategory(StrEnum):
    GOVERNMENT = "government"
    PRIVATE = "private"


class ParkingType(StrEnum):
    OPEN_AIR = "open_air"
    COVERED = "covered"
    BASEMENT = "basement"
    ROOFTOP = "rooftop"
    STREET = "street"


class ParkingStatus(StrEnum):
    OPEN = "open"
    FULL = "full"
    CLOSED = "closed"
    SUSPENDED = "suspended"


class PricingMode(StrEnum):
    FREE = "free"
    HOURLY = "hourly"


class AvailableDays(StrEnum):
    EVERY_DAY = "every_day"
    WEEKDAYS = "weekdays"
    MON_SAT = "mon_sat"
    WEEKENDS = "weekends"


class ApplicationStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    CHANGES_REQUESTED = "changes_requested"
    APPROVED = "approved"
    REJECTED = "rejected"


EDITABLE_APPLICATION_STATUSES = {ApplicationStatus.DRAFT, ApplicationStatus.CHANGES_REQUESTED}
PENDING_APPLICATION_STATUSES = {ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW}


class ApplicationEventKind(StrEnum):
    SUBMITTED = "submitted"
    RESUBMITTED = "resubmitted"
    REVIEW_STARTED = "review_started"
    CHANGES_REQUESTED = "changes_requested"
    DOCUMENTS_REQUESTED = "documents_requested"
    APPROVED = "approved"
    REJECTED = "rejected"


class DocumentKind(StrEnum):
    OWNERSHIP_DOCUMENT = "ownership_document"
    GOVERNMENT_ID = "government_id"
    PROPERTY_PHOTO = "property_photo"
    PARKING_PHOTO = "parking_photo"


REQUIRED_DOCUMENT_KINDS = {
    DocumentKind.OWNERSHIP_DOCUMENT,
    DocumentKind.GOVERNMENT_ID,
    DocumentKind.PROPERTY_PHOTO,
}


class DocumentStatus(StrEnum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class CameraStatus(StrEnum):
    LIVE = "live"
    OFFLINE = "offline"
    MAINTENANCE = "maintenance"


class TrafficLevel(StrEnum):
    CLEAR = "clear"
    MODERATE = "moderate"
    SLOW = "slow"
    CONGESTED = "congested"


class ViolationType(StrEnum):
    NO_PARKING_ZONE = "no_parking_zone"
    RESTRICTED_LANE = "restricted_lane"
    NEAR_INTERSECTION = "near_intersection"
    FOOTPATH = "footpath_obstruction"
    DOUBLE_PARKING = "double_parking"
    BUS_STOP = "bus_stop_obstruction"
    OVERTIME = "overtime_parking"
    LOADING_ZONE = "loading_zone_obstruction"


class AlertSeverity(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AlertStatus(StrEnum):
    ACTIVE = "active"
    ASSIGNED = "assigned"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


OPEN_ALERT_STATUSES = {AlertStatus.ACTIVE, AlertStatus.ASSIGNED}


class IncidentStatus(StrEnum):
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"


class NotificationKind(StrEnum):
    APPLICATION_RECEIVED = "application_received"
    APPLICATION_UNDER_REVIEW = "application_under_review"
    APPLICATION_APPROVED = "application_approved"
    APPLICATION_REJECTED = "application_rejected"
    APPLICATION_CHANGES = "application_changes"
    DOCUMENTS_REQUIRED = "documents_required"
    ISSUE_UPDATE = "issue_update"
    SYSTEM = "system"


class NotificationTone(StrEnum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    DANGER = "danger"


class IssueCategory(StrEnum):
    WRONG_INFORMATION = "wrong_information"
    CLOSED_OR_FULL = "closed_or_full"
    OVERCHARGING = "overcharging"
    SAFETY = "safety"
    OTHER = "other"


class IssueStatus(StrEnum):
    OPEN = "open"
    REVIEWED = "reviewed"
    CLOSED = "closed"
