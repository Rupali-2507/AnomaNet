/**
 * app/api/auth/session/route.ts
 * Returns the current user from the session cookie (no tokens).
 * Used by client components on first mount.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ session: null });
  }

  // Never expose tokens to the client via JSON
  return NextResponse.json({
    session: {
      user: session.user,
    },
  });
}