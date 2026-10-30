import type { Role, TokenBundle } from "./types";

export const ACCESS_COOKIE = "pm_access";
export const REFRESH_COOKIE = "pm_refresh";
export const FLASH_COOKIE = "pm_flash";

export const ROLE_HOME: Record<Role, string> = {
  public: "/home",
  police: "/police",
  admin: "/admin",
};

export interface TokenClaims {
  sub: string;
  role: Role;
  sid: string;
  exp: number;
}

/**
 * Reads the access-token payload WITHOUT verifying the signature. Only used for routing decisions
 * and refresh timing — every data request is authorised by the API, which does verify it.
 */
export function readClaims(token: string | undefined): TokenClaims | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as TokenClaims;
    return claims.sub && claims.role && claims.exp ? claims : null;
  } catch {
    return null;
  }
}

export function isExpiring(claims: TokenClaims | null, skewSeconds = 30): boolean {
  return !claims || claims.exp * 1000 - Date.now() < skewSeconds * 1000;
}

interface CookieWriter {
  set(name: string, value: string, options: Record<string, unknown>): unknown;
}

const secure = process.env.COOKIE_SECURE === "true";

export function writeSessionCookies(store: CookieWriter, tokens: TokenBundle): void {
  const base = { httpOnly: true, secure, sameSite: "lax", path: "/" };
  const accessAge = Math.max(60, Math.floor((Date.parse(tokens.access_expires_at) - Date.now()) / 1000));
  const refreshAge = Math.max(60, Math.floor((Date.parse(tokens.refresh_expires_at) - Date.now()) / 1000));
  store.set(ACCESS_COOKIE, tokens.access_token, { ...base, maxAge: accessAge });
  store.set(REFRESH_COOKIE, tokens.refresh_token, { ...base, maxAge: refreshAge });
}
