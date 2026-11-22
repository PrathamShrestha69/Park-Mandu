import { QueryClient, useInfiniteQuery, useQuery, type QueryKey } from "@tanstack/react-query";

import { api, ApiError, type Query } from "./api";
import type { Page } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

/** GET with the query string as part of the cache key — filtering happens on the server. */
export function useApi<T>(path: string, query?: Query, options: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery<T>({
    queryKey: [path, query ?? {}] as QueryKey,
    queryFn: () => api<T>(path, { query }),
    ...options,
  });
}

/** Server-side pagination as an infinite list (page/size, `has_next` from the API). */
export function usePaged<T>(path: string, query: Query = {}, options: { size?: number; refetchInterval?: number } = {}) {
  const size = options.size ?? 20;
  const result = useInfiniteQuery<Page<T>>({
    queryKey: [path, "paged", query],
    queryFn: ({ pageParam }) => api<Page<T>>(path, { query: { ...query, page: pageParam as number, size } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_next ? last.page + 1 : undefined),
    refetchInterval: options.refetchInterval,
  });
  const items = result.data?.pages.flatMap((p) => p.items) ?? [];
  const total = result.data?.pages[0]?.total ?? 0;
  return { ...result, items, total };
}

/** Invalidate everything under an API path prefix after a mutation. */
export function invalidate(...prefixes: string[]) {
  return queryClient.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === "string" && prefixes.some((p) => (q.queryKey[0] as string).startsWith(p)),
  });
}
