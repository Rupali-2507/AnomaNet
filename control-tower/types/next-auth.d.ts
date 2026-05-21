// lib/types/next-auth.d.ts
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    id:           string;
    name:         string;
    email:        string;  // stores username
    role:         string;
    accessToken:  string;
    refreshToken: string;
  }

  interface Session {
    accessToken:  string;
    refreshToken: string;
    role:         string;
    user: {
      id:       string;
      name:     string;
      email:    string;   // = username
      username: string;
      role:     string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id:           string;
    accessToken:  string;
    refreshToken: string;
    role:         string;
    username:     string;
  }
}