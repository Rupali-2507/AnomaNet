/**
 * lib/auth.ts
 * Core auth helpers — no NextAuth, pure Spring Boot JWT.
 * Tokens are stored in httpOnly cookies (set by the Next.js API routes).
 */

export interface SpringUser {
  id: string;
  name: string;
  role: "ADMIN" | "INVESTIGATOR" | string;
  username: string;
}

export interface AuthSession {
  user: SpringUser;
  accessToken: string;
  refreshToken: string;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

/** Called from the /api/auth/login Next.js route */
export async function loginWithSpring(
  username: string,
  password: string
): Promise<{
  token: string;
  refreshToken: string;
  user: SpringUser;
}> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Login failed");
    throw new Error(text || "Invalid credentials");
  }

  return res.json();
}

/** Called from the /api/auth/refresh Next.js route */
export async function refreshWithSpring(refreshToken: string): Promise<{
  token: string;
  refreshToken: string;
  user: SpringUser;
}> {
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) throw new Error("Refresh failed");
  return res.json();
}