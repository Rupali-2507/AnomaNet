package com.anomanet.alert.controller;

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

@RestController
@RequestMapping("/alerts")
public class AlertController {

    private final AlertRepository alertRepository;

    public AlertController(AlertRepository alertRepository) {
        this.alertRepository = alertRepository;
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

    @GetMapping("/stats")
    public ResponseEntity<Map<String, Long>> stats() {
        return ResponseEntity.ok(Map.of(
            "total", alertRepository.count(),
            "new", alertRepository.countByStatus(Alert.AlertStatus.NEW),
            "under_review", alertRepository.countByStatus(Alert.AlertStatus.UNDER_REVIEW)
        ));
    }
}
