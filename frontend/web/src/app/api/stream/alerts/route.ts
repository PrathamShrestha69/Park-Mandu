import { cookies } from "next/headers";

import { API_URL } from "@/lib/api";
import { ACCESS_COOKIE } from "@/lib/session";

/** Relays the API's server-sent alert stream to the browser using the httpOnly session cookie. */
export async function GET(request: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return new Response("Unauthorized", { status: 401 });

  const upstream = await fetch(`${API_URL}/alerts/stream`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream", "X-Client-Type": "web-server" },
    signal: request.signal,
    cache: "no-store",
  }).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return new Response("Alert stream unavailable", { status: upstream?.status ?? 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
