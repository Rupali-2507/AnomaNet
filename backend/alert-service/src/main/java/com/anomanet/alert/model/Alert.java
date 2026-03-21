package com.anomanet.alert.model;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "alerts")
public class Alert {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "transaction_id")
    private UUID transactionId;

    @Column(name = "account_id", nullable = false)
    private String accountId;

    @Enumerated(EnumType.STRING)
    @Column(name = "alert_type", nullable = false)
    private AlertType alertType;

    @Column(name = "anoma_score", nullable = false)
    private double anomaScore;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "score_breakdown", columnDefinition = "jsonb")
    private Map<String, Double> scoreBreakdown;

    @Enumerated(EnumType.STRING)
    private AlertStatus status = AlertStatus.NEW;

    @Column(name = "assigned_to")
    private UUID assignedTo;

    @Column(name = "created_at")
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at")
    private Instant updatedAt = Instant.now();

    public enum AlertType { LAYERING, CIRCULAR, STRUCTURING, DORMANT, PROFILE_MISMATCH, COMPOSITE }
    public enum AlertStatus { NEW, UNDER_REVIEW, ESCALATED, REPORTED_FIU, CLOSED_FP, CLOSED_SAR }

    public UUID getId() { return id; }
    public UUID getTransactionId() { return transactionId; }
    public void setTransactionId(UUID v) { transactionId = v; }
    public String getAccountId() { return accountId; }
    public void setAccountId(String v) { accountId = v; }
    public AlertType getAlertType() { return alertType; }
    public void setAlertType(AlertType v) { alertType = v; }
    public double getAnomaScore() { return anomaScore; }
    public void setAnomaScore(double v) { anomaScore = v; }
    public Map<String, Double> getScoreBreakdown() { return scoreBreakdown; }
    public void setScoreBreakdown(Map<String, Double> v) { scoreBreakdown = v; }
    public AlertStatus getStatus() { return status; }
    public void setStatus(AlertStatus v) { status = v; }
    public UUID getAssignedTo() { return assignedTo; }
    public void setAssignedTo(UUID v) { assignedTo = v; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant v) { updatedAt = v; }
}
