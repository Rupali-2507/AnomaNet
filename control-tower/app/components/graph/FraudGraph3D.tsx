"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import NodeInspector from "./NodeInspector";

// 3d-force-graph ships CommonJS with incomplete TS types for the chained
// imperative API. We import it as `any` to avoid spurious TS errors while
// keeping full runtime behaviour.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FG3DInstance = any;

// Lazy-import so Next.js SSR never tries to execute the WebGL code on the server.
let _ForceGraph3DFactory: ((...args: unknown[]) => FG3DInstance) | null = null;
function getForceGraph3D() {
  if (!_ForceGraph3DFactory) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const mod = require("3d-force-graph");
    _ForceGraph3DFactory = mod.default ?? mod;
  }
  return _ForceGraph3DFactory!;
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string | number;
  is_anomalous: boolean;
  anomalyScore?: number;
  patterns?: string[];      // e.g. ["CIRCULAR", "LAYERING"]
  cycle_path?: string[];    // node ids forming the cycle
  kyc_risk_tier?: string;   // "HIGH" | "MEDIUM" | "LOW"
  is_dormant?: boolean;
  volume?: number;
  // injected by 3d-force-graph at runtime
  x?: number;
  y?: number;
  z?: number;
}

interface GraphLink {
  source: string | number | GraphNode;
  target: string | number | GraphNode;
  amount?: number;
  channel?: string;
  timestamp?: string;
}

interface RawGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface FocusData {
  neighborSet: Set<string | number>;
}

interface FraudGraph3DProps {
  onNodeSelect: (node: GraphNode | null) => void;
  selectedNode: GraphNode | null;
  alertedNodeId?: string | number | null;
  initialAccountId?: string;           // drives flagged-accounts dropdown
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const resolveId = (ref: string | number | GraphNode): string | number =>
  typeof ref === "object" && ref !== null ? ref.id : ref;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const scoreToColor = (score: number): string => {
  if (score > 0.7) return "#ef4444";  // red   – high risk
  if (score > 0.4) return "#f59e0b";  // amber – suspicious
  return "#22c55e";                    // green – normal
};

const LegendDot = ({ color, label }: { color: string; label: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
    <div
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
    <span style={{ color: "#cbd5e1", fontSize: 11 }}>{label}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

const FraudGraph3D: React.FC<FraudGraph3DProps> = ({
  onNodeSelect,
  selectedNode,
  alertedNodeId,
  initialAccountId,
}) => {
  // ── state ──
  const [rawGraph, setRawGraph] = useState<RawGraph>({ nodes: [], links: [] });
  const [depth, setDepth] = useState(3);
  const [activeNodeId, setActiveNodeId] = useState<string | number | null>(
    alertedNodeId ?? null
  );
  const [flaggedAccounts, setFlaggedAccounts] = useState<
    { id: string; score: number; kyc_tier: string }[]
  >([]);
  const [selectedAccount, setSelectedAccount] = useState<string>(
    initialAccountId ?? ""
  );
  const [showLabels, setShowLabels] = useState(false);
  const [loading, setLoading] = useState(false);

  const graphRef = useRef<FG3DInstance>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── load flagged accounts on mount ──
  useEffect(() => {
    fetch(`${API_BASE}/api/graph/flagged-accounts`)
      .then((r) => r.json())
      .then((d) => {
        setFlaggedAccounts(d.accounts ?? []);
        if (!selectedAccount && d.accounts?.length) {
          setSelectedAccount(String(d.accounts[0].id));
        }
      })
      .catch(console.error);
  }, []);

  // ── load graph when account or depth changes ──
  const loadGraph = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/graph/scored-subgraph?accountId=${selectedAccount}&depth=${depth}`
      );
      const data = await res.json();

      let nodes: GraphNode[] = data.nodes.map(
        (n: any): GraphNode => ({
          id: n.id,
          is_anomalous: n.is_flagged || n.anoma_score > 0.5,
          anomalyScore: n.anoma_score,
          patterns: n.patterns ?? [],
          cycle_path: n.cycle_path ?? [],
          kyc_risk_tier: n.kyc_risk_tier ?? "LOW",
          is_dormant: n.is_dormant ?? false,
          volume: undefined,
        })
      );

      let links: GraphLink[] = data.edges
        .filter((l: any) => l.source && l.target)
        .map((l: any) => ({
          source: String(l.source),
          target: String(l.target),
          amount: l.amount ?? 0,
          channel: l.channel ?? "",
          timestamp: l.timestamp ?? "",
        }));

      // ── 500-node performance cap ──
      if (nodes.length > 500) {
        const keepIds = new Set<string | number>(
          nodes.filter((n) => n.is_anomalous).map((n) => n.id)
        );
        links.forEach((l) => {
          const src = resolveId(l.source);
          const tgt = resolveId(l.target);
          if (keepIds.has(src)) keepIds.add(tgt);
          if (keepIds.has(tgt)) keepIds.add(src);
        });
        if (keepIds.size > 500) {
          nodes
            .sort((a, b) => (b.anomalyScore ?? 0) - (a.anomalyScore ?? 0))
            .slice(0, 500)
            .forEach((n) => keepIds.add(n.id));
        }
        nodes = nodes.filter((n) => keepIds.has(n.id));
        links = links.filter(
          (l) =>
            keepIds.has(resolveId(l.source)) &&
            keepIds.has(resolveId(l.target))
        );
      }

      setRawGraph({ nodes, links });
    } catch (err) {
      console.error("loadGraph error:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, depth]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // ── derived visible graph (no extra filter needed – raw IS visible) ──
  const visibleGraph = rawGraph;

  // ── focusData: neighborSet + cycle path awareness ──
  const focusData = useMemo((): FocusData => {
    const neighborSet = new Set<string | number>();
    if (activeNodeId) {
      visibleGraph.links.forEach((l) => {
        const src = resolveId(l.source);
        const tgt = resolveId(l.target);
        if (src === activeNodeId) neighborSet.add(tgt);
        if (tgt === activeNodeId) neighborSet.add(src);
      });
      neighborSet.add(activeNodeId);

      // cycle path awareness – light up all nodes in the cycle
      const activeNode = visibleGraph.nodes.find(
        (n) => n.id === activeNodeId
      );
      if (activeNode?.cycle_path?.length) {
        activeNode.cycle_path.forEach((id) => neighborSet.add(id));
      }
    }
    return { neighborSet };
  }, [activeNodeId, visibleGraph]);

  // ── mount ForceGraph3D ──
  useEffect(() => {
    if (!containerRef.current) return;

    // ForceGraph3DLib is a CJS factory: call it to get the constructor,
    // then call the constructor with the DOM element.
    const GraphFactory = getForceGraph3D();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Graph: FG3DInstance = GraphFactory()(containerRef.current)
      .backgroundColor("#060c18")
      .width(containerRef.current.offsetWidth)
      .height(containerRef.current.offsetHeight)
      // ── node rendering ──
      .nodeThreeObject((node: any) => buildNodeObject(node as GraphNode))
      .nodeLabel((node: any) => getNodeLabel(node as GraphNode))
      // ── link rendering ──
      .linkColor((link: any) =>
        (link.amount ?? 0) > 500000 ? "#ef4444" : "#475569"
      )
      .linkWidth((link: any) =>
        Math.max(0.3, Math.log10(((link.amount ?? 1000) / 1000) + 1) * 0.5)
      )
      .linkDirectionalArrowLength(4)
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor((link: any) =>
        (link.amount ?? 0) > 500000 ? "#ef4444" : "#60a5fa"
      )
      .linkDirectionalParticles((link: any) =>
        (link.amount ?? 0) > 200000 ? 3 : 1
      )
      .linkDirectionalParticleSpeed(0.004)
      .linkDirectionalParticleColor((link: any) =>
        (link.amount ?? 0) > 500000 ? "#ef4444" : "#94a3b8"
      )
      // ── interaction ──
      .onNodeClick((node: any) => {
        const gNode = node as GraphNode;
        setActiveNodeId(gNode.id);
        onNodeSelect(gNode);
      })
      .onBackgroundClick(() => {
        setActiveNodeId(null);
        onNodeSelect(null);
      })
      .graphData({ nodes: visibleGraph.nodes, links: visibleGraph.links });

    graphRef.current = Graph;

    // resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        Graph.width(containerRef.current.offsetWidth).height(
          containerRef.current.offsetHeight
        );
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      Graph._destructor?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── sync graph data when it changes ──
  useEffect(() => {
    graphRef.current?.graphData({
      nodes: visibleGraph.nodes,
      links: visibleGraph.links,
    });
  }, [visibleGraph]);

  // ── re-render nodes when focus changes ──
  useEffect(() => {
    graphRef.current?.nodeThreeObject(
      (node: any) => buildNodeObject(node as GraphNode)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodeId, focusData]);

  // ── toggle labels ──
  useEffect(() => {
    graphRef.current?.nodeLabel(
      showLabels ? (node: any) => String((node as GraphNode).id) : (node: any) => getNodeLabel(node as GraphNode)
    );
  }, [showLabels]);

  // ─────────────────────────────────────────────────────────────
  // buildNodeObject
  // ─────────────────────────────────────────────────────────────
  const buildNodeObject = (node: GraphNode): THREE.Group => {
    const isSelected = node.id === activeNodeId;
    const isNeighbor = focusData.neighborSet.has(node.id);
    const isCircular = node.patterns?.includes("CIRCULAR");
    const isLayering = node.patterns?.includes("LAYERING");

    const score = node.anomalyScore ?? 0;
    const baseColor = scoreToColor(score);

    let opacity = 1;
    if (activeNodeId) {
      opacity = isSelected || isNeighbor ? 1 : 0.08;
    }

    const radius = 2 + score * 4;
    const group = new THREE.Group();

    // Core sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 24),
      new THREE.MeshStandardMaterial({
        color: baseColor,
        transparent: true,
        opacity,
        emissive: baseColor,
        emissiveIntensity: isSelected ? 0.6 : 0.2,
      })
    );
    group.add(sphere);

    // CIRCULAR pattern → red pulsing torus ring
    if (isCircular) {
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(radius + 3, 0.6, 8, 32),
        new THREE.MeshBasicMaterial({
          color: "#ef4444",
          transparent: true,
          opacity: 0.85,
        })
      );
      group.add(torus);
    }

    // LAYERING pattern → outer wireframe sphere (fan-out visual)
    if (isLayering) {
      const wire = new THREE.Mesh(
        new THREE.SphereGeometry(radius + 4, 8, 8),
        new THREE.MeshBasicMaterial({
          color: "#f59e0b",
          wireframe: true,
          transparent: true,
          opacity: 0.4,
        })
      );
      group.add(wire);
    }

    // Selected → blue wireframe border
    if (isSelected) {
      const border = new THREE.Mesh(
        new THREE.SphereGeometry(radius + 5, 32, 32),
        new THREE.MeshBasicMaterial({
          color: "#3b82f6",
          wireframe: true,
          transparent: true,
          opacity: 0.6,
        })
      );
      group.add(border);
    }

    return group;
  };

  // ─────────────────────────────────────────────────────────────
  // getNodeLabel
  // ─────────────────────────────────────────────────────────────
  const getNodeLabel = (node: GraphNode): string => {
    const score = node.anomalyScore ?? 0;
    const scoreColor = scoreToColor(score);
    const patterns = (node.patterns ?? []).join(", ") || "None";
    return `
      <div style="
        background: rgba(10,15,25,0.97);
        padding: 10px 14px;
        border-radius: 8px;
        border: 1px solid ${node.is_anomalous ? "#ef4444" : "#22c55e"};
        font-size: 12px;
        color: white;
        min-width: 180px;
        font-family: monospace;
      ">
        <div style="font-weight:600; margin-bottom:6px;">Account ${node.id}</div>
        <div style="color:${scoreColor}; margin-bottom:4px;">
          AnomaScore: ${(score * 100).toFixed(1)}%
        </div>
        <div style="color:#94a3b8; margin-bottom:2px;">Pattern: ${patterns}</div>
        <div style="color:#94a3b8; margin-bottom:2px;">KYC: ${node.kyc_risk_tier ?? "LOW"}</div>
        <div style="color:#94a3b8;">Dormant: ${node.is_dormant ? "Yes" : "No"}</div>
      </div>
    `;
  };

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", background: "#060c18" }}>
      {/* ── Controls bar ── */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 10,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {/* Flagged accounts dropdown */}
        <select
          value={selectedAccount}
          onChange={(e) => setSelectedAccount(e.target.value)}
          style={{
            background: "#0f172a",
            color: "#e2e8f0",
            border: "1px solid #334155",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {flaggedAccounts.length === 0 && (
            <option value="">No flagged accounts</option>
          )}
          {flaggedAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} — {(a.score * 100).toFixed(0)}% [{a.kyc_tier}]
            </option>
          ))}
        </select>

        {/* Depth selector */}
        <div style={{ display: "flex", gap: 4 }}>
          {[1, 2, 3, 4].map((d) => (
            <button
              key={d}
              onClick={() => setDepth(d)}
              style={{
                background: depth === d ? "#3b82f6" : "#1e293b",
                color: "#e2e8f0",
                border: "1px solid #334155",
                borderRadius: 4,
                padding: "5px 10px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {d}
            </button>
          ))}
        </div>

        {/* Reset camera */}
        <button
          onClick={() =>
            graphRef.current?.cameraPosition({ x: 0, y: 0, z: 400 }, undefined, 800)
          }
          style={{
            background: "#1e293b",
            color: "#e2e8f0",
            border: "1px solid #334155",
            borderRadius: 4,
            padding: "5px 10px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Reset camera
        </button>

        {/* Toggle labels */}
        <button
          onClick={() => setShowLabels((v) => !v)}
          style={{
            background: showLabels ? "#334155" : "#1e293b",
            color: "#e2e8f0",
            border: "1px solid #334155",
            borderRadius: 4,
            padding: "5px 10px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {showLabels ? "Hide labels" : "Show labels"}
        </button>

        {loading && (
          <span style={{ color: "#60a5fa", fontSize: 13 }}>Loading…</span>
        )}
      </div>

      {/* ── 3-D canvas ── */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* ── Legend ── */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: 16,
          background: "rgba(10,15,25,0.85)",
          borderRadius: 8,
          padding: "12px 16px",
          border: "1px solid #1e293b",
          zIndex: 10,
        }}
      >
        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 8, fontWeight: 600 }}>
          LEGEND
        </div>
        <LegendDot color="#ef4444" label="High risk (score > 0.7)" />
        <LegendDot color="#f59e0b" label="Suspicious (score 0.4–0.7)" />
        <LegendDot color="#22c55e" label="Normal (score < 0.4)" />
        <LegendDot color="#ef4444" label="◯ Circular pattern (torus ring)" />
        <LegendDot color="#f59e0b" label="⬡ Layering pattern (wireframe)" />
        <LegendDot color="#3b82f6" label="● Selected node" />
      </div>

      {/* ── Stats ── */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          right: selectedNode ? 380 : 16,
          background: "rgba(10,15,25,0.85)",
          borderRadius: 8,
          padding: "8px 12px",
          border: "1px solid #1e293b",
          zIndex: 10,
          fontSize: 12,
          color: "#64748b",
        }}
      >
        {visibleGraph.nodes.length} nodes · {visibleGraph.links.length} edges
      </div>
    </div>
  );
};

export default FraudGraph3D;