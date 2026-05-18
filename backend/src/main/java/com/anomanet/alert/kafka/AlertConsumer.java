package com.anomanet.alert.kafka;

import com.anomanet.alert.model.Alert;
import com.anomanet.alert.repository.AlertRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
public class AlertConsumer {

    private static final Logger log = LoggerFactory.getLogger(AlertConsumer.class);
    private final AlertRepository alertRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;

    public AlertConsumer(AlertRepository alertRepository,
                         SimpMessagingTemplate messagingTemplate,
                         ObjectMapper objectMapper) {
        this.alertRepository = alertRepository;
        this.messagingTemplate = messagingTemplate;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(topics = "${kafka.topics.alerts-generated}", groupId = "alert-service")
    public void consume(String message) {
        try {
            JsonNode event = objectMapper.readTree(message);
            log.info("Alert received: score={}", event.get("anoma_score"));

            Alert alert = new Alert();
            if (event.has("transaction_id")) {
                alert.setTransactionId(UUID.fromString(event.get("transaction_id").asText()));
            }
            alert.setAccountId(event.get("account_id").asText());
            alert.setAnomaScore(event.get("anoma_score").asDouble());

            // Parse score breakdown
            Map<String, Double> breakdown = new HashMap<>();
            JsonNode scoreNode = event.get("score_breakdown");
            if (scoreNode != null) {
                scoreNode.fields().forEachRemaining(e ->
                    breakdown.put(e.getKey(), e.getValue().asDouble()));
            }
            alert.setScoreBreakdown(breakdown);
            alert.setAlertType(deriveAlertType(event.get("detected_patterns")));

            Alert saved = alertRepository.save(alert);
            log.info("Alert saved: id={} score={}", saved.getId(), saved.getAnomaScore());

            // Push WebSocket notification
            Map<String, Object> wsPayload = new HashMap<>();
            wsPayload.put("id", saved.getId().toString());
            wsPayload.put("accountId", saved.getAccountId());
            wsPayload.put("anomaScore", saved.getAnomaScore());
            wsPayload.put("alertType", saved.getAlertType().name());
            wsPayload.put("scoreBreakdown", saved.getScoreBreakdown());
            wsPayload.put("createdAt", saved.getCreatedAt().toString());

            messagingTemplate.convertAndSend("/topic/alerts", wsPayload);
            log.info("WebSocket pushed to /topic/alerts");

        } catch (Exception e) {
            log.error("Failed to process alert event", e);
        }
    }

    private Alert.AlertType deriveAlertType(JsonNode patterns) {
        if (patterns == null || !patterns.isArray() || patterns.isEmpty())
            return Alert.AlertType.COMPOSITE;
        if (patterns.size() > 1) return Alert.AlertType.COMPOSITE;
        return switch (patterns.get(0).asText()) {
            case "CIRCULAR"         -> Alert.AlertType.CIRCULAR;
            case "LAYERING"         -> Alert.AlertType.LAYERING;
            case "STRUCTURING"      -> Alert.AlertType.STRUCTURING;
            case "DORMANT"          -> Alert.AlertType.DORMANT;
            case "PROFILE_MISMATCH" -> Alert.AlertType.PROFILE_MISMATCH;
            default                 -> Alert.AlertType.COMPOSITE;
        };
    }
}
