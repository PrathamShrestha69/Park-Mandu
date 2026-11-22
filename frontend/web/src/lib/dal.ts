import "server-only";

import { cache } from "react";

import { apiGet } from "./api";
import type { User } from "./types";

/** Data access layer: the signed-in user, fetched once per request. */
export const getViewer = cache(() => apiGet<User>("/auth/me"));

export const getUnreadCount = cache(async () => {
  const { unread } = await apiGet<{ unread: number }>("/notifications/unread-count");
  return unread;
});
