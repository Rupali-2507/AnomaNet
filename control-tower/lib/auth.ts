// lib/auth.ts
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    CredentialsProvider({
      name: "AnomaNet",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        try {
          const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: credentials.username,
              password: credentials.password,
            }),
          });

          if (!res.ok) return null;

          const data = await res.json() as {
            token:        string;
            refreshToken: string;
            user: {
              id:       string;
              name:     string;
              role:     string;
              username: string;
            };
          };

          return {
            id:           data.user.id,
            name:         data.user.name,
            email:        data.user.username, // email slot holds username
            role:         data.user.role,
            accessToken:  data.token,
            refreshToken: data.refreshToken,
          };
        } catch {
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id           = user.id;
        token.name         = user.name;
        token.accessToken  = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.role         = (user as any).role;
        token.username     = user.email; // email slot holds username
      }
      return token;
    },

    async session({ session, token }) {
      session.accessToken  = token.accessToken  as string;
      session.refreshToken = token.refreshToken as string;
      session.role         = token.role         as string;
      session.user = {
        ...session.user,
        id:       token.id       as string ?? "",
        name:     token.name     as string ?? "",
        email:    token.username as string ?? "",
        username: token.username as string ?? "",
        role:     token.role     as string,
      };
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error:  "/login",
  },

  session: { strategy: "jwt" },

  secret: process.env.NEXTAUTH_SECRET ?? "dev-secret-change-in-prod",
});