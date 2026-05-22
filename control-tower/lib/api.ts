/**
 * lib/api.ts
 * Fetch helpers for Spring Boot API and ML service.
 *
 * SERVER COMPONENTS: pass the full session from getSession().
 * CLIENT COMPONENTS:  accessToken is in an httpOnly cookie — the Next.js
 *                     API routes act as a proxy, so client components should
 *                     call /api/* routes (which forward the cookie), not
 *                     Spring Boot directly.
 *
 * Shape is kept backward-compatible: apiFetch(path, session, init?)
 */

import type { AuthSession } from "./auth";

export interface ApiFetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
const ML_BASE  = process.env.NEXT_PUBLIC_ML_BASE_URL  ?? "http://localhost:8000";

function buildHeaders(
  session: AuthSession | null,
  extra: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };

  if (session?.accessToken) {
    headers["Authorization"] = `Bearer ${session.accessToken}`;
  }

  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`[${res.status}] ${text}`);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

/**
 * Fetch from the Spring Boot API.
 * Use from SERVER components (pass session from getSession()).
 * From CLIENT components, prefer calling your own /api/* Next.js routes.
 */
export async function apiFetch<T>(
  path: string,
  session: AuthSession | null,
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
 * Fetch from the Python ML service.
 * Use from SERVER components (pass session from getSession()).
 */
export async function mlFetch<T>(
  path: string,
  session: AuthSession | null,
  init: ApiFetchOptions = {}
): Promise<T> {
  const { headers: extraHeaders, ...rest } = init;
  const res = await fetch(`${ML_BASE}${path}`, {
    ...rest,
    headers: buildHeaders(session, extraHeaders),
  });
  return handleResponse<T>(res);
}