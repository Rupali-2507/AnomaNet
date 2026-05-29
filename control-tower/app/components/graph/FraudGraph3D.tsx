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
  pagerank?: number;
  role?: "HUB" | "BRIDGE" | "MULE" | "NORMAL";
  clusterId?: number;
  ringIds?: number[];
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

interface TourRing {
  ringId: number;
  label: string;
  shape: "STAR" | "CHAIN" | "CYCLE" | "DENSE";
  members: (string | number)[];
  description: string;
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
const NODE_RENDER_CAP = 300;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 800;

const resolveId = (ref: string | number | GraphNode): string | number =>
  typeof ref === "object" && ref !== null ? ref.id : ref;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Green → Yellow → Red colour ramp */
function riskColor(score: number): THREE.Color {
  if (score < 0.45) {
    return new THREE.Color().lerpColors(
      new THREE.Color("#22c55e"),
      new THREE.Color("#eab308"),
      score / 0.45
    );
  }
  return new THREE.Color().lerpColors(
    new THREE.Color("#eab308"),
    new THREE.Color("#ef4444"),
    (score - 0.45) / 0.55
  );
}

function riskHex(score: number): string {
  return "#" + riskColor(score).getHexString();
}

function nodeRadius(n: GraphNode): number {
  return 2 + (n.pagerank ?? 0) * 8;
}

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
      if (res.status >= 400 && res.status < 500) return res;
      if (attempt < retries - 1)
        await new Promise((r) => setTimeout(r, backoff * Math.pow(2, attempt)));
      else return res;
    } catch (err) {
      if (attempt < retries - 1)
        await new Promise((r) => setTimeout(r, backoff * Math.pow(2, attempt)));
      else throw err;
    }
  }
  throw new Error("fetchWithRetry exhausted");
}

// ─────────────────────────────────────────────────────────────
// Demo Tour Rings (shown when backend is unavailable)
// ─────────────────────────────────────────────────────────────

const DEMO_TOUR_RINGS: TourRing[] = [
  {
    ringId: 1,
    label: "Star Ring #1",
    shape: "STAR",
    members: [],
    description:
      "One hub account distributes stolen funds to 7 mule accounts before cash-out.",
  },
  {
    ringId: 2,
    label: "Chain Ring #1",
    shape: "CHAIN",
    members: [],
    description:
      "Sequential layering — funds hop A→B→C→D across 4 accounts to obscure trail.",
  },
  {
    ringId: 3,
    label: "Cycle Ring #1",
    shape: "CYCLE",
    members: [],
    description:
      "Circular flow — funds loop between accounts to simulate legitimate transactions.",
  },
];

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

const LegendDot = ({ color, label }: { color: string; label: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
    <div
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        boxShadow: `0 0 6px ${color}88`,
      }}
    />
    <span style={{ color: "#94a3b8", fontSize: 11 }}>{label}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Synthetic demo graph — used when API is unreachable
// ─────────────────────────────────────────────────────────────

function buildDemoGraph(): RawGraph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  for (let c = 0; c < 8; c++) {
    const isFraud = c < 3;
    const size = 12 + Math.floor(Math.random() * 18);

    for (let i = 0; i < size; i++) {
      const id = `${c}_${i}`;
      const score = isFraud
        ? 0.65 + Math.random() * 0.35
        : Math.random() * 0.35;
      const isAnom = score > 0.6;
      const role: GraphNode["role"] =
        i === 0 && isFraud
          ? "HUB"
          : i < 3 && isFraud
          ? "BRIDGE"
          : isAnom
          ? "MULE"
          : "NORMAL";

      nodes.push({
        id,
        is_anomalous: isAnom,
        anomalyScore: score,
        pagerank: i === 0 ? 0.85 : Math.random() * 0.3,
        role,
        clusterId: c,
        ringIds: isFraud ? [c + 1] : [],
        volume: Math.floor(Math.random() * 200) + 10,
        patterns: isFraud ? (i === 0 ? ["CIRCULAR"] : ["LAYERING"]) : [],
        kyc_risk_tier: isFraud ? "HIGH" : "LOW",
        is_dormant: isFraud && Math.random() > 0.7,
      });

      if (i > 0) {
        links.push({
          source: `${c}_0`,
          target: id,
          amount: Math.floor(Math.random() * 800000) + 50000,
        });
      }
    }
    if (isFraud && c > 0)
      links.push({ source: `${c}_0`, target: `0_0`, amount: 1200000 });
  }

  return { nodes, links };
}

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

  // ── Data ──
  const [rawGraph, setRawGraph] = useState<RawGraph>({ nodes: [], links: [] });
  const [isDemo, setIsDemo] = useState(false);

  // ── Graph controls ──
  const [depth, setDepth] = useState(2);
  const [viewMode, setViewMode] = useState<"all" | "fraud" | "rings">("all");
  const [searchId, setSearchId] = useState("");
  const [showLabels, setShowLabels] = useState(false);

  // ── UI state ──
  const [activeNodeId, setActiveNodeId] = useState<string | number | null>(
    alertedNodeId ?? null
  );
  const [flaggedAccounts, setFlaggedAccounts] = useState<
    { id: string; score: number; kyc_tier: string }[]
  >([]);
  const [selectedAccount, setSelectedAccount] = useState<string>(
    initialAccountId ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const [neo4jError, setNeo4jError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [nodeCount, setNodeCount] = useState(0);

  // ── Stats ──
  const [stats, setStats] = useState({
    totalNodes: 0,
    fraudNodes: 0,
    totalEdges: 0,
    rings: 0,
  });

  // ── Guided Tour ──
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [tourRings] = useState<TourRing[]>(DEMO_TOUR_RINGS);
  const tourTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Refs ──
  const graphRef = useRef<FG3DInstance>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleGraphRef = useRef<RawGraph>({ nodes: [], links: [] });
  const hasFitted = useRef(false);

  // ─────────────────────────────────────────────────────────────
  const authHeaders = useCallback((): HeadersInit => {
    const token = (session as any)?.accessToken;
    return token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  }, [session]);

  // ── Load flagged accounts ──
  useEffect(() => {
    if (session === undefined) return;

    const load = async () => {
      setNeo4jError(null);
      try {
        const res = await fetchWithRetry(`${API_BASE}/api/graph/flagged-accounts`, {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        const accounts = d.accounts ?? [];

        if (accounts.length === 0) {
          throw new Error("No flagged accounts returned");
        }

        setFlaggedAccounts(accounts);
        if (!selectedAccount) {
          setSelectedAccount(initialAccountId ?? String(accounts[0].id));
        }
        setIsDemo(false);
      } catch (err: any) {
        console.warn("flagged-accounts failed, using demo data:", err);
        // Load demo data silently
        loadDemoFallback();
      }
    };
    load();
  }, [session, retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Demo fallback ──
  const loadDemoFallback = useCallback(() => {
    const demo = buildDemoGraph();
    setIsDemo(true);
    setNeo4jError(null);
    setRawGraph(demo);
    visibleGraphRef.current = demo;
    const fraudCount = demo.nodes.filter((n) => n.is_anomalous).length;
    const ringCount = new Set(
      demo.nodes.flatMap((n) => n.ringIds ?? [])
    ).size;
    setStats({
      totalNodes: demo.nodes.length,
      fraudNodes: fraudCount,
      totalEdges: demo.links.length,
      rings: ringCount,
    });
    setNodeCount(demo.nodes.length);

    // Fake flagged accounts for dropdown
    const hubs = demo.nodes
      .filter((n) => n.role === "HUB")
      .map((n) => ({ id: String(n.id), score: n.anomalyScore ?? 0.9, kyc_tier: "HIGH" }));
    setFlaggedAccounts(hubs);
    if (!selectedAccount && hubs.length > 0) setSelectedAccount(hubs[0].id);
    if (graphRef.current) {
      graphRef.current.graphData({ nodes: demo.nodes, links: demo.links });
    }
  }, [selectedAccount]);

  // ── Load real graph ──
  const loadGraph = useCallback(async () => {
    if (!selectedAccount || isDemo) return;
    setLoading(true);
    setNeo4jError(null);

    try {
      const res = await fetchWithRetry(
        `${API_BASE}/api/graph/scored-subgraph?accountId=${selectedAccount}&depth=${depth}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let nodes: GraphNode[] = (data.nodes ?? []).map((n: any): GraphNode => {
        // Normalise every possible field name from different backends
        const isAnom = !!(
          n.isAnomalous ?? n.is_anomalous ?? n.anomalous ??
          n.isFraud ?? n.is_fraud ?? n.fraud ??
          (n.anoma_score ?? 0) > 0.5
        );
        const scoreCandidates = [
          n.anoma_score, n.anomalyScore, n.gnnScore, n.riskScore,
          n.score, n.fraudScore,
        ].filter((v) => v != null && !isNaN(v));
        let rawScore = scoreCandidates.length > 0 ? scoreCandidates[0] : 0;
        if (rawScore < 0) rawScore = Math.min(1, Math.abs(rawScore));
        const score = isAnom && rawScore < 0.5 ? Math.max(rawScore, 0.75) : rawScore;

        let ringIds: number[] = [];
        if (Array.isArray(n.ringIds)) ringIds = n.ringIds.map(Number);
        else if (Array.isArray(n.ring_ids)) ringIds = n.ring_ids.map(Number);
        else if (n.ringId != null) ringIds = [Number(n.ringId)];
        if (isAnom && ringIds.length === 0) ringIds = [1];

        const role: GraphNode["role"] =
          n.role ?? n.nodeRole ?? n.node_role ??
          (isAnom && (n.pagerank ?? 0) > 0.5 ? "HUB" :
           isAnom && ringIds.length > 0 ? "BRIDGE" :
           isAnom ? "MULE" : "NORMAL");

        return {
          id: String(n.nodeId ?? n.node_id ?? n.id),
          is_anomalous: isAnom,
          anomalyScore: Math.min(1, Math.max(0, score)),
          patterns: n.patterns ?? [],
          cycle_path: n.cycle_path ?? [],
          kyc_risk_tier: n.kyc_risk_tier ?? (isAnom ? "HIGH" : "LOW"),
          is_dormant: n.dormant ?? n.is_dormant ?? false,
          volume: n.volume ?? n.txCount ?? n.tx_count ?? 0,
          pagerank: n.pagerank ?? n.pageRank ?? n.page_rank ?? 0,
          role,
          clusterId: n.clusterId ?? n.cluster_id ?? n.community,
          ringIds,
        };
      });

      let links: GraphLink[] = (data.edges ?? data.links ?? [])
        .filter((l: any) => (l.source ?? l.from) && (l.target ?? l.to))
        .map((l: any) => ({
          source: String(l.source ?? l.from ?? l.sourceId),
          target: String(l.target ?? l.to ?? l.targetId),
          amount: l.amount ?? 0,
          channel: l.channel ?? "",
          timestamp: l.timestamp ?? "",
        }));

      // Cap to prevent freeze
      if (nodes.length > NODE_RENDER_CAP) {
        const sorted = [...nodes].sort(
          (a, b) => (b.anomalyScore ?? 0) - (a.anomalyScore ?? 0)
        );
        const keepIds = new Set(
          sorted.slice(0, NODE_RENDER_CAP).map((n) => n.id)
        );
        nodes = nodes.filter((n) => keepIds.has(n.id));
        links = links.filter(
          (l) =>
            keepIds.has(String(resolveId(l.source))) &&
            keepIds.has(String(resolveId(l.target)))
        );
      }

      const graph = { nodes, links };
      const fraudCount = nodes.filter((n) => n.is_anomalous).length;
      const ringCount = new Set(nodes.flatMap((n) => n.ringIds ?? [])).size;

      setRawGraph(graph);
      visibleGraphRef.current = graph;
      setNodeCount(nodes.length);
      setStats({
        totalNodes: nodes.length,
        fraudNodes: fraudCount,
        totalEdges: links.length,
        rings: ringCount,
      });

      if (graphRef.current) {
        graphRef.current.graphData({ nodes, links });
      }
    } catch (err: any) {
      console.warn("loadGraph failed, falling back to demo:", err);
      loadDemoFallback();
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, depth, authHeaders, isDemo, loadDemoFallback]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    visibleGraphRef.current = rawGraph;
  }, [rawGraph]);

  // ─────────────────────────────────────────────────────────────
  // Filter graph based on viewMode
  // ─────────────────────────────────────────────────────────────

  const visibleGraph = useMemo<RawGraph>(() => {
    let nodes = rawGraph.nodes;

    if (viewMode === "fraud") {
      nodes = nodes.filter((n) => n.is_anomalous);
    } else if (viewMode === "rings") {
      nodes = nodes.filter((n) => (n.ringIds?.length ?? 0) > 0);
      if (nodes.length === 0) nodes = rawGraph.nodes.filter((n) => n.is_anomalous);
    }

    if (searchId.trim()) {
      const q = searchId.trim().toLowerCase();
      nodes = rawGraph.nodes.filter((n) =>
        String(n.id).toLowerCase().includes(q)
      );
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = rawGraph.links.filter(
      (l) =>
        nodeIds.has(resolveId(l.source) as any) &&
        nodeIds.has(resolveId(l.target) as any)
    );

    return { nodes, links };
  }, [rawGraph, viewMode, searchId]);

  // ─────────────────────────────────────────────────────────────
  // Focus / neighbours
  // ─────────────────────────────────────────────────────────────

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
    }
    return { neighborSet };
  }, [activeNodeId, visibleGraph]);

  // ─────────────────────────────────────────────────────────────
  // buildNodeObject
  // ─────────────────────────────────────────────────────────────

  const buildNodeObject = useCallback(
    (node: GraphNode): THREE.Group => {
      const isActive = node.id === activeNodeId;
      const isNeighbor = focusData.neighborSet.has(node.id);
      const score = node.anomalyScore ?? 0;
      const color = riskColor(score);
      const radius = nodeRadius(node);

      let opacity = 1;
      if (activeNodeId) {
        opacity = isActive ? 1 : isNeighbor ? 0.75 : 0.08;
      }

      const group = new THREE.Group();

      // Core sphere
      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(radius, 28, 28),
          new THREE.MeshStandardMaterial({
            color,
            transparent: true,
            opacity,
            roughness: 0.4,
            metalness: 0.2,
            emissive: color,
            emissiveIntensity: score > 0.75 ? 0.35 : 0.1,
          })
        )
      );

      // Role rings
      if (node.role === "HUB") {
        group.add(
          new THREE.Mesh(
            new THREE.TorusGeometry(radius * 1.55, 0.35, 8, 32),
            new THREE.MeshBasicMaterial({
              color: new THREE.Color("#ef4444"),
              transparent: true,
              opacity: opacity * 0.9,
            })
          )
        );
      } else if (node.role === "BRIDGE") {
        group.add(
          new THREE.Mesh(
            new THREE.TorusGeometry(radius * 1.45, 0.2, 8, 24),
            new THREE.MeshBasicMaterial({
              color: new THREE.Color("#f97316"),
              transparent: true,
              opacity: opacity * 0.75,
            })
          )
        );
      }

      // Pattern: CIRCULAR torus
      if (node.patterns?.includes("CIRCULAR")) {
        group.add(
          new THREE.Mesh(
            new THREE.TorusGeometry(radius + 3, 0.6, 8, 32),
            new THREE.MeshBasicMaterial({
              color: "#ef4444",
              transparent: true,
              opacity: 0.85,
            })
          )
        );
      }

      // Pattern: LAYERING wireframe shell
      if (node.patterns?.includes("LAYERING")) {
        group.add(
          new THREE.Mesh(
            new THREE.SphereGeometry(radius + 4, 8, 8),
            new THREE.MeshBasicMaterial({
              color: "#f59e0b",
              wireframe: true,
              transparent: true,
              opacity: 0.4,
            })
          )
        );
      }

      // Selection wireframe
      if (isActive) {
        group.add(
          new THREE.Mesh(
            new THREE.SphereGeometry(radius * 1.4, 16, 16),
            new THREE.MeshBasicMaterial({
              color: "#60a5fa",
              wireframe: true,
              transparent: true,
              opacity: 0.6,
            })
          )
        );
        group.add(
          new THREE.Mesh(
            new THREE.TorusGeometry(radius * 2, 0.15, 8, 32),
            new THREE.MeshBasicMaterial({
              color: "#3b82f6",
              transparent: true,
              opacity: 0.4,
            })
          )
        );
      }

      // Tour highlight glow
      if (tourActive && tourRings[tourStep]?.members.includes(node.id)) {
        group.add(
          new THREE.Mesh(
            new THREE.SphereGeometry(radius * 2, 16, 16),
            new THREE.MeshBasicMaterial({
              color: "#facc15",
              transparent: true,
              opacity: 0.18,
            })
          )
        );
      }

      return group;
    },
    [activeNodeId, focusData, tourActive, tourStep, tourRings]
  );

  // ─────────────────────────────────────────────────────────────
  // Node label tooltip
  // ─────────────────────────────────────────────────────────────

  const getNodeLabel = useCallback(
    (node: GraphNode): string => {
      const score = node.anomalyScore ?? 0;
      const hex = riskHex(score);
      const role = node.role ?? "NORMAL";
      const roleEmoji =
        role === "HUB" ? "🔴" : role === "BRIDGE" ? "🟠" : role === "MULE" ? "⚪" : "🟢";
      const patterns = (node.patterns ?? []).join(", ") || "None";
      return `
        <div style="background:rgba(8,10,18,0.97);padding:12px 16px;border-radius:10px;
          border:1px solid ${hex};font-size:12px;color:#e5e7eb;min-width:190px;
          box-shadow:0 0 20px ${hex}44;font-family:monospace;">
          <div style="font-weight:700;font-size:13px;color:${hex};margin-bottom:6px;">
            ${roleEmoji} Account ${node.id}
          </div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div>Role: <b style="color:${hex}">${role}</b></div>
            <div>Risk Score: <b style="color:${hex}">${(score * 100).toFixed(1)}%</b></div>
            <div>Pattern: <b>${patterns}</b></div>
            <div>KYC: <b style="color:${node.kyc_risk_tier === "HIGH" ? "#ef4444" : "#22c55e"}">${node.kyc_risk_tier ?? "LOW"}</b></div>
            <div>Dormant: <b>${node.is_dormant ? "Yes" : "No"}</b></div>
            ${(node.ringIds?.length ?? 0) > 0
              ? `<div style="margin-top:4px;color:#facc15;font-size:11px;">⚠ Ring member</div>`
              : ""}
          </div>
        </div>`;
    },
    []
  );

  // ─────────────────────────────────────────────────────────────
  // Mount ForceGraph3D (once)
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;

    try {
      const GraphFactory = getForceGraph3D();
      const Graph: FG3DInstance = GraphFactory()(containerRef.current)
        .backgroundColor("#050814")
        .width(containerRef.current.offsetWidth || 800)
        .height(containerRef.current.offsetHeight || 600)
        .nodeThreeObject((node: any) => buildNodeObject(node as GraphNode))
        .nodeLabel((node: any) => getNodeLabel(node as GraphNode))
        .linkColor((link: any) => {
          const amt = (link as GraphLink).amount ?? 0;
          return amt > 500000 ? "rgba(239,68,68,0.9)" : "rgba(100,140,220,0.55)";
        })
        .linkWidth((link: any) =>
          Math.max(0.4, Math.log10(((link.amount ?? 1000) / 1000) + 1) * 0.6)
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
        .onNodeClick((node: any) => {
          const gNode = node as GraphNode;
          setActiveNodeId(gNode.id);
          onNodeSelect(gNode);
        })
        .onBackgroundClick(() => {
          setActiveNodeId(null);
          onNodeSelect(null);
        })
        .onEngineStop(() => {
          if (!hasFitted.current && graphRef.current) {
            graphRef.current.zoomToFit(800);
            hasFitted.current = true;
          }
        })
        .graphData({
          nodes: visibleGraphRef.current.nodes,
          links: visibleGraphRef.current.links,
        });

      graphRef.current = Graph;

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
    } catch (err) {
      console.error("ForceGraph3D mount failed:", err);
      setMountError(
        err instanceof Error ? err.message : "3D graph failed to initialise"
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push new data to existing instance
  useEffect(() => {
    if (!graphRef.current) return;
    hasFitted.current = false;
    graphRef.current.graphData({
      nodes: visibleGraph.nodes,
      links: visibleGraph.links,
    });
  }, [visibleGraph]);

  // Rebuild node objects on focus change
  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.nodeThreeObject((node: any) =>
      buildNodeObject(node as GraphNode)
    );
  }, [buildNodeObject]);

  // Labels toggle
  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.nodeLabel(
      showLabels
        ? (node: any) => String((node as GraphNode).id)
        : (node: any) => getNodeLabel(node as GraphNode)
    );
  }, [showLabels, getNodeLabel]);

  // ─────────────────────────────────────────────────────────────
  // Guided Tour
  // ─────────────────────────────────────────────────────────────

  const focusCameraOnNode = useCallback((node: GraphNode) => {
    if (!graphRef.current || node.x === undefined) return;
    const dist = 80;
    const mag = Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0) || 1;
    const ratio = 1 + dist / mag;
    graphRef.current.cameraPosition(
      { x: (node.x ?? 0) * ratio, y: (node.y ?? 0) * ratio, z: (node.z ?? 0) * ratio },
      node,
      800
    );
  }, []);

  const advanceTour = useCallback(
    (step: number) => {
      if (step >= tourRings.length) {
        setTourActive(false);
        setTourStep(0);
        return;
      }
      setTourStep(step);
      const ring = tourRings[step];
      const firstMember = ring.members[0];
      const node = firstMember
        ? rawGraph.nodes.find((n) => n.id === firstMember)
        : rawGraph.nodes.find((n) => n.is_anomalous && n.role === "HUB");
      if (node) {
        setActiveNodeId(node.id);
        setTimeout(() => focusCameraOnNode(node), 300);
      }
      tourTimerRef.current = setTimeout(() => advanceTour(step + 1), 4500);
    },
    [tourRings, rawGraph, focusCameraOnNode]
  );

  const startTour = useCallback(() => {
    setTourActive(true);
    advanceTour(0);
  }, [advanceTour]);

  const stopTour = useCallback(() => {
    if (tourTimerRef.current) clearTimeout(tourTimerRef.current);
    setTourActive(false);
    setTourStep(0);
  }, []);

  useEffect(() => () => { if (tourTimerRef.current) clearTimeout(tourTimerRef.current); }, []);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  const currentTourRing = tourActive ? tourRings[tourStep] : null;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "calc(100vh - 64px)",
        background: "#050814",
        overflow: "hidden",
      }}
    >
      {/* ── Demo mode banner ── */}
      {isDemo && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 25,
            background: "rgba(234,179,8,0.12)",
            borderBottom: "1px solid rgba(234,179,8,0.35)",
            padding: "7px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            backdropFilter: "blur(6px)",
          }}
        >
          <span style={{ fontSize: 14 }}>⚡</span>
          <span style={{ color: "#fde68a", fontSize: 12, flex: 1 }}>
            Backend unreachable — showing synthetic demo graph. Real data will load once your API is available.
          </span>
          <button
            onClick={() => { setIsDemo(false); setRetryCount((c) => c + 1); }}
            style={{
              background: "rgba(234,179,8,0.2)",
              border: "1px solid rgba(234,179,8,0.45)",
              color: "#fde68a",
              borderRadius: 4,
              padding: "3px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ↺ Retry API
          </button>
        </div>
      )}

      {/* ── Stats bar (top center) ── */}
      <div
        style={{
          position: "absolute",
          top: isDemo ? 40 : 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          display: "flex",
          gap: 4,
        }}
      >
        {[
          { label: "Accounts", value: stats.totalNodes.toLocaleString(), color: "#60a5fa" },
          { label: "Fraud", value: stats.fraudNodes.toLocaleString(), color: "#ef4444" },
          { label: "Edges", value: stats.totalEdges.toLocaleString(), color: "#94a3b8" },
          { label: "Rings", value: stats.rings.toLocaleString(), color: "#facc15" },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{
              background: "rgba(10,12,22,0.88)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: "6px 12px",
              textAlign: "center",
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ color, fontSize: 13, fontFamily: "monospace", fontWeight: 700 }}>
              {value}
            </div>
            <div style={{ color: "#4b5563", fontSize: 10, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── Top-right controls ── */}
      <div
        style={{
          position: "absolute",
          top: isDemo ? 44 : 12,
          right: 16,
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        {/* View mode tabs */}
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "rgba(10,12,22,0.88)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            padding: 4,
            backdropFilter: "blur(8px)",
          }}
        >
          {(["all", "fraud", "rings"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                background: viewMode === mode ? "rgba(59,130,246,0.25)" : "transparent",
                color: viewMode === mode ? "#60a5fa" : "#6b7280",
                border: viewMode === mode ? "1px solid rgba(59,130,246,0.4)" : "1px solid transparent",
                borderRadius: 6,
                padding: "5px 12px",
                fontSize: 11,
                cursor: "pointer",
                transition: "all 0.15s",
                textTransform: "capitalize",
              }}
            >
              {mode === "all" ? "All" : mode === "fraud" ? "Fraud Only" : "Ring Members"}
            </button>
          ))}
        </div>

        {/* Account selector + depth */}
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <select
            value={selectedAccount}
            onChange={(e) => {
              setSelectedAccount(e.target.value);
              setNeo4jError(null);
              if (isDemo) setIsDemo(false);
            }}
            style={{
              background: "rgba(15,23,42,0.95)",
              color: "#e2e8f0",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 12,
              cursor: "pointer",
              backdropFilter: "blur(6px)",
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

          {/* Depth buttons */}
          <div style={{ display: "flex", gap: 3 }}>
            {[1, 2, 3, 4].map((d) => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                title={d >= 3 ? "⚠ Large depth may be slow" : undefined}
                style={{
                  background: depth === d ? "rgba(59,130,246,0.3)" : "rgba(10,12,22,0.88)",
                  color: d >= 3 ? "#f59e0b" : depth === d ? "#60a5fa" : "#6b7280",
                  border: `1px solid ${depth === d ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: 5,
                  padding: "4px 9px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div style={{ display: "flex", gap: 4 }}>
          <input
            type="text"
            placeholder="Search account ID…"
            value={searchId}
            onChange={(e) => setSearchId(e.target.value)}
            style={{
              background: "rgba(10,12,22,0.88)",
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 12,
              width: 160,
              outline: "none",
            }}
          />
          {searchId && (
            <button
              onClick={() => setSearchId("")}
              style={{
                background: "rgba(10,12,22,0.88)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#6b7280",
                borderRadius: 5,
                padding: "4px 8px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Neo4j error banner (only when not demo and no mount error) ── */}
      {neo4jError && !mountError && !isDemo && (
        <div
          style={{
            position: "absolute",
            top: 60,
            left: 16,
            right: 16,
            zIndex: 15,
            background: "rgba(127,29,29,0.95)",
            border: "1px solid #ef4444",
            borderRadius: 8,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            backdropFilter: "blur(6px)",
          }}
        >
          <span style={{ fontSize: 16 }}>⚠</span>
          <span style={{ color: "#fca5a5", fontSize: 13, flex: 1 }}>
            {neo4jError}
          </span>
          <button
            onClick={() => { setRetryCount((c) => c + 1); setNeo4jError(null); }}
            style={{
              background: "#7f1d1d",
              border: "1px solid #ef4444",
              color: "#fca5a5",
              borderRadius: 4,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── WebGL mount error ── */}
      {mountError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 20,
            color: "#ef4444",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700 }}>Graph failed to load</div>
          <div
            style={{
              fontSize: 13,
              color: "#94a3b8",
              background: "#0f172a",
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid #334155",
              fontFamily: "monospace",
              maxWidth: 480,
              textAlign: "center",
            }}
          >
            {mountError}
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            WebGL must be enabled in your browser.
          </div>
        </div>
      )}

      {/* ── Loading spinner ── */}
      {loading && !isDemo && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            zIndex: 15,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            color: "#60a5fa",
            fontSize: 13,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              border: "2px solid #3b82f6",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          Loading transaction graph…
        </div>
      )}

      {/* ── Guided Tour caption ── */}
      {tourActive && currentTourRing && (
        <div
          style={{
            position: "absolute",
            bottom: 120,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            maxWidth: 440,
            width: "90%",
            background: "rgba(8,10,18,0.96)",
            border: "1px solid rgba(250,204,21,0.4)",
            borderRadius: 12,
            padding: "16px 20px",
            backdropFilter: "blur(12px)",
            boxShadow: "0 0 30px rgba(250,204,21,0.15)",
          }}
        >
          {/* Progress bar */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {tourRings.map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 99,
                  background: i <= tourStep ? "#facc15" : "rgba(255,255,255,0.1)",
                  transition: "background 0.3s",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div
              style={{
                background: "rgba(250,204,21,0.15)",
                color: "#facc15",
                border: "1px solid rgba(250,204,21,0.3)",
                borderRadius: 5,
                padding: "3px 8px",
                fontSize: 11,
                fontFamily: "monospace",
                flexShrink: 0,
              }}
            >
              {currentTourRing.shape}
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                {currentTourRing.label}
              </div>
              <div style={{ color: "#9ca3af", fontSize: 12, lineHeight: 1.6 }}>
                {currentTourRing.description}
              </div>
            </div>
          </div>
          <button
            onClick={stopTour}
            style={{
              marginTop: 12,
              background: "transparent",
              border: "none",
              color: "#6b7280",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Stop tour ✕
          </button>
        </div>
      )}

      {/* ── Bottom action bar ── */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          display: "flex",
          gap: 6,
        }}
      >
        {/* Detective Tour */}
        <button
          onClick={tourActive ? stopTour : startTour}
          style={{
            background: tourActive
              ? "rgba(250,204,21,0.2)"
              : "rgba(250,204,21,0.1)",
            border: "1px solid rgba(250,204,21,0.4)",
            color: "#facc15",
            borderRadius: 8,
            padding: "7px 16px",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            backdropFilter: "blur(6px)",
          }}
        >
          {tourActive
            ? `⏹ Stop Tour (${tourStep + 1}/${tourRings.length})`
            : "▶ Detective Tour"}
        </button>

        {/* Reset */}
        <button
          onClick={() => {
            setActiveNodeId(null);
            onNodeSelect(null);
            stopTour();
            graphRef.current?.zoomToFit(800);
          }}
          style={{
            background: "rgba(10,12,22,0.88)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#9ca3af",
            borderRadius: 8,
            padding: "7px 16px",
            fontSize: 12,
            cursor: "pointer",
            backdropFilter: "blur(6px)",
          }}
        >
          ↺ Reset View
        </button>

        {/* Show labels */}
        <button
          onClick={() => setShowLabels((v) => !v)}
          style={{
            background: showLabels ? "rgba(59,130,246,0.2)" : "rgba(10,12,22,0.88)",
            border: showLabels
              ? "1px solid rgba(59,130,246,0.5)"
              : "1px solid rgba(255,255,255,0.1)",
            color: showLabels ? "#60a5fa" : "#9ca3af",
            borderRadius: 8,
            padding: "7px 16px",
            fontSize: 12,
            cursor: "pointer",
            backdropFilter: "blur(6px)",
          }}
        >
          {showLabels ? "Hide Labels" : "Show Labels"}
        </button>

        {/* Node count */}
        {nodeCount > 0 && (
          <div
            style={{
              background: "rgba(10,12,22,0.88)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 8,
              padding: "7px 14px",
              fontSize: 11,
              color: "#475569",
              backdropFilter: "blur(6px)",
              display: "flex",
              alignItems: "center",
            }}
          >
            {visibleGraph.nodes.length} nodes · {visibleGraph.links.length} edges
            {nodeCount === NODE_RENDER_CAP && (
              <span style={{ color: "#f59e0b", marginLeft: 6 }}> (capped)</span>
            )}
          </div>
        )}
      </div>

      {/* ── Zoom controls ── */}
      <div
        style={{
          position: "absolute",
          bottom: 100,
          right: selectedNode ? 380 : 16,
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {[
          {
            label: "+",
            fn: () => {
              const cam = graphRef.current?.camera();
              if (cam)
                graphRef.current?.cameraPosition({ z: cam.position.z * 0.75 }, undefined, 400);
            },
          },
          {
            label: "−",
            fn: () => {
              const cam = graphRef.current?.camera();
              if (cam)
                graphRef.current?.cameraPosition({ z: cam.position.z * 1.3 }, undefined, 400);
            },
          },
        ].map(({ label, fn }) => (
          <button
            key={label}
            onClick={fn}
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "rgba(10,12,22,0.88)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#9ca3af",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(6px)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Risk legend ── */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: 16,
          zIndex: 20,
          background: "rgba(10,12,22,0.88)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          padding: "12px 14px",
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ color: "#4b5563", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
          Risk Scale
        </div>
        <div
          style={{
            width: 110,
            height: 6,
            borderRadius: 99,
            background: "linear-gradient(to right, #22c55e, #eab308, #ef4444)",
            marginBottom: 6,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#4b5563", marginBottom: 10 }}>
          <span>Low</span>
          <span>High</span>
        </div>
        <LegendDot color="#ef4444" label="HUB — ring organiser" />
        <LegendDot color="#f97316" label="BRIDGE — connector" />
        <LegendDot color="#94a3b8" label="MULE — forwarder" />
        <LegendDot color="#22c55e" label="NORMAL — clean" />
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 8, paddingTop: 8 }}>
          <LegendDot color="#ef4444" label="◯ Circular pattern" />
          <LegendDot color="#f59e0b" label="⬡ Layering pattern" />
          <LegendDot color="#3b82f6" label="● Selected node" />
        </div>
      </div>

      {/* ── 3D canvas ── */}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />

      {/* ── Node Inspector panel ── */}
      {selectedNode && (
        <NodeInspector node={selectedNode} onClose={() => onNodeSelect(null)} />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        select option { background: #0f172a; }
      `}</style>
    </div>
  );
};

export default FraudGraph3D;