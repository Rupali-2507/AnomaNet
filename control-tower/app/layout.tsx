/**
 * app/layout.tsx
 * Root layout — reads session on the server and passes to client SessionProvider.
 * No NextAuth. No [..nextauth] route needed.
 */

import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { SessionProvider } from "@/lib/session-context";
// @ts-ignore: CSS side-effect import declaration missing in this environment
import "./globals.css";

export const metadata: Metadata = {
  title: "AnomaNet",
  description: "AnomaNet Control Tower",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side session read — available immediately, no client round-trip
  const session = await getSession();

  return (
    <html lang="en">
      <body>
        <SessionProvider session={session}>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}