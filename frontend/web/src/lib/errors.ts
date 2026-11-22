/**
 * Plain-language messages for failures. Technical detail (status, code, response body) is logged
 * for developers; people only ever see these sentences.
 */
export const MESSAGES = {
  network: "Unable to connect to the server. Check your internet connection.",
  session: "Your session has expired. Please sign in again.",
  server: "Something went wrong. Please try again later.",
  upload: "Unable to upload your file. Please try again.",
  forbidden: "You do not have permission to do that.",
  notFound: "We couldn't find what you were looking for.",
  rateLimited: "Too many attempts. Please wait a moment and try again.",
} as const;

/** Codes whose backend message is already written for people and says something specific. */
const SPECIFIC_401 = new Set(["invalid_credentials", "invalid_code"]);

export function friendlyMessage(status: number, code: string | undefined, serverMessage: string | undefined, context?: "upload"): string {
  if (status === 0 || code === "api_unreachable" || status === 502 || status === 503 || status === 504) return MESSAGES.network;
  if (status === 401) return code && SPECIFIC_401.has(code) && serverMessage ? serverMessage : MESSAGES.session;
  if (status >= 500) return context === "upload" ? MESSAGES.upload : MESSAGES.server;
  if (status === 413) return "This file is too large. Please choose a smaller file.";
  if (status === 429) return serverMessage ?? MESSAGES.rateLimited;
  if (context === "upload" && status !== 422 && !serverMessage) return MESSAGES.upload;
  // 4xx answers from the API are written for people ("This alert has already been taken…").
  if (serverMessage) return serverMessage;
  if (status === 403) return MESSAGES.forbidden;
  if (status === 404) return MESSAGES.notFound;
  return MESSAGES.server;
}

/** Codes meaning the session itself is gone (not a wrong password). */
export const SESSION_LOST_CODES = ["token_expired", "session_revoked", "invalid_token", "unauthorized"];
