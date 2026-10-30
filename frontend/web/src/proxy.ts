import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  ROLE_HOME,
  isExpiring,
  readClaims,
  writeSessionCookies,
  type TokenClaims,
} from "@/lib/session";
import type { AuthResponse, Role } from "@/lib/types";

const API_URL = process.env.API_URL ?? "http://localhost:8000/api/v1";

const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"];
const PUBLIC_PAGES = ["/", ...AUTH_PAGES];

const ROLE_AREAS: { prefix: string; roles: Role[] }[] = [
  { prefix: "/police", roles: ["police"] },
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/api/stream/alerts", roles: ["police", "admin"] },
];

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

async function refresh(request: NextRequest, refreshToken: string): Promise<AuthResponse | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Type": "web-server",
        "X-Forwarded-For": request.headers.get("x-forwarded-for") ?? "",
        "User-Agent": request.headers.get("user-agent") ?? "",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as AuthResponse;
    return body.tokens ? body : null;
  } catch {
    return null;
  }
}

function clearSession(response: NextResponse): NextResponse {
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // The app asked us to drop a session the API rejected (expired or revoked).
  if (pathname === "/login" && searchParams.has("expired")) {
    return clearSession(NextResponse.next());
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  let claims: TokenClaims | null = readClaims(request.cookies.get(ACCESS_COOKIE)?.value);
  let rotated: AuthResponse | null = null;
  let sessionLost = false;

  if (isExpiring(claims) && refreshToken) {
    rotated = await refresh(request, refreshToken);
    if (rotated?.tokens) {
      claims = readClaims(rotated.tokens.access_token);
      // Make the fresh token visible to Server Components rendering this same request.
      request.cookies.set(ACCESS_COOKIE, rotated.tokens.access_token);
      request.cookies.set(REFRESH_COOKIE, rotated.tokens.refresh_token);
    } else {
      claims = null;
      sessionLost = true;
    }
  } else if (isExpiring(claims, 0)) {
    claims = null;
  }

  const role = claims?.role;
  let response: NextResponse;

  if (!role && !PUBLIC_PAGES.includes(pathname)) {
    if (isApi) {
      response = NextResponse.json({ error: { code: "unauthorized", message: "Please sign in." } }, { status: 401 });
    } else {
      const login = new URL("/login", request.url);
      if (pathname !== "/") login.searchParams.set("next", pathname + request.nextUrl.search);
      response = NextResponse.redirect(login);
    }
  } else if (role && PUBLIC_PAGES.includes(pathname)) {
    response = NextResponse.redirect(new URL(ROLE_HOME[role], request.url));
  } else if (role && ROLE_AREAS.some((a) => matches(pathname, a.prefix) && !a.roles.includes(role))) {
    response = isApi
      ? NextResponse.json({ error: { code: "forbidden", message: "Not allowed." } }, { status: 403 })
      : NextResponse.redirect(new URL(ROLE_HOME[role], request.url));
  } else if (role && !isApi && role !== "public" && !ROLE_AREAS.some((a) => matches(pathname, a.prefix))) {
    // Staff accounts live in their own areas; public pages are for residents and landowners.
    response = NextResponse.redirect(new URL(ROLE_HOME[role], request.url));
  } else {
    response = NextResponse.next({ request: { headers: request.headers } });
  }

  if (rotated?.tokens) writeSessionCookies(response.cookies, rotated.tokens);
  if (sessionLost) clearSession(response);
  return response;
}

export const config = {
  // Never run for static assets — including the MapLibre worker, which every role's map needs.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|maplibre/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|js|mjs|css|map|woff2?)$).*)"],
};
