// app/login/page.tsx  (or pages/login.tsx if using Pages Router)
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

type Role = "admin" | "investigator";

export default function LoginPage() {
  const router   = useRouter();
  const [role,     setRole]     = useState<Role>("admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      redirect:  false,
      username,
      password,
      role,
    });

    setLoading(false);

    if (result?.error) {
      setError("Access Denied: Invalid credentials");
    } else {
      router.push("/");   // redirect to dashboard
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: 8,
    color: "white",
    padding: "14px 16px",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d0d0d",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{
        background: "#161616",
        border: "1px solid #222",
        borderRadius: 16,
        padding: "40px 36px",
        width: 460,
      }}>

        {/* Title */}
        <h1 style={{ textAlign: "center", color: "#c8f000", fontWeight: 700, fontSize: 28, margin: "0 0 8px" }}>
          Login
        </h1>
        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 14, marginBottom: 28 }}>
          Select access level and enter credentials.
        </p>

        {/* Role toggle */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          background: "#111", borderRadius: 10, padding: 4,
          marginBottom: 20, border: "1px solid #222",
        }}>
          {(["admin", "investigator"] as Role[]).map(r => (
            <button
              key={r}
              onClick={() => setRole(r)}
              style={{
                background: role === r ? "#222" : "transparent",
                border: "none",
                borderRadius: 7,
                color: role === r ? "#c8f000" : "rgba(255,255,255,0.4)",
                fontWeight: role === r ? 700 : 400,
                fontSize: 14,
                padding: "10px 0",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Username */}
        <input
          type="text"
          placeholder="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          style={{ ...inputStyle, marginBottom: 12 }}
          autoComplete="username"
        />

        {/* Password */}
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          style={{ ...inputStyle, marginBottom: 12 }}
          autoComplete="current-password"
        />

        {/* Error */}
        {error && (
          <p style={{ color: "#f87171", fontSize: 13, margin: "0 0 12px" }}>
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading || !username || !password}
          style={{
            width: "100%",
            background: loading || !username || !password ? "#8aaa00" : "#c8f000",
            color: "#000",
            fontWeight: 700,
            fontSize: 15,
            border: "none",
            borderRadius: 8,
            padding: "14px 0",
            cursor: loading || !username || !password ? "not-allowed" : "pointer",
            marginBottom: 16,
            transition: "background 0.15s",
          }}
        >
          {loading ? "Authenticating…" : `Login as ${role}`}
        </button>

        {/* Footer */}
        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13, margin: 0 }}>
          Request system access?
        </p>
      </div>
    </div>
  );
}