"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { apiFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Alert {
  id: string;
  accountId: string;
  type: string;
  riskLevel: "Critical" | "High" | "Medium";
  time: string;
  status: "New" | "In Review" | "Escalated";
  amount: string;
  branch: string;
}

interface Case {
  id: string;
  accountId: string;
  type: string;
  openedAt: string;
  assignedTo: string;
  status: "Open" | "Pending SAR" | "Escalated";
}

interface DailyVolume {
  day: string;
  normal: number;
  flagged: number;
}

// ─── Mappings ──────────────────────────────────────────────────────────────────
const ALERT_TYPE_LABEL: Record<string, string> = {
  CIRCULAR:         "Circular Flow",
  LAYERING:         "Layering",
  STRUCTURING:      "Structuring",
  DORMANT:          "Dormant Activation",
  PROFILE_MISMATCH: "Profile Mismatch",
  COMPOSITE:        "Layering",
};

const ALERT_STATUS_LABEL: Record<string, Alert["status"]> = {
  NEW:          "New",
  UNDER_REVIEW: "In Review",
  ESCALATED:    "Escalated",
  REPORTED_FIU: "Escalated",
  CLOSED_SAR:   "New",   // won't appear in active list but safe fallback
  CLOSED_FP:    "New",
};

const CASE_STATUS_LABEL: Record<string, Case["status"]> = {
  OPEN:        "Open",
  ESCALATED:   "Escalated",
  CLOSED_SAR:  "Pending SAR",
  PENDING_SAR: "Pending SAR",
};

function scoreToRisk(score: number): Alert["riskLevel"] {
  if (score >= 0.8) return "Critical";
  if (score >= 0.6) return "High";
  return "Medium";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Fallback volume data (until a daily-volume endpoint is added) ─────────────
const FALLBACK_VOLUME: DailyVolume[] = [
  { day: "Mon", normal: 4200, flagged: 18 },
  { day: "Tue", normal: 3900, flagged: 24 },
  { day: "Wed", normal: 4600, flagged: 15 },
  { day: "Thu", normal: 5100, flagged: 41 },
  { day: "Fri", normal: 4800, flagged: 33 },
  { day: "Sat", normal: 2900, flagged: 12 },
  { day: "Sun", normal: 2100, flagged: 47 },
];

// ─── Theme tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:      "#0a0a0a",
  surface: "#111111",
  border:  "#222222",
  lime:    "#c8f135",
  text:    "#f0f0f0",
  muted:   "#666666",
  dim:     "#2a2a2a",
};

const font = "'Inter', 'Helvetica Neue', Arial, sans-serif";

const riskColor = (r: Alert["riskLevel"]) =>
  r === "Critical" ? "#ff4d4d" : r === "High" ? "#f59e0b" : "#60a5fa";

const statusStyle = (s: string) => {
  const m: Record<string, { bg: string; color: string; border: string }> = {
    New:           { bg: "rgba(255,77,77,0.12)",  color: "#ff4d4d", border: "rgba(255,77,77,0.28)"   },
    "In Review":   { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "rgba(245,158,11,0.28)"  },
    Escalated:     { bg: "rgba(167,139,250,0.12)",color: "#a78bfa", border: "rgba(167,139,250,0.28)" },
    Open:          { bg: "rgba(96,165,250,0.12)", color: "#60a5fa", border: "rgba(96,165,250,0.28)"  },
    "Pending SAR": { bg: "rgba(251,146,60,0.12)", color: "#fb923c", border: "rgba(251,146,60,0.28)"  },
  };
  return m[s] ?? { bg: "#1e1e1e", color: "#aaa", border: "#333" };
};

const typeIcon = (t: string) =>
  ({ "Circular Flow": "⟳", "High Velocity": "⚡", "Structuring": "⬇",
     "Dormant Activation": "◎", "Layering": "≡", "Profile Mismatch": "◈" }[t] ?? "•");

// ─── SVG Sparkline ────────────────────────────────────────────────────────────
function VolumeChart({ data }: { data: DailyVolume[] }) {
  const maxF = Math.max(...data.map((d) => d.flagged));
  const W = 540; const H = 68; const pad = 14;
  const xs = data.map((_, i) => pad + (i / (data.length - 1)) * (W - pad * 2));
  const ys = data.map((d) => H - pad - (d.flagged / maxF) * (H - pad * 2));
  const linePath = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x} ${ys[i]}`).join(" ");
  const areaPath = `M ${xs[0]} ${H - pad} ` + xs.map((x, i) => `L ${x} ${ys[i]}`).join(" ") + ` L ${xs[xs.length - 1]} ${H - pad} Z`;
  return (
    <div style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 68, display: "block" }}>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.lime} stopOpacity="0.22" />
            <stop offset="100%" stopColor={T.lime} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#lg)" />
        <path d={linePath} fill="none" stroke={T.lime} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="2.5" fill={T.lime} />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px 0" }}>
        {data.map((d) => <span key={d.day} style={{ fontSize: 9, color: T.muted }}>{d.day}</span>)}
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub: string; accent: string }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "18px 20px" }}>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: accent, letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: string | number }) {
  return (
    <div style={{
      height, width,
      background: "linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%)",
      backgroundSize: "200% 100%",
      borderRadius: 4,
      animation: "shimmer 1.5s infinite",
    }} />
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: session } = useSession();
  const token = session?.accessToken; // stable string — safe as dep

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cases,  setCases]  = useState<Case[]>([]);
  const [volume]            = useState<DailyVolume[]>(FALLBACK_VOLUME);

  const [statsLoading,  setStatsLoading]  = useState(false);  // ← start false; set true only when fetch fires
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [casesLoading,  setCasesLoading]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [alertStats, setAlertStats] = useState<{ total: number; newCount: number; under_review: number }>({ total: 0, newCount: 0, under_review: 0 });
  const [caseStats,  setCaseStats]  = useState({ total: 0, open: 0, escalated: 0 });

  // ── Fetch alerts ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !session) return;
    setAlertsLoading(true);
    apiFetch<{ content: any[] }>("/api/alerts?page=0&size=10", session)
      .then((data) => {
        const mapped: Alert[] = (data.content ?? []).map((a: any) => ({
          id:        `AL-${String(a.id).slice(0, 5).toUpperCase()}`,
          accountId: a.accountId ?? "—",
          type:      ALERT_TYPE_LABEL[a.alertType] ?? a.alertType ?? "Unknown",
          riskLevel: scoreToRisk(a.anomaScore ?? 0),
          time:      a.createdAt ? relativeTime(a.createdAt) : "—",
          status:    ALERT_STATUS_LABEL[a.status] ?? "New",
          amount:    "—",
          branch:    "—",
        }));
        setAlerts(mapped);
      })
      .catch((e) => setError(e.message))
      .finally(() => setAlertsLoading(false));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch alert stats ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !session) return;
    setStatsLoading(true);
    apiFetch<{ total: number; new: number; under_review: number }>("/api/alerts/stats", session)
      .then((raw) => setAlertStats({
        total:        raw.total        ?? 0,
        newCount:     raw["new"]       ?? 0,  // ← bracket notation avoids reserved keyword parse error
        under_review: raw.under_review ?? 0,
      }))
      .catch((e) => setError(e.message))
      .finally(() => setStatsLoading(false));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch cases ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !session) return;
    setCasesLoading(true);
    apiFetch<{ content: any[] }>("/api/cases?page=0&size=20", session)
      .then((data) => {
        const mapped: Case[] = (data.content ?? []).map((c: any) => ({
          id:         `CASE-${String(c.id).slice(0, 6).toUpperCase()}`,
          accountId:  `Alert ${String(c.alertId).slice(0, 6).toUpperCase()}`,  // Case has no accountId — show linked alertId
          type:       c.priority ?? "MEDIUM",   // Case has no caseType — show priority
          openedAt:   c.createdAt
                        ? new Date(c.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
                        : "—",
          assignedTo: "You",
          status:     CASE_STATUS_LABEL[c.status] ?? "Open",
        }));
        setCases(mapped);
      })
      .catch((e) => setError(e.message))
      .finally(() => setCasesLoading(false));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch case stats ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !session) return;
    apiFetch<{ total: number; open: number; escalated: number }>("/api/cases/stats", session)
      .then(setCaseStats)
      .catch(() => {/* non-fatal */});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const critical     = alerts.filter((a) => a.riskLevel === "Critical").length;
  const needsAction  = alertStats.newCount;   // ← was alertStats.new (reserved keyword — always 0)
  const todayFlagged = volume[volume.length - 1].flagged;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: font }}>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>

      <main style={{ maxWidth: 1580, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Title block */}
        <div>
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, margin: "0 0 6px" }}>MONITORING</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Dashboard</h1>
          <p style={{ fontSize: 13, color: T.muted, margin: "4px 0 0" }}>Here's what needs your attention today.</p>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{ background: "rgba(255,77,77,0.1)", border: "1px solid rgba(255,77,77,0.3)", borderRadius: 8, padding: "10px 16px", fontSize: 13, color: "#ff4d4d" }}>
            ⚠ Could not reach backend: {error}. Showing last known data.
          </div>
        )}

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          {statsLoading ? (
            [0,1,2,3].map(i => (
              <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "18px 20px" }}>
                <Skeleton height={10} width="60%" /><br/>
                <Skeleton height={32} width="40%" /><br/>
                <Skeleton height={10} width="80%" />
              </div>
            ))
          ) : (
            <>
              <StatCard label="Action Required" value={needsAction}        sub="New alerts waiting"                                                   accent={T.lime}   />
              <StatCard label="Critical Alerts"  value={critical}           sub="Highest priority"                                                     accent="#ff4d4d"  />
              <StatCard label="My Open Cases"    value={caseStats.open}     sub={`${cases.filter(c=>c.status==="Pending SAR").length} pending SAR`}    accent="#60a5fa"  />
              <StatCard label="Flagged Today"    value={todayFlagged}       sub="Transactions flagged"                                                 accent="#a78bfa"  />
            </>
          )}
        </div>

        {/* Alerts + sidebar */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14 }}>

          {/* ── Alert table ── */}
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Recent Alerts</span>
              <button style={{ fontSize: 11, color: T.muted, background: "none", border: "none", cursor: "pointer" }}>View all →</button>
            </div>

            {alertsLoading ? (
              <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                {[0,1,2,3].map(i => <Skeleton key={i} height={36} />)}
              </div>
            ) : alerts.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: T.muted, fontSize: 13 }}>No alerts found</div>
            ) : (
              alerts.map((a, idx) => {
                const st = statusStyle(a.status);
                return (
                  <div
                    key={a.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "11px 18px",
                      borderBottom: idx < alerts.length - 1 ? `1px solid ${T.border}` : "none",
                      cursor: "pointer", transition: "background 0.12s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#161616")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Risk dot */}
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: riskColor(a.riskLevel), flexShrink: 0, boxShadow: `0 0 6px ${riskColor(a.riskLevel)}` }} />

                    {/* Icon */}
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{typeIcon(a.type)}</span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{a.type}</span>
                        <span style={{ fontSize: 10, color: T.muted, fontFamily: "'Courier New', monospace" }}>{a.accountId}</span>
                      </div>
                      <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{a.time} · {a.branch}</div>
                    </div>

                    <div style={{ padding: "2px 8px", borderRadius: 20, background: st.bg, color: st.color, border: `1px solid ${st.border}`, fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                      {a.status}
                    </div>

                    <span style={{ fontSize: 11, color: riskColor(a.riskLevel), fontWeight: 700, fontFamily: "'Courier New', monospace", flexShrink: 0 }}>
                      {a.riskLevel}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Right column ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Volume sparkline */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 14px" }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, margin: "0 0 12px" }}>Flagged Transactions / Day</p>
              <VolumeChart data={volume} />
            </div>

            {/* Risk bars */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, margin: 0 }}>Risk Breakdown</p>
              {alertsLoading ? (
                [0,1,2].map(i => <Skeleton key={i} height={24} />)
              ) : (
                (["Critical","High","Medium"] as const).map((r) => {
                  const count = alerts.filter(a => a.riskLevel === r).length;
                  const pct   = alerts.length ? Math.round((count / alerts.length) * 100) : 0;
                  return (
                    <div key={r}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: T.text }}>{r}</span>
                        <span style={{ color: riskColor(r), fontWeight: 600 }}>{count}</span>
                      </div>
                      <div style={{ height: 3, borderRadius: 3, background: T.dim }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: riskColor(r), borderRadius: 3, transition: "width 0.4s ease" }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick lookup */}
            <div style={{ background: "rgba(200,241,53,0.04)", border: "1px solid rgba(200,241,53,0.14)", borderRadius: 10, padding: "14px" }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.lime, margin: "0 0 6px" }}>Quick Lookup</p>
              <p style={{ fontSize: 11, color: T.muted, margin: "0 0 10px" }}>Search any account to trace fund flow</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(alerts.length > 0
                  ? alerts.slice(0, 3).map(a => a.accountId)
                  : ["ACC-8872", "ACC-2219", "ACC-5504"]
                ).map(acc => (
                  <span key={acc} style={{ padding: "3px 8px", borderRadius: 5, background: "#1a1a1a", border: `1px solid ${T.border}`, fontSize: 10, color: T.muted, cursor: "pointer", fontFamily: "'Courier New', monospace" }}>
                    {acc}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── My Cases ── */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>My Open Cases</span>
            <button style={{ fontSize: 11, color: T.muted, background: "none", border: "none", cursor: "pointer" }}>View all →</button>
          </div>

          {casesLoading ? (
            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              {[0,1,2].map(i => <Skeleton key={i} height={40} />)}
            </div>
          ) : cases.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: T.muted, fontSize: 13 }}>No open cases</div>
          ) : (
            cases.map((c, idx) => {
              const st = statusStyle(c.status);
              return (
                <div
                  key={c.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "11px 18px",
                    borderBottom: idx < cases.length - 1 ? `1px solid ${T.border}` : "none",
                    cursor: "pointer", transition: "background 0.12s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#161616")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ fontSize: 11, color: T.muted, width: 74, flexShrink: 0, fontFamily: "'Courier New', monospace" }}>{c.id}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{c.accountId}</div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{c.type} · Opened {c.openedAt}</div>
                  </div>
                  <div style={{ padding: "2px 8px", borderRadius: 20, background: st.bg, color: st.color, border: `1px solid ${st.border}`, fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                    {c.status}
                  </div>
                  <button style={{ padding: "4px 12px", borderRadius: 6, background: "none", border: `1px solid ${T.border}`, fontSize: 11, color: T.muted, cursor: "pointer", flexShrink: 0, fontFamily: font }}>
                    Resume →
                  </button>
                </div>
              );
            })
          )}
        </div>

      </main>
    </div>
  );
}