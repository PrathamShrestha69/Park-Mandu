import type { Tone } from "./theme";
import type { ApplicationStatus, AvailableDays, CameraStatus, DocumentKind, ParkingSummary, ParkingType, Severity, TrafficLevel } from "./types";

export const PARKING_TYPE_LABEL: Record<ParkingType, string> = {
  open_air: "Open-air lot",
  covered: "Covered garage",
  basement: "Basement parking",
  rooftop: "Rooftop parking",
  street: "Street parking",
};

export const DAYS_LABEL: Record<AvailableDays, string> = {
  every_day: "Every day",
  weekdays: "Monday – Friday",
  mon_sat: "Monday – Saturday",
  weekends: "Weekends only",
};

export const APPLICATION_STATUS: Record<ApplicationStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Pending review", tone: "warning" },
  under_review: { label: "Under review", tone: "info" },
  changes_requested: { label: "Changes requested", tone: "danger" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

export const DOCUMENT_LABEL: Record<DocumentKind, { title: string; hint: string; required: boolean; photo: boolean }> = {
  ownership_document: { title: "Land ownership document", hint: "Lalpurja or official land record", required: true, photo: false },
  government_id: { title: "Government ID", hint: "Citizenship certificate, front and back", required: true, photo: false },
  property_photo: { title: "Property photos", hint: "At least one clear exterior photo", required: true, photo: true },
  parking_photo: { title: "Parking-area photos", hint: "Entrance, surface and boundaries (optional)", required: false, photo: true },
};

export const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  high: { label: "High", tone: "danger" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "info" },
};

export const CAMERA_STATUS: Record<CameraStatus, { label: string; tone: Tone }> = {
  live: { label: "Live", tone: "success" },
  offline: { label: "Offline", tone: "danger" },
  maintenance: { label: "Maintenance", tone: "warning" },
};

export const TRAFFIC: Record<TrafficLevel, { label: string; tone: Tone }> = {
  clear: { label: "Clear", tone: "success" },
  moderate: { label: "Moderate", tone: "info" },
  slow: { label: "Slow", tone: "warning" },
  congested: { label: "Congested", tone: "danger" },
};

// Nepal Standard Time is a fixed UTC+05:45 with no daylight saving.
const NPT_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function nepal(value: string | Date): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Date(date.getTime() + NPT_OFFSET_MS); // read with getUTC* below
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = nepal(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatClock(value: string | null | undefined): string {
  if (!value) return "—";
  const d = nepal(value);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = nepal(value);
  return `${formatDate(value)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 6 * 3600_000) return `${Math.round(diff / 3600_000)} h ago`;
  const d = nepal(value);
  const today = nepal(new Date());
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (d.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)) return `Today, ${time}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function greeting(): string {
  const hour = nepal(new Date()).getUTCHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function todayLong(): string {
  const d = nepal(new Date());
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const formatTime = (value: string | null | undefined) => (value ? value.slice(0, 5) : "—");

export function formatHours(opens: string | null, closes: string | null): string {
  if (opens?.startsWith("00:00") && closes?.startsWith("23:59")) return "Open 24 hours";
  return `${formatTime(opens)} – ${formatTime(closes)}`;
}

export function formatDistance(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined) return null;
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function walkingMinutes(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined) return null;
  return `${Math.max(1, Math.round(meters / 80))} min walk`;
}

export function formatPrice(p: Pick<ParkingSummary, "pricing_mode" | "price_per_hour">): string {
  if (p.pricing_mode === "free" || !p.price_per_hour) return "Free";
  return `NPR ${Number(p.price_per_hour).toFixed(0)} / hr`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
