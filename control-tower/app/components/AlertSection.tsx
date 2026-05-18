"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ArrowLeft,
  UserPlus,
  FolderOpen,
  Search,
  X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Design tokens (inherits from your existing theme)
// ─────────────────────────────────────────────────────────────

// Score → colour helper (same as your existing tc())
const tc = (score: number) => {
  if (score >= 0.85) return "text-red-400";
  if (score >= 0.7) return "text-orange-400";
  if (score >= 0.55) return "text-yellow-400";
  return "text-green-400";
};

const scoreBg = (score: number) => {
  if (score >= 0.85) return "bg-red-500";
  if (score >= 0.7) return "bg-orange-500";
  if (score >= 0.55) return "bg-yellow-500";
  return "bg-green-500";
};

// ─────────────────────────────────────────────────────────────
// Shared tiny components
// ─────────────────────────────────────────────────────────────

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1">
    {children}
  </p>
);

const Card = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`bg-white/[0.03] border border-white/[0.07] rounded-2xl ${className}`}
  >
    {children}
  </div>
);

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type AlertStatus = "NEW" | "REVIEW" | "ESCALATED" | "CLOSED SAR";
type AlertTypology =
  | "CIRCULAR"
  | "DORMANT"
  | "STRUCTURING"
  | "PROFILE"
  | "LAYERING";

interface Alert {
  id: string;          // e.g. "ALT-0091"
  score: number;
  typology: AlertTypology;
  account: string;
  amount: string;      // e.g. "₹48.2L"
  amountRaw: number;   // numeric for sorting
  branch: string;
  time: string;        // e.g. "14:31:58"
  status: AlertStatus;
  assigned: string | null;

  // Detail-view data (populated from backend in prod)
  detail?: AlertDetail;
}

interface TxRow {
  time: string;
  from: string;
  to: string;
  amount: string;
  channel: string;
}

interface ScoreBreakdown {
  CIRCULAR: number;
  LAYERING: number;
  PROFILE: number;
  STRUCTURING: number;
  DORMANCY: number;
}

interface AlertDetail {
  graphLabel: string;        // "Fund-flow subgraph — depth 3"
  cycleLabel: string;        // "Directed cycle – 3 accounts · 3.8 hours · Mumbai + Delhi"
  transactions: TxRow[];
  scoreBreakdown: ScoreBreakdown;
  aiExplanation: string;
  mlLog: { time: string; tag: string; msg: string }[];
  // graph nodes/edges would be passed to FraudGraph3D in production
}

// ─────────────────────────────────────────────────────────────
// MOCK DATA
// ── In production: replace with GET /api/alerts?status=...&score=...&window=...
// ── WebSocket: prepend new alerts via useWebSocket hook on topic "alerts.generated"
// ─────────────────────────────────────────────────────────────

const MOCK_ALERTS: Alert[] = [
  {
    id: "ALT-0091",
    score: 0.91,
    typology: "CIRCULAR",
    account: "ACC-8872",
    amount: "₹48.2L",
    amountRaw: 4820000,
    branch: "HDFC0001234",
    time: "14:31:58",
    status: "NEW",
    assigned: null,
    detail: {
      graphLabel: "Fund-flow subgraph — depth 3",
      cycleLabel: "Directed cycle – 3 accounts · 3.8 hours · Mumbai + Delhi",
      transactions: [
        { time: "14:31:49", from: "ACC-8872", to: "ACC-9912", amount: "₹48.2L", channel: "NEFT" },
        { time: "14:31:52", from: "ACC-9912", to: "ACC-3341", amount: "₹47.9L", channel: "NEFT" },
        { time: "14:31:55", from: "ACC-3341", to: "ACC-8872", amount: "₹47.6L", channel: "NEFT" },
      ],
      scoreBreakdown: { CIRCULAR: 0.91, LAYERING: 0.82, PROFILE: 0.78, STRUCTURING: 0.45, DORMANCY: 0.12 },
      aiExplanation:
        "Account ACC-8872 transferred ₹48.2L to ACC-9912, which transferred ₹47.9L to ACC-3341, which returned ₹47.6L to ACC-8872 — completing a financial cycle in 3.8 hours across branches in Mumbai and Delhi. Two of the three counterparty relationships were first-time transactions.",
      mlLog: [
        { time: "14:31:57", tag: "GNN", msg: "GraphSAGE encoded 3 nodes · 2-hop subgraph" },
        { time: "14:31:57", tag: "CIRC", msg: "Johnson's algo · cycle found · 3 hops · 6min window" },
        { time: "14:31:58", tag: "LAYER", msg: "Velocity: 3 tx in 6min · isolation forest anomaly" },
        { time: "14:31:58", tag: "SCORE", msg: "AnomaScore=0.91 · threshold=0.65 · ALERT" },
        { time: "14:31:58", tag: "KAFKA", msg: "AlertEvent published · alerts.generated topic" },
        { time: "14:31:58", tag: "WS", msg: "WebSocket broadcast → 2 connected investigators" },
      ],
    },
  },
  {
    id: "ALT-0090",
    score: 0.88,
    typology: "DORMANT",
    account: "ACC-5504",
    amount: "₹1.8Cr",
    amountRaw: 18000000,
    branch: "SBI0009801",
    time: "14:22:44",
    status: "NEW",
    assigned: null,
    detail: {
      graphLabel: "Fund-flow subgraph — depth 2",
      cycleLabel: "Dormant reactivation · 14 months gap · ₹1.8Cr single tx",
      transactions: [
        { time: "14:22:40", from: "UNKNOWN", to: "ACC-5504", amount: "₹1.8Cr", channel: "IMPS" },
      ],
      scoreBreakdown: { CIRCULAR: 0.12, LAYERING: 0.44, PROFILE: 0.66, STRUCTURING: 0.31, DORMANCY: 0.88 },
      aiExplanation:
        "Account ACC-5504 was dormant for 14 months with zero transactions, then received ₹1.8Cr via IMPS in a single transaction. The sender is an unregistered entity with no prior relationship to this account. KYC tier is MEDIUM but risk flags HIGH given the reactivation pattern.",
      mlLog: [
        { time: "14:22:42", tag: "DORM", msg: "Last tx: 14 months ago · 427 day gap detected" },
        { time: "14:22:43", tag: "PROF", msg: "Profile mismatch: autoencoder score 0.88" },
        { time: "14:22:44", tag: "SCORE", msg: "AnomaScore=0.88 · threshold=0.65 · ALERT" },
        { time: "14:22:44", tag: "KAFKA", msg: "AlertEvent published · alerts.generated topic" },
        { time: "14:22:44", tag: "WS", msg: "WebSocket broadcast → 2 connected investigators" },
      ],
    },
  },
  {
    id: "ALT-0089",
    score: 0.83,
    typology: "STRUCTURING",
    account: "ACC-2219",
    amount: "₹29.8L",
    amountRaw: 2980000,
    branch: "HDFC0004412",
    time: "14:28:11",
    status: "REVIEW",
    assigned: "Arjun M.",
    detail: {
      graphLabel: "Fund-flow subgraph — depth 2",
      cycleLabel: "Structuring pattern · 11 txns just below ₹2L · 4h window",
      transactions: [
        { time: "13:55:00", from: "ACC-2219", to: "ACC-7701", amount: "₹1.9L", channel: "NEFT" },
        { time: "14:10:00", from: "ACC-2219", to: "ACC-7702", amount: "₹1.8L", channel: "NEFT" },
        { time: "14:28:00", from: "ACC-2219", to: "ACC-7703", amount: "₹1.95L", channel: "NEFT" },
      ],
      scoreBreakdown: { CIRCULAR: 0.15, LAYERING: 0.38, PROFILE: 0.52, STRUCTURING: 0.83, DORMANCY: 0.05 },
      aiExplanation:
        "ACC-2219 made 11 transactions ranging ₹1.8L–₹1.95L across 9 unique accounts within 4 hours. Each amount is deliberately below the ₹2L reporting threshold. This is a classic structuring (Smurfing) pattern. Branch HDFC0004412 has not flagged this account previously.",
      mlLog: [
        { time: "14:28:09", tag: "STRUCT", msg: "11 txns · avg ₹1.89L · below-threshold clustering" },
        { time: "14:28:10", tag: "PROF", msg: "Profile mismatch score 0.52" },
        { time: "14:28:11", tag: "SCORE", msg: "AnomaScore=0.83 · threshold=0.65 · ALERT" },
        { time: "14:28:11", tag: "KAFKA", msg: "AlertEvent published · alerts.generated topic" },
      ],
    },
  },
  {
    id: "ALT-0088",
    score: 0.76,
    typology: "PROFILE",
    account: "ACC-7731",
    amount: "₹2.1Cr",
    amountRaw: 21000000,
    branch: "ICICI0003321",
    time: "14:19:03",
    status: "REVIEW",
    assigned: "Priya S.",
    detail: {
      graphLabel: "Fund-flow subgraph — depth 2",
      cycleLabel: "Profile mismatch · salary account · large outflow",
      transactions: [
        { time: "14:19:00", from: "ACC-7731", to: "ACC-0012", amount: "₹2.1Cr", channel: "RTGS" },
      ],
      scoreBreakdown: { CIRCULAR: 0.08, LAYERING: 0.31, PROFILE: 0.76, STRUCTURING: 0.22, DORMANCY: 0.19 },
      aiExplanation:
        "ACC-7731 is a salary account with average monthly credit of ₹85K. A single ₹2.1Cr RTGS transfer was initiated to an account with no prior relationship. The amount is 24× the account's historical monthly average — a severe profile mismatch flagged by the autoencoder.",
      mlLog: [
        { time: "14:19:01", tag: "PROF", msg: "Autoencoder reconstruction error: 0.76" },
        { time: "14:19:02", tag: "SCORE", msg: "AnomaScore=0.76 · threshold=0.65 · ALERT" },
        { time: "14:19:03", tag: "KAFKA", msg: "AlertEvent published · alerts.generated topic" },
      ],
    },
  },
  {
    id: "ALT-0087",
    score: 0.71,
    typology: "LAYERING",
    account: "ACC-1103",
    amount: "₹50L",
    amountRaw: 5000000,
    branch: "AXIS0007761",
    time: "13:55:22",
    status: "ESCALATED",
    assigned: "Priya S.",
    detail: {
      graphLabel: "Fund-flow subgraph — depth 4",
      cycleLabel: "Layering fan-out · 7 intermediaries · 2h window",
      transactions: [
        { time: "13:40:00", from: "ACC-1103", to: "ACC-A1", amount: "₹7.2L", channel: "NEFT" },
        { time: "13:48:00", from: "ACC-1103", to: "ACC-A2", amount: "₹6.9L", channel: "IMPS" },
        { time: "13:55:00", from: "ACC-1103", to: "ACC-A3", amount: "₹7.5L", channel: "NEFT" },
      ],
      scoreBreakdown: { CIRCULAR: 0.22, LAYERING: 0.71, PROFILE: 0.48, STRUCTURING: 0.55, DORMANCY: 0.08 },
      aiExplanation:
        "ACC-1103 disbursed ₹50L across 7 intermediary accounts within 2 hours. Each recipient then forwarded funds to 2–3 downstream accounts, creating a classic layering fan-out to obscure the money trail. AXIS branch has no prior SAR for this account.",
      mlLog: [
        { time: "13:55:20", tag: "LAYER", msg: "Fan-out detected · 7 intermediaries · depth 3" },
        { time: "13:55:21", tag: "SCORE", msg: "AnomaScore=0.71 · threshold=0.65 · ALERT" },
        { time: "13:55:22", tag: "KAFKA", msg: "AlertEvent published · alerts.generated topic" },
      ],
    },
  },
  {
    id: "ALT-0086",
    score: 0.67,
    typology: "CIRCULAR",
    account: "ACC-4488",
    amount: "₹12.1L",
    amountRaw: 1210000,
    branch: "PNB0002231",
    time: "13:41:09",
    status: "CLOSED SAR",
    assigned: "Arjun M.",
    detail: {
      graphLabel: "Fund-flow subgraph — depth 3",
      cycleLabel: "Directed cycle – 4 accounts · 6.2 hours · Delhi",
      transactions: [
        { time: "13:30:00", from: "ACC-4488", to: "ACC-B1", amount: "₹12.1L", channel: "NEFT" },
        { time: "13:35:00", from: "ACC-B1", to: "ACC-B2", amount: "₹11.9L", channel: "NEFT" },
        { time: "13:41:00", from: "ACC-B2", to: "ACC-4488", amount: "₹11.7L", channel: "NEFT" },
      ],
      scoreBreakdown: { CIRCULAR: 0.67, LAYERING: 0.31, PROFILE: 0.44, STRUCTURING: 0.28, DORMANCY: 0.11 },
      aiExplanation:
        "A circular flow of ₹12.1L was detected across 4 accounts within 6.2 hours, all within the Delhi cluster. SAR was filed and the case closed. Pattern consistent with test-run circular before a larger operation.",
      mlLog: [
        { time: "13:41:07", tag: "CIRC", msg: "Cycle found · 4 hops · 6.2h window" },
        { time: "13:41:08", tag: "SCORE", msg: "AnomaScore=0.67 · threshold=0.65 · ALERT" },
        { time: "13:41:09", tag: "KAFKA", msg: "AlertEvent published · alerts.generated topic" },
        { time: "13:41:09", tag: "SAR", msg: "SAR filed · case closed by Arjun M." },
      ],
    },
  },
];

// ─────────────────────────────────────────────────────────────
// Typology badge config
// ─────────────────────────────────────────────────────────────

const TYPOLOGY_CONFIG: Record<
  AlertTypology,
  { color: string; bg: string; icon: string }
> = {
  CIRCULAR:    { color: "#f87171", bg: "rgba(248,113,113,0.12)", icon: "◎" },
  DORMANT:     { color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  icon: "⇌" },
  STRUCTURING: { color: "#fb923c", bg: "rgba(251,146,60,0.12)",  icon: "↓" },
  PROFILE:     { color: "#a78bfa", bg: "rgba(167,139,250,0.12)", icon: "◈" },
  LAYERING:    { color: "#34d399", bg: "rgba(52,211,153,0.12)",  icon: "≡" },
};

const STATUS_CONFIG: Record<
  AlertStatus,
  { color: string; bg: string }
> = {
  "NEW":        { color: "#f87171", bg: "rgba(248,113,113,0.15)" },
  "REVIEW":     { color: "#fbbf24", bg: "rgba(251,191,36,0.15)"  },
  "ESCALATED":  { color: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
  "CLOSED SAR": { color: "#34d399", bg: "rgba(52,211,153,0.15)"  },
};

// ─────────────────────────────────────────────────────────────
// Mini radar chart (canvas-based, no deps)
// ─────────────────────────────────────────────────────────────

const RadarChart = ({ breakdown }: { breakdown: ScoreBreakdown }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labels = Object.keys(breakdown) as (keyof ScoreBreakdown)[];
  const values = labels.map((k) => breakdown[k]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(cx, cy) - 30;
    const n = labels.length;

    ctx.clearRect(0, 0, W, H);

    // Grid rings
    [0.25, 0.5, 0.75, 1.0].forEach((pct) => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const x = cx + Math.cos(angle) * R * pct;
        const y = cy + Math.sin(angle) * R * pct;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Axes
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Data polygon
    ctx.beginPath();
    values.forEach((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const x = cx + Math.cos(angle) * R * v;
      const y = cy + Math.sin(angle) * R * v;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(239,68,68,0.18)";
    ctx.fill();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Labels
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    labels.forEach((label, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const lx = cx + Math.cos(angle) * (R + 18);
      const ly = cy + Math.sin(angle) * (R + 18);
      ctx.fillText(label, lx, ly);
    });

    // Score dots
    values.forEach((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const x = cx + Math.cos(angle) * R * v;
      const y = cy + Math.sin(angle) * R * v;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      // score label
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 8px monospace";
      ctx.fillText(v.toFixed(2), x + 10, y - 6);
    });
  }, [breakdown]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={220}
      style={{ display: "block", margin: "0 auto" }}
    />
  );
};

// ─────────────────────────────────────────────────────────────
// Score bar row
// ─────────────────────────────────────────────────────────────

const SCORE_COLORS: Record<keyof ScoreBreakdown, string> = {
  CIRCULAR:    "#ef4444",
  LAYERING:    "#f59e0b",
  PROFILE:     "#a78bfa",
  STRUCTURING: "#22d3ee",
  DORMANCY:    "#34d399",
};

const ScoreBar = ({
  label,
  value,
}: {
  label: keyof ScoreBreakdown;
  value: number;
}) => (
  <div style={{ marginBottom: 10 }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 4,
      }}
    >
      <span
        style={{
          color: "rgba(255,255,255,0.45)",
          fontSize: 10,
          fontFamily: "monospace",
          fontWeight: 700,
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: SCORE_COLORS[label],
          fontSize: 11,
          fontFamily: "monospace",
          fontWeight: 700,
        }}
      >
        {value.toFixed(2)}
      </span>
    </div>
    <div
      style={{
        height: 3,
        background: "rgba(255,255,255,0.06)",
        borderRadius: 99,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${value * 100}%`,
          background: SCORE_COLORS[label],
          borderRadius: 99,
          transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)",
        }}
      />
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// ML log line
// ─────────────────────────────────────────────────────────────

const TAG_COLORS: Record<string, string> = {
  GNN: "#60a5fa", CIRC: "#f87171", CIRC2: "#f87171",
  LAYER: "#f59e0b", SCORE: "#34d399", KAFKA: "#a78bfa",
  WS: "#22d3ee", DORM: "#60a5fa", PROF: "#a78bfa",
  STRUCT: "#fb923c", SAR: "#34d399",
};

const MlLogLine = ({ time, tag, msg }: { time: string; tag: string; msg: string }) => (
  <div
    style={{
      display: "flex",
      gap: 10,
      fontFamily: "monospace",
      fontSize: 11,
      lineHeight: 1.6,
    }}
  >
    <span style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }}>{time}</span>
    <span
      style={{
        color: TAG_COLORS[tag] ?? "#94a3b8",
        fontWeight: 700,
        flexShrink: 0,
        minWidth: 52,
      }}
    >
      {tag}
    </span>
    <span style={{ color: "rgba(255,255,255,0.55)" }}>{msg}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────
// ALERT DETAIL VIEW (3rd screenshot)
// ─────────────────────────────────────────────────────────────

const AlertDetail = ({
  alert,
  onBack,
}: {
  alert: Alert;
  onBack: () => void;
}) => {
  const d = alert.detail!;
  const typ = TYPOLOGY_CONFIG[alert.typology];

  return (
    <div style={{ color: "white" }}>
      {/* ── Header bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={onBack}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
              fontSize: 13,
              padding: 0,
            }}
          >
            <ArrowLeft size={14} />
            Alert Queue
          </button>
          <span style={{ color: "rgba(255,255,255,0.15)" }}>/</span>
          <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, fontWeight: 600 }}>
            {alert.id} · {alert.typology === "CIRCULAR" ? "Circular Transaction" : alert.typology} · {alert.account}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Score pill */}
          <div
            style={{
              background: scoreBg(alert.score),
              borderRadius: 6,
              padding: "4px 12px",
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: 14,
              color: "white",
            }}
          >
            {alert.score.toFixed(2)}
          </div>
          {/* BACKEND: POST /api/cases creates a new case linked to this alert */}
          <button
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              color: "rgba(255,255,255,0.7)",
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <FolderOpen size={13} /> Open Case
          </button>
          {/* BACKEND: PATCH /api/alerts/:id { assigned: currentUser } */}
          <button
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              color: "rgba(255,255,255,0.7)",
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <UserPlus size={13} /> Assign Me
          </button>
        </div>
      </div>

      {/* ── Main 2-column grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* LEFT column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Graph panel */}
          {/* BACKEND: GET /api/graph/scored-subgraph?accountId=XXX&depth=3 → render FraudGraph3D */}
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 16,
              padding: 20,
              minHeight: 360,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 16,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.5)",
                  fontFamily: "monospace",
                }}
              >
                {d.graphLabel}
              </span>
            </div>

            {/* Placeholder graph area — swap for <FraudGraph3D initialAccountId={alert.account} .../> */}
            <div
              style={{
                background: "rgba(0,0,0,0.3)",
                borderRadius: 10,
                height: 260,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px dashed rgba(255,255,255,0.08)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Mock graph visual */}
              <MockGraphVisual typology={alert.typology} />
            </div>

            <div
              style={{
                marginTop: 10,
                fontSize: 11,
                color: "rgba(255,255,255,0.35)",
                fontFamily: "monospace",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ color: typ.color }}>◎</span>
              {d.cycleLabel}
            </div>
          </div>

          {/* Transaction trail */}
          {/* BACKEND: GET /api/alerts/:id/transactions */}
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 16,
              padding: 20,
            }}
          >
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.3)",
                marginBottom: 14,
                fontFamily: "monospace",
              }}
            >
              TRANSACTION TRAIL
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Time", "From", "To", "Amount", "Channel"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        color: "rgba(255,255,255,0.3)",
                        paddingBottom: 8,
                        fontFamily: "monospace",
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.transactions.map((tx, i) => (
                  <tr key={i}>
                    {[tx.time, tx.from, tx.to, tx.amount, tx.channel].map(
                      (val, j) => (
                        <td
                          key={j}
                          style={{
                            padding: "9px 0",
                            fontSize: 12,
                            fontFamily: "monospace",
                            color:
                              j === 3
                                ? "#f87171"
                                : j === 4
                                ? "rgba(255,255,255,0.4)"
                                : "rgba(255,255,255,0.75)",
                            borderBottom: "1px solid rgba(255,255,255,0.04)",
                          }}
                        >
                          {val}
                        </td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Score breakdown */}
          {/* BACKEND: data comes from GET /api/alerts/:id (score_breakdown field) */}
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 16,
              padding: 20,
            }}
          >
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.3)",
                marginBottom: 14,
                fontFamily: "monospace",
              }}
            >
              ANOMA SCORE BREAKDOWN
            </p>
            <RadarChart breakdown={d.scoreBreakdown} />
            <div style={{ marginTop: 16 }}>
              {(Object.keys(d.scoreBreakdown) as (keyof ScoreBreakdown)[]).map(
                (k) => (
                  <ScoreBar key={k} label={k} value={d.scoreBreakdown[k]} />
                )
              )}
            </div>
          </div>

          {/* AI Explanation */}
          {/* BACKEND: GET /ml/explain/:alertId — Rupali's explainability engine */}
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 16,
              padding: 20,
            }}
          >
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: "rgba(167,139,250,0.7)",
                marginBottom: 10,
                fontFamily: "monospace",
              }}
            >
              AI EXPLANATION — RUPALI'S EXPLAINABILITY ENGINE
            </p>
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.7,
                color: "rgba(255,255,255,0.65)",
              }}
              dangerouslySetInnerHTML={{
                __html: d.aiExplanation.replace(
                  /(\d+\.\d+[LCr]+|\d+\.\d+ hours|\d+ accounts|first-time)/g,
                  '<strong style="color:white">$1</strong>'
                ),
              }}
            />
            <div style={{ marginTop: 12 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(167,139,250,0.1)",
                  border: "1px solid rgba(167,139,250,0.2)",
                  borderRadius: 6,
                  padding: "3px 10px",
                  fontSize: 10,
                  color: "rgba(167,139,250,0.8)",
                  fontFamily: "monospace",
                  fontWeight: 600,
                }}
              >
                + Template-based NLG · Rupali's engine
              </span>
            </div>
          </div>

          {/* ML scoring log */}
          {/* BACKEND: GET /api/alerts/:id/ml-log — streamed from Kafka audit topic */}
          <div
            style={{
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 16,
              padding: 20,
              fontFamily: "monospace",
            }}
          >
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.3)",
                marginBottom: 12,
              }}
            >
              ML SCORING LOG · {alert.id}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {d.mlLog.map((l, i) => (
                <MlLogLine key={i} {...l} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Simple mock graph visuals (replace with FraudGraph3D in prod)
// ─────────────────────────────────────────────────────────────

const MockGraphVisual = ({ typology }: { typology: AlertTypology }) => {
  const color = TYPOLOGY_CONFIG[typology].color;
  if (typology === "CIRCULAR") {
    return (
      <svg width="300" height="220" viewBox="0 0 300 220">
        {/* Triangle nodes */}
        {[
          { x: 150, y: 40,  label: "ACC-8872", main: true },
          { x: 60,  y: 175, label: "ACC-9912", main: false },
          { x: 240, y: 175, label: "ACC-3341", main: false },
        ].map((n, i) => (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={n.main ? 28 : 20} fill="rgba(239,68,68,0.18)" stroke={color} strokeWidth={1.5} strokeDasharray={n.main ? "0" : "4 2"} />
            <text x={n.x} y={n.y - 2} textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace" fontWeight="bold">{n.label.split("-")[0]}</text>
            <text x={n.x} y={n.y + 9} textAnchor="middle" fill={color} fontSize="9" fontFamily="monospace" fontWeight="bold">-{n.label.split("-")[1]}</text>
          </g>
        ))}
        {/* Arrows */}
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={color} opacity="0.7" />
          </marker>
        </defs>
        {[
          { x1:130,y1:60,  x2:78, y2:155, label:"₹48.2L", lx:88, ly:108,  t:"14:31:49" },
          { x1:82, y1:175, x2:218,y2:175, label:"₹47.9L", lx:150,ly:168, t:"14:31:52" },
          { x1:228,y1:158, x2:162,y2:62,  label:"₹47.6L", lx:208,ly:108, t:"14:31:55" },
        ].map((e, i) => (
          <g key={i}>
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={color} strokeWidth={1.5} strokeOpacity={0.6} strokeDasharray="6 3" markerEnd="url(#arr)" />
            <text x={e.lx} y={e.ly} textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace" opacity="0.9">{e.label}</text>
            <text x={e.lx} y={e.ly + 10} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="monospace">{e.t}</text>
          </g>
        ))}
        {/* Outer satellite nodes */}
        {[{x:40,y:50},{x:260,y:50},{x:150,y:205}].map((n,i)=>(
          <circle key={i} cx={n.x} cy={n.y} r={8} fill="rgba(34,197,94,0.1)" stroke="#22c55e" strokeWidth={1} />
        ))}
      </svg>
    );
  }
  // Generic fallback for other typologies
  return (
    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 12, fontFamily: "monospace" }}>
      <div style={{ fontSize: 32, marginBottom: 8, color }}>{TYPOLOGY_CONFIG[typology].icon}</div>
      Graph renders here via FraudGraph3D<br />
      <span style={{ fontSize: 10 }}>(connect /api/graph/scored-subgraph)</span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// ALERT QUEUE VIEW (2nd screenshot)
// ─────────────────────────────────────────────────────────────

const SCORE_THRESHOLDS = ["Score ≥ 0.50", "Score ≥ 0.65", "Score ≥ 0.75", "Score ≥ 0.85"];
const TIME_WINDOWS = ["Last 1h", "Last 6h", "Last 24h", "Last 7d"];
const ALL_TYPES: ("ALL" | AlertTypology)[] = ["ALL", "CIRCULAR", "DORMANT", "STRUCTURING", "PROFILE", "LAYERING"];
const ALL_STATUSES: ("ALL" | AlertStatus)[] = ["ALL", "NEW", "REVIEW", "ESCALATED", "CLOSED SAR"];

const PAGE_SIZE = 6;

const AlertQueue = ({
  onSelectAlert,
}: {
  onSelectAlert: (a: Alert) => void;
}) => {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | AlertTypology>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | AlertStatus>("ALL");
  const [scoreFilter, setScoreFilter] = useState("Score ≥ 0.65");
  const [timeFilter, setTimeFilter] = useState("Last 24h");
  const [page, setPage] = useState(0);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // BACKEND: replace MOCK_ALERTS with:
  // const { data: alerts } = useQuery(['alerts', typeFilter, statusFilter, scoreFilter, timeFilter],
  //   () => fetch(`/api/alerts?typology=${typeFilter}&status=${statusFilter}&minScore=${parseScore()}&window=${timeFilter}`).then(r => r.json())
  // );
  // WebSocket: useWebSocket('alerts.generated', (event) => prependAlert(event.alert));

  const minScore = parseFloat(scoreFilter.split("≥ ")[1]) || 0;

  const filtered = MOCK_ALERTS
    .filter((a) => {
      if (typeFilter !== "ALL" && a.typology !== typeFilter) return false;
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (a.score < minScore) return false;
      if (
        search &&
        !a.account.toLowerCase().includes(search.toLowerCase()) &&
        !a.id.toLowerCase().includes(search.toLowerCase()) &&
        !a.branch.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) =>
      sortDir === "desc" ? b.score - a.score : a.score - b.score
    );

  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const exportCSV = () => {
    // BACKEND: GET /api/alerts/export?...same filters → download CSV
    const header = "ID,Score,Typology,Account,Amount,Branch,Time,Status,Assigned\n";
    const rows = filtered.map(a =>
      `${a.id},${a.score},${a.typology},${a.account},${a.amount},${a.branch},${a.time},${a.status},${a.assigned ?? ""}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "alerts.csv"; link.click();
  };

  const selStyle = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "rgba(255,255,255,0.7)",
    padding: "7px 12px",
    fontSize: 12,
    cursor: "pointer",
    outline: "none",
    appearance: "none" as const,
    WebkitAppearance: "none" as const,
    paddingRight: 28,
  };

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "white", margin: 0 }}>
          Alert Queue
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#22c55e",
              display: "inline-block",
              boxShadow: "0 0 6px #22c55e",
            }}
          />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: "monospace" }}>
            {filtered.length} active · sorted by AnomaScore
          </span>
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {/* Search */}
        <div style={{ position: "relative" }}>
          <Search
            size={13}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "rgba(255,255,255,0.3)",
            }}
          />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search account, PAN, branch…"
            style={{
              ...selStyle,
              paddingLeft: 30,
              paddingRight: 12,
              width: 220,
              fontFamily: "inherit",
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.3)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div style={{ position: "relative" }}>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as any); setPage(0); }} style={selStyle}>
            {ALL_TYPES.map((t) => <option key={t} value={t}>{t === "ALL" ? "All types" : t}</option>)}
          </select>
          <ChevronRight size={10} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%) rotate(90deg)", color:"rgba(255,255,255,0.3)", pointerEvents:"none" }} />
        </div>

        <div style={{ position: "relative" }}>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(0); }} style={selStyle}>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{s === "ALL" ? "All status" : s}</option>)}
          </select>
          <ChevronRight size={10} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%) rotate(90deg)", color:"rgba(255,255,255,0.3)", pointerEvents:"none" }} />
        </div>

        <div style={{ position: "relative" }}>
          <select value={scoreFilter} onChange={(e) => { setScoreFilter(e.target.value); setPage(0); }} style={selStyle}>
            {SCORE_THRESHOLDS.map((t) => <option key={t}>{t}</option>)}
          </select>
          <ChevronRight size={10} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%) rotate(90deg)", color:"rgba(255,255,255,0.3)", pointerEvents:"none" }} />
        </div>

        <div style={{ position: "relative" }}>
          <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)} style={selStyle}>
            {TIME_WINDOWS.map((t) => <option key={t}>{t}</option>)}
          </select>
          <ChevronRight size={10} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%) rotate(90deg)", color:"rgba(255,255,255,0.3)", pointerEvents:"none" }} />
        </div>

        <button
          onClick={exportCSV}
          style={{
            ...selStyle,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
          }}
        >
          <Download size={13} /> Export CSV
        </button>
      </div>

      {/* Feature badges */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["· TanStack Table · sortable columns", "· Multi-filter", "· Real-time WebSocket prepend"].map((b) => (
          <span
            key={b}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              padding: "3px 10px",
              fontSize: 10,
              color: "rgba(255,255,255,0.35)",
              fontFamily: "monospace",
            }}
          >
            {b}
          </span>
        ))}
      </div>

      {/* Table */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {[
                { label: "AnomaScore", sortable: true },
                { label: "Typology" },
                { label: "Account" },
                { label: "Amount" },
                { label: "Branch" },
                { label: "Time" },
                { label: "Status" },
                { label: "Assigned" },
                { label: "" },
              ].map((h) => (
                <th
                  key={h.label}
                  onClick={h.sortable ? () => setSortDir(sortDir === "desc" ? "asc" : "desc") : undefined}
                  style={{
                    padding: "12px 14px",
                    textAlign: "left",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    color: "rgba(255,255,255,0.35)",
                    fontFamily: "monospace",
                    cursor: h.sortable ? "pointer" : "default",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h.label}
                  {h.sortable && (
                    <span style={{ marginLeft: 4 }}>
                      {sortDir === "desc" ? "↓" : "↑"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((a) => {
              const typ = TYPOLOGY_CONFIG[a.typology];
              const sta = STATUS_CONFIG[a.status];
              return (
                <tr
                  key={a.id}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "background 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {/* Score pill */}
                  <td style={{ padding: "12px 14px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        background: scoreBg(a.score),
                        borderRadius: 6,
                        padding: "3px 10px",
                        fontFamily: "monospace",
                        fontWeight: 700,
                        fontSize: 13,
                        color: "white",
                        minWidth: 46,
                        textAlign: "center",
                      }}
                    >
                      {a.score.toFixed(2)}
                    </span>
                  </td>

                  {/* Typology */}
                  <td style={{ padding: "12px 14px" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: typ.bg,
                        borderRadius: 6,
                        padding: "3px 10px",
                        color: typ.color,
                        fontSize: 11,
                        fontWeight: 700,
                        fontFamily: "monospace",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span>{typ.icon}</span> {a.typology}
                    </span>
                  </td>

                  <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace" }}>{a.account}</td>
                  <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "monospace" }}>{a.amount}</td>
                  <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.45)", fontSize: 12, fontFamily: "monospace" }}>{a.branch}</td>
                  <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.45)", fontSize: 12, fontFamily: "monospace" }}>{a.time}</td>

                  {/* Status */}
                  <td style={{ padding: "12px 14px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        background: sta.bg,
                        color: sta.color,
                        borderRadius: 6,
                        padding: "3px 10px",
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: "monospace",
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.status}
                    </span>
                  </td>

                  <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.35)", fontSize: 12, fontFamily: "monospace" }}>
                    {a.assigned ?? "—"}
                  </td>

                  {/* Action */}
                  <td style={{ padding: "12px 14px" }}>
                    {a.status === "NEW" ? (
                      <button
                        onClick={() => onSelectAlert(a)}
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(96,165,250,0.4)",
                          borderRadius: 8,
                          color: "#60a5fa",
                          padding: "5px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                          fontFamily: "monospace",
                        }}
                      >
                        Investigate →
                      </button>
                    ) : (
                      <button
                        onClick={() => onSelectAlert(a)}
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 8,
                          color: "rgba(255,255,255,0.5)",
                          padding: "5px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "monospace",
                        }}
                      >
                        View
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {paged.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 32, textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 13, fontFamily: "monospace" }}>
                  No alerts match the current filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 14,
        }}
      >
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
          Showing {Math.min(paged.length, PAGE_SIZE)} of {filtered.length}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              color: page === 0 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.6)",
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: page === 0 ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "monospace",
            }}
          >
            <ChevronLeft size={13} /> Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              color: page >= totalPages - 1 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.6)",
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: page >= totalPages - 1 ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "monospace",
            }}
          >
            Next <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// ROOT: AlertsSection — orchestrates list ↔ detail routing
// ─────────────────────────────────────────────────────────────

const AlertsSection = () => {
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);

  if (selectedAlert) {
    return (
      <AlertDetail
        alert={selectedAlert}
        onBack={() => setSelectedAlert(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      
    

      {/* Full alert queue */}
      <AlertQueue onSelectAlert={setSelectedAlert} />
    </div>
  );
};

export default AlertsSection;