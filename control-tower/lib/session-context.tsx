"use client";
/**
 * lib/session-context.tsx
 * Client-side session context — replaces next-auth's useSession().
 *
 * Wrap your root layout with <SessionProvider session={...} />.
 * Consume with useSession() anywhere in client components.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { AuthSession } from "./auth";

interface SessionContextValue {
  session: AuthSession | null;
  status: "loading" | "authenticated" | "unauthenticated";
  /** Call after a successful login to sync client state */
  setSession: (s: AuthSession | null) => void;
  /** Calls /api/auth/logout then clears client state */
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  session: null,
  status: "unauthenticated",
  setSession: () => {},
  logout: async () => {},
});

interface SessionProviderProps {
  /** Pass the server-fetched session from your root layout */
  session: AuthSession | null;
  children: ReactNode;
}

export function SessionProvider({ session: initial, children }: SessionProviderProps) {
  const [session, setSessionState] = useState<AuthSession | null>(initial);
  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">(
    initial ? "authenticated" : "unauthenticated"
  );

  const setSession = useCallback((s: AuthSession | null) => {
    setSessionState(s);
    setStatus(s ? "authenticated" : "unauthenticated");
  }, []);

  const logout = useCallback(async () => {
    setStatus("loading");
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setSessionState(null);
      setStatus("unauthenticated");
      window.location.href = "/login";
    }
  }, []);

  return (
    <SessionContext.Provider value={{ session, status, setSession, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

/** Drop-in replacement for next-auth's useSession() */
export function useSession() {
  return useContext(SessionContext);
}