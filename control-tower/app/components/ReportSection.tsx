import { useState } from "react";
import { Search, Download, FileText, ArrowLeft, Save, ChevronRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Report {
  id: string;
  title: string;
  date: string;
  size: string;
  type: string;
  caseRef: string;
  alertRef: string;
  pattern: string;
  anomaScore: number;
  totalAmount: string;
  accountsInvolved: string[];
  duration: string;
  branches: string[];
  mlScores: { typology: string; score: number; method: string }[];
  narrativeSummary: string;
  investigatorFindings: string;
  supportingRefs: string;
  reportLog: { time: string; tag: string; message: string }[];
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const REPORTS: Report[] = [
  {
    id: "1",
    title: "Quarterly Fraud Landscape Q1 2026",
    date: "Mar 12, 2026",
    size: "4.2 MB",
    type: "PDF",
    caseRef: "CASE-0042",
    alertRef: "ALT-0091",
    pattern: "CIRCULAR",
    anomaScore: 0.91,
    totalAmount: "₹1,43,70,000",
    accountsInvolved: ["ACC-8872", "9912", "3341"],
    duration: "6 seconds",
    branches: ["HDFC Mumbai", "HDFC Delhi"],
    mlScores: [
      { typology: "CIRCULAR", score: 0.91, method: "Johnson's Algo" },
      { typology: "LAYERING", score: 0.82, method: "Isolation Forest" },
      { typology: "PROFILE", score: 0.78, method: "Autoencoder" },
      { typology: "STRUCTURING", score: 0.45, method: "XGBoost" },
      { typology: "DORMANCY", score: 0.12, method: "State Machine" },
    ],
    narrativeSummary:
      "Three accounts (ACC-8872, ACC-9912, ACC-3341) engaged in a rapid circular fund movement totaling ₹1.43Cr in under 6 seconds across Mumbai and Delhi branches. All three counterparty relationships were first-time. Pattern consistent with round-tripping to create false appearance of legitimate trade.",
    investigatorFindings:
      "Accounts opened within 2 weeks of each other. No prior business relationship. KYC declared occupations inconsistent with transfer volumes. Recommend STR filing.",
    supportingRefs: "ALT-0091, TX-48821, TX-48822, TX-48823",
    reportLog: [
      { time: "15:02:10", tag: "RPT", message: "POST /api/reports/generate · CASE-0042" },
      { time: "15:02:10", tag: "RPT", message: "Fetching case + alert + transactions from DB" },
      { time: "15:02:11", tag: "RPT", message: "GET /ml/explain · narrative generated" },
      { time: "15:02:11", tag: "RPT", message: "iText 7 PDF building · 4 pages" },
      { time: "15:02:12", tag: "RPT", message: "PDF ready · goAML-format · download URL issued" },
    ],
  },
  {
    id: "2",
    title: "Mule Ring Detection: Advanced GNN Patterns",
    date: "Mar 08, 2026",
    size: "1.8 MB",
    type: "DOCX",
    caseRef: "CASE-0031",
    alertRef: "ALT-0077",
    pattern: "LAYERING",
    anomaScore: 0.82,
    totalAmount: "₹87,40,000",
    accountsInvolved: ["ACC-1121", "ACC-3345", "ACC-9981"],
    duration: "12 minutes",
    branches: ["SBI Chennai", "Axis Mumbai"],
    mlScores: [
      { typology: "LAYERING", score: 0.82, method: "Isolation Forest" },
      { typology: "CIRCULAR", score: 0.74, method: "Johnson's Algo" },
      { typology: "STRUCTURING", score: 0.61, method: "XGBoost" },
      { typology: "PROFILE", score: 0.39, method: "Autoencoder" },
      { typology: "DORMANCY", score: 0.08, method: "State Machine" },
    ],
    narrativeSummary:
      "Graph neural network analysis identified a mule ring of 3 accounts facilitating layering across Chennai and Mumbai branches. Funds were split into sub-threshold amounts before being consolidated, indicating structured layering behavior.",
    investigatorFindings:
      "All accounts linked to same IP address for registration. Transaction velocity 10x above peer group baseline. Recommend SAR filing and account freeze pending review.",
    supportingRefs: "ALT-0077, TX-31201, TX-31202, TX-31210",
    reportLog: [
      { time: "11:14:05", tag: "RPT", message: "POST /api/reports/generate · CASE-0031" },
      { time: "11:14:06", tag: "RPT", message: "Fetching GNN subgraph · 3 nodes, 7 edges" },
      { time: "11:14:07", tag: "RPT", message: "Narrative generated · layering pattern confirmed" },
      { time: "11:14:08", tag: "RPT", message: "DOCX build complete · 6 pages" },
    ],
  },
  {
    id: "3",
    title: "Weekly Anomaly Summary #44",
    date: "Mar 01, 2026",
    size: "890 KB",
    type: "PDF",
    caseRef: "CASE-0028",
    alertRef: "ALT-0069",
    pattern: "STRUCTURING",
    anomaScore: 0.45,
    totalAmount: "₹23,10,000",
    accountsInvolved: ["ACC-4410"],
    duration: "3 days",
    branches: ["ICICI Pune"],
    mlScores: [
      { typology: "STRUCTURING", score: 0.45, method: "XGBoost" },
      { typology: "DORMANCY", score: 0.33, method: "State Machine" },
      { typology: "PROFILE", score: 0.21, method: "Autoencoder" },
      { typology: "CIRCULAR", score: 0.11, method: "Johnson's Algo" },
      { typology: "LAYERING", score: 0.07, method: "Isolation Forest" },
    ],
    narrativeSummary:
      "Single account (ACC-4410) made 14 cash deposits over 3 days, each below the ₹2L reporting threshold. Cumulative total of ₹23.1L suggests deliberate structuring to avoid CTR obligations at ICICI Pune branch.",
    investigatorFindings:
      "Account holder has no declared business income matching deposit frequency. Branch teller noted repeated same-day visits. CTR threshold avoidance pattern confirmed by XGBoost model.",
    supportingRefs: "ALT-0069, TX-28001 through TX-28014",
    reportLog: [
      { time: "09:00:01", tag: "RPT", message: "Weekly batch job triggered · summary #44" },
      { time: "09:00:03", tag: "RPT", message: "14 anomaly alerts aggregated" },
      { time: "09:00:04", tag: "RPT", message: "PDF summary generated · 2 pages" },
    ],
  },
];

// ─── Score color helper ────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 0.75) return "#ef4444";
  if (score >= 0.5) return "#f97316";
  if (score >= 0.3) return "#eab308";
  return "#22c55e";
}

// ─── FIU Detail View ──────────────────────────────────────────────────────────

function FIUDetailView({ report, onBack }: { report: Report; onBack: () => void }) {
  const [narrativeSummary, setNarrativeSummary] = useState(report.narrativeSummary);
  const [investigatorFindings, setInvestigatorFindings] = useState(report.investigatorFindings);
  const [supportingRefs, setSupportingRefs] = useState(report.supportingRefs);

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-xs uppercase tracking-widest font-bold"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <ChevronRight size={14} className="text-white/20" />
          <span className="text-white/60 text-xs uppercase tracking-widest font-bold">
            FIU Evidence Package — {report.caseRef}
          </span>
        </div>
        <button
          style={{ borderColor: "#CAFF33", color: "#CAFF33" }}
          className="flex items-center gap-2 px-4 py-2 border rounded text-xs font-bold uppercase tracking-widest hover:bg-[#CAFF33]/10 transition-colors"
        >
          <Download size={14} />
          Generate FIU Report PDF
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* ── Left Column ── */}
        <div className="space-y-4">
          {/* Auto-populated case info */}
          <div
            style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
            className="border rounded p-4"
          >
            <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold mb-4">
              Auto-Populated from Case (Read-Only)
            </p>
            <div className="space-y-2">
              {[
                { label: "Case ref", value: report.caseRef },
                { label: "Alert ref", value: report.alertRef },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-white/40 text-xs">{label}</span>
                  <span className="text-white text-xs font-bold">{value}</span>
                </div>
              ))}

              <div className="flex justify-between items-center">
                <span className="text-white/40 text-xs">Pattern</span>
                <span
                  style={{ background: "#ef4444", color: "#fff" }}
                  className="text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest"
                >
                  {report.pattern}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-white/40 text-xs">AnomaScore</span>
                <span
                  style={{ background: scoreColor(report.anomaScore), color: "#fff" }}
                  className="text-xs font-black px-2 py-0.5 rounded min-w-[40px] text-center"
                >
                  {report.anomaScore.toFixed(2)}
                </span>
              </div>

              {[
                { label: "Total amount", value: report.totalAmount },
                {
                  label: "Accounts involved",
                  value: `${report.accountsInvolved.length} · ${report.accountsInvolved.join(", ")}`,
                },
                { label: "Duration", value: report.duration },
                { label: "Branches", value: report.branches.join(" · ") },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center gap-4">
                  <span className="text-white/40 text-xs shrink-0">{label}</span>
                  <span className="text-white text-xs font-bold text-right">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ML Score Breakdown */}
          <div
            style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
            className="border rounded p-4"
          >
            <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold mb-4">
              ML Score Breakdown
            </p>
            <div className="space-y-0">
              <div className="grid grid-cols-3 text-[10px] text-white/30 uppercase tracking-widest font-bold pb-2 border-b border-white/5">
                <span>Typology</span>
                <span className="text-center">Score</span>
                <span className="text-right">Method</span>
              </div>
              {report.mlScores.map(({ typology, score, method }) => (
                <div
                  key={typology}
                  className="grid grid-cols-3 items-center py-2.5 border-b border-white/5 last:border-0"
                >
                  <span className="text-white text-xs font-black uppercase tracking-wider">
                    {typology}
                  </span>
                  <div className="flex justify-center">
                    <span
                      style={{ background: scoreColor(score), color: "#fff" }}
                      className="text-xs font-black px-2 py-0.5 rounded min-w-[40px] text-center"
                    >
                      {score.toFixed(2)}
                    </span>
                  </div>
                  <span className="text-white/40 text-xs text-right">{method}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Column ── */}
        <div className="space-y-4">
          {/* Investigator Narrative */}
          <div
            style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
            className="border rounded p-4"
          >
            <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold mb-4">
              Investigator Narrative
            </p>

            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-1">
                  Narrative summary
                </p>
                <textarea
                  value={narrativeSummary}
                  onChange={(e) => setNarrativeSummary(e.target.value)}
                  rows={4}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    borderColor: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.8)",
                    fontFamily: "inherit",
                    resize: "none",
                  }}
                  className="w-full border rounded p-3 text-xs leading-relaxed focus:outline-none focus:border-[#CAFF33]/40 transition-colors"
                />
              </div>

              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-1">
                  Investigator findings
                </p>
                <textarea
                  value={investigatorFindings}
                  onChange={(e) => setInvestigatorFindings(e.target.value)}
                  rows={3}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    borderColor: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.8)",
                    fontFamily: "inherit",
                    resize: "none",
                  }}
                  className="w-full border rounded p-3 text-xs leading-relaxed focus:outline-none focus:border-[#CAFF33]/40 transition-colors"
                />
              </div>

              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-1">
                  Supporting references
                </p>
                <input
                  value={supportingRefs}
                  onChange={(e) => setSupportingRefs(e.target.value)}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    borderColor: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.8)",
                    fontFamily: "inherit",
                  }}
                  className="w-full border rounded p-3 text-xs focus:outline-none focus:border-[#CAFF33]/40 transition-colors"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-4">
              <button
                style={{ borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)" }}
                className="flex items-center gap-2 px-3 py-2 border rounded text-xs font-bold uppercase tracking-widest hover:border-white/30 hover:text-white transition-colors"
              >
                <Save size={12} />
                Save Draft
              </button>
              <button
                style={{ background: "#CAFF33", color: "#000" }}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-black uppercase tracking-widest hover:opacity-90 transition-opacity"
              >
                <Download size={12} />
                Generate &amp; Download FIU PDF
              </button>
            </div>
          </div>

          {/* Report generation log */}
          <div
            style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
            className="border rounded p-4"
          >
            <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold mb-3">
              Report generation log
            </p>
            <div className="space-y-1">
              {report.reportLog.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="text-white/30 tabular-nums">{entry.time}</span>
                  <span style={{ color: "#CAFF33" }} className="font-black">
                    {entry.tag}
                  </span>
                  <span className="text-white/50">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reports List ─────────────────────────────────────────────────────────────

function ReportsList({ onSelect }: { onSelect: (r: Report) => void }) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-black text-white">Intelligence Reports</h2>
        <div className="flex gap-2">
          <button className="p-2 bg-white/5 border border-white/10 rounded-lg text-white/60 hover:text-white hover:border-white/20 transition-colors">
            <Search size={18} />
          </button>
          <button className="p-2 bg-white/5 border border-white/10 rounded-lg text-white/60 hover:text-white hover:border-white/20 transition-colors">
            <Download size={18} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {REPORTS.map((doc) => (
          <div
            key={doc.id}
            onClick={() => onSelect(doc)}
            style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}
            className="p-4 border rounded-xl flex items-center justify-between group hover:bg-white/[0.04] hover:border-white/[0.12] transition-all cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-white/[0.08] transition-colors">
                <FileText size={24} className="text-white/40 group-hover:text-white/60 transition-colors" />
              </div>
              <div>
                <p className="font-bold text-white group-hover:text-[#CAFF33] transition-colors">
                  {doc.title}
                </p>
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">
                  {doc.date} · {doc.size}
                </p>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="text-white/20 group-hover:text-white/60 transition-colors"
            >
              <Download size={20} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function ReportsSection() {
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  return (
    <div>
      {selectedReport ? (
        <FIUDetailView report={selectedReport} onBack={() => setSelectedReport(null)} />
      ) : (
        <ReportsList onSelect={setSelectedReport} />
      )}
    </div>
  );
}