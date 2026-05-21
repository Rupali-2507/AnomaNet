/**
 * @/lib/api
 *
 * Centralised fetch helpers for the AnomaNet control-tower.
 *
 * Both helpers share the same 3-argument shape used throughout the app:
 *
 *   apiFetch<T>(path, session, init?)
 *   mlFetch<T>(path, session, init?)
 *
 * `session` comes from next-auth's useSession(); it may be null while the
 * session is loading or when the user is unauthenticated.
 */

import type { Session } from "next-auth";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Subset of RequestInit we actually use, kept explicit for clarity. */
export interface ApiFetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
const ML_BASE  = process.env.NEXT_PUBLIC_ML_BASE_URL  ?? "http://localhost:8000";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildHeaders(
  session: Session | null,
  extra: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };

  // next-auth v4 exposes the JWT as session.accessToken when you add it in
  // the session callback; v5 / App Router surfaces it as session.token or
  // via getToken(). Support both shapes gracefully.
  const token =
    (session as (Session & { accessToken?: string }) | null)?.accessToken ??
    null;

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`[${res.status}] ${text}`);
  }
  // 204 No Content — return empty object cast to T
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch from the Spring Boot API (API_BASE).
 *
 * @param path    Absolute path, e.g. "/api/alerts?page=0&size=20"
 * @param session next-auth Session (may be null)
 * @param init    Optional fetch overrides (method, body, headers, …)
 */
export async function apiFetch<T>(
  path: string,
  session: Session | null,
  init: ApiFetchOptions = {}
): Promise<T> {
  const { headers: extraHeaders, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: buildHeaders(session, extraHeaders),
  });
  return handleResponse<T>(res);
}

/**
 * Fetch from the Python ML service (ML_BASE).
 *
 * @param path    Absolute path, e.g. "/ml/explain/abc-123"
 * @param session next-auth Session (may be null)
 * @param init    Optional fetch overrides (method, body, headers, …)
 */
export async function mlFetch<T>(
  path: string,
  session: Session | null,
  init: ApiFetchOptions = {}
): Promise<T> {
  const { headers: extraHeaders, ...rest } = init;
  const res = await fetch(`${ML_BASE}${path}`, {
    ...rest,
    headers: buildHeaders(session, extraHeaders),
  });
  return handleResponse<T>(res);
}