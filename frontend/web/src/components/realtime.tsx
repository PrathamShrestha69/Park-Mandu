"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";

/** Every server event carries a unique id and a timestamp (see backend app/core/realtime.py). */
export interface RealtimeEvent {
  id: string;
  ts: string;
  [key: string]: unknown;
}

type Handler = (event: RealtimeEvent) => void;

interface RealtimeContextValue {
  connected: boolean;
  subscribe: (event: string, handler: Handler) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({ connected: false, subscribe: () => () => {} });

function socketUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (configured) return configured;
  return `${window.location.protocol}//${window.location.hostname}:8000`;
}

async function fetchTicket(): Promise<string | "signed_out" | null> {
  try {
    const res = await fetch("/api/realtime/ticket", { method: "POST", cache: "no-store" });
    if (res.status === 401) return "signed_out";
    if (!res.ok) return null;
    return ((await res.json()) as { ticket?: string }).ticket ?? null;
  } catch {
    return null;
  }
}

/**
 * One authenticated Socket.IO connection per tab, shared by every component that listens.
 * Handlers subscribe by event name; an event already handled (same id) is never delivered twice.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const handlers = useRef(new Map<string, Set<Handler>>());
  const socketRef = useRef<Socket | null>(null);
  const seen = useRef<string[]>([]);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const socket = io(socketUrl(), {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15_000,
      // A fresh single-use ticket for every (re)connection attempt.
      auth: (send) => {
        void fetchTicket().then((ticket) => {
          if (ticket === "signed_out") {
            stopped = true;
            socket.disconnect();
            router.replace("/login?expired=1");
            return;
          }
          send({ ticket: ticket ?? "" });
        });
      },
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      attempts = 0;
      setConnected(true);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => {
      setConnected(false);
      // A refused handshake (expired ticket) does not reconnect on its own; retry with backoff.
      if (!socket.active && !stopped) {
        attempts += 1;
        retry = setTimeout(() => socket.connect(), Math.min(30_000, 1000 * 2 ** attempts));
      }
    });
    socket.onAny((name: string, payload: RealtimeEvent) => {
      if (payload?.id) {
        if (seen.current.includes(payload.id)) return;
        seen.current.push(payload.id);
        if (seen.current.length > 300) seen.current.shift();
      }
      handlers.current.get(name)?.forEach((h) => h(payload));
    });
    socket.connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [router]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      connected,
      subscribe(event, handler) {
        const set = handlers.current.get(event) ?? new Set();
        set.add(handler);
        handlers.current.set(event, set);
        return () => set.delete(handler);
      },
    }),
    [connected],
  );

  return <RealtimeContext value={value}>{children}</RealtimeContext>;
}

export function useRealtimeStatus(): boolean {
  return use(RealtimeContext).connected;
}

/** Calls `handler` for each `events` message. The latest handler is always used; no resubscription churn. */
export function useRealtime(events: string | string[], handler: Handler): void {
  const { subscribe } = use(RealtimeContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const key = Array.isArray(events) ? events.join("|") : events;
  useEffect(() => {
    const offs = key.split("|").map((name) => subscribe(name, (e) => latest.current(e)));
    return () => offs.forEach((off) => off());
  }, [key, subscribe]);
}

/**
 * Re-renders the current page's Server Components when any of `events` arrives, so counts, lists
 * and map markers stay current. Bursts collapse into one refresh; hidden tabs refresh on return.
 */
export function useLiveRefresh(events: string[], delayMs = 800): void {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stale = useRef(false);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && stale.current) {
        stale.current = false;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  useRealtime(events, () => {
    if (document.visibilityState !== "visible") {
      stale.current = true;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), delayMs);
  });
}
