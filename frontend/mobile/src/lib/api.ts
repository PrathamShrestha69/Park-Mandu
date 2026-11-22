import * as SecureStore from "expo-secure-store";

import { API_URL } from "./config";
import type { AuthResponse, TokenBundle } from "./types";

const TOKEN_KEY = "parkmandu.session";

type QueryValue = string | number | boolean | null | undefined | string[];
export type Query = Record<string, QueryValue>;

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

// --------------------------------------------------------------------------- token storage

let tokens: TokenBundle | null = null;
let onSessionLost: (() => void) | null = null;

export async function loadTokens(): Promise<TokenBundle | null> {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  tokens = raw ? (JSON.parse(raw) as TokenBundle) : null;
  return tokens;
}

export async function saveTokens(next: TokenBundle | null): Promise<void> {
  tokens = next;
  if (next) await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(next));
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function currentRefreshToken(): string | null {
  return tokens?.refresh_token ?? null;
}

/** Headers for authenticated image requests (expo-image `source.headers`). */
export function authHeaders(): Record<string, string> {
  return tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}`, "X-Client-Type": "mobile" } : {};
}

/** Registered by the AuthProvider so an unrecoverable 401 signs the user out everywhere. */
export function setSessionLostHandler(handler: (() => void) | null) {
  onSessionLost = handler;
}

// --------------------------------------------------------------------------- requests

export function buildQuery(query?: Query): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    const values = Array.isArray(value) ? value : [String(value)];
    values.forEach((v) => parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`));
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Query;
  json?: unknown;
  form?: FormData;
  auth?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Single-flight refresh: concurrent 401s share one rotation request. */
function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = tokens?.refresh_token;
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Client-Type": "mobile" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return false;
        const body = (await res.json()) as AuthResponse;
        if (!body.tokens) return false;
        await saveTokens(body.tokens);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshInFlight = null), 0);
      }
    })();
  }
  return refreshInFlight;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Client-Type": "mobile" };
  if (options.auth !== false && tokens?.access_token) headers.Authorization = `Bearer ${tokens.access_token}`;
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  }
  return fetch(`${API_URL}${path}${buildQuery(options.query)}`, { method: options.method ?? "GET", headers, body });
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await send(path, options);
    if (response.status === 401 && options.auth !== false && tokens) {
      const code = (await response.clone().json().catch(() => null))?.error?.code;
      if (code === "token_expired" || code === "invalid_token") {
        if (await refreshSession()) response = await send(path, options);
      }
    }
  } catch {
    throw new ApiError(0, "network_error", "Can't reach Park Mandu. Check your connection and try again.");
  }

  if (response.status === 401 && options.auth !== false && tokens) {
    await saveTokens(null);
    onSessionLost?.();
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error ?? {};
    throw new ApiError(response.status, error.code ?? "http_error", error.message ?? "Something went wrong.", error.fields ?? {});
  }
  return data as T;
}

/** Field errors keyed by field name, plus a form-level message (non_field or the error message). */
export function formErrors(error: unknown): { message: string | null; fields: Record<string, string> } {
  if (error instanceof ApiError) {
    const fields = { ...error.fields };
    const message = fields.non_field ?? (Object.keys(fields).length ? null : error.message);
    delete fields.non_field;
    return { message: message ?? (Object.keys(fields).length ? "Please check the highlighted fields." : error.message), fields };
  }
  return { message: "Something went wrong. Please try again.", fields: {} };
}
