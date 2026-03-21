package com.anomanet.alert.repository;

import com.anomanet.alert.model.Alert;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface AlertRepository extends JpaRepository<Alert, UUID> {
    Page<Alert> findByStatus(Alert.AlertStatus status, Pageable pageable);
    Page<Alert> findByAlertType(Alert.AlertType type, Pageable pageable);
    long countByStatus(Alert.AlertStatus status);
}
