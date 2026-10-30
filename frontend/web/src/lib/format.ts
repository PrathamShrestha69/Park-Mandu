import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";

import type {
  ApplicationStatus,
  AvailableDays,
  CameraStatus,
  DocumentKind,
  ParkingSummary,
  ParkingType,
  Severity,
  Tone,
  TrafficLevel,
} from "./types";

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

export const DOCUMENT_LABEL: Record<DocumentKind, { title: string; hint: string; required: boolean }> = {
  ownership_document: { title: "Land ownership document", hint: "Lalpurja or official land record (PDF or photo)", required: true },
  government_id: { title: "Government ID", hint: "Citizenship certificate or national ID, front and back", required: true },
  property_photo: { title: "Property photos", hint: "At least one clear exterior photo of the property", required: true },
  parking_photo: { title: "Parking-area photos", hint: "Entrance, surface and boundaries (optional)", required: false },
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

const TZ = "Asia/Kathmandu";

/** Dates are rendered on the server, so format them explicitly in Nepal time. */
function inNepal(value: string | Date): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Date(date.toLocaleString("en-US", { timeZone: TZ }));
}

export function formatDate(value: string | null | undefined): string {
  return value ? format(inNepal(value), "d MMM yyyy") : "—";
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? format(inNepal(value), "d MMM yyyy · HH:mm") : "—";
}

export function formatClock(value: string | null | undefined): string {
  return value ? format(inNepal(value), "HH:mm:ss") : "—";
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Date.now() - date.getTime() < 60_000) return "Just now";
  const local = inNepal(value);
  if (Date.now() - date.getTime() < 6 * 3600_000) return `${formatDistanceToNowStrict(date)} ago`;
  if (isToday(local)) return `Today, ${format(local, "HH:mm")}`;
  if (isYesterday(local)) return `Yesterday, ${format(local, "HH:mm")}`;
  return format(local, "d MMM");
}

export function greeting(now = new Date()): string {
  const hour = inNepal(now).getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function formatTime(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : "—";
}

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

export function formatPrice(parking: Pick<ParkingSummary, "pricing_mode" | "price_per_hour">): string {
  if (parking.pricing_mode === "free" || !parking.price_per_hour) return "Free";
  return `NPR ${Number(parking.price_per_hour).toFixed(0)} / hr`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
