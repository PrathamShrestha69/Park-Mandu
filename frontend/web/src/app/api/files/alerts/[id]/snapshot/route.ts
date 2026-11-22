import { cookies } from "next/headers";

import { API_URL } from "@/lib/api";
import { ACCESS_COOKIE } from "@/lib/session";

/** Streams the AI detector's vehicle photo for an alert; the API restricts it to police and admins. */
export async function GET(_request: Request, ctx: RouteContext<"/api/files/alerts/[id]/snapshot">) {
  const { id } = await ctx.params;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return new Response("Unauthorized", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const upstream = await fetch(`${API_URL}/files/alerts/${id}/snapshot`, {
    headers: { Authorization: `Bearer ${token}`, "X-Client-Type": "web-server" },
    cache: "no-store",
  }).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return new Response("Not found", { status: upstream?.status === 401 ? 401 : 404 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
