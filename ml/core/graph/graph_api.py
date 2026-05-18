"""
New file — core/graph/graph_api.py
Exposes scored subgraph data for the frontend graph visualizer.
Rupali writes this, Muskan wires it into core/main.py
"""
from fastapi import APIRouter
from core.graph.neo4j_client import get_subgraph
from core.scoring.circular_detector import score_circular_from_graph
from core.scoring.layering_scorer import score_layering_from_features
from shared.feature_store.redis_store import get_rolling_features

graph_router = APIRouter(prefix="/ml/graph", tags=["Graph"])

@graph_router.get("/subgraph")
def scored_subgraph(account_id: str, depth: int = 3):
    # 1. Pull subgraph from Neo4j
    G = get_subgraph(account_id, hops=depth, hours=168)

    nodes, edges = [], []

    for node_id in G.nodes():
        features   = get_rolling_features(node_id)
        cycle_res  = score_circular_from_graph(G, node_id)
        layer_res  = score_layering_from_features(features, node_id)

        anoma_score = max(cycle_res.cycle_score, layer_res.layering_score)
        patterns    = []
        if cycle_res.cycle_detected:     patterns.append("CIRCULAR")
        if layer_res.layering_score > 0.5: patterns.append("LAYERING")

        nodes.append({
            "id":          node_id,
            "anoma_score": round(anoma_score, 3),
            "patterns":    patterns,
            "cycle_path":  cycle_res.cycle_path,
            "is_flagged":  anoma_score > 0.5,
            "kyc_risk_tier": G.nodes[node_id].get("kyc_risk_tier", "LOW"),
            "is_dormant":    G.nodes[node_id].get("is_dormant", False),
        })

    for src, dst, data in G.edges(data=True):
        edges.append({
            "source":    src,
            "target":    dst,
            "amount":    data.get("amount", 0),
            "channel":   data.get("channel", ""),
            "timestamp": str(data.get("timestamp", "")),
            "tx_id":     data.get("tx_id", ""),
        })

    return {"nodes": nodes, "edges": edges,
            "metadata": {"total_nodes": len(nodes), "total_edges": len(edges)}}


@graph_router.get("/flagged-accounts")
def flagged_accounts(limit: int = 20):
    """Returns top flagged accounts for the demo dropdown."""
    from core.graph.neo4j_client import get_high_risk_accounts
    accounts = get_high_risk_accounts(limit=limit)
    return {"accounts": accounts}