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

export interface ParkingSummary {
  id: string;
  name: string;
  address: string;
  area: string;
  category: ParkingCategory;
  parking_type: ParkingType;
  capacity: number;
  available_spaces: number;
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
  created_at: string;
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
  active_violations: number;
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
  camera_code: string;
  road: string;
  area: string;
  traffic_level: TrafficLevel;
  avg_speed_kmh: number;
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
