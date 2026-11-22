// Shapes returned by the Park Mandu API (see backend/app/schemas).

export type Role = "public" | "police" | "admin";
export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
  has_next: boolean;
}

export interface User {
  id: string;
  full_name: string;
  initials: string;
  email: string | null;
  phone: string | null;
  role: Role;
  status: "active" | "pending" | "suspended";
  is_verified: boolean;
  designation: string | null;
  badge_number: string | null;
  unit: string | null;
  on_duty: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface TokenBundle {
  token_type: "bearer";
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
}

export interface AuthResponse {
  user: User;
  tokens: TokenBundle | null;
}

export interface CodeSent {
  message: string;
  expires_in: number;
  dev_code: string | null;
}

export type ParkingCategory = "government" | "private";
export type ParkingType = "open_air" | "covered" | "basement" | "rooftop" | "street";
export type ParkingStatus = "open" | "full" | "closed" | "suspended";
export type PricingMode = "free" | "hourly";
export type AvailableDays = "every_day" | "weekdays" | "mon_sat" | "weekends";
export type MarkerTone = "green" | "blue" | "gray" | "red" | "amber" | "camera" | "incident";

export type VehicleType = "car" | "bike" | "other";
export type OccupancySource = "camera" | "manual";

export interface ParkingSummary {
  id: string;
  name: string;
  address: string;
  area: string;
  category: ParkingCategory;
  parking_type: ParkingType;
  capacity: number;
  available_spaces: number;
  /** Always capacity − available_spaces, computed by the API. */
  occupied_spaces: number;
  vehicle_types: VehicleType[];
  pricing_mode: PricingMode;
  price_per_hour: string | null;
  status: ParkingStatus;
  latitude: number;
  longitude: number;
  opens_at: string;
  closes_at: string;
  available_days: AvailableDays;
  distance_m: number | null;
  marker_tone: MarkerTone;
  is_open_now: boolean;
}

export interface ParkingDetail extends ParkingSummary {
  managed_by: string;
  contact_phone: string | null;
  land_size_sqm: number | null;
  is_owner_verified: boolean;
  occupancy_source: OccupancySource | null;
  occupancy_updated_at: string | null;
  created_at: string;
}

export type CameraConnection = "connected" | "waiting" | "disconnected" | "maintenance";

/** The CCTV camera an owner connected to count vehicles in their facility. */
export interface OwnerCamera {
  id: string;
  code: string;
  name: string;
  source_url: string | null;
  connection: CameraConnection;
  connection_label: string;
  last_seen_at: string | null;
  stream_url: string | null;
  /** Distinct parked vehicles in the detector's latest report (before smoothing). */
  detected_vehicles: number | null;
}

/** A facility the signed-in user owns, with AI occupancy monitoring. */
export interface OwnerParking extends ParkingDetail {
  camera: OwnerCamera | null;
  /** A manual correction holds until what the camera sees changes. */
  manual_hold: boolean;
}

export interface MapMarker {
  id: string;
  kind: "parking" | "pending" | "rejected" | "camera" | "incident";
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  tone: MarkerTone;
  status: string;
  /** Distance from the viewer in metres; null when the request carried no position. */
  distance_m?: number | null;
}

export type IssueCategory = "wrong_information" | "closed_or_full" | "overcharging" | "safety" | "other";
export type IssueStatus = "open" | "reviewed" | "closed";

/** A problem a member of the public reported about a parking location, as administrators see it. */
export interface IssueReport {
  id: string;
  category: IssueCategory;
  description: string;
  status: IssueStatus;
  created_at: string;
  updated_at: string;
  parking: { id: string; name: string; address: string; area: string; latitude: number; longitude: number };
  reporter: { id: string; full_name: string; email: string | null; phone: string | null };
}

export interface IssueCounts {
  total: number;
  open: number;
  reviewed: number;
  closed: number;
}

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "changes_requested"
  | "approved"
  | "rejected";

export type DocumentKind = "ownership_document" | "government_id" | "property_photo" | "parking_photo";

export interface DocumentOut {
  id: string;
  kind: DocumentKind;
  original_name: string;
  content_type: string;
  size_bytes: number;
  status: "processing" | "ready" | "failed";
  has_thumbnail: boolean;
  created_at: string;
}

export interface ApplicationEvent {
  id: string;
  kind:
    | "submitted"
    | "resubmitted"
    | "review_started"
    | "changes_requested"
    | "documents_requested"
    | "approved"
    | "rejected";
  message: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface ApplicationSummary {
  id: string;
  reference: string | null;
  status: ApplicationStatus;
  property_name: string | null;
  address: string | null;
  area: string | null;
  capacity: number | null;
  completed_step: number;
  applicant_name: string;
  document_count: number;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationDetail extends ApplicationSummary {
  latitude: number | null;
  longitude: number | null;
  land_size_sqm: number | null;
  parking_type: ParkingType | null;
  vehicle_types: VehicleType[];
  opens_at: string | null;
  closes_at: string | null;
  available_days: AvailableDays | null;
  pricing_mode: PricingMode | null;
  price_per_hour: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  gov_id_masked: string | null;
  ownership_document_number: string | null;
  owner_confirmed: boolean;
  declaration_accepted: boolean;
  feedback: string | null;
  decided_at: string | null;
  reviewer_name: string | null;
  applicant_phone: string | null;
  applicant_email: string | null;
  applicant_verified: boolean;
  parking_location_id: string | null;
  documents: DocumentOut[];
  events: ApplicationEvent[];
  missing: string[];
}

export interface StatusCounts {
  total: number;
  draft: number;
  pending: number;
  approved: number;
  rejected: number;
  changes_requested: number;
}

export interface Notification {
  id: string;
  kind: string;
  tone: "info" | "success" | "warning" | "danger";
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export type CameraStatus = "live" | "offline" | "maintenance";
export type TrafficLevel = "clear" | "moderate" | "slow" | "congested";

export interface Camera {
  id: string;
  code: string;
  name: string;
  road: string;
  area: string;
  zone: string;
  status: CameraStatus;
  traffic_level: TrafficLevel;
  avg_speed_kmh: number;
  latitude: number;
  longitude: number;
  last_heartbeat_at: string | null;
  /** Base URL of the AI detector's live preview (serves /stream.mjpg and /snapshot.jpg); null for simulated cameras. */
  stream_url: string | null;
  /** True once a real AI detector has reported for this camera. */
  ai_enabled: boolean;
  /** Headline numbers from the detector's latest tracking update; null when it is not reporting. */
  tracking: TrackingSummary | null;
  active_violations: number;
}

export type TrackStatus = "moving" | "stopped" | "parked";

/** One vehicle an AI detector is following. `track_id` stays the same while the vehicle is in view. */
export interface TrackedVehicle {
  track_id: number;
  vehicle_type: string;
  status: TrackStatus;
  confidence: number;
  /** Null when the camera has no speed calibration. */
  speed_kmh: number | null;
  stopped_seconds: number;
  /** x1, y1, x2, y2 as fractions of the frame. */
  box: [number, number, number, number];
}

export interface TrackingSummary {
  vehicle_count: number;
  moving_count: number;
  stopped_count: number;
  parked_count: number;
  /** Different vehicles seen during the last minute. */
  flow_per_minute: number;
  avg_speed_kmh: number | null;
  updated_at: string;
}

export interface CameraTracking extends TrackingSummary {
  counts_by_class: Record<string, number>;
  fps: number | null;
  tracks: TrackedVehicle[];
}

export interface CameraTrackingState {
  camera_id: string;
  camera_code: string;
  ai_enabled: boolean;
  traffic_level: TrafficLevel;
  avg_speed_kmh: number;
  tracking: CameraTracking | null;
}

export interface CameraCounts {
  total: number;
  live: number;
  offline: number;
  maintenance: number;
}

export type Severity = "high" | "medium" | "low";
export type AlertStatus = "active" | "assigned" | "resolved" | "dismissed";

export interface Alert {
  id: string;
  code: string | null;
  camera_id: string;
  camera_code: string;
  camera_name: string;
  road: string;
  area: string;
  violation_type: string;
  violation_label: string;
  severity: Severity;
  status: AlertStatus;
  vehicle_type: string;
  vehicle_color: string | null;
  plate_number: string | null;
  confidence: number;
  direction: string | null;
  detected_at: string;
  latitude: number;
  longitude: number;
  assigned_officer_name: string | null;
  incident_id: string | null;
  closed_at: string | null;
  dismiss_reason: string | null;
  /** True when the AI detector attached a photo of the vehicle. */
  has_snapshot: boolean;
}

export interface AlertCounts {
  open: number;
  active: number;
  assigned: number;
  high_priority: number;
  resolved_today: number;
}

export interface IncidentNote {
  id: string;
  body: string;
  author_name: string;
  created_at: string;
}

export interface IncidentSummary {
  id: string;
  code: string | null;
  status: "in_progress" | "resolved";
  officer_id: string;
  officer_name: string;
  violation_label: string;
  severity: Severity;
  road: string;
  camera_code: string;
  plate_number: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface IncidentDetail extends IncidentSummary {
  resolution: string | null;
  alert: Alert;
  notes: IncidentNote[];
}

export interface RoadCondition {
  camera_id: string;
  camera_code: string;
  road: string;
  area: string;
  traffic_level: TrafficLevel;
  avg_speed_kmh: number;
  /** "ai" when measured by a detector's live tracking, "simulated" for demo cameras. */
  source: "ai" | "simulated";
  vehicle_count: number | null;
}

export interface PoliceDashboard {
  officer: User;
  alerts: AlertCounts;
  cameras: CameraCounts;
  latest_alert: Alert | null;
  open_incidents_mine: number;
  road_conditions: RoadCondition[];
}

export interface DashboardStats {
  overview: {
    registered_parkings: number;
    registered_this_month: number;
    pending_applications: number;
    approved_applications: number;
    rejected_applications: number;
    changes_requested: number;
    cameras_live: number;
    cameras_total: number;
    active_alerts: number;
    high_priority_alerts: number;
    resolved_incidents: number;
    registered_users: number;
    open_issue_reports: number;
  };
  charts: {
    applications_over_time: { month: string; submitted: number; approved: number }[];
    outcomes: { approved: number; rejected: number; changes_requested: number };
    incidents_by_area: { area: string; count: number }[];
    cctv_activity: { label: string; detections: number }[];
  };
}

export interface AdminMap {
  markers: MapMarker[];
  counts: Record<string, number>;
}

export interface RoleCounts {
  total: number;
  public: number;
  police: number;
  admin: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_name: string | null;
  meta: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

/** Result returned by Server Actions to forms rendered with useActionState. */
export interface FormState {
  ok?: boolean;
  message?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
}

// --------------------------------------------------------------------------- paid parking (eSewa / Khalti)

export type PaymentProvider = "esewa" | "khalti";
export type PaymentStatus = "initiated" | "pending" | "completed" | "failed" | "cancelled" | "expired" | "refunded";
export type BookingStatus = "pending_payment" | "confirmed" | "expired" | "cancelled";
export type BookingDisplayStatus = "awaiting_payment" | "payment_pending" | "active" | "ended" | "expired" | "cancelled" | "needs_attention";
export type ReconciliationState = "none" | "needs_confirmation" | "refund_required" | "resolved";

export interface PaymentProviderOption {
  id: PaymentProvider;
  label: string;
  enabled: boolean;
  min_amount: string;
  environment: "sandbox" | "production";
}

export interface BookingQuote {
  parking_id: string;
  hours: number;
  price_per_hour: string;
  amount: string;
  currency: string;
  bookable_spaces: number;
  max_hours: number;
  closes_at: string | null;
  hold_minutes: number;
  providers: PaymentProviderOption[];
}

export interface Payment {
  id: string;
  provider: PaymentProvider;
  provider_label: string;
  status: PaymentStatus;
  amount: string;
  transaction_uuid: string;
  provider_transaction_id: string | null;
  created_at: string;
  completed_at: string | null;
  failure_reason: string | null;
  reconciliation: ReconciliationState;
  reconciliation_note: string | null;
  checkout_url: string | null;
}

export interface BookingSummary {
  id: string;
  reference: string | null;
  kind: "initial" | "extension";
  parent_id: string | null;
  status: BookingStatus;
  display_status: BookingDisplayStatus;
  hours: number;
  price_per_hour: string;
  amount: string;
  currency: string;
  vehicle_plate: string | null;
  hold_expires_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  parking: { id: string; name: string; address: string; latitude: number; longitude: number };
}

export interface BookingDetail extends BookingSummary {
  payments: Payment[];
  extensions: BookingSummary[];
  latest_payment: Payment | null;
  can_pay: boolean;
  can_cancel: boolean;
  can_extend: boolean;
  max_extension_hours: number;
}

// --------------------------------------------------------------------------- in-app navigation

export interface RouteStep {
  instruction: string;
  distance_m: number;
  duration_s: number;
  road: string;
  maneuver: string;
  location: [number, number];
}

export interface DrivingRoute {
  distance_m: number;
  duration_s: number;
  /** [lng, lat] pairs */
  geometry: [number, number][];
  steps: RouteStep[];
  provider: string;
}
