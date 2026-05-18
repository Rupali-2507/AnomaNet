package com.anomanet.report;

import com.anomanet.alert.model.Alert;
import com.anomanet.alert.repository.AlertRepository;
import com.anomanet.cases.model.Case;
import com.anomanet.cases.repository.CaseRepository;
import com.itextpdf.kernel.colors.ColorConstants;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.element.Table;
import com.itextpdf.layout.element.Cell;
import com.itextpdf.layout.properties.UnitValue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/reports")
public class ReportController {

    private static final Logger log = LoggerFactory.getLogger(ReportController.class);
    private static final DateTimeFormatter FMT =
        DateTimeFormatter.ofPattern("dd-MMM-yyyy HH:mm:ss").withZone(ZoneId.of("Asia/Kolkata"));

    private final CaseRepository caseRepo;
    private final AlertRepository alertRepo;

    public ReportController(CaseRepository caseRepo, AlertRepository alertRepo) {
        this.caseRepo = caseRepo;
        this.alertRepo = alertRepo;
    }

    @PostMapping("/generate")
    public ResponseEntity<byte[]> generate(@RequestBody Map<String, String> body) {
        UUID caseId = UUID.fromString(body.get("caseId"));

        Case c = caseRepo.findById(caseId)
                .orElseThrow(() -> new RuntimeException("Case not found: " + caseId));
        Alert alert = alertRepo.findById(c.getAlertId())
                .orElseThrow(() -> new RuntimeException("Alert not found: " + c.getAlertId()));

        try {
            byte[] pdf = buildPdf(c, alert);
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename=\"FIU_Report_" + caseId + ".pdf\"")
                    .contentType(MediaType.APPLICATION_PDF)
                    .body(pdf);
        } catch (Exception e) {
            log.error("PDF generation failed for case {}: {}", caseId, e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }

    private byte[] buildPdf(Case c, Alert alert) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        PdfWriter writer = new PdfWriter(baos);
        PdfDocument pdf = new PdfDocument(writer);
        Document doc = new Document(pdf);

        // ── Cover ─────────────────────────────────────────────────────────
        doc.add(new Paragraph("AnomaNet — FIU Evidence Package")
                .setBold().setFontSize(20).setFontColor(ColorConstants.DARK_GRAY));
        doc.add(new Paragraph("CONFIDENTIAL — For Submission to FIU-IND goAML Portal")
                .setItalic().setFontSize(10).setFontColor(ColorConstants.RED));
        doc.add(new Paragraph(" "));

        // ── Case Summary ──────────────────────────────────────────────────
        doc.add(new Paragraph("Case Summary").setBold().setFontSize(14));
        Table summary = new Table(UnitValue.createPercentArray(new float[]{30, 70}))
                .useAllAvailableWidth();
        addRow(summary, "Case ID",       c.getId().toString());
        addRow(summary, "Alert ID",      c.getAlertId().toString());
        addRow(summary, "Status",        c.getStatus().name());
        addRow(summary, "Priority",      c.getPriority().name());
        addRow(summary, "Created At",    FMT.format(c.getCreatedAt()));
        doc.add(summary);
        doc.add(new Paragraph(" "));

        // ── AnomaScore Breakdown ──────────────────────────────────────────
        doc.add(new Paragraph("ML Risk Score Breakdown").setBold().setFontSize(14));
        Table scoreTable = new Table(UnitValue.createPercentArray(new float[]{50, 50}))
                .useAllAvailableWidth();
        scoreTable.addHeaderCell(new Cell().add(new Paragraph("Pattern").setBold()));
        scoreTable.addHeaderCell(new Cell().add(new Paragraph("Score").setBold()));
        addRow(scoreTable, "COMPOSITE (AnomaScore)", String.format("%.4f", alert.getAnomaScore()));
        if (alert.getScoreBreakdown() != null) {
            alert.getScoreBreakdown().forEach((k, v) ->
                addRow(scoreTable, k.toUpperCase(), String.format("%.4f", v)));
        }
        doc.add(scoreTable);
        doc.add(new Paragraph(" "));

        // ── Alert Details ─────────────────────────────────────────────────
        doc.add(new Paragraph("Alert Details").setBold().setFontSize(14));
        Table alertTable = new Table(UnitValue.createPercentArray(new float[]{30, 70}))
                .useAllAvailableWidth();
        addRow(alertTable, "Account ID",   alert.getAccountId());
        addRow(alertTable, "Alert Type",   alert.getAlertType().name());
        addRow(alertTable, "Alert Status", alert.getStatus().name());
        addRow(alertTable, "Generated At", FMT.format(alert.getCreatedAt()));
        doc.add(alertTable);
        doc.add(new Paragraph(" "));

        // ── Narrative ─────────────────────────────────────────────────────
        doc.add(new Paragraph("Investigator Narrative").setBold().setFontSize(14));
        doc.add(new Paragraph(
            "Account " + alert.getAccountId() +
            " triggered a " + alert.getAlertType().name() +
            " alert with a composite AnomaScore of " +
            String.format("%.2f", alert.getAnomaScore()) +
            " on " + FMT.format(alert.getCreatedAt()) +
            ". This case has been reviewed and is submitted for FIU-IND consideration."
        ).setFontSize(11));

        doc.add(new Paragraph(" "));
        doc.add(new Paragraph("Generated by AnomaNet | " + FMT.format(Instant.now()))
                .setFontSize(8).setFontColor(ColorConstants.GRAY));

        doc.close();
        return baos.toByteArray();
    }

    private void addRow(Table table, String label, String value) {
        table.addCell(new Cell().add(new Paragraph(label).setBold()));
        table.addCell(new Cell().add(new Paragraph(value != null ? value : "N/A")));
    }
}
