/**
 * app/api/auth/login/route.ts
 * Proxies credentials to Spring Boot, then sets the session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { loginWithSpring } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const data = await loginWithSpring(username, password);

    // Build the session object we'll seal into the cookie
    const session = {
      user: data.user,
      accessToken: data.token,
      refreshToken: data.refreshToken,
    };

    await setSessionCookie(session);

    // Return safe user info to the client (no tokens in JSON response)
    return NextResponse.json({ user: data.user });
  } catch (err: any) {
    console.error("[login]", err.message);
    return NextResponse.json(
      { error: err.message ?? "Login failed" },
      { status: 401 }
    );
  }
}