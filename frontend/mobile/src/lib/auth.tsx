import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, ApiError, currentRefreshToken, loadTokens, saveTokens, setSessionLostHandler } from "./api";
import type { AuthResponse, User } from "./types";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthContextValue {
  status: Status;
  user: User | null;
  signIn: (response: AuthResponse) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);

  const clear = useCallback(() => {
    setUser(null);
    setStatus("signedOut");
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setSessionLostHandler(clear);
    (async () => {
      const stored = await loadTokens().catch(() => null);
      if (!stored) return setStatus("signedOut");
      try {
        const me = await api<User>("/auth/me");
        // Administrator sessions from older app versions are dropped: administration is web-only.
        if (me.role === "admin") throw new Error("admin_web_only");
        setUser(me);
        setStatus("signedIn");
      } catch {
        await saveTokens(null);
        setStatus("signedOut");
      }
    })();
    return () => setSessionLostHandler(null);
  }, [clear]);

  const signIn = useCallback(async (response: AuthResponse) => {
    if (response.user.role === "admin") {
      throw new ApiError(403, "admin_web_only", "Administrator accounts sign in on the Park Mandu web dashboard, not in the mobile app.");
    }
    if (response.tokens) await saveTokens(response.tokens);
    setUser(response.user);
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", json: { refresh_token: currentRefreshToken() } });
    } catch {
      // Local sign-out still happens if the network is down.
    }
    await saveTokens(null);
    clear();
  }, [clear]);

  const refreshUser = useCallback(async () => {
    setUser(await api<User>("/auth/me"));
  }, []);

  const value = useMemo(() => ({ status, user, signIn, signOut, refreshUser }), [status, user, signIn, signOut, refreshUser]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The signed-in user; only call inside role-protected screens. */
export function useViewer(): User {
  const { user } = useAuth();
  if (!user) throw new Error("No signed-in user");
  return user;
}
