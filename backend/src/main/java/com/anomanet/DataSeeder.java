package com.anomanet;

import com.anomanet.alert.model.Alert;
import com.anomanet.alert.repository.AlertRepository;
import com.anomanet.cases.model.Case;
import com.anomanet.cases.repository.CaseRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Seeds demo alerts and cases on startup if the tables are empty.
 * Safe to run multiple times — checks count first.
 * Place at: src/main/java/com/anomanet/DataSeeder.java
 */
@Component
public class DataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private final AlertRepository alertRepository;
    private final CaseRepository  caseRepository;

    public DataSeeder(AlertRepository alertRepository, CaseRepository caseRepository) {
        this.alertRepository = alertRepository;
        this.caseRepository  = caseRepository;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (alertRepository.count() > 0) {
            log.info("DataSeeder: alerts already present, skipping.");
            return;
        }

        log.info("DataSeeder: seeding demo alerts and cases...");

        // ── Seed Alerts ──────────────────────────────────────────────────────────
        List<SeedAlert> seedAlerts = List.of(
            new SeedAlert("ACC-1001", Alert.AlertType.CIRCULAR,         0.91, Map.of("circular", 0.91, "velocity", 0.72)),
            new SeedAlert("ACC-2045", Alert.AlertType.LAYERING,         0.83, Map.of("layering", 0.83, "structuring", 0.45)),
            new SeedAlert("ACC-3312", Alert.AlertType.STRUCTURING,      0.76, Map.of("structuring", 0.76)),
            new SeedAlert("ACC-1892", Alert.AlertType.DORMANT,          0.68, Map.of("dormant", 0.68, "profile_mismatch", 0.52)),
            new SeedAlert("ACC-4401", Alert.AlertType.PROFILE_MISMATCH, 0.72, Map.of("profile_mismatch", 0.72)),
            new SeedAlert("ACC-5590", Alert.AlertType.COMPOSITE,        0.88, Map.of("circular", 0.78, "layering", 0.65, "structuring", 0.55)),
            new SeedAlert("ACC-2219", Alert.AlertType.CIRCULAR,         0.95, Map.of("circular", 0.95, "velocity", 0.88)),
            new SeedAlert("ACC-8872", Alert.AlertType.LAYERING,         0.81, Map.of("layering", 0.81)),
            new SeedAlert("ACC-5504", Alert.AlertType.STRUCTURING,      0.67, Map.of("structuring", 0.67, "profile_mismatch", 0.41)),
            new SeedAlert("ACC-7730", Alert.AlertType.DORMANT,          0.79, Map.of("dormant", 0.79)),
            new SeedAlert("ACC-6621", Alert.AlertType.COMPOSITE,        0.93, Map.of("circular", 0.88, "layering", 0.71)),
            new SeedAlert("ACC-3309", Alert.AlertType.PROFILE_MISMATCH, 0.62, Map.of("profile_mismatch", 0.62))
        );

        List<Alert> savedAlerts = seedAlerts.stream().map(sa -> {
            Alert a = new Alert();
            a.setAccountId(sa.accountId());
            a.setAlertType(sa.type());
            a.setAnomaScore(sa.score());
            a.setScoreBreakdown(sa.breakdown());
            a.setStatus(Alert.AlertStatus.NEW);
            return alertRepository.save(a);
        }).toList();

        log.info("DataSeeder: saved {} alerts", savedAlerts.size());

        // ── Seed Cases (linked to first few alerts) ───────────────────────────────
        List<CaseStatus> caseStatuses = List.of(
            new CaseStatus(savedAlerts.get(0).getId(),  Case.CaseStatus.OPEN,      Case.CasePriority.CRITICAL),
            new CaseStatus(savedAlerts.get(1).getId(),  Case.CaseStatus.OPEN,      Case.CasePriority.HIGH),
            new CaseStatus(savedAlerts.get(2).getId(),  Case.CaseStatus.ESCALATED, Case.CasePriority.HIGH),
            new CaseStatus(savedAlerts.get(5).getId(),  Case.CaseStatus.OPEN,      Case.CasePriority.CRITICAL),
            new CaseStatus(savedAlerts.get(6).getId(),  Case.CaseStatus.OPEN,      Case.CasePriority.MEDIUM),
            new CaseStatus(savedAlerts.get(10).getId(), Case.CaseStatus.ESCALATED, Case.CasePriority.CRITICAL)
        );

        caseStatuses.forEach(cs -> {
            Case c = new Case();
            c.setAlertId(cs.alertId());
            c.setStatus(cs.status());
            c.setPriority(cs.priority());
            caseRepository.save(c);
        });

        log.info("DataSeeder: saved {} cases. Seeding complete.", caseStatuses.size());
    }

    private record SeedAlert(String accountId, Alert.AlertType type, double score, Map<String, Double> breakdown) {}
    private record CaseStatus(UUID alertId, Case.CaseStatus status, Case.CasePriority priority) {}
}