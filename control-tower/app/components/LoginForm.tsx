"use client";
/**
 * components/LoginForm.tsx
 * Calls /api/auth/login (our Next.js route) instead of NextAuth signIn().
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";

export default function LoginForm() {
  const router = useRouter();
  const { setSession } = useSession();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      // Sync client session state
      setSession({
        user: data.user,
        accessToken: "",  // tokens live only in the httpOnly cookie
        refreshToken: "",
      });

      // Redirect based on role
      if (data.user.role === "ADMIN") {
        router.push("/admin");
      } else {
        router.push("/monitoring");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm flex flex-col gap-4 bg-[#1A1A1A] border border-gray-800 rounded-2xl p-8"
    >
      <h1 className="text-white text-xl font-bold font-mono tracking-tight">
        AnomaNet Login
      </h1>

      {error && (
        <p className="text-red-400 text-xs font-mono bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-gray-500 text-xs font-mono uppercase tracking-widest">
          Username
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          className="bg-[#111] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-[#CAFF33] transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-gray-500 text-xs font-mono uppercase tracking-widest">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="bg-[#111] border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-[#CAFF33] transition-colors"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-2 bg-[#CAFF33] text-black font-bold text-sm rounded-full py-2.5 hover:bg-[#b8e62e] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Authenticating..." : "Login"}
      </button>
    </form>
  );
}