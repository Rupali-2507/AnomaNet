package com.anomanet.simulator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Map;

@RestController
@RequestMapping("/api/simulate")
public class SimulatorController {

    private static final Logger log = LoggerFactory.getLogger(SimulatorController.class);

    private final WebClient webClient;

    public SimulatorController(@Value("${ml.service.url}") String mlServiceUrl) {
        this.webClient = WebClient.builder().baseUrl(mlServiceUrl).build();
    }

    @PostMapping("/scenario")
    public ResponseEntity<Map<String, Object>> triggerScenario(
            @RequestParam String type) {
        try {
            Map<?, ?> mlResponse = webClient.post()
                    .uri("/simulator/trigger?type=" + type)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            log.info("Scenario triggered: type={}", type);
            return ResponseEntity.ok(Map.of(
                "triggered", true,
                "type", type,
                "mlResponse", mlResponse != null ? mlResponse : Map.of()
            ));
        } catch (Exception e) {
            log.error("Scenario trigger failed: {}", e.getMessage());
            return ResponseEntity.ok(Map.of(
                "triggered", false,
                "type", type,
                "error", e.getMessage()
            ));
        }
    }
}
