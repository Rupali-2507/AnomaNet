/**
 * middleware.ts
 * Route protection without NextAuth.
 * Verifies the session cookie directly using jose (same lib as lib/session.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "anomanet_session";

function getSecret(): Uint8Array {
  const secret =
    process.env.SESSION_SECRET ?? "dev-secret-please-change-in-prod-32chars";
  return new TextEncoder().encode(secret);
}

async function getSessionFromCookie(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE);
  if (!cookie?.value) return null;
  try {
    const { payload } = await jwtVerify(cookie.value, getSecret());
    return (payload as any).session;
  } catch {
    return null;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await getSessionFromCookie(req);
  const role = session?.user?.role as string | undefined;

  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (pathname.startsWith("/admin") && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/monitoring/:path*",
    "/investigation/:path*",
    "/reporting/:path*",
    "/service/:path*",
  ],
};