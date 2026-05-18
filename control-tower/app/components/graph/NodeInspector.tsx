"use client";

import React, { useCallback, useEffect, useState } from "react";
import { GraphNode } from "./FraudGraph3D";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const ML_BASE =
  process.env.NEXT_PUBLIC_ML_URL ?? "http://localhost:8000";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface NodeInspectorProps {
  node: GraphNode | null;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const scoreColor = (score: number): string => {
  if (score > 0.7) return "#ef4444";
  if (score > 0.4) return "#f59e0b";
  return "#22c55e";
};

const Badge = ({
  label,
  color,
}: {
  label: string;
  color: string;
}) => (
  <span
    style={{
      background: color + "22",
      border: `1px solid ${color}`,
      color,
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 600,
      marginRight: 4,
    }}
  >
    {label}
  </span>
);

const Row = ({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
}) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "7px 0",
      borderBottom: "1px solid #1e293b",
    }}
  >
    <span style={{ color: "#64748b", fontSize: 12 }}>{label}</span>
    <span style={{ color: valueColor ?? "#e2e8f0", fontSize: 12, fontWeight: 500 }}>
      {value}
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

const NodeInspector: React.FC<NodeInspectorProps> = ({ node, onClose }) => {
  const [aiText, setAiText] = useState<string>("");
  const [loadingAI, setLoadingAI] = useState(false);

  // ── fetch AI explanation whenever selected node changes ──
  const generateAIExplanation = useCallback(async () => {
    if (!node) return;
    setLoadingAI(true);
    setAiText("");

    try {
      // Step 1: get the scored subgraph to extract score_breakdown
      const graphRes = await fetch(
        `${API_BASE}/api/graph/scored-subgraph?accountId=${node.id}&depth=1`
      );
      const graphData = await graphRes.json();
      const flaggedNode = (graphData.nodes ?? []).find(
        (n: any) => String(n.id) === String(node.id)
      );
      const scoreBreakdown = flaggedNode?.score_breakdown ?? {};

      // Step 2: call Rupali's explanation endpoint
      const explainRes = await fetch(`${ML_BASE}/ml/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alert_id: `GRAPH-${node.id}`,
          score_breakdown: scoreBreakdown,
        }),
      });
      const explainData = await explainRes.json();
      setAiText(
        explainData.explanation ??
          `Account ${node.id} flagged with AnomaScore ${(
            (node.anomalyScore ?? 0) * 100
          ).toFixed(1)}%.`
      );
    } catch {
      // Graceful fallback — still shows something useful
      const score = (node.anomalyScore ?? 0) * 100;
      const patterns = (node.patterns ?? []).join(" + ") || "unclassified";
      setAiText(
        `Account ${node.id} flagged with AnomaScore ${score.toFixed(
          1
        )}%. ` +
          `Detected pattern(s): ${patterns}. ` +
          (node.kyc_risk_tier === "HIGH"
            ? "KYC tier is HIGH — elevated due-diligence required."
            : `KYC tier: ${node.kyc_risk_tier ?? "LOW"}.`) +
          (node.is_dormant
            ? " Account was previously dormant and recently reactivated."
            : "")
      );
    } finally {
      setLoadingAI(false);
    }
  }, [node]);

  useEffect(() => {
    if (node) generateAIExplanation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  if (!node) return null;

  const score = node.anomalyScore ?? 0;
  const patterns = node.patterns ?? [];
  const kycTier = node.kyc_risk_tier ?? "LOW";

  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        top: 16,
        bottom: 16,
        width: 340,
        background: "rgba(8,12,22,0.96)",
        border: "1px solid #1e293b",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 20,
        backdropFilter: "blur(12px)",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 16px",
          borderBottom: "1px solid #1e293b",
        }}
      >
        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 2 }}>
            ACCOUNT
          </div>
          <div
            style={{
              color: "#e2e8f0",
              fontSize: 15,
              fontWeight: 700,
              fontFamily: "monospace",
            }}
          >
            {node.id}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#475569",
            cursor: "pointer",
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* ── Score pill ── */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #1e293b" }}>
        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 8 }}>
          ANOMASCORE
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* bar */}
          <div
            style={{
              flex: 1,
              height: 6,
              background: "#1e293b",
              borderRadius: 99,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${score * 100}%`,
                background: scoreColor(score),
                borderRadius: 99,
                transition: "width 0.4s ease",
              }}
            />
          </div>
          <span
            style={{
              color: scoreColor(score),
              fontSize: 18,
              fontWeight: 700,
              minWidth: 44,
              textAlign: "right",
            }}
          >
            {(score * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* ── Details ── */}
      <div style={{ padding: "0 16px" }}>
        <Row
          label="Pattern"
          value={
            patterns.length ? (
              <>
                {patterns.map((p) => (
                  <Badge
                    key={p}
                    label={p}
                    color={p === "CIRCULAR" ? "#ef4444" : "#f59e0b"}
                  />
                ))}
              </>
            ) : (
              <span style={{ color: "#475569" }}>None</span>
            )
          }
        />
        <Row
          label="KYC Tier"
          value={kycTier}
          valueColor={
            kycTier === "HIGH"
              ? "#ef4444"
              : kycTier === "MEDIUM"
              ? "#f59e0b"
              : "#22c55e"
          }
        />
        <Row
          label="Dormant"
          value={node.is_dormant ? "Yes" : "No"}
          valueColor={node.is_dormant ? "#f59e0b" : "#22c55e"}
        />
        {node.cycle_path?.length ? (
          <Row
            label="Cycle length"
            value={`${node.cycle_path.length} nodes`}
            valueColor="#ef4444"
          />
        ) : null}
      </div>

      {/* ── AI Explanation ── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 16px",
          borderTop: "1px solid #1e293b",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            color: "#64748b",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span>AI EXPLANATION</span>
          {loadingAI && (
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: "2px solid #3b82f6",
                borderTopColor: "transparent",
                animation: "spin 0.8s linear infinite",
              }}
            />
          )}
        </div>
        {loadingAI ? (
          <div style={{ color: "#475569", fontSize: 13 }}>
            Generating explanation…
          </div>
        ) : (
          <p style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.65, margin: 0 }}>
            {aiText || "No explanation available."}
          </p>
        )}
      </div>

      {/* ── Actions ── */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid #1e293b",
          display: "flex",
          gap: 8,
        }}
      >
        <a
          href={`/alerts?accountId=${node.id}`}
          style={{
            flex: 1,
            textAlign: "center",
            padding: "8px",
            borderRadius: 6,
            background: "#1e293b",
            color: "#60a5fa",
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
            border: "1px solid #334155",
          }}
        >
          View Alert →
        </a>
        <a
          href={`/cases/create?alertId=GRAPH-${node.id}`}
          style={{
            flex: 1,
            textAlign: "center",
            padding: "8px",
            borderRadius: 6,
            background: "#ef44441a",
            color: "#ef4444",
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
            border: "1px solid #ef444444",
          }}
        >
          Open Case →
        </a>
      </div>

      {/* spin keyframes */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default NodeInspector;