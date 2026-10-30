import "server-only";

import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { buildQuery, type Query } from "./api-query";
import { ACCESS_COOKIE } from "./session";

export const API_URL = process.env.API_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function forwardHeaders(): Promise<Record<string, string>> {
  const store = await cookies();
  const incoming = await headers();
  const token = store.get(ACCESS_COOKIE)?.value;
  const result: Record<string, string> = { "X-Client-Type": "web-server", Accept: "application/json" };
  if (token) result.Authorization = `Bearer ${token}`;
  const forwarded = incoming.get("x-forwarded-for") ?? incoming.get("x-real-ip");
  if (forwarded) result["X-Forwarded-For"] = forwarded;
  const userAgent = incoming.get("user-agent");
  if (userAgent) result["User-Agent"] = userAgent;
  return result;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Query;
  json?: unknown;
  form?: FormData;
}

/** Low-level request to the API. Throws ApiError for non-2xx responses. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Everything from the API is per-request data (sessions, live availability, alerts); never prerender it.
  await connection();
  const init: RequestInit & { headers: Record<string, string> } = {
    method: options.method ?? "GET",
    headers: await forwardHeaders(),
    cache: "no-store",
  };
  if (options.json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.json);
  } else if (options.form) {
    init.body = options.form;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}${buildQuery(options.query)}`, init);
  } catch {
    throw new ApiError(503, "api_unreachable", "The Park Mandu service is temporarily unavailable. Please try again.");
  }

  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? "http_error",
      error.message ?? "Something went wrong. Please try again.",
      error.fields ?? {},
    );
  }
  return body as T;
}

/**
 * For Server Components: fetches data and maps auth/404 failures onto navigation
 * (sign-in redirect or the not-found page). Other errors bubble to error.tsx.
 */
export async function apiGet<T>(path: string, query?: Query): Promise<T> {
  try {
    return await apiRequest<T>(path, { query });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect("/login?expired=1");
      if (error.status === 404) notFound();
    }
    throw error;
  }
}
