package com.anomanet.graph;

import com.anomanet.graph.dto.GraphDtos;
import com.anomanet.graph.service.GraphQueryService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/graph")
public class GraphController {

    private final GraphQueryService graphQueryService;

    public GraphController(GraphQueryService graphQueryService) {
        this.graphQueryService = graphQueryService;
    }

    @PostMapping("/subgraph")
    public ResponseEntity<GraphDtos.SubgraphResponse> subgraph(
            @RequestBody GraphDtos.SubgraphRequest req) {
        return ResponseEntity.ok(graphQueryService.getSubgraph(
                req.getAccountId(),
                req.getDepth(),
                req.getHours()));
    }

    @PostMapping("/cycles")
    public ResponseEntity<List<GraphDtos.CycleResult>> cycles(
            @RequestBody GraphDtos.CycleRequest req) {
        return ResponseEntity.ok(graphQueryService.detectCycles(
                req.getAccountId(),
                req.getMaxLength(),
                req.getHours()));
    }

    @GetMapping("/account/{id}/stats")
    public ResponseEntity<GraphDtos.AccountStats> stats(@PathVariable String id) {
        return ResponseEntity.ok(graphQueryService.getAccountStats(id));
    }

    // Returns the list of high-risk accounts to populate the graph explorer dropdown
    @GetMapping("/flagged-accounts")
    public ResponseEntity<Map<String, Object>> flaggedAccounts() {
        List<Map<String, Object>> accounts = graphQueryService.getFlaggedAccounts();
        return ResponseEntity.ok(Map.of("accounts", accounts));
    }

    // Serves the 3D graph explorer; accepts query params instead of a POST body
    @GetMapping("/scored-subgraph")
    public ResponseEntity<GraphDtos.SubgraphResponse> scoredSubgraph(
            @RequestParam String accountId,
            @RequestParam(defaultValue = "3") int depth) {
        return ResponseEntity.ok(graphQueryService.getSubgraph(accountId, depth, 168));
    }
}