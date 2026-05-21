package com.anomanet.alert;

import com.anomanet.alert.model.Alert;
import com.anomanet.alert.repository.AlertRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.reactive.function.client.WebClient;
import java.util.List;



@RestController
@RequestMapping("/api/alerts")
public class AlertController {

    private final AlertRepository alertRepository;
    private static final Logger log = LoggerFactory.getLogger(AlertController.class);
    private final WebClient mlWebClient;

    public AlertController(AlertRepository alertRepository,
                       @Value("${ml.service.url}") String mlServiceUrl) {
    this.alertRepository = alertRepository;
    this.mlWebClient = WebClient.builder().baseUrl(mlServiceUrl).build();
}

    @GetMapping
    public ResponseEntity<Page<Alert>> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(alertRepository.findAll(
                PageRequest.of(page, size, Sort.by("createdAt").descending())));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Alert> getById(@PathVariable UUID id) {
        return alertRepository.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}/status")
    public ResponseEntity<Alert> updateStatus(@PathVariable UUID id,
                                               @RequestBody Map<String, String> body) {
        return alertRepository.findById(id).map(alert -> {
            alert.setStatus(Alert.AlertStatus.valueOf(body.get("status")));
            alert.setUpdatedAt(Instant.now());
            return ResponseEntity.ok(alertRepository.save(alert));
        }).orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}/assign")
    public ResponseEntity<Alert> assign(@PathVariable UUID id,
                                         @RequestBody Map<String, String> body) {
        return alertRepository.findById(id).map(alert -> {
            alert.setAssignedTo(UUID.fromString(body.get("investigatorId")));
            alert.setStatus(Alert.AlertStatus.UNDER_REVIEW);
            alert.setUpdatedAt(Instant.now());
            return ResponseEntity.ok(alertRepository.save(alert));
        }).orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{id}/explanation")
    public ResponseEntity<Map<String, Object>> getExplanation(@PathVariable UUID id) {
        return alertRepository.findById(id).map(alert -> {
            try {
                Map<String, Object> requestBody = Map.of(
                    "alert_id",       alert.getId().toString(),
                    "score_breakdown", alert.getScoreBreakdown()
                );
                Map<?, ?> mlResponse = mlWebClient.post()
                    .uri("/ml/explain")
                    .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                    .bodyValue(requestBody)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

                String explanation = mlResponse != null
                    ? (String) mlResponse.get("explanation") : "Explanation unavailable.";
                List<?> patterns = mlResponse != null
                    ? (List<?>) mlResponse.get("patterns") : List.of();

                return ResponseEntity.ok(Map.<String, Object>of(
                    "explanation",    explanation,
                    "evidence_points", alert.getScoreBreakdown().entrySet().stream()
                        .filter(e -> e.getValue() > 0.4)
                        .map(e -> e.getKey() + ": " + String.format("%.4f", e.getValue()))
                        .toList(),
                    "patterns", patterns
                ));
            } catch (Exception e) {
                log.error("ML explain call failed for alert {}: {}", id, e.getMessage());
                return ResponseEntity.ok(Map.<String, Object>of(
                    "explanation", "Explanation temporarily unavailable.",
                    "evidence_points", List.of()
                ));
            }
        }).orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/stats")
    public ResponseEntity<Map<String, Long>> stats() {
        return ResponseEntity.ok(Map.of(
            "total", alertRepository.count(),
            "new", alertRepository.countByStatus(Alert.AlertStatus.NEW),
            "under_review", alertRepository.countByStatus(Alert.AlertStatus.UNDER_REVIEW)
        ));
    }
}
