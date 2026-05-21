// middleware.ts — place at project root beside package.json
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const role = (req.auth?.user as any)?.role as string | undefined;

  // Not logged in — redirect to login
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // /admin — ADMIN only
  if (pathname.startsWith("/admin") && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/admin/:path*",
    "/monitoring/:path*",
    "/investigation/:path*",
    "/reporting/:path*",
    "/service/:path*",
  ],
};