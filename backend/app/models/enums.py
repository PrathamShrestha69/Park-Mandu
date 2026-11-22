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


class VehicleType(StrEnum):
    """Which vehicles a parking facility accepts."""

    CAR = "car"
    BIKE = "bike"
    OTHER = "other"


class OccupancySource(StrEnum):
    """Where a facility's current occupancy figure came from."""

    CAMERA = "camera"
    MANUAL = "manual"


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


class ParkingState(StrEnum):
    """What the Parking Availability Bridge reports for a tracked vehicle. Only two states exist."""

    PARKED = "PARKED"
    NOT_PARKED = "NOT_PARKED"


class TrafficStatus(StrEnum):
    """Traffic on a camera's road as illegal-parking enforcement sees it (derived from TrafficLevel)."""

    NORMAL_FLOW = "NORMAL_FLOW"
    TRAFFIC_JAM = "TRAFFIC_JAM"
    # No traffic measurement, or the last one is too old to trust: alerts are held back.
    UNKNOWN = "UNKNOWN"


class EnforcementDecision(StrEnum):
    """Why a parked vehicle did or did not become an illegal-parking alert (latest assessment)."""

    PENDING = "pending"
    ALERTED = "alerted"
    SUPPRESSED_TRAFFIC_JAM = "suppressed_traffic_jam"
    SUPPRESSED_TRAFFIC_UNKNOWN = "suppressed_traffic_unknown"
    NOT_PARKED = "not_parked"
    LEGAL_PARKING = "legal_parking"
    LOW_CONFIDENCE = "low_confidence"
    CAMERA_UNAVAILABLE = "camera_unavailable"
    NOT_OBSERVED = "not_observed"


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
    INCIDENT_DISPATCH = "incident_dispatch"
    SUGGESTION_UPDATE = "suggestion_update"
    BOOKING_UPDATE = "booking_update"
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


class AvailabilityStatus(StrEnum):
    """What a driver cares about: can I park here right now?"""

    AVAILABLE = "available"
    PARTIAL = "partial"
    FULL = "full"
    CLOSED = "closed"


class DispatchStatus(StrEnum):
    NOTIFIED = "notified"
    ACKNOWLEDGED = "acknowledged"
    DECLINED = "declined"
    EXPIRED = "expired"
    NO_OFFICER = "no_officer"


class SuggestionCategory(StrEnum):
    PARKING = "parking"
    TRAFFIC = "traffic"
    APP = "app"
    SAFETY = "safety"
    OTHER = "other"


class SuggestionStatus(StrEnum):
    NEW = "new"
    REVIEWED = "reviewed"
    RESOLVED = "resolved"
    ARCHIVED = "archived"


class BookingKind(StrEnum):
    INITIAL = "initial"  # reserves a space
    EXTENSION = "extension"  # adds hours to a confirmed booking (same space)


class BookingStatus(StrEnum):
    PENDING_PAYMENT = "pending_payment"  # space held while the driver pays
    CONFIRMED = "confirmed"  # paid and verified with the provider
    EXPIRED = "expired"  # the hold ran out before a verified payment arrived
    CANCELLED = "cancelled"  # the driver gave up before paying


class PaymentProvider(StrEnum):
    ESEWA = "esewa"
    KHALTI = "khalti"


class PaymentStatus(StrEnum):
    INITIATED = "initiated"  # created; the driver is being sent to the provider
    PENDING = "pending"  # the provider has not finished (or could not be asked yet)
    COMPLETED = "completed"  # verified server-side with the provider, amount checked
    FAILED = "failed"
    CANCELLED = "cancelled"  # the driver cancelled at the provider
    EXPIRED = "expired"  # the provider's payment session timed out
    REFUNDED = "refunded"


OPEN_PAYMENT_STATUSES = {PaymentStatus.INITIATED, PaymentStatus.PENDING}


class ReconciliationState(StrEnum):
    """Money and booking out of step: a completed payment that did not (yet) confirm its booking."""

    NONE = "none"
    NEEDS_CONFIRMATION = "needs_confirmation"  # paid; confirming the booking failed and is retried
    REFUND_REQUIRED = "refund_required"  # paid, but the booking cannot be honoured (duplicate, no space…)
    RESOLVED = "resolved"  # an administrator settled it
