// Query-string helpers shared by server and client code (no server-only imports).

type QueryValue = string | number | boolean | null | undefined | string[];
export type Query = Record<string, QueryValue>;

export function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Picks a single string value from Next.js searchParams. */
export function param(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  const single = Array.isArray(value) ? value[0] : value;
  return single?.trim() || undefined;
}

export function pageParam(params: SearchParams): number {
  const n = Number(param(params, "page") ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
