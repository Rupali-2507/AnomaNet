/**
 * lib/session.ts
 * Encode / decode the session stored as a signed JWT in an httpOnly cookie.
 * This replaces NextAuth's session entirely.
 *
 * Cookie name : "anomanet_session"
 * Contents    : { user, accessToken, refreshToken }
 * Signed with : SESSION_SECRET env var
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { AuthSession } from "./auth";

const COOKIE_NAME = "anomanet_session";
const MAX_AGE = 60 * 60 * 8; // 8 hours

function getSecret(): Uint8Array {
  const secret =
    process.env.SESSION_SECRET ?? "dev-secret-please-change-in-prod-32chars";
  return new TextEncoder().encode(secret);
}

/** Seal the session into a signed JWT and set the httpOnly cookie. */
export async function setSessionCookie(session: AuthSession): Promise<void> {
  const token = await new SignJWT({ session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

/** Read and verify the session cookie. Returns null if missing / invalid. */
export async function getSession(): Promise<AuthSession | null> {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(COOKIE_NAME);
    if (!cookie?.value) return null;

    const { payload } = await jwtVerify(cookie.value, getSecret());
    return (payload as any).session as AuthSession;
  } catch {
    return null;
  }
}

/** Delete the session cookie (logout). */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
}