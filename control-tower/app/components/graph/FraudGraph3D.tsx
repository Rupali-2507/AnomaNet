"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/session-context";
import * as THREE from "three";
import NodeInspector from "./NodeInspector";

type FG3DInstance = any;

let _ForceGraph3DFactory: ((...args: unknown[]) => FG3DInstance) | null = null;
function getForceGraph3D() {
  if (!_ForceGraph3DFactory) {
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
  patterns?: string[];
  cycle_path?: string[];
  kyc_risk_tier?: string;
  is_dormant?: boolean;
  volume?: number;
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
  initialAccountId?: string;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const NODE_RENDER_CAP = 200;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 800;

const resolveId = (ref: string | number | GraphNode): string | number =>
  typeof ref === "object" && ref !== null ? ref.id : ref;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const scoreToColor = (score: number): string => {
  if (score > 0.7) return "#ef4444";
  if (score > 0.4) return "#f59e0b";
  return "#22c55e";
};

// Retry helper for Neo4j routing failures
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
  backoff = RETRY_BACKOFF_MS
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      // Don't retry 4xx — only retry 5xx (server/db errors)
      if (res.status >= 400 && res.status < 500) return res;
      if (attempt < retries - 1) {
        console.warn(`Fetch attempt ${attempt + 1} failed (HTTP ${res.status}), retrying in ${backoff}ms…`);
        await new Promise((r) => setTimeout(r, backoff * Math.pow(2, attempt)));
      } else {
        return res;
      }
    } catch (err) {
      if (attempt < retries - 1) {
        console.warn(`Fetch attempt ${attempt + 1} threw, retrying in ${backoff}ms…`, err);
        await new Promise((r) => setTimeout(r, backoff * Math.pow(2, attempt)));
      } else {
        throw err;
      }
    }
  }
  throw new Error("fetchWithRetry exhausted");
}

const LegendDot = ({ color, label }: { color: string; label: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
    <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
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
  const { session } = useSession();

  const [rawGraph, setRawGraph]   = useState<RawGraph>({ nodes: [], links: [] });
  const [depth, setDepth]         = useState(2);
  const [activeNodeId, setActiveNodeId] = useState<string | number | null>(alertedNodeId ?? null);
  const [flaggedAccounts, setFlaggedAccounts] = useState<{ id: string; score: number; kyc_tier: string }[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>(initialAccountId ?? "");
  const [showLabels, setShowLabels] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const [nodeCount, setNodeCount] = useState(0);
  const [neo4jError, setNeo4jError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const graphRef      = useRef<FG3DInstance>(null);
  const containerRef  = useRef<HTMLDivElement | null>(null);
  // FIX: keep a ref to current graph data so the mount effect always has fresh data
  const visibleGraphRef = useRef<RawGraph>({ nodes: [], links: [] });

  const authHeaders = useCallback((): HeadersInit => {
    const token = (session as any)?.accessToken;
    return token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  }, [session]);

  // ── flagged accounts — with retry for Neo4j routing failures ──
  useEffect(() => {
    if (session === undefined) return;

    const load = async () => {
      setNeo4jError(null);
      try {
        const res = await fetchWithRetry(
          `${API_BASE}/api/graph/flagged-accounts`,
          { headers: authHeaders() }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        const accounts = d.accounts ?? [];

        if (accounts.length === 0) {
          setNeo4jError("No flagged accounts found. Neo4j may be paused or query returned no results.");
          setFlaggedAccounts([]);
          return;
        }

        setFlaggedAccounts(accounts);
        if (!selectedAccount) {
          const firstId = initialAccountId ?? String(accounts[0].id);
          setSelectedAccount(firstId);
        }
      } catch (err: any) {
        console.error("flagged-accounts:", err);
        const msg = err?.message ?? "Unknown error";
        const isRouting = msg.includes("routing") || msg.includes("unavailable") || msg.includes("discovery");
        setNeo4jError(
          isRouting
            ? "Neo4j AuraDB routing error — the database may be paused. Check console.neo4j.io."
            : `Backend error: ${msg}`
        );
      }
    };

    load();
  }, [session, retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── load graph — with retry ──
  const loadGraph = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    setNeo4jError(null);

    try {
      const res = await fetchWithRetry(
        `${API_BASE}/api/graph/scored-subgraph?accountId=${selectedAccount}&depth=${depth}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let nodes: GraphNode[] = (data.nodes ?? []).map((n: any): GraphNode => ({
        id:            String(n.id),
        is_anomalous:  (n.anoma_score ?? 0) > 0.5,
        anomalyScore:  n.anoma_score ?? 0,
        patterns:      n.patterns    ?? [],
        cycle_path:    n.cycle_path  ?? [],
        kyc_risk_tier: n.kyc_risk_tier ?? "LOW",
        is_dormant:    n.dormant ?? n.is_dormant ?? false,
        volume:        undefined,
      }));

      let links: GraphLink[] = (data.edges ?? data.links ?? [])
        .filter((l: any) => l.source && l.target)
        .map((l: any) => ({
          source:    String(l.source),
          target:    String(l.target),
          amount:    l.amount    ?? 0,
          channel:   l.channel   ?? "",
          timestamp: l.timestamp ?? "",
        }));

      // ── cap nodes to prevent browser freeze ──
      if (nodes.length > NODE_RENDER_CAP) {
        const anomalous = nodes
          .filter((n) => n.is_anomalous)
          .sort((a, b) => (b.anomalyScore ?? 0) - (a.anomalyScore ?? 0));

        const keepIds = new Set<string | number>(
          anomalous.slice(0, NODE_RENDER_CAP).map((n) => n.id)
        );

        links.forEach((l) => {
          if (keepIds.size >= NODE_RENDER_CAP) return;
          const src = String(resolveId(l.source));
          const tgt = String(resolveId(l.target));
          if (keepIds.has(src)) keepIds.add(tgt);
          if (keepIds.has(tgt)) keepIds.add(src);
        });

        if (keepIds.size < NODE_RENDER_CAP) {
          nodes
            .filter((n) => !keepIds.has(n.id))
            .sort((a, b) => (b.anomalyScore ?? 0) - (a.anomalyScore ?? 0))
            .slice(0, NODE_RENDER_CAP - keepIds.size)
            .forEach((n) => keepIds.add(n.id));
        }

        nodes = nodes.filter((n) => keepIds.has(n.id));
        links = links.filter(
          (l) =>
            keepIds.has(String(resolveId(l.source))) &&
            keepIds.has(String(resolveId(l.target)))
        );
      }

      const graph = { nodes, links };
      setNodeCount(nodes.length);
      setRawGraph(graph);
      // FIX: also update ref so mount effect and re-renders always have fresh data
      visibleGraphRef.current = graph;

      // FIX: push data to existing graph instance immediately
      if (graphRef.current) {
        graphRef.current.graphData({ nodes, links });
      }
    } catch (err: any) {
      console.error("loadGraph error:", err);
      const msg = err?.message ?? "Unknown error";
      const isRouting = msg.includes("routing") || msg.includes("unavailable") || msg.includes("discovery");
      setNeo4jError(
        isRouting
          ? "Neo4j routing failure while loading graph. Retrying…"
          : `Graph load failed: ${msg}`
      );
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, depth, authHeaders]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // Keep ref in sync whenever rawGraph changes
  useEffect(() => { visibleGraphRef.current = rawGraph; }, [rawGraph]);

  const visibleGraph = rawGraph;

  // ── focus / neighbor highlighting ──
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
      const activeNode = visibleGraph.nodes.find((n) => n.id === activeNodeId);
      if (activeNode?.cycle_path?.length) {
        activeNode.cycle_path.forEach((id) => neighborSet.add(id));
      }
    }
    return { neighborSet };
  }, [activeNodeId, visibleGraph]);

  // ── mount ForceGraph3D ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;

    try {
      const GraphFactory = getForceGraph3D();
      const Graph: FG3DInstance = GraphFactory()(containerRef.current)
        .backgroundColor("#060c18")
        .width(containerRef.current.offsetWidth || 800)
        .height(containerRef.current.offsetHeight || 600)
        .nodeThreeObject((node: any) => buildNodeObject(node as GraphNode))
        .nodeLabel((node: any) => getNodeLabel(node as GraphNode))
        .linkColor((link: any) => (link.amount ?? 0) > 500000 ? "#ef4444" : "#475569")
        .linkWidth((link: any) => Math.max(0.3, Math.log10(((link.amount ?? 1000) / 1000) + 1) * 0.5))
        .linkDirectionalArrowLength(4)
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalArrowColor((link: any) => (link.amount ?? 0) > 500000 ? "#ef4444" : "#60a5fa")
        .linkDirectionalParticles((link: any) => (link.amount ?? 0) > 200000 ? 3 : 1)
        .linkDirectionalParticleSpeed(0.004)
        .linkDirectionalParticleColor((link: any) => (link.amount ?? 0) > 500000 ? "#ef4444" : "#94a3b8")
        .onNodeClick((node: any) => {
          const gNode = node as GraphNode;
          setActiveNodeId(gNode.id);
          onNodeSelect(gNode);
        })
        .onBackgroundClick(() => {
          setActiveNodeId(null);
          onNodeSelect(null);
        })
        // FIX: use ref so we always pass current data, not the empty initial state
        .graphData({
          nodes: visibleGraphRef.current.nodes,
          links: visibleGraphRef.current.links,
        });

      graphRef.current = Graph;

      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          Graph.width(containerRef.current.offsetWidth).height(containerRef.current.offsetHeight);
        }
      });
      ro.observe(containerRef.current);

      return () => {
        ro.disconnect();
        Graph._destructor?.();
      };
    } catch (err) {
      console.error("ForceGraph3D mount failed:", err);
      setMountError(err instanceof Error ? err.message : "3D graph failed to initialise");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // FIX: push new graph data to existing instance whenever visibleGraph changes
  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.graphData({ nodes: visibleGraph.nodes, links: visibleGraph.links });
  }, [visibleGraph]);

  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.nodeThreeObject((node: any) => buildNodeObject(node as GraphNode));
  }, [activeNodeId, focusData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.nodeLabel(
      showLabels
        ? (node: any) => String((node as GraphNode).id)
        : (node: any) => getNodeLabel(node as GraphNode)
    );
  }, [showLabels]);

  // ─────────────────────────────────────────────────────────────
  // buildNodeObject
  // ─────────────────────────────────────────────────────────────
  const buildNodeObject = (node: GraphNode): THREE.Group => {
    const isSelected  = node.id === activeNodeId;
    const isNeighbor  = focusData.neighborSet.has(node.id);
    const isCircular  = node.patterns?.includes("CIRCULAR");
    const isLayering  = node.patterns?.includes("LAYERING");

    const score     = node.anomalyScore ?? 0;
    const baseColor = scoreToColor(score);

    let opacity = 1;
    if (activeNodeId) opacity = isSelected || isNeighbor ? 1 : 0.08;

    const radius = 2 + score * 4;
    const group  = new THREE.Group();

    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 24),
      new THREE.MeshStandardMaterial({
        color: baseColor, transparent: true, opacity,
        emissive: baseColor, emissiveIntensity: isSelected ? 0.6 : 0.2,
      })
    ));

    if (isCircular) {
      group.add(new THREE.Mesh(
        new THREE.TorusGeometry(radius + 3, 0.6, 8, 32),
        new THREE.MeshBasicMaterial({ color: "#ef4444", transparent: true, opacity: 0.85 })
      ));
    }

    if (isLayering) {
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(radius + 4, 8, 8),
        new THREE.MeshBasicMaterial({ color: "#f59e0b", wireframe: true, transparent: true, opacity: 0.4 })
      ));
    }

    if (isSelected) {
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(radius + 5, 32, 32),
        new THREE.MeshBasicMaterial({ color: "#3b82f6", wireframe: true, transparent: true, opacity: 0.6 })
      ));
    }

    return group;
  };

  // ─────────────────────────────────────────────────────────────
  // getNodeLabel
  // ─────────────────────────────────────────────────────────────
  const getNodeLabel = (node: GraphNode): string => {
    const score      = node.anomalyScore ?? 0;
    const scoreColor = scoreToColor(score);
    const patterns   = (node.patterns ?? []).join(", ") || "None";
    return `
      <div style="background:rgba(10,15,25,0.97);padding:10px 14px;border-radius:8px;
        border:1px solid ${node.is_anomalous ? "#ef4444" : "#22c55e"};font-size:12px;
        color:white;min-width:180px;font-family:monospace;">
        <div style="font-weight:600;margin-bottom:6px;">Account ${node.id}</div>
        <div style="color:${scoreColor};margin-bottom:4px;">AnomaScore: ${(score * 100).toFixed(1)}%</div>
        <div style="color:#94a3b8;margin-bottom:2px;">Pattern: ${patterns}</div>
        <div style="color:#94a3b8;margin-bottom:2px;">KYC: ${node.kyc_risk_tier ?? "LOW"}</div>
        <div style="color:#94a3b8;">Dormant: ${node.is_dormant ? "Yes" : "No"}</div>
      </div>`;
  };

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative", width: "100%", height: "calc(100vh - 64px)", background: "#060c18" }}>

      {/* Controls */}
      <div style={{ position: "absolute", top: 16, left: 16, zIndex: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={selectedAccount}
          onChange={(e) => { setSelectedAccount(e.target.value); setNeo4jError(null); }}
          style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", fontSize: 13, cursor: "pointer" }}
        >
          {flaggedAccounts.length === 0 && <option value="">No flagged accounts</option>}
          {flaggedAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} — {(a.score * 100).toFixed(0)}% [{a.kyc_tier}]
            </option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 4 }}>
          {[1, 2, 3, 4].map((d) => (
            <button
              key={d}
              onClick={() => setDepth(d)}
              title={d >= 3 ? "⚠ Large depth may be slow with big graphs" : undefined}
              style={{
                background: depth === d ? "#3b82f6" : "#1e293b",
                color: d >= 3 ? "#f59e0b" : "#e2e8f0",
                border: `1px solid ${depth === d ? "#3b82f6" : "#334155"}`,
                borderRadius: 4, padding: "5px 10px", fontSize: 13, cursor: "pointer",
              }}
            >
              {d}
            </button>
          ))}
        </div>

        <button
          onClick={() => graphRef.current?.cameraPosition({ x: 0, y: 0, z: 400 }, undefined, 800)}
          style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 4, padding: "5px 10px", fontSize: 13, cursor: "pointer" }}
        >
          Reset camera
        </button>

        <button
          onClick={() => setShowLabels((v) => !v)}
          style={{ background: showLabels ? "#334155" : "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 4, padding: "5px 10px", fontSize: 13, cursor: "pointer" }}
        >
          {showLabels ? "Hide labels" : "Show labels"}
        </button>

        {/* Retry button shown when Neo4j is flaky */}
        {neo4jError && (
          <button
            onClick={() => { setRetryCount((c) => c + 1); setNeo4jError(null); }}
            style={{ background: "#7c3aed", color: "#e2e8f0", border: "1px solid #6d28d9", borderRadius: 4, padding: "5px 10px", fontSize: 13, cursor: "pointer" }}
          >
            ↺ Retry
          </button>
        )}

        {loading && <span style={{ color: "#60a5fa", fontSize: 13 }}>Loading…</span>}

        {!loading && nodeCount > 0 && (
          <span style={{ color: "#475569", fontSize: 12 }}>
            Showing {nodeCount}{nodeCount === NODE_RENDER_CAP ? ` (capped — use depth 1 or 2 for full view)` : ""} nodes
          </span>
        )}
      </div>

      {/* Neo4j / backend error banner */}
      {neo4jError && !mountError && (
        <div style={{
          position: "absolute", top: 60, left: 16, right: 16, zIndex: 15,
          background: "rgba(127,29,29,0.95)", border: "1px solid #ef4444",
          borderRadius: 8, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <span style={{ color: "#fca5a5", fontSize: 13, flex: 1 }}>{neo4jError}</span>
          <button
            onClick={() => { setRetryCount((c) => c + 1); setNeo4jError(null); }}
            style={{ background: "#7f1d1d", border: "1px solid #ef4444", color: "#fca5a5", borderRadius: 4, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      )}

      {/* WebGL mount error */}
      {mountError && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 20, color: "#ef4444", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Graph failed to load</div>
          <div style={{ fontSize: 13, color: "#94a3b8", background: "#0f172a", padding: "10px 16px", borderRadius: 8, border: "1px solid #334155", fontFamily: "monospace", maxWidth: 480, textAlign: "center" }}>
            {mountError}
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>WebGL must be enabled in your browser.</div>
        </div>
      )}

      {/* Empty state — accounts loaded but graph is empty */}
      {!loading && !mountError && !neo4jError && nodeCount === 0 && selectedAccount && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 5, gap: 8 }}>
          <div style={{ color: "#475569", fontSize: 14 }}>No graph data returned for account {selectedAccount}</div>
          <div style={{ color: "#334155", fontSize: 12 }}>Try a different account or increase depth</div>
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height: "100%", display: "block" }} />

      {selectedNode && <NodeInspector node={selectedNode} onClose={() => onNodeSelect(null)} />}

      {/* Legend */}
      <div style={{ position: "absolute", bottom: 24, left: 16, background: "rgba(10,15,25,0.85)", borderRadius: 8, padding: "12px 16px", border: "1px solid #1e293b", zIndex: 10 }}>
        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 8, fontWeight: 600 }}>LEGEND</div>
        <LegendDot color="#ef4444" label="High risk (score > 0.7)" />
        <LegendDot color="#f59e0b" label="Suspicious (score 0.4–0.7)" />
        <LegendDot color="#22c55e" label="Normal (score < 0.4)" />
        <LegendDot color="#ef4444" label="◯ Circular pattern (torus ring)" />
        <LegendDot color="#f59e0b" label="⬡ Layering pattern (wireframe)" />
        <LegendDot color="#3b82f6" label="● Selected node" />
      </div>

      {/* Stats */}
      <div style={{ position: "absolute", bottom: 24, right: selectedNode ? 380 : 16, background: "rgba(10,15,25,0.85)", borderRadius: 8, padding: "8px 12px", border: "1px solid #1e293b", zIndex: 10, fontSize: 12, color: "#64748b" }}>
        {visibleGraph.nodes.length} nodes · {visibleGraph.links.length} edges
      </div>
    </div>
  );
};

export default FraudGraph3D;