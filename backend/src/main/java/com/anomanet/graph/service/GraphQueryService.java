package com.anomanet.graph.service;

import com.anomanet.graph.dto.GraphDtos;
import org.neo4j.driver.exceptions.ServiceUnavailableException;
import org.neo4j.driver.exceptions.SessionExpiredException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.neo4j.core.Neo4jClient;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.function.Supplier;
import java.util.stream.Collectors;

@Service
public class GraphQueryService {

    private static final Logger log = LoggerFactory.getLogger(GraphQueryService.class);

    private static final int    MAX_RETRIES             = 3;
    private static final long   RETRY_BACKOFF_MS        = 600L;
    private static final double FLAGGED_SCORE_THRESHOLD = 0.3;

    private final Neo4jClient neo4jClient;

    public GraphQueryService(Neo4jClient neo4jClient) {
        this.neo4jClient = neo4jClient;
    }

    // ─────────────────────────────────────────────────────────────
    // Retry helper
    // ─────────────────────────────────────────────────────────────

    private <T> T withRetry(String opName, Supplier<T> operation) {
        Exception last  = null;
        long backoff    = RETRY_BACKOFF_MS;

        for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                return operation.get();
            } catch (ServiceUnavailableException | SessionExpiredException e) {
                last = e;
                log.warn("{} routing error (attempt {}/{}), retrying in {}ms: {}",
                        opName, attempt + 1, MAX_RETRIES, backoff, e.getMessage());
                sleep(backoff);
                backoff *= 2;
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "";
                boolean isRouting = msg.contains("routing")
                        || msg.contains("No routing server")
                        || msg.contains("no longer available")
                        || msg.contains("ServiceUnavailable")
                        || msg.contains("Could not perform discovery");

                if (isRouting && attempt < MAX_RETRIES - 1) {
                    last = e;
                    log.warn("{} routing error (attempt {}/{}), retrying in {}ms: {}",
                            opName, attempt + 1, MAX_RETRIES, backoff, msg);
                    sleep(backoff);
                    backoff *= 2;
                } else {
                    log.error("{} failed: {}", opName, msg);
                    throw e;
                }
            }
        }
        log.error("{} failed after {} retries", opName, MAX_RETRIES);
        throw new RuntimeException(opName + " failed after " + MAX_RETRIES + " retries", last);
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); }
        catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
    }

    // ─────────────────────────────────────────────────────────────
    // getFlaggedAccounts
    // ─────────────────────────────────────────────────────────────

    public List<Map<String, Object>> getFlaggedAccounts() {
        return withRetry("getFlaggedAccounts", () -> {
            try {
                Collection<Map<String, Object>> rows = neo4jClient.query("""
                        MATCH (n:Account)
                        WHERE n.anoma_score IS NOT NULL
                          AND n.anoma_score >= $threshold
                        RETURN n.id            AS id,
                               n.anoma_score   AS score,
                               n.kyc_risk_tier AS kyc_tier
                        ORDER BY n.anoma_score DESC
                        LIMIT 50
                        """)
                        .bind(FLAGGED_SCORE_THRESHOLD).to("threshold")
                        .fetch()
                        .all();

                List<Map<String, Object>> accounts = rows.stream()
                        .map(row -> {
                            Map<String, Object> m = new LinkedHashMap<>();
                            m.put("id",       Objects.toString(row.get("id"), ""));
                            m.put("score",    toDouble(row.get("score")));
                            m.put("kyc_tier", Objects.toString(row.get("kyc_tier"), "LOW"));
                            return m;
                        })
                        .collect(Collectors.toList());

                log.info("getFlaggedAccounts → {} accounts (threshold={})",
                        accounts.size(), FLAGGED_SCORE_THRESHOLD);

                if (accounts.isEmpty()) logTotalAccountCount();

                return accounts;

            } catch (Exception e) {
                log.error("getFlaggedAccounts failed: {}", e.getMessage());
                throw e;
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // getSubgraph  — uses GraphDtos.GraphNode / GraphDtos.GraphEdge
    // ─────────────────────────────────────────────────────────────

    public GraphDtos.SubgraphResponse getSubgraph(String accountId, int depth, int hours) {
        return withRetry("getSubgraph[" + accountId + "]", () -> {
            try {
                // ── nodes ──
                Collection<Map<String, Object>> nodeRows = neo4jClient.query("""
                        MATCH (root:Account {id: $accountId})
                        CALL apoc.path.subgraphAll(root, {
                            maxLevel: $depth,
                            relationshipFilter: 'TRANSFERRED_TO>'
                        })
                        YIELD nodes
                        UNWIND nodes AS n
                        RETURN DISTINCT
                               n.id             AS id,
                               n.label          AS label,
                               n.anoma_score    AS anoma_score,
                               n.account_type   AS account_type,
                               n.kyc_risk_tier  AS kyc_risk_tier,
                               n.dormant        AS dormant,
                               n.branch_id      AS branch_id
                        """)
                        .bind(accountId).to("accountId")
                        .bind(depth).to("depth")
                        .fetch().all();

                // ── edges ──
                Collection<Map<String, Object>> edgeRows = neo4jClient.query("""
                        MATCH (root:Account {id: $accountId})
                        CALL apoc.path.subgraphAll(root, {
                            maxLevel: $depth,
                            relationshipFilter: 'TRANSFERRED_TO>'
                        })
                        YIELD relationships
                        UNWIND relationships AS r
                        RETURN DISTINCT
                               startNode(r).id AS source,
                               endNode(r).id   AS target,
                               r.amount        AS amount,
                               r.timestamp     AS timestamp,
                               r.channel       AS channel,
                               r.tx_id         AS tx_id
                        """)
                        .bind(accountId).to("accountId")
                        .bind(depth).to("depth")
                        .fetch().all();

                List<GraphDtos.GraphNode> nodes = nodeRows.stream()
                        .map(this::toGraphNode)
                        .collect(Collectors.toList());

                List<GraphDtos.GraphEdge> edges = edgeRows.stream()
                        .map(this::toGraphEdge)
                        .collect(Collectors.toList());

                // build metadata
                GraphDtos.GraphMetadata meta = new GraphDtos.GraphMetadata();
                meta.setTotalNodes(nodes.size());
                meta.setTotalEdges(edges.size());

                GraphDtos.SubgraphResponse resp = new GraphDtos.SubgraphResponse();
                resp.setNodes(nodes);
                resp.setEdges(edges);
                resp.setMetadata(meta);

                log.info("getSubgraph[{}] depth={} → {} nodes, {} edges",
                        accountId, depth, nodes.size(), edges.size());

                return resp;

            } catch (Exception e) {
                log.error("getSubgraph[{}] failed: {}", accountId, e.getMessage());
                throw e;
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // detectCycles  — uses GraphDtos.CycleResult (has setPath)
    // ─────────────────────────────────────────────────────────────

    public List<GraphDtos.CycleResult> detectCycles(String accountId, int maxLength, int hours) {
        return withRetry("detectCycles[" + accountId + "]", () -> {
            Collection<Map<String, Object>> rows = neo4jClient.query("""
                    MATCH path = (start:Account {id: $accountId})-[:TRANSFERRED_TO*2..$maxLen]->(start)
                    RETURN [n IN nodes(path) | n.id] AS cycle_path
                    LIMIT 20
                    """)
                    .bind(accountId).to("accountId")
                    .bind(maxLength).to("maxLen")
                    .fetch().all();

            return rows.stream().map(row -> {
                @SuppressWarnings("unchecked")
                List<String> path = row.get("cycle_path") instanceof List
                        ? (List<String>) row.get("cycle_path") : List.of();
                GraphDtos.CycleResult cr = new GraphDtos.CycleResult();
                cr.setPath(path);
                return cr;
            }).collect(Collectors.toList());
        });
    }

    // ─────────────────────────────────────────────────────────────
    // getAccountStats  — uses GraphDtos.AccountStats (has setters)
    // ─────────────────────────────────────────────────────────────

    public GraphDtos.AccountStats getAccountStats(String accountId) {
        return withRetry("getAccountStats[" + accountId + "]", () -> {
            Optional<Map<String, Object>> row = neo4jClient.query("""
                    MATCH (n:Account {id: $accountId})
                    OPTIONAL MATCH (n)-[out:TRANSFERRED_TO]->()
                    OPTIONAL MATCH ()-[in:TRANSFERRED_TO]->(n)
                    RETURN count(DISTINCT out) AS out_degree,
                           count(DISTINCT in)  AS in_degree
                    """)
                    .bind(accountId).to("accountId")
                    .fetch().first();

            GraphDtos.AccountStats stats = new GraphDtos.AccountStats();
            row.ifPresent(r -> {
                stats.setDegreeIn(toLong(r.get("in_degree")));
                stats.setDegreeOut(toLong(r.get("out_degree")));
            });
            return stats;
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Mapping helpers
    // ─────────────────────────────────────────────────────────────

    private GraphDtos.GraphNode toGraphNode(Map<String, Object> row) {
        GraphDtos.GraphNode n = new GraphDtos.GraphNode();
        n.setId(Objects.toString(row.get("id"), ""));
        n.setLabel(Objects.toString(row.get("label"), ""));
        n.setAnomaScore(toDouble(row.get("anoma_score")));
        n.setAccountType(Objects.toString(row.get("account_type"), ""));
        n.setKycRiskTier(Objects.toString(row.get("kyc_risk_tier"), "LOW"));
        n.setDormant(Boolean.TRUE.equals(row.get("dormant")));
        n.setBranchId(Objects.toString(row.get("branch_id"), ""));
        return n;
    }

    private GraphDtos.GraphEdge toGraphEdge(Map<String, Object> row) {
        GraphDtos.GraphEdge e = new GraphDtos.GraphEdge();
        e.setSource(Objects.toString(row.get("source"), ""));
        e.setTarget(Objects.toString(row.get("target"), ""));
        e.setAmount(toDouble(row.get("amount")));
        e.setTimestamp(Objects.toString(row.get("timestamp"), ""));
        e.setChannel(Objects.toString(row.get("channel"), ""));
        e.setTxId(Objects.toString(row.get("tx_id"), ""));
        return e;
    }

    private static double toDouble(Object val) {
        if (val instanceof Number) return ((Number) val).doubleValue();
        if (val instanceof String) {
            try { return Double.parseDouble((String) val); }
            catch (NumberFormatException ignored) {}
        }
        return 0.0;
    }

    private static long toLong(Object val) {
        if (val instanceof Number) return ((Number) val).longValue();
        return 0L;
    }

    private void logTotalAccountCount() {
        try {
            Optional<Map<String, Object>> row = neo4jClient
                    .query("MATCH (n:Account) RETURN count(n) AS total")
                    .fetch().first();
            long total = row.map(r -> toLong(r.get("total"))).orElse(0L);
            log.warn("getFlaggedAccounts returned 0 results. Total Account nodes in DB: {}. " +
                    "If 0 → seed your database. If >0 → lower FLAGGED_SCORE_THRESHOLD (currently {}).",
                    total, FLAGGED_SCORE_THRESHOLD);
        } catch (Exception e) {
            log.warn("Could not count Account nodes for diagnostics: {}", e.getMessage());
        }
    }
}