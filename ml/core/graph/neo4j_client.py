"""
ml/core/graph/neo4j_client.py

All Neo4j interactions for the ML layer live here.
Called by: circular_detector.py, layering_scorer.py, graphsage_encoder.py, anoma_score.py

Exposes:
  get_subgraph(account_id, hops, hours)  → nx.DiGraph  (main workhorse)
  get_account_features(account_id)       → dict
  get_recent_counterparties(account_id, hours) → list[str]
  get_cycle_candidates(account_id, max_hops, hours) → list[list[str]]
  write_transaction_edge(tx)             → None  (called by Kafka consumer)
  update_anoma_score(account_id, score)  → None
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import networkx as nx
from neo4j import GraphDatabase, Driver

log = logging.getLogger(__name__)

# ── Connection ────────────────────────────────────────────────────────────────

_driver: Optional[Driver] = None


def get_driver() -> Driver:
    global _driver
    if _driver is None:
        uri      = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
        user     = os.getenv("NEO4J_USERNAME",  "neo4j")
        password = os.getenv("NEO4J_PASSWORD",  "anomanet2024")
        _driver  = GraphDatabase.driver(uri, auth=(user, password))
        log.info("Neo4j driver initialised → %s", uri)
    return _driver


def close_driver():
    global _driver
    if _driver:
        _driver.close()
        _driver = None


def health_check() -> bool:
    try:
        with get_driver().session() as s:
            s.run("RETURN 1")
        return True
    except Exception as e:
        log.error("Neo4j health check failed: %s", e)
        return False


# ── Subgraph extraction ───────────────────────────────────────────────────────

def get_subgraph(
    account_id: str,
    hops: int = 2,
    hours: int = 168,       # 7 days default
) -> nx.DiGraph:
    """
    Extract an N-hop subgraph around account_id from Neo4j.
    Returns a NetworkX DiGraph with full node and edge attributes.

    Node attributes:
      account_type, kyc_risk_tier, is_dormant, anoma_score,
      branch_id, status, declared_monthly_income

    Edge attributes:
      amount, timestamp (datetime), channel, tx_id, branch_id
    """
    hops  = max(1, min(hops, 4))   # cap at 4 hops for performance
    since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()

    cypher = """
    MATCH path = (center:Account {id: $account_id})
                 -[:TRANSFERRED_TO*1..{hops}]-
                 (neighbor:Account)
    WHERE ALL(r IN relationships(path)
              WHERE r.timestamp >= $since)
    WITH nodes(path) AS ns, relationships(path) AS rs
    UNWIND range(0, size(rs)-1) AS i
    RETURN
        ns[i].id   AS src_id,
        ns[i+1].id AS dst_id,
        ns[i].account_type          AS src_type,
        ns[i].kyc_risk_tier         AS src_kyc,
        ns[i].is_dormant            AS src_dormant,
        ns[i].anoma_score           AS src_score,
        ns[i].branch_id             AS src_branch,
        ns[i].status                AS src_status,
        ns[i+1].account_type        AS dst_type,
        ns[i+1].kyc_risk_tier       AS dst_kyc,
        ns[i+1].is_dormant          AS dst_dormant,
        ns[i+1].anoma_score         AS dst_score,
        ns[i+1].branch_id           AS dst_branch,
        ns[i+1].status              AS dst_status,
        rs[i].amount                AS amount,
        rs[i].timestamp             AS timestamp,
        rs[i].channel               AS channel,
        rs[i].tx_id                 AS tx_id,
        rs[i].branch_id             AS edge_branch
    """.replace("{hops}", str(hops))

    G = nx.DiGraph()
    G.graph["center_account"] = account_id

    try:
        with get_driver().session() as session:
            result = session.run(cypher, account_id=account_id, since=since)
            rows   = result.data()

        if not rows:
            # Return a single-node graph if no edges found
            G.add_node(account_id, account_type="UNKNOWN", kyc_risk_tier="LOW",
                       is_dormant=False, anoma_score=0.0, branch_id="", status="ACTIVE")
            return G

        for row in rows:
            # Add/update source node
            if row["src_id"] not in G:
                G.add_node(row["src_id"],
                    account_type  = row["src_type"]    or "UNKNOWN",
                    kyc_risk_tier = row["src_kyc"]     or "LOW",
                    is_dormant    = row["src_dormant"]  or False,
                    anoma_score   = row["src_score"]    or 0.0,
                    branch_id     = row["src_branch"]   or "",
                    status        = row["src_status"]   or "ACTIVE",
                )
            # Add/update destination node
            if row["dst_id"] not in G:
                G.add_node(row["dst_id"],
                    account_type  = row["dst_type"]    or "UNKNOWN",
                    kyc_risk_tier = row["dst_kyc"]     or "LOW",
                    is_dormant    = row["dst_dormant"]  or False,
                    anoma_score   = row["dst_score"]    or 0.0,
                    branch_id     = row["dst_branch"]   or "",
                    status        = row["dst_status"]   or "ACTIVE",
                )
            # Add edge
            ts = row["timestamp"]
            if isinstance(ts, str):
                try:
                    ts = datetime.fromisoformat(ts)
                except ValueError:
                    ts = None

            G.add_edge(
                row["src_id"], row["dst_id"],
                amount    = float(row["amount"] or 0),
                timestamp = ts,
                channel   = row["channel"]      or "UNKNOWN",
                tx_id     = row["tx_id"]        or "",
                branch_id = row["edge_branch"]  or "",
            )

        log.debug(
            "Subgraph for %s: %d nodes, %d edges (hops=%d, hours=%d)",
            account_id, G.number_of_nodes(), G.number_of_edges(), hops, hours,
        )

    except Exception as e:
        log.error("get_subgraph failed for %s: %s", account_id, e)
        G.add_node(account_id)

    return G


# ── Account features ──────────────────────────────────────────────────────────

def get_account_features(account_id: str) -> dict:
    """
    Fetch static account and customer features from Neo4j.
    Used by dormancy scorer and profile mismatch module.
    Returns empty dict if account not found.
    """
    cypher = """
    MATCH (a:Account {id: $account_id})
    OPTIONAL MATCH (c:Customer)-[:OWNS]->(a)
    OPTIONAL MATCH (b:Branch)<-[:BELONGS_TO]-(a)
    RETURN
        a.account_type           AS account_type,
        a.kyc_risk_tier          AS kyc_risk_tier,
        a.is_dormant             AS is_dormant,
        a.dormant_since          AS dormant_since,
        a.status                 AS status,
        a.branch_id              AS branch_id,
        a.anoma_score            AS anoma_score,
        c.declared_monthly_income AS declared_monthly_income,
        c.occupation             AS occupation,
        c.risk_tier              AS customer_risk_tier,
        c.segment                AS segment,
        b.city                   AS branch_city
    """
    try:
        with get_driver().session() as session:
            result = session.run(cypher, account_id=account_id)
            record = result.single()
            if record is None:
                return {}
            return dict(record)
    except Exception as e:
        log.error("get_account_features failed for %s: %s", account_id, e)
        return {}


# ── Counterparty history ──────────────────────────────────────────────────────

def get_recent_counterparties(account_id: str, hours: int = 168) -> list[str]:
    """
    Return all account IDs that transacted with account_id in the last N hours.
    Used by layering scorer to compute unique_counterparties feature.
    """
    since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
    cypher = """
    MATCH (a:Account {id: $account_id})-[r:TRANSFERRED_TO]-(b:Account)
    WHERE r.timestamp >= $since
    RETURN DISTINCT b.id AS counterparty_id
    """
    try:
        with get_driver().session() as session:
            result = session.run(cypher, account_id=account_id, since=since)
            return [row["counterparty_id"] for row in result.data()]
    except Exception as e:
        log.error("get_recent_counterparties failed for %s: %s", account_id, e)
        return []


def is_first_time_counterparty(account_a: str, account_b: str) -> bool:
    """
    Returns True if this is the first-ever transaction between account_a and account_b.
    Used by circular detector to flag new relationships in a cycle.
    """
    cypher = """
    MATCH (a:Account {id: $a})-[r:TRANSFERRED_TO]-(b:Account {id: $b})
    RETURN count(r) AS tx_count
    """
    try:
        with get_driver().session() as session:
            result = session.run(cypher, a=account_a, b=account_b)
            record = result.single()
            return (record["tx_count"] if record else 0) <= 1
    except Exception as e:
        log.error("is_first_time_counterparty failed: %s", e)
        return False


# ── Cycle candidates (for circular detector) ─────────────────────────────────

def get_cycle_candidates(
    account_id: str,
    max_hops: int = 7,
    hours: int = 72,
) -> list[list[str]]:
    """
    Use Neo4j's native cycle detection to find potential circular paths
    starting and ending at account_id within the last N hours.

    Returns a list of paths — each path is a list of account IDs forming a cycle.
    The circular_detector.py then validates these with amount-variance checks.

    Neo4j finds the paths; Johnson's Algorithm in NetworkX confirms them.
    This is a fast pre-filter to avoid running Johnson's on the full graph.
    """
    since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
    cypher = f"""
    MATCH path = (start:Account {{id: $account_id}})
                 -[:TRANSFERRED_TO*2..{max_hops}]->
                 (start)
    WHERE ALL(r IN relationships(path)
              WHERE r.timestamp >= $since)
    RETURN [node IN nodes(path) | node.id] AS cycle_path,
           [r IN relationships(path) | r.amount] AS amounts,
           [r IN relationships(path) | r.timestamp] AS timestamps
    LIMIT 20
    """
    candidates = []
    try:
        with get_driver().session() as session:
            result = session.run(cypher, account_id=account_id, since=since)
            for row in result.data():
                candidates.append({
                    "path":       row["cycle_path"],
                    "amounts":    row["amounts"],
                    "timestamps": row["timestamps"],
                })
    except Exception as e:
        log.error("get_cycle_candidates failed for %s: %s", account_id, e)

    return candidates


# ── Historical transaction stats ──────────────────────────────────────────────

def get_historical_avg_amount(account_id: str, days: int = 365) -> float:
    """
    Average transaction amount for account_id over the last N days.
    Used by dormancy scorer to check if current transaction >> historical average.
    """
    since = (datetime.now(tz=timezone.utc) - timedelta(days=days)).isoformat()
    cypher = """
    MATCH (a:Account {id: $account_id})-[r:TRANSFERRED_TO]-()
    WHERE r.timestamp >= $since
    RETURN avg(r.amount) AS avg_amount, count(r) AS tx_count
    """
    try:
        with get_driver().session() as session:
            result = session.run(cypher, account_id=account_id, since=since)
            record = result.single()
            if record and record["tx_count"] > 0:
                return float(record["avg_amount"] or 0)
            return 0.0
    except Exception as e:
        log.error("get_historical_avg_amount failed for %s: %s", account_id, e)
        return 0.0


def get_account_degree(account_id: str, hours: int = 168) -> dict:
    """
    Return in-degree and out-degree for account_id in the last N hours.
    Used by layering scorer — high out-degree in short window = fan-out signal.
    """
    since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
    cypher = """
    MATCH (a:Account {id: $account_id})
    OPTIONAL MATCH (a)-[out:TRANSFERRED_TO]->(b)
        WHERE out.timestamp >= $since
    OPTIONAL MATCH (c)-[in_:TRANSFERRED_TO]->(a)
        WHERE in_.timestamp >= $since
    RETURN count(DISTINCT out) AS out_degree,
           count(DISTINCT in_) AS in_degree
    """
    try:
        with get_driver().session() as session:
            result = session.run(cypher, account_id=account_id, since=since)
            record = result.single()
            if record:
                return {
                    "out_degree": int(record["out_degree"] or 0),
                    "in_degree":  int(record["in_degree"]  or 0),
                }
    except Exception as e:
        log.error("get_account_degree failed for %s: %s", account_id, e)
    return {"out_degree": 0, "in_degree": 0}


# ── Write operations (called by Kafka consumer) ───────────────────────────────

def write_transaction_edge(
    tx_id: str,
    source_account_id: str,
    dest_account_id: str,
    amount: float,
    channel: str,
    timestamp: str,
    branch_id: str,
) -> bool:
    """
    Write a new TRANSFERRED_TO edge to Neo4j.
    Also creates Account nodes if they don't exist yet (MERGE).
    Called by core/kafka/consumer.py after each transaction is scored.
    """
    cypher = """
    MERGE (src:Account {id: $src_id})
    MERGE (dst:Account {id: $dst_id})
    CREATE (src)-[:TRANSFERRED_TO {
        tx_id:     $tx_id,
        amount:    $amount,
        channel:   $channel,
        timestamp: $timestamp,
        branch_id: $branch_id
    }]->(dst)
    """
    try:
        with get_driver().session() as session:
            session.run(cypher,
                src_id    = source_account_id,
                dst_id    = dest_account_id,
                tx_id     = tx_id,
                amount    = amount,
                channel   = channel,
                timestamp = timestamp,
                branch_id = branch_id,
            )
        return True
    except Exception as e:
        log.error("write_transaction_edge failed for tx %s: %s", tx_id, e)
        return False


def update_anoma_score(account_id: str, score: float) -> bool:
    """
    Update the anoma_score property on an Account node.
    Called after scoring so the graph reflects current risk.
    Manya's D3 graph reads this property for node colouring.
    """
    cypher = """
    MATCH (a:Account {id: $account_id})
    SET a.anoma_score = $score
    """
    try:
        with get_driver().session() as session:
            session.run(cypher, account_id=account_id, score=score)
        return True
    except Exception as e:
        log.error("update_anoma_score failed for %s: %s", account_id, e)
        return False


# ── Bulk loader (used after simulator generates parquet files) ────────────────

def bulk_load_from_simulator(
    nodes_parquet: str = "data/neo4j_nodes.parquet",
    edges_parquet: str = "data/neo4j_edges.parquet",
    batch_size: int = 500,
) -> dict:
    """
    Load the simulator's parquet output into Neo4j in batches.
    Run this ONCE after generating the 100k dataset.

    Usage:
        from core.graph.neo4j_client import bulk_load_from_simulator
        bulk_load_from_simulator()
    """
    import pandas as pd

    log.info("Starting bulk load from parquet files...")
    stats = {"nodes": 0, "edges": 0, "errors": 0}

    # ── Load nodes ────────────────────────────────────────────────────────────
    nodes_df = pd.read_parquet(nodes_parquet)

    account_nodes  = nodes_df[nodes_df["node_type"] == "Account"].to_dict("records")
    customer_nodes = nodes_df[nodes_df["node_type"] == "Customer"].to_dict("records")
    branch_nodes   = nodes_df[nodes_df["node_type"] == "Branch"].to_dict("records")

    def _batch_write_nodes(records: list[dict], cypher: str, label: str):
        for i in range(0, len(records), batch_size):
            batch = records[i: i + batch_size]
            try:
                with get_driver().session() as s:
                    s.run(cypher, rows=batch)
                stats["nodes"] += len(batch)
            except Exception as e:
                log.error("Node batch failed (%s): %s", label, e)
                stats["errors"] += 1

    _batch_write_nodes(account_nodes, """
        UNWIND $rows AS row
        MERGE (a:Account {id: row.id})
        SET a.account_type  = row.account_type,
            a.branch_id     = row.branch_id,
            a.kyc_risk_tier = row.kyc_risk_tier,
            a.is_dormant    = row.is_dormant,
            a.status        = row.status,
            a.anoma_score   = row.anoma_score
    """, "Account")

    _batch_write_nodes(customer_nodes, """
        UNWIND $rows AS row
        MERGE (c:Customer {id: row.id})
        SET c.name       = row.name,
            c.kyc_id     = row.kyc_id,
            c.risk_tier  = row.risk_tier,
            c.city       = row.city,
            c.occupation = row.occupation,
            c.segment    = row.segment
    """, "Customer")

    _batch_write_nodes(branch_nodes, """
        UNWIND $rows AS row
        MERGE (b:Branch {id: row.id})
        SET b.ifsc = row.ifsc
    """, "Branch")

    log.info("Nodes loaded: %d", stats["nodes"])

    # ── Load edges ────────────────────────────────────────────────────────────
    edges_df = pd.read_parquet(edges_parquet)

    transfer_edges = edges_df[edges_df["edge_type"] == "TRANSFERRED_TO"].to_dict("records")
    owns_edges     = edges_df[edges_df["edge_type"] == "OWNS"].to_dict("records")
    belongs_edges  = edges_df[edges_df["edge_type"] == "BELONGS_TO"].to_dict("records")

    for i in range(0, len(transfer_edges), batch_size):
        batch = transfer_edges[i: i + batch_size]
        try:
            with get_driver().session() as s:
                s.run("""
                    UNWIND $rows AS row
                    MATCH (src:Account {id: row.source})
                    MATCH (dst:Account {id: row.target})
                    CREATE (src)-[:TRANSFERRED_TO {
                        tx_id:     row.tx_id,
                        amount:    toFloat(row.amount),
                        timestamp: row.timestamp,
                        channel:   row.channel,
                        branch_id: row.branch_id,
                        is_fraud:  row.is_fraud,
                        fraud_type: row.fraud_type
                    }]->(dst)
                """, rows=batch)
            stats["edges"] += len(batch)
        except Exception as e:
            log.error("Transfer edge batch failed: %s", e)
            stats["errors"] += 1

        if i % 10_000 == 0 and i > 0:
            log.info("  edges loaded: %d / %d", i, len(transfer_edges))

    for i in range(0, len(owns_edges), batch_size):
        batch = owns_edges[i: i + batch_size]
        try:
            with get_driver().session() as s:
                s.run("""
                    UNWIND $rows AS row
                    MATCH (c:Customer {id: row.source})
                    MATCH (a:Account  {id: row.target})
                    MERGE (c)-[:OWNS]->(a)
                """, rows=batch)
            stats["edges"] += len(batch)
        except Exception as e:
            log.error("OWNS edge batch failed: %s", e)
            stats["errors"] += 1

    for i in range(0, len(belongs_edges), batch_size):
        batch = belongs_edges[i: i + batch_size]
        try:
            with get_driver().session() as s:
                s.run("""
                    UNWIND $rows AS row
                    MATCH (a:Account {id: row.source})
                    MATCH (b:Branch  {id: row.target})
                    MERGE (a)-[:BELONGS_TO]->(b)
                """, rows=batch)
            stats["edges"] += len(batch)
        except Exception as e:
            log.error("BELONGS_TO edge batch failed: %s", e)
            stats["errors"] += 1

    log.info("Bulk load complete. Nodes: %d | Edges: %d | Errors: %d",
             stats["nodes"], stats["edges"], stats["errors"])
    return stats