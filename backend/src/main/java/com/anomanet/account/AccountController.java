package com.anomanet.account;

import com.anomanet.transaction.repository.TransactionRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private final TransactionRepository transactionRepository;

    public AccountController(TransactionRepository transactionRepository) {
        this.transactionRepository = transactionRepository;
    }

    /**
     * Autocomplete search — returns distinct account IDs seen in transactions
     * that start with the query string (max 10 results).
     * Used by Manya's Graph Explorer search box.
     */
    @GetMapping("/search")
    public ResponseEntity<List<Map<String, String>>> search(@RequestParam String q) {
        List<String> sources = transactionRepository.findDistinctSourceAccountIdsByPrefix(q);
        List<String> dests   = transactionRepository.findDistinctDestAccountIdsByPrefix(q);

        List<Map<String, String>> results = Stream.concat(sources.stream(), dests.stream())
                .distinct()
                .filter(id -> id.toLowerCase().contains(q.toLowerCase()))
                .limit(10)
                .map(id -> Map.of("id", id, "label", id))
                .toList();

        return ResponseEntity.ok(results);
    }
}
