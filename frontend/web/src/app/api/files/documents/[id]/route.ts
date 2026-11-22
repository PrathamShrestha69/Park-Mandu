import { cookies } from "next/headers";

import { API_URL } from "@/lib/api";
import { ACCESS_COOKIE } from "@/lib/session";

/** Streams an application document from the API; the API enforces applicant/admin access. */
export async function GET(request: Request, ctx: RouteContext<"/api/files/documents/[id]">) {
  const { id } = await ctx.params;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return new Response("Unauthorized", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const variant = new URL(request.url).searchParams.get("variant") === "thumbnail" ? "thumbnail" : "original";
  const upstream = await fetch(`${API_URL}/files/documents/${id}?variant=${variant}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Client-Type": "web-server" },
    cache: "no-store",
  }).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return new Response("Not found", { status: upstream?.status === 401 ? 401 : 404 });
  }
  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("Content-Disposition", disposition);
  return new Response(upstream.body, { headers });
}
