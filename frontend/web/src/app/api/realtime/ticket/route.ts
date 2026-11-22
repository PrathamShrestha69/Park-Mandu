import { cookies } from "next/headers";

import { API_URL } from "@/lib/api";
import { ACCESS_COOKIE } from "@/lib/session";

/**
 * Exchanges the httpOnly session for a one-time, 60-second Socket.IO ticket. The access token
 * itself never reaches browser JavaScript. The proxy has already refreshed an expiring session.
 */
export async function POST() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });

  const upstream = await fetch(`${API_URL}/realtime/ticket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-Client-Type": "web-server", Accept: "application/json" },
    cache: "no-store",
  }).catch(() => null);

  if (!upstream) return Response.json({ error: { code: "api_unreachable" } }, { status: 503 });
  const body = await upstream.json().catch(() => ({}));
  return Response.json(body, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
