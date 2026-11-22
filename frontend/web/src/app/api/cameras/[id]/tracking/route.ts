import { cookies } from "next/headers";

import { API_URL } from "@/lib/api";
import { ACCESS_COOKIE } from "@/lib/session";

/** Relays a camera's live vehicle tracking to the browser, which polls it using the httpOnly session cookie. */
export async function GET(_: Request, ctx: RouteContext<"/api/cameras/[id]/tracking">) {
  const { id } = await ctx.params;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return Response.json({ error: { code: "unauthorized", message: "Please sign in." } }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: { code: "not_found", message: "Camera not found." } }, { status: 404 });

  const upstream = await fetch(`${API_URL}/cameras/${id}/tracking`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "X-Client-Type": "web-server" },
    cache: "no-store",
  }).catch(() => null);

  if (!upstream) {
    return Response.json({ error: { code: "api_unreachable", message: "Tracking is temporarily unavailable." } }, { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
