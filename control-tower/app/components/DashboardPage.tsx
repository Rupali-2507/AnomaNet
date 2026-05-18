"use client";

import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Alert {
  id: string;
  accountId: string;
  type: "Circular Flow" | "High Velocity" | "Structuring" | "Dormant Activation" | "Layering";
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

// ─── Mock Data ────────────────────────────────────────────────────────────────
// GET /api/alerts?status=New,In+Review&limit=10
const MOCK_ALERTS: Alert[] = [
  { id: "AL-9022", accountId: "ACC_88291", type: "Circular Flow",      riskLevel: "Critical", time: "2m ago",  status: "New",       amount: "₹14,20,000", branch: "Mumbai Central" },
  { id: "AL-9021", accountId: "ACC_11204", type: "High Velocity",      riskLevel: "Critical", time: "11m ago", status: "New",       amount: "₹8,75,500",  branch: "Delhi North"   },
  { id: "AL-9020", accountId: "ACC_33017", type: "Structuring",        riskLevel: "High",     time: "34m ago", status: "In Review", amount: "₹4,99,000",  branch: "Pune East"     },
  { id: "AL-9019", accountId: "ACC_72104", type: "Dormant Activation", riskLevel: "High",     time: "1h ago",  status: "New",       amount: "₹2,30,000",  branch: "Chennai"       },
  { id: "AL-9018", accountId: "ACC_45892", type: "Layering",           riskLevel: "Medium",   time: "2h ago",  status: "In Review", amount: "₹1,10,000",  branch: "Hyderabad"     },
  { id: "AL-9017", accountId: "ACC_60341", type: "Circular Flow",      riskLevel: "High",     time: "3h ago",  status: "Escalated", amount: "₹9,50,000",  branch: "Bengaluru"     },
];

// GET /api/cases?assignedTo=me&status=Open,Pending+SAR
const MOCK_CASES: Case[] = [
  { id: "CASE-441", accountId: "ACC_55312", type: "Circular Flow",  openedAt: "Today, 9:14 AM",     assignedTo: "You", status: "Open"        },
  { id: "CASE-438", accountId: "ACC_29871", type: "High Velocity",  openedAt: "Yesterday, 4:02 PM", assignedTo: "You", status: "Pending SAR" },
  { id: "CASE-431", accountId: "ACC_10042", type: "Structuring",    openedAt: "18 May, 11:30 AM",   assignedTo: "You", status: "Escalated"   },
];

// GET /api/stats/daily-volume?days=7
const MOCK_VOLUME: DailyVolume[] = [
  { day: "Mon", normal: 4200, flagged: 18 },
  { day: "Tue", normal: 3900, flagged: 24 },
  { day: "Wed", normal: 4600, flagged: 15 },
  { day: "Thu", normal: 5100, flagged: 41 },
  { day: "Fri", normal: 4800, flagged: 33 },
  { day: "Sat", normal: 2900, flagged: 12 },
  { day: "Sun", normal: 2100, flagged: 47 },
];

// ─── Theme tokens — AnomaNet palette ─────────────────────────────────────────
const T = {
  bg:      "#0a0a0a",
  surface: "#111111",
  border:  "#222222",
  lime:    "#c8f135",   // AnomaNet yellow-green CTA
  text:    "#f0f0f0",
  muted:   "#666666",
  dim:     "#2a2a2a",
};

const font = "'Inter', 'Helvetica Neue', Arial, sans-serif";

const riskColor = (r: Alert["riskLevel"]) =>
  r === "Critical" ? "#ff4d4d" : r === "High" ? "#f59e0b" : "#60a5fa";

const statusStyle = (s: string) => {
  const m: Record<string, { bg: string; color: string; border: string }> = {
    New:           { bg: "rgba(255,77,77,0.12)",  color: "#ff4d4d", border: "rgba(255,77,77,0.28)"  },
    "In Review":   { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "rgba(245,158,11,0.28)" },
    Escalated:     { bg: "rgba(167,139,250,0.12)",color: "#a78bfa", border: "rgba(167,139,250,0.28)"},
    Open:          { bg: "rgba(96,165,250,0.12)", color: "#60a5fa", border: "rgba(96,165,250,0.28)" },
    "Pending SAR": { bg: "rgba(251,146,60,0.12)", color: "#fb923c", border: "rgba(251,146,60,0.28)" },
  };
  return m[s] ?? { bg: "#1e1e1e", color: "#aaa", border: "#333" };
};

const typeIcon = (t: string) =>
  ({ "Circular Flow": "⟳", "High Velocity": "⚡", "Structuring": "⬇", "Dormant Activation": "◎", "Layering": "≡" }[t] ?? "•");

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

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [alerts] = useState<Alert[]>(MOCK_ALERTS);
  const [cases]  = useState<Case[]>(MOCK_CASES);
  const [volume] = useState<DailyVolume[]>(MOCK_VOLUME);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const critical     = alerts.filter((a) => a.riskLevel === "Critical").length;
  const needsAction  = alerts.filter((a) => a.status === "New").length;
  const todayFlagged = volume[volume.length - 1].flagged;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: font }}>

    

      {/* ── Main ── */}
      <main style={{ maxWidth: 1580, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Title block */}
        <div>
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, margin: "0 0 6px" }}>MONITORING</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Dashboard</h1>
          <p style={{ fontSize: 13, color: T.muted, margin: "4px 0 0" }}>Here's what needs your attention today.</p>
        </div>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          <StatCard label="Action Required" value={needsAction}   sub="New alerts waiting"                                                 accent={T.lime}   />
          <StatCard label="Critical Alerts" value={critical}      sub="Highest priority"                                                   accent="#ff4d4d"  />
          <StatCard label="My Open Cases"   value={cases.length}  sub={`${cases.filter(c=>c.status==="Pending SAR").length} pending SAR`}  accent="#60a5fa"  />
          <StatCard label="Flagged Today"   value={todayFlagged}  sub="Transactions flagged"                                               accent="#a78bfa"  />
        </div>

        {/* Alerts + sidebar */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14 }}>

         

          {/* ── Right column ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          

            {/* Risk bars */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, margin: 0 }}>Risk Breakdown</p>
              {(["Critical","High","Medium"] as const).map((r) => {
                const count = alerts.filter(a => a.riskLevel === r).length;
                const pct   = Math.round((count / alerts.length) * 100);
                return (
                  <div key={r}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: T.text }}>{r}</span>
                      <span style={{ color: riskColor(r), fontWeight: 600 }}>{count}</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 3, background: T.dim }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: riskColor(r), borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick lookup hint — AnomaNet style */}
            <div style={{ background: "rgba(200,241,53,0.04)", border: "1px solid rgba(200,241,53,0.14)", borderRadius: 10, padding: "14px" }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.lime, margin: "0 0 6px" }}>Quick Lookup</p>
              <p style={{ fontSize: 11, color: T.muted, margin: "0 0 10px" }}>Search any account to trace fund flow</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["ACC-8872", "ACC-2219", "ACC-5504"].map(acc => (
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
            {/* GET /api/cases?assignedTo=me */}
            <button style={{ fontSize: 11, color: T.muted, background: "none", border: "none", cursor: "pointer" }}>View all →</button>
          </div>
          {cases.map((c, idx) => {
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
          })}
        </div>

      </main>
    </div>
  );
}