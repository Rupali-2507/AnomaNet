"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Download,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  UserPlus,
  FolderOpen,
  Search,
  X,
  RefreshCw,
} from "lucide-react";
import { useSession } from "@/lib/session-context";   
import { apiFetch, mlFetch } from "@/lib/api";
import { useAlertStream } from "../hooks/useAlertStream";

// ─────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────

const tc = (score: number) => {
  if (score >= 0.85) return "text-red-400";
  if (score >= 0.7)  return "text-orange-400";
  if (score >= 0.55) return "text-yellow-400";
  return "text-green-400";
};

const scoreBg = (score: number) => {
  if (score >= 0.85) return "bg-red-500";
  if (score >= 0.7)  return "bg-orange-500";
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
  <div className={`bg-white/[0.03] border border-white/[0.07] rounded-2xl ${className}`}>
    {children}
  </div>
);

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type AlertStatus   = "NEW" | "REVIEW" | "ESCALATED" | "CLOSED SAR";
type AlertTypology = "CIRCULAR" | "DORMANT" | "STRUCTURING" | "PROFILE" | "LAYERING";

interface Alert {
  id:             string;
  _backendId:     string;
  score:          number;
  typology:       AlertTypology;
  account:        string;
  amount:         string;
  amountRaw:      number;
  branch:         string;
  time:           string;
  status:         AlertStatus;
  assigned:       string | null;
  scoreBreakdown: ScoreBreakdown;
  detail?:        AlertDetail;
}

interface TxRow {
  time:    string;
  from:    string;
  to:      string;
  amount:  string;
  channel: string;
}

interface ScoreBreakdown {
  CIRCULAR:    number;
  LAYERING:    number;
  PROFILE:     number;
  STRUCTURING: number;
  DORMANCY:    number;
}

interface AlertDetail {
  graphLabel:     string;
  cycleLabel:     string;
  transactions:   TxRow[];
  scoreBreakdown: ScoreBreakdown;
  aiExplanation:  string;
  mlLog:          { time: string; tag: string; msg: string }[];
}

// Backend response shapes
interface BackendAlert {
  id:             string;
  anomaScore:     number;
  alertType:      string;
  accountId:      string;
  status:         string;
  createdAt:      string;
  scoreBreakdown: Record<string, number> | null;
}

interface BackendAlertsPage {
  content:       BackendAlert[];
  totalElements: number;
}

interface ExplainResponse {
  explanation: string;
  patterns?:   string[];
}

// ─────────────────────────────────────────────────────────────
// Backend → frontend mapping
// ─────────────────────────────────────────────────────────────

const TYPOLOGY_MAP: Record<string, AlertTypology> = {
  CIRCULAR:         "CIRCULAR",
  LAYERING:         "LAYERING",
  STRUCTURING:      "STRUCTURING",
  DORMANT:          "DORMANT",
  PROFILE_MISMATCH: "PROFILE",
  COMPOSITE:        "LAYERING",
};

const STATUS_MAP: Record<string, AlertStatus> = {
  NEW:          "NEW",
  UNDER_REVIEW: "REVIEW",
  ESCALATED:    "ESCALATED",
  REPORTED_FIU: "ESCALATED",
  CLOSED_SAR:   "CLOSED SAR",
  CLOSED_FP:    "CLOSED SAR",
};

function emptyBreakdown(): ScoreBreakdown {
  return { CIRCULAR: 0, LAYERING: 0, PROFILE: 0, STRUCTURING: 0, DORMANCY: 0 };
}

function mapBreakdown(raw: Record<string, number> | null): ScoreBreakdown {
  if (!raw) return emptyBreakdown();
  return {
    CIRCULAR:    raw.circular    ?? raw.CIRCULAR    ?? 0,
    LAYERING:    raw.layering    ?? raw.LAYERING    ?? 0,
    PROFILE:     raw.profile_mismatch ?? raw.PROFILE ?? 0,
    STRUCTURING: raw.structuring ?? raw.STRUCTURING ?? 0,
    DORMANCY:    raw.dormancy    ?? raw.DORMANCY    ?? 0,
  };
}

function mapBackendAlert(a: BackendAlert): Alert {
  return {
    id:             `ALT-${String(a.id).slice(0, 5).toUpperCase()}`,
    _backendId:     a.id,
    score:          a.anomaScore ?? 0,
    typology:       TYPOLOGY_MAP[a.alertType] ?? "LAYERING",
    account:        a.accountId ?? "—",
    amount:         "—",
    amountRaw:      0,
    branch:         "—",
    time:           new Date(a.createdAt).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }),
    status:         STATUS_MAP[a.status] ?? "NEW",
    assigned:       null,
    scoreBreakdown: mapBreakdown(a.scoreBreakdown),
  };
}

// ─────────────────────────────────────────────────────────────
// Typology / status config
// ─────────────────────────────────────────────────────────────

const TYPOLOGY_CONFIG: Record<AlertTypology, { color: string; bg: string; icon: string }> = {
  CIRCULAR:    { color: "#f87171", bg: "rgba(248,113,113,0.12)", icon: "◎" },
  DORMANT:     { color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  icon: "⇌" },
  STRUCTURING: { color: "#fb923c", bg: "rgba(251,146,60,0.12)",  icon: "↓" },
  PROFILE:     { color: "#a78bfa", bg: "rgba(167,139,250,0.12)", icon: "◈" },
  LAYERING:    { color: "#34d399", bg: "rgba(52,211,153,0.12)",  icon: "≡" },
};

const STATUS_CONFIG: Record<AlertStatus, { color: string; bg: string }> = {
  "NEW":        { color: "#f87171", bg: "rgba(248,113,113,0.15)" },
  "REVIEW":     { color: "#fbbf24", bg: "rgba(251,191,36,0.15)"  },
  "ESCALATED":  { color: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
  "CLOSED SAR": { color: "#34d399", bg: "rgba(52,211,153,0.15)"  },
};

// ─────────────────────────────────────────────────────────────
// Radar chart
// ─────────────────────────────────────────────────────────────

const RadarChart = ({ breakdown }: { breakdown: ScoreBreakdown }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labels    = Object.keys(breakdown) as (keyof ScoreBreakdown)[];
  const values    = labels.map((k) => breakdown[k]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R  = Math.min(cx, cy) - 30;
    const n  = labels.length;
    ctx.clearRect(0, 0, W, H);

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
      ctx.lineWidth = 1; ctx.stroke();
    });

    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1; ctx.stroke();
    }

    ctx.beginPath();
    values.forEach((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const x = cx + Math.cos(angle) * R * v;
      const y = cy + Math.sin(angle) * R * v;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(239,68,68,0.18)"; ctx.fill();
    ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.font = "bold 9px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    labels.forEach((label, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      ctx.fillText(label, cx + Math.cos(angle) * (R + 18), cy + Math.sin(angle) * (R + 18));
    });

    values.forEach((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const x = cx + Math.cos(angle) * R * v;
      const y = cy + Math.sin(angle) * R * v;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444"; ctx.fill();
      ctx.fillStyle = "#ef4444"; ctx.font = "bold 8px monospace";
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
// Score bar
// ─────────────────────────────────────────────────────────────

const SCORE_COLORS: Record<keyof ScoreBreakdown, string> = {
  CIRCULAR:    "#ef4444",
  LAYERING:    "#f59e0b",
  PROFILE:     "#a78bfa",
  STRUCTURING: "#22d3ee",
  DORMANCY:    "#34d399",
};

const ScoreBar = ({ label, value }: { label: keyof ScoreBreakdown; value: number }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
      <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.1em" }}>{label}</span>
      <span style={{ color: SCORE_COLORS[label], fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>{value.toFixed(2)}</span>
    </div>
    <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${value * 100}%`, background: SCORE_COLORS[label], borderRadius: 99, transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)" }} />
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// ML log line
// ─────────────────────────────────────────────────────────────

const TAG_COLORS: Record<string, string> = {
  GNN: "#60a5fa", CIRC: "#f87171", LAYER: "#f59e0b", SCORE: "#34d399",
  KAFKA: "#a78bfa", WS: "#22d3ee", DORM: "#60a5fa", PROF: "#a78bfa",
  STRUCT: "#fb923c", SAR: "#34d399",
};

const MlLogLine = ({ time, tag, msg }: { time: string; tag: string; msg: string }) => (
  <div style={{ display: "flex", gap: 10, fontFamily: "monospace", fontSize: 11, lineHeight: 1.6 }}>
    <span style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }}>{time}</span>
    <span style={{ color: TAG_COLORS[tag] ?? "#94a3b8", fontWeight: 700, flexShrink: 0, minWidth: 52 }}>{tag}</span>
    <span style={{ color: "rgba(255,255,255,0.55)" }}>{msg}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Alert detail view
// ─────────────────────────────────────────────────────────────

const AlertDetailView = ({ alert, onBack }: { alert: Alert; onBack: () => void }) => {
  const {  session } = useSession();

  const [detail,         setDetail]         = useState<AlertDetail | null>(null);
  const [loadingAI,      setLoadingAI]      = useState(true);
  const [actionError,    setActionError]    = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const typ = TYPOLOGY_CONFIG[alert.typology];

  // ── Fetch AI explanation ──────────────────────────────────────────────────
  useEffect(() => {
    setLoadingAI(true);

    // Try cached GET first, fall back to POST
    mlFetch<ExplainResponse>(`/ml/explain/${alert._backendId}`, session)
      .then((d: ExplainResponse) => {
        setDetail({
          graphLabel:     "Fund-flow subgraph — depth 3",
          cycleLabel:     d.patterns?.join(" · ") ?? alert.typology,
          transactions:   [],
          scoreBreakdown: alert.scoreBreakdown,
          aiExplanation:  d.explanation ?? "",
          mlLog:          [],
        });
      })
      .catch((_err: unknown) => {
        // Not cached — generate via POST
        mlFetch<ExplainResponse>("/ml/explain", session, {
          method: "POST",
          body: JSON.stringify({
            alert_id:        alert._backendId,
            score_breakdown: {
              circular:         alert.scoreBreakdown.CIRCULAR,
              layering:         alert.scoreBreakdown.LAYERING,
              profile_mismatch: alert.scoreBreakdown.PROFILE,
              structuring:      alert.scoreBreakdown.STRUCTURING,
              dormancy:         alert.scoreBreakdown.DORMANCY,
            },
          }),
        })
          .then((d: ExplainResponse) => {
            setDetail({
              graphLabel:     "Fund-flow subgraph — depth 3",
              cycleLabel:     (d.patterns ?? []).join(" · ") || alert.typology,
              transactions:   [],
              scoreBreakdown: alert.scoreBreakdown,
              aiExplanation:  d.explanation ?? "No explanation available.",
              mlLog:          [],
            });
          })
          .catch((_err2: unknown) => {
            setDetail({
              graphLabel:     "Fund-flow subgraph — depth 3",
              cycleLabel:     alert.typology,
              transactions:   [],
              scoreBreakdown: alert.scoreBreakdown,
              aiExplanation:  `Account ${alert.account} flagged with AnomaScore ${(alert.score * 100).toFixed(1)}%. Pattern: ${alert.typology}.`,
              mlLog:          [],
            });
          });
      })
      .finally(() => setLoadingAI(false));
  }, [alert._backendId]);

  // ── Update status ─────────────────────────────────────────────────────────
  const updateStatus = async (newStatus: string) => {
    setStatusUpdating(true);
    setActionError(null);
    try {
      await apiFetch(`/api/alerts/${alert._backendId}/status`, session, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setStatusUpdating(false);
    }
  };

  // ── Open case ─────────────────────────────────────────────────────────────
  const openCase = async () => {
    setActionError(null);
    try {
      await apiFetch("/api/cases", session, {
        method: "POST",
        body: JSON.stringify({ alertId: alert._backendId }),
      });
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  // ── Assign to me ──────────────────────────────────────────────────────────
  const assignMe = async () => {
    setActionError(null);
    try {
      await apiFetch(`/api/alerts/${alert._backendId}/status`, session, {
        method: "PUT",
        body: JSON.stringify({ status: "UNDER_REVIEW" }),
      });
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  return (
    <div style={{ color: "white" }}>
      {/* Header bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 13, padding: 0 }}>
            <ArrowLeft size={14} /> Alert Queue
          </button>
          <span style={{ color: "rgba(255,255,255,0.15)" }}>/</span>
          <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, fontWeight: 600 }}>
            {alert.id} · {alert.typology} · {alert.account}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            borderRadius: 6, padding: "4px 12px", fontFamily: "monospace", fontWeight: 700, fontSize: 14, color: "white",
            background: alert.score >= 0.85 ? "#ef4444" : alert.score >= 0.7 ? "#f97316" : alert.score >= 0.55 ? "#eab308" : "#22c55e",
          }}>
            {alert.score.toFixed(2)}
          </div>

          {actionError && <span style={{ fontSize: 11, color: "#f87171" }}>{actionError}</span>}

          <button onClick={openCase} disabled={statusUpdating} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "rgba(255,255,255,0.7)", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <FolderOpen size={13} /> Open Case
          </button>
          <button onClick={assignMe} disabled={statusUpdating} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "rgba(255,255,255,0.7)", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <UserPlus size={13} /> Assign Me
          </button>
          <button onClick={() => updateStatus("ESCALATED")} disabled={statusUpdating} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 8, color: "#a78bfa", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Escalate
          </button>
        </div>
      </div>

      {/* 2-column grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Graph placeholder */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20, minHeight: 360 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>
                {detail?.graphLabel ?? "Fund-flow subgraph — depth 3"}
              </span>
            </div>
            <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 10, height: 260, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed rgba(255,255,255,0.08)" }}>
              <MockGraphVisual typology={alert.typology} />
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: typ.color }}>◎</span>
              {detail?.cycleLabel ?? "Loading…"}
            </div>
          </div>

          {/* Transaction trail */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", marginBottom: 14, fontFamily: "monospace" }}>TRANSACTION TRAIL</p>
            {(!detail || detail.transactions.length === 0) ? (
              <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, fontFamily: "monospace", textAlign: "center", padding: "16px 0" }}>
                Connect <code>/api/alerts/{"{id}"}/transactions</code> to show trail
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Time","From","To","Amount","Channel"].map(h => (
                      <th key={h} style={{ textAlign: "left", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", paddingBottom: 8, fontFamily: "monospace", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.transactions.map((tx, i) => (
                    <tr key={i}>
                      {[tx.time, tx.from, tx.to, tx.amount, tx.channel].map((val, j) => (
                        <td key={j} style={{ padding: "9px 0", fontSize: 12, fontFamily: "monospace", color: j === 3 ? "#f87171" : j === 4 ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.75)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Score breakdown */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", marginBottom: 14, fontFamily: "monospace" }}>ANOMA SCORE BREAKDOWN</p>
            <RadarChart breakdown={alert.scoreBreakdown} />
            <div style={{ marginTop: 16 }}>
              {(Object.keys(alert.scoreBreakdown) as (keyof ScoreBreakdown)[]).map(k => (
                <ScoreBar key={k} label={k} value={alert.scoreBreakdown[k]} />
              ))}
            </div>
          </div>

          {/* AI explanation */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(167,139,250,0.7)", marginBottom: 10, fontFamily: "monospace" }}>AI EXPLANATION</p>
            {loadingAI ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.35)", fontSize: 13 }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid #3b82f6", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
                Generating explanation…
              </div>
            ) : (
              <p
                style={{ fontSize: 13, lineHeight: 1.7, color: "rgba(255,255,255,0.65)", margin: 0 }}
                dangerouslySetInnerHTML={{
                  __html: (detail?.aiExplanation ?? "").replace(
                    /([\d,.]+[LCr]+|\d+\.\d+ hours|\d+ accounts|first-time)/g,
                    '<strong style="color:white">$1</strong>'
                  ),
                }}
              />
            )}
            <div style={{ marginTop: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 6, padding: "3px 10px", fontSize: 10, color: "rgba(167,139,250,0.8)", fontFamily: "monospace", fontWeight: 600 }}>
                Template-based NLG · ML explain engine
              </span>
            </div>
          </div>

          {/* ML log */}
          <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 20, fontFamily: "monospace" }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", marginBottom: 12 }}>ML SCORING LOG · {alert.id}</p>
            {(!detail || detail.mlLog.length === 0) ? (
              <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, textAlign: "center", padding: "8px 0" }}>
                Connect <code>/api/alerts/{"{id}"}/ml-log</code> to show log
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {detail.mlLog.map((l, i) => <MlLogLine key={i} {...l} />)}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Mock graph visual
// ─────────────────────────────────────────────────────────────

const MockGraphVisual = ({ typology }: { typology: AlertTypology }) => {
  const color = TYPOLOGY_CONFIG[typology].color;
  if (typology === "CIRCULAR") {
    return (
      <svg width="300" height="220" viewBox="0 0 300 220">
        {[{ x: 150, y: 40, label: "ACC-8872", main: true }, { x: 60, y: 175, label: "ACC-9912", main: false }, { x: 240, y: 175, label: "ACC-3341", main: false }].map((n, i) => (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={n.main ? 28 : 20} fill="rgba(239,68,68,0.18)" stroke={color} strokeWidth={1.5} strokeDasharray={n.main ? "0" : "4 2"} />
            <text x={n.x} y={n.y - 2} textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace" fontWeight="bold">{n.label.split("-")[0]}</text>
            <text x={n.x} y={n.y + 9} textAnchor="middle" fill={color} fontSize="9" fontFamily="monospace" fontWeight="bold">-{n.label.split("-")[1]}</text>
          </g>
        ))}
        <defs><marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill={color} opacity="0.7" /></marker></defs>
        {[
          { x1:130,y1:60,x2:78,y2:155,label:"₹48.2L",lx:88,ly:108,t:"14:31:49" },
          { x1:82,y1:175,x2:218,y2:175,label:"₹47.9L",lx:150,ly:168,t:"14:31:52" },
          { x1:228,y1:158,x2:162,y2:62,label:"₹47.6L",lx:208,ly:108,t:"14:31:55" },
        ].map((e, i) => (
          <g key={i}>
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={color} strokeWidth={1.5} strokeOpacity={0.6} strokeDasharray="6 3" markerEnd="url(#arr)" />
            <text x={e.lx} y={e.ly} textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace" opacity="0.9">{e.label}</text>
            <text x={e.lx} y={e.ly + 10} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="monospace">{e.t}</text>
          </g>
        ))}
        {[{x:40,y:50},{x:260,y:50},{x:150,y:205}].map((n,i) => (
          <circle key={i} cx={n.x} cy={n.y} r={8} fill="rgba(34,197,94,0.1)" stroke="#22c55e" strokeWidth={1} />
        ))}
      </svg>
    );
  }
  return (
    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 12, fontFamily: "monospace" }}>
      <div style={{ fontSize: 32, marginBottom: 8, color }}>{TYPOLOGY_CONFIG[typology].icon}</div>
      Graph renders here via FraudGraph3D<br />
      <span style={{ fontSize: 10 }}>(connect /ml/graph/subgraph)</span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Alert queue
// ─────────────────────────────────────────────────────────────

const SCORE_THRESHOLDS = ["Score ≥ 0.50", "Score ≥ 0.65", "Score ≥ 0.75", "Score ≥ 0.85"];
const TIME_WINDOWS     = ["Last 1h", "Last 6h", "Last 24h", "Last 7d"];
const ALL_TYPES:    ("ALL" | AlertTypology)[] = ["ALL", "CIRCULAR", "DORMANT", "STRUCTURING", "PROFILE", "LAYERING"];
const ALL_STATUSES: ("ALL" | AlertStatus)[]   = ["ALL", "NEW", "REVIEW", "ESCALATED", "CLOSED SAR"];
const PAGE_SIZE = 6;

const AlertQueue = ({ onSelectAlert }: { onSelectAlert: (a: Alert) => void }) => {
  const {  session } = useSession();

  const [alerts,       setAlerts]       = useState<Alert[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [totalItems,   setTotalItems]   = useState(0);
  const [search,       setSearch]       = useState("");
  const [typeFilter,   setTypeFilter]   = useState<"ALL" | AlertTypology>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | AlertStatus>("ALL");
  const [scoreFilter,  setScoreFilter]  = useState("Score ≥ 0.65");
  const [timeFilter,   setTimeFilter]   = useState("Last 24h");
  const [page,         setPage]         = useState(0);
  const [sortDir,      setSortDir]      = useState<"desc" | "asc">("desc");

  // ── Fetch alerts ──────────────────────────────────────────────────────────
  const fetchAlerts = useCallback(() => {
    setLoading(true);
    apiFetch<BackendAlertsPage>(`/api/alerts?page=${page}&size=${PAGE_SIZE}`, session)
      .then((data: BackendAlertsPage) => {
        setAlerts((data.content ?? []).map(mapBackendAlert));
        setTotalItems(data.totalElements ?? 0);
      })
      .catch((_err: unknown) => console.error(_err))
      .finally(() => setLoading(false));
  }, [page, session]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  // ── WebSocket: prepend live alerts ───────────────────────────────────────
  useAlertStream((raw: BackendAlert) => {
    setAlerts(prev => [mapBackendAlert(raw), ...prev]);
    setTotalItems(t => t + 1);
  });

  // ── Client-side filter ────────────────────────────────────────────────────
  const minScore = parseFloat(scoreFilter.split("≥ ")[1]) || 0;
  const filtered = alerts
    .filter((a) => {
      if (typeFilter   !== "ALL" && a.typology !== typeFilter)   return false;
      if (statusFilter !== "ALL" && a.status   !== statusFilter) return false;
      if (a.score < minScore) return false;
      if (search && !a.account.toLowerCase().includes(search.toLowerCase()) &&
                    !a.id.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => sortDir === "desc" ? b.score - a.score : a.score - b.score);

  const totalPages = Math.ceil(totalItems / PAGE_SIZE);

  const exportCSV = () => {
    const header = "ID,Score,Typology,Account,Amount,Branch,Time,Status,Assigned\n";
    const rows   = filtered.map(a =>
      `${a.id},${a.score},${a.typology},${a.account},${a.amount},${a.branch},${a.time},${a.status},${a.assigned ?? ""}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "white", margin: 0 }}>Alert Queue</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 6px #22c55e" }} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: "monospace" }}>
            {totalItems} total · sorted by AnomaScore
          </span>
          <button onClick={fetchAlerts} title="Refresh" style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 4 }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search account, ID…"
            style={{ ...selStyle, paddingLeft: 30, paddingRight: 12, width: 220, fontFamily: "inherit" }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 0 }}>
              <X size={12} />
            </button>
          )}
        </div>

        <div style={{ position: "relative" }}>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as "ALL" | AlertTypology); setPage(0); }} style={selStyle}>
            {ALL_TYPES.map(t => <option key={t} value={t}>{t === "ALL" ? "All types" : t}</option>)}
          </select>
          <ChevronRight size={10} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%) rotate(90deg)", color:"rgba(255,255,255,0.3)", pointerEvents:"none" }} />
        </div>

        <div style={{ position: "relative" }}>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as "ALL" | AlertStatus); setPage(0); }} style={selStyle}>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s === "ALL" ? "All status" : s}</option>)}
          </select>
          <ChevronRight size={10} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%) rotate(90deg)", color:"rgba(255,255,255,0.3)", pointerEvents:"none" }} />
        </div>

        <div style={{ position: "relative" }}>
          <select value={scoreFilter} onChange={(e) => { setScoreFilter(e.target.value); setPage(0); }} style={selStyle}>
            {SCORE_THRESHOLDS.map(t => <option key={t}>{t}</option>)}
          </select>
          <ChevronRight size={10} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%) rotate(90deg)", color:"rgba(255,255,255,0.3)", pointerEvents:"none" }} />
        </div>

        <div style={{ position: "relative" }}>
          <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)} style={selStyle}>
            {TIME_WINDOWS.map(t => <option key={t}>{t}</option>)}
          </select>
          <ChevronRight size={10} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%) rotate(90deg)", color:"rgba(255,255,255,0.3)", pointerEvents:"none" }} />
        </div>

        <button onClick={exportCSV} style={{ ...selStyle, display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
          <Download size={13} /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {[
                { label: "AnomaScore", sortable: true },
                { label: "Typology" }, { label: "Account" }, { label: "Amount" },
                { label: "Branch" },   { label: "Time" },    { label: "Status" },
                { label: "Assigned" }, { label: "" },
              ].map(h => (
                <th
                  key={h.label}
                  onClick={h.sortable ? () => setSortDir(sortDir === "desc" ? "asc" : "desc") : undefined}
                  style={{ padding: "12px 14px", textAlign: "left", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontFamily: "monospace", cursor: h.sortable ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}
                >
                  {h.label}{h.sortable && <span style={{ marginLeft: 4 }}>{sortDir === "desc" ? "↓" : "↑"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} style={{ padding: "12px 14px" }}>
                      <div style={{ height: 14, background: "rgba(255,255,255,0.06)", borderRadius: 4 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: 32, textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 13, fontFamily: "monospace" }}>
                  No alerts match filters
                </td>
              </tr>
            ) : (
              filtered.map((a) => {
                const typ = TYPOLOGY_CONFIG[a.typology];
                const sta = STATUS_CONFIG[a.status];
                return (
                  <tr
                    key={a.id}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "background 0.15s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ display: "inline-block", background: a.score >= 0.85 ? "#ef4444" : a.score >= 0.7 ? "#f97316" : a.score >= 0.55 ? "#eab308" : "#22c55e", borderRadius: 6, padding: "3px 10px", fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "white", minWidth: 46, textAlign: "center" }}>
                        {a.score.toFixed(2)}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: typ.bg, borderRadius: 6, padding: "3px 10px", color: typ.color, fontSize: 11, fontWeight: 700, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                        <span>{typ.icon}</span> {a.typology}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.8)",  fontSize: 13, fontFamily: "monospace" }}>{a.account}</td>
                    <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.6)",  fontSize: 13, fontFamily: "monospace" }}>{a.amount}</td>
                    <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.45)", fontSize: 12, fontFamily: "monospace" }}>{a.branch}</td>
                    <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.45)", fontSize: 12, fontFamily: "monospace" }}>{a.time}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ display: "inline-block", background: sta.bg, color: sta.color, borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                        {a.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.35)", fontSize: 12, fontFamily: "monospace" }}>{a.assigned ?? "—"}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <button
                        onClick={() => onSelectAlert(a)}
                        style={{ background: "transparent", border: `1px solid ${a.status === "NEW" ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.12)"}`, borderRadius: 8, color: a.status === "NEW" ? "#60a5fa" : "rgba(255,255,255,0.5)", padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "monospace" }}
                      >
                        {a.status === "NEW" ? "Investigate →" : "View"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
          Page {page + 1} of {totalPages || 1} · {totalItems} total
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: page === 0 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.6)", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: page === 0 ? "default" : "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "monospace" }}
          >
            <ChevronLeft size={13} /> Prev
          </button>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: page >= totalPages - 1 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.6)", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: page >= totalPages - 1 ? "default" : "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "monospace" }}
          >
            Next <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────

const AlertsSection = () => {
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);

  if (selectedAlert) {
    return <AlertDetailView alert={selectedAlert} onBack={() => setSelectedAlert(null)} />;
  }

  return (
    <div className="space-y-6">
      <AlertQueue onSelectAlert={setSelectedAlert} />
    </div>
  );
};

export default AlertsSection;